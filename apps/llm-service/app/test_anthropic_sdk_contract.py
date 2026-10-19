"""Contract tests against the *installed* Anthropic SDK.

Every other chain test swaps the SDK client for a MagicMock, so a dependency
resolve that changes the SDK's call signature goes unnoticed until a real
request fails. That happened when an unbounded `anthropic` pin resolved 1.x,
which dropped the `temperature` keyword: every chat RPC raised TypeError →
gRPC INTERNAL. These tests drive a real `AsyncAnthropic` client, with only the
HTTP transport mocked, through the same helpers and kwargs the chains use.
"""

from __future__ import annotations

import importlib
import json

import anthropic
import pytest

from app import observability
from app.chains import user_chat_chain

# The SDK's own HTTP library (httpx on 0.x, httpx2 on 1.x), so the transport is
# accepted by whichever SDK is installed and a failure points at the call itself.
_http = importlib.import_module(
    "httpx2" if int(anthropic.__version__.split(".")[0]) >= 1 else "httpx"
)

_MODEL = "claude-haiku-4-5"


def _message_json(text: str) -> dict:
    return {
        "id": "msg_test",
        "type": "message",
        "role": "assistant",
        "model": _MODEL,
        "content": [{"type": "text", "text": text}],
        "stop_reason": "end_turn",
        "stop_sequence": None,
        "usage": {"input_tokens": 12, "output_tokens": 3},
    }


def _sse(text: str) -> bytes:
    events = [
        ("message_start", {"type": "message_start", "message": {
            **_message_json(""), "content": [], "stop_reason": None,
            "usage": {"input_tokens": 12, "output_tokens": 1}}}),
        ("content_block_start", {"type": "content_block_start", "index": 0,
                                 "content_block": {"type": "text", "text": ""}}),
        ("content_block_delta", {"type": "content_block_delta", "index": 0,
                                 "delta": {"type": "text_delta", "text": text}}),
        ("content_block_stop", {"type": "content_block_stop", "index": 0}),
        ("message_delta", {"type": "message_delta",
                           "delta": {"stop_reason": "end_turn", "stop_sequence": None},
                           "usage": {"output_tokens": 3}}),
        ("message_stop", {"type": "message_stop"}),
    ]
    return "".join(
        f"event: {name}\ndata: {json.dumps(data)}\n\n" for name, data in events
    ).encode()


class _Recorder:
    """Mock transport handler: records each request body, answers like the API."""

    def __init__(self, text: str):
        self.text = text
        self.bodies: list[dict] = []

    def __call__(self, request):
        body = json.loads(request.content)
        self.bodies.append(body)
        if body.get("stream"):
            return _http.Response(
                200, headers={"content-type": "text/event-stream"}, content=_sse(self.text)
            )
        return _http.Response(200, json=_message_json(self.text))


def _real_client(recorder: _Recorder) -> anthropic.AsyncAnthropic:
    return anthropic.AsyncAnthropic(
        api_key="test-key",
        base_url="http://anthropic.test",
        max_retries=0,
        http_client=_http.AsyncClient(transport=_http.MockTransport(recorder)),
    )


# The kwargs shape every chain passes (chat_chain, user_chat_chain,
# job_chat_chain, cv_chain, cover_letter_chain).
def _chain_kwargs() -> dict:
    return dict(
        model=_MODEL,
        max_tokens=1024,
        temperature=0.4,
        system=[{"type": "text", "text": "You are helpful."}],
        messages=[{"role": "user", "content": "Hi"}],
    )


@pytest.fixture(autouse=True)
def _no_langfuse(monkeypatch):
    for var in ("LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY", "LANGFUSE_HOST"):
        monkeypatch.delenv(var, raising=False)
    observability.reset()
    yield
    observability.reset()


@pytest.mark.asyncio
async def test_buffered_call_sends_temperature_through_real_sdk():
    """anthropic_create (user chat, job chat, generate, cover letter)."""
    recorder = _Recorder("Hello there")
    message = await observability.anthropic_create(
        _real_client(recorder), name="contract", **_chain_kwargs()
    )

    assert message.content[0].text == "Hello there"
    assert recorder.bodies[0]["temperature"] == 0.4
    assert recorder.bodies[0]["model"] == _MODEL


@pytest.mark.asyncio
async def test_streamed_call_sends_temperature_through_real_sdk():
    """anthropic_stream (in-editor chat) — reassembled from SSE."""
    recorder = _Recorder("Streamed reply")
    message = await observability.anthropic_stream(
        _real_client(recorder), name="contract", **_chain_kwargs()
    )

    assert "".join(b.text for b in message.content if b.type == "text") == "Streamed reply"
    assert recorder.bodies[0]["stream"] is True
    assert recorder.bodies[0]["temperature"] == 0.4


@pytest.mark.asyncio
async def test_global_assistant_reply_through_real_sdk(monkeypatch):
    """The read-only global assistant (POST /api/chat with no document) end to
    end through the chain, on the real SDK."""
    monkeypatch.setenv("LLM_PROVIDER", "anthropic")
    monkeypatch.setenv("LLM_MODEL", _MODEL)
    monkeypatch.setenv("LLM_TEMPERATURE", "0.4")
    recorder = _Recorder("You have no profiles yet — want to create one?")
    monkeypatch.setattr(
        user_chat_chain, "_build_anthropic_messages_client", lambda _p: _real_client(recorder)
    )

    response, usage = await user_chat_chain.user_chat_reply(
        profiles=[], message="What can you do?", history=[]
    )

    assert response.reply == "You have no profiles yet — want to create one?"
    assert usage.prompt_tokens == 12
    assert recorder.bodies[0]["temperature"] == 0.4
