"""Test helpers: a *real* ``AsyncAnthropic`` client over a mocked HTTP transport.

Shared by the SDK contract tests (``app/test_anthropic_sdk_contract.py``), the
per-chain wire tests (``app/chains/test_anthropic_wire.py``) and the eval-judge
test. Only the transport is fake: request building, header defaults, argument
validation and response parsing are the installed SDK's own, so a dependency
resolve that changes the SDK's call signature or wire format is caught here
rather than by a failing production request.

Not imported by production code.
"""

from __future__ import annotations

import importlib
import json
from typing import Any

import anthropic

SDK_MAJOR = int(anthropic.__version__.split(".")[0])

# The SDK's own HTTP library (httpx on 0.x, httpx2 on 1.x+), so the transport is
# accepted by whichever SDK is installed and a failure points at the call itself.
_http = importlib.import_module("httpx2" if SDK_MAJOR >= 1 else "httpx")

MODEL = "claude-haiku-4-5"

# The Messages API version the current SDK (2.x) sends by default. That version
# rejects every sampling parameter below on every model.
EXPECTED_API_VERSION = "2026-10-21"
SAMPLING_PARAMS = ("temperature", "top_p", "top_k")


def message_json(content: list[dict], *, stop_reason: str = "end_turn") -> dict:
    return {
        "id": "msg_test",
        "type": "message",
        "role": "assistant",
        "model": MODEL,
        "content": content,
        "stop_reason": stop_reason,
        "stop_sequence": None,
        "usage": {"input_tokens": 12, "output_tokens": 3},
    }


def _sse(content: list[dict], stop_reason: str) -> bytes:
    events: list[tuple[str, dict]] = [
        ("message_start", {"type": "message_start", "message": {
            **message_json([]), "stop_reason": None,
            "usage": {"input_tokens": 12, "output_tokens": 1}}}),
    ]
    for index, block in enumerate(content):
        if block["type"] == "text":
            events += [
                ("content_block_start", {"type": "content_block_start", "index": index,
                                         "content_block": {"type": "text", "text": ""}}),
                ("content_block_delta", {"type": "content_block_delta", "index": index,
                                         "delta": {"type": "text_delta", "text": block["text"]}}),
            ]
        elif block["type"] == "tool_use":
            events += [
                ("content_block_start", {"type": "content_block_start", "index": index,
                                         "content_block": {"type": "tool_use", "id": block["id"],
                                                           "name": block["name"], "input": {}}}),
                ("content_block_delta", {"type": "content_block_delta", "index": index,
                                         "delta": {"type": "input_json_delta",
                                                   "partial_json": json.dumps(block["input"])}}),
            ]
        else:  # pragma: no cover - test helper misuse
            raise ValueError(f"unsupported block type {block['type']!r}")
        events.append(("content_block_stop", {"type": "content_block_stop", "index": index}))
    events += [
        ("message_delta", {"type": "message_delta",
                           "delta": {"stop_reason": stop_reason, "stop_sequence": None},
                           "usage": {"output_tokens": 3}}),
        ("message_stop", {"type": "message_stop"}),
    ]
    return "".join(
        f"event: {name}\ndata: {json.dumps(data)}\n\n" for name, data in events
    ).encode()


def text_turn(text: str) -> dict:
    """A scripted assistant turn: one text block, ``stop_reason=end_turn``."""
    return {"content": [{"type": "text", "text": text}], "stop_reason": "end_turn"}


def tool_use_turn(name: str, tool_input: dict, *, tool_id: str = "toolu_test_1") -> dict:
    """A scripted assistant turn: one tool call, ``stop_reason=tool_use``."""
    return {
        "content": [{"type": "tool_use", "id": tool_id, "name": name, "input": tool_input}],
        "stop_reason": "tool_use",
    }


class Recorder:
    """Mock transport handler: records each request (body + headers) and answers
    like the Messages API — buffered JSON, or SSE when the body asks to stream.

    ``turns`` is either one reply text, or a list of scripted turns
    (:func:`text_turn` / :func:`tool_use_turn`) answered in order; the last turn
    repeats once the script runs out.
    """

    def __init__(self, turns: str | list[dict]):
        self.turns = [text_turn(turns)] if isinstance(turns, str) else list(turns)
        self.bodies: list[dict] = []
        self.headers: list[dict[str, str]] = []

    def __call__(self, request):
        body = json.loads(request.content)
        self.bodies.append(body)
        self.headers.append({k.lower(): v for k, v in request.headers.items()})
        turn = self.turns[min(len(self.bodies), len(self.turns)) - 1]
        if body.get("stream"):
            return _http.Response(
                200,
                headers={"content-type": "text/event-stream"},
                content=_sse(turn["content"], turn["stop_reason"]),
            )
        return _http.Response(
            200, json=message_json(turn["content"], stop_reason=turn["stop_reason"])
        )


def real_client(recorder: Recorder) -> anthropic.AsyncAnthropic:
    return anthropic.AsyncAnthropic(
        api_key="test-key",
        base_url="http://anthropic.test",
        max_retries=0,
        http_client=_http.AsyncClient(transport=_http.MockTransport(recorder)),
    )


def sampling_params_in(body: dict) -> dict[str, Any]:
    return {k: body[k] for k in SAMPLING_PARAMS if k in body}


def assert_wire_contract(recorder: Recorder, *, min_requests: int = 1) -> None:
    """Every recorded request is valid for API version 2026-10-21: it carries
    that ``anthropic-version`` header and no sampling parameter."""
    assert len(recorder.bodies) >= min_requests, (
        f"expected at least {min_requests} Messages request(s), recorded {len(recorder.bodies)}"
    )
    for i, body in enumerate(recorder.bodies):
        leaked = sampling_params_in(body)
        assert not leaked, (
            f"request #{i + 1} sends sampling params {leaked}; API version "
            f"{EXPECTED_API_VERSION} rejects {', '.join(SAMPLING_PARAMS)} on every model"
        )
    for i, headers in enumerate(recorder.headers):
        assert headers.get("anthropic-version") == EXPECTED_API_VERSION, (
            f"request #{i + 1} sent anthropic-version={headers.get('anthropic-version')!r}, "
            f"expected {EXPECTED_API_VERSION!r} (anthropic SDK {anthropic.__version__} installed)"
        )
