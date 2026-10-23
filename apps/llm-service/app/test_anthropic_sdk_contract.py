"""Contract tests against the *installed* Anthropic SDK.

Every other chain test swaps the SDK client for a MagicMock, so a dependency
resolve that changes the SDK's call signature goes unnoticed until a real
request fails. That happened when an unbounded `anthropic` pin resolved 1.x,
which dropped the `temperature` keyword: every chat RPC raised TypeError →
gRPC INTERNAL. These tests drive a real `AsyncAnthropic` client, with only the
HTTP transport mocked, through the same helpers and kwargs the chains use.

The service targets SDK 2.x, which sends ``anthropic-version: 2026-10-21``. That
API version rejects ``temperature`` / ``top_p`` / ``top_k`` on every model, so no
Anthropic-path request may carry a sampling parameter.
"""

from __future__ import annotations

from unittest.mock import MagicMock

import anthropic
import pytest

from app import observability
from app.anthropic_test_support import (
    EXPECTED_API_VERSION,
    MODEL,
    SAMPLING_PARAMS,
    SDK_MAJOR,
    Recorder,
    assert_wire_contract,
    real_client,
)
from app.chains import user_chat_chain


# The kwargs shape every chain passes (chat_chain, user_chat_chain,
# job_chat_chain, cv_chain, cover_letter_chain, profile_selector_chain) — no
# sampling parameters.
def _chain_kwargs() -> dict:
    return dict(
        model=MODEL,
        max_tokens=1024,
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


def test_installed_sdk_is_2x_or_newer():
    """Guard: the service is built for SDK 2.x (API version 2026-10-21). A venv
    or image that resolves an older SDK sends an older API version and would
    still accept the sampling params the chains no longer pass."""
    assert SDK_MAJOR >= 2, (
        f"anthropic {anthropic.__version__} is installed; llm-service requires "
        f"anthropic>=2 (API version {EXPECTED_API_VERSION})"
    )


@pytest.mark.asyncio
async def test_buffered_call_sends_no_sampling_params_through_real_sdk():
    """anthropic_create (user chat, job chat, generate, extract, cover letter,
    select profile)."""
    recorder = Recorder("Hello there")
    message = await observability.anthropic_create(
        real_client(recorder), name="contract", **_chain_kwargs()
    )

    assert message.content[0].text == "Hello there"
    assert recorder.bodies[0]["model"] == MODEL
    assert recorder.bodies[0]["max_tokens"] == 1024
    assert "stream" not in recorder.bodies[0] or recorder.bodies[0]["stream"] is False
    assert_wire_contract(recorder, min_requests=1)


@pytest.mark.asyncio
async def test_streamed_call_sends_no_sampling_params_through_real_sdk():
    """anthropic_stream (in-editor chat) — reassembled from SSE."""
    recorder = Recorder("Streamed reply")
    message = await observability.anthropic_stream(
        real_client(recorder), name="contract", **_chain_kwargs()
    )

    assert "".join(b.text for b in message.content if b.type == "text") == "Streamed reply"
    assert recorder.bodies[0]["stream"] is True
    assert recorder.bodies[0]["max_tokens"] == 1024
    assert_wire_contract(recorder, min_requests=1)


@pytest.mark.asyncio
@pytest.mark.parametrize("helper", ["anthropic_create", "anthropic_stream"])
async def test_installed_sdk_rejects_temperature_kwarg(helper):
    """Documents why the chains no longer pass ``temperature``: the installed
    SDK refuses it outright, before any request leaves the process."""
    recorder = Recorder("unused")

    with pytest.raises(TypeError, match="temperature"):
        await getattr(observability, helper)(
            real_client(recorder), name="contract", temperature=0.4, **_chain_kwargs()
        )

    assert recorder.bodies == [], "no request may be sent when the SDK rejects the call"


@pytest.mark.asyncio
async def test_global_assistant_reply_through_real_sdk(monkeypatch):
    """The read-only global assistant (POST /api/chat with no document) end to
    end through the chain, on the real SDK — LLM_TEMPERATURE is set but must not
    reach the wire."""
    monkeypatch.setenv("LLM_PROVIDER", "anthropic")
    monkeypatch.setenv("LLM_MODEL", MODEL)
    monkeypatch.setenv("LLM_TEMPERATURE", "0.4")
    recorder = Recorder("You have no profiles yet — want to create one?")
    monkeypatch.setattr(
        user_chat_chain, "_build_anthropic_messages_client", lambda _p: real_client(recorder)
    )

    response, usage = await user_chat_chain.user_chat_reply(
        profiles=[], message="What can you do?", history=[]
    )

    assert response.reply == "You have no profiles yet — want to create one?"
    assert usage.prompt_tokens == 12
    assert recorder.bodies[0]["model"] == MODEL
    assert_wire_contract(recorder, min_requests=1)


@pytest.mark.asyncio
async def test_langfuse_generation_lists_max_tokens_only_for_global_assistant(monkeypatch):
    """In Langfuse, an Anthropic generation lists ``max_tokens`` — and no
    ``temperature`` — among its model parameters, even with LLM_TEMPERATURE set."""
    monkeypatch.setenv("LLM_PROVIDER", "anthropic")
    monkeypatch.setenv("LLM_MODEL", MODEL)
    monkeypatch.setenv("LLM_TEMPERATURE", "0.4")
    fake_langfuse = MagicMock()
    cm = MagicMock()
    cm.__enter__.return_value = MagicMock()
    cm.__exit__.return_value = False
    fake_langfuse.start_as_current_generation.return_value = cm
    monkeypatch.setattr(observability, "_build_client", lambda: fake_langfuse)
    observability.reset()
    recorder = Recorder("Hi!")
    monkeypatch.setattr(
        user_chat_chain, "_build_anthropic_messages_client", lambda _p: real_client(recorder)
    )

    response, _usage = await user_chat_chain.user_chat_reply(
        profiles=[], message="Hello", history=[]
    )

    assert response.reply == "Hi!"
    fake_langfuse.start_as_current_generation.assert_called_once()
    params = fake_langfuse.start_as_current_generation.call_args.kwargs["model_parameters"]
    assert params == {"max_tokens": 1024}, (
        f"Langfuse model_parameters should list max_tokens only, got {params}"
    )
    assert not set(params) & set(SAMPLING_PARAMS)
