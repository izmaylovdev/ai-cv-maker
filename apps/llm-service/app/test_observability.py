"""Tests for Langfuse LLM observability (ADR-0010).

Covers the contract that matters most: tracing is a no-op with zero behavioural
change when unconfigured, activates only when all three credentials are present,
attaches the LangChain handler / Anthropic generation on the respective paths,
and parses cv-api trace context from gRPC metadata.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from app import observability
from app.grpc.trace_interceptor import TraceInterceptor


@pytest.fixture(autouse=True)
def _clean_langfuse_env(monkeypatch):
    """Each test starts with no Langfuse config and a fresh client cache."""
    for var in ("LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY", "LANGFUSE_HOST"):
        monkeypatch.delenv(var, raising=False)
    observability.reset()
    yield
    observability.reset()


def _configure(monkeypatch):
    monkeypatch.setenv("LANGFUSE_PUBLIC_KEY", "pk-test")
    monkeypatch.setenv("LANGFUSE_SECRET_KEY", "sk-test")
    monkeypatch.setenv("LANGFUSE_HOST", "http://localhost:3030")
    observability.reset()


# --- enablement ------------------------------------------------------------


def test_disabled_when_unconfigured():
    assert observability.is_enabled() is False
    assert observability.client() is None


def test_disabled_when_partially_configured(monkeypatch):
    monkeypatch.setenv("LANGFUSE_PUBLIC_KEY", "pk-test")
    monkeypatch.setenv("LANGFUSE_SECRET_KEY", "sk-test")
    # LANGFUSE_HOST intentionally missing
    observability.reset()
    assert observability.is_enabled() is False


def test_enabled_when_fully_configured(monkeypatch):
    sentinel = object()
    monkeypatch.setattr(observability, "_build_client", lambda: sentinel)
    observability.reset()
    assert observability.is_enabled() is True
    assert observability.client() is sentinel


def test_client_build_failure_degrades_to_disabled(monkeypatch):
    _configure(monkeypatch)
    import langfuse

    def boom(*args, **kwargs):
        raise RuntimeError("connection refused")

    monkeypatch.setattr(langfuse, "Langfuse", boom)
    observability.reset()
    assert observability.is_enabled() is False  # never raises


# --- no-op pass-through (behaviour unchanged when disabled) -----------------


@pytest.mark.asyncio
async def test_lc_invoke_passthrough_when_disabled():
    llm = MagicMock()
    llm.ainvoke = AsyncMock(return_value="response")
    result = await observability.lc_invoke(llm, ["msg"], name="generate")
    assert result == "response"
    # No config/callbacks injected when tracing is off.
    llm.ainvoke.assert_awaited_once_with(["msg"])


@pytest.mark.asyncio
async def test_anthropic_create_passthrough_when_disabled():
    msg = MagicMock()
    anthropic_client = MagicMock()
    anthropic_client.messages.create = AsyncMock(return_value=msg)
    result = await observability.anthropic_create(
        anthropic_client, name="generate", model="claude", messages=[], system="s"
    )
    assert result is msg
    anthropic_client.messages.create.assert_awaited_once_with(
        model="claude", messages=[], system="s"
    )


@pytest.mark.asyncio
async def test_rpc_span_passthrough_when_disabled():
    async with observability.rpc_span("Generate", {"x-trace-id": "abc"}):
        pass  # must not raise even though no client exists


# --- enabled paths ---------------------------------------------------------


@pytest.mark.asyncio
async def test_lc_invoke_attaches_callback_when_enabled(monkeypatch):
    monkeypatch.setattr(observability, "_build_client", lambda: MagicMock())
    monkeypatch.setattr(observability, "_langchain_callbacks", lambda: ["handler"])
    observability.reset()

    llm = MagicMock()
    llm.ainvoke = AsyncMock(return_value="response")
    result = await observability.lc_invoke(llm, ["msg"], name="generate")

    assert result == "response"
    _, kwargs = llm.ainvoke.call_args
    assert kwargs["config"]["callbacks"] == ["handler"]
    assert kwargs["config"]["run_name"] == "generate"


@pytest.mark.asyncio
async def test_anthropic_create_records_generation_when_enabled(monkeypatch):
    fake_client = MagicMock()
    generation = MagicMock()
    cm = MagicMock()
    cm.__enter__.return_value = generation
    cm.__exit__.return_value = False
    fake_client.start_as_current_generation.return_value = cm
    monkeypatch.setattr(observability, "_build_client", lambda: fake_client)
    observability.reset()

    msg = MagicMock()
    msg.content = [MagicMock(type="text", text="hello")]
    msg.usage = MagicMock(input_tokens=10, output_tokens=5)
    anthropic_client = MagicMock()
    anthropic_client.messages.create = AsyncMock(return_value=msg)

    result = await observability.anthropic_create(
        anthropic_client, name="generate", model="claude", messages=[], max_tokens=1024
    )

    assert result is msg
    fake_client.start_as_current_generation.assert_called_once()
    generation.update.assert_called_once()
    _, update_kwargs = generation.update.call_args
    assert update_kwargs["output"] == "hello"
    assert update_kwargs["usage_details"] == {"input": 10, "output": 5}


def _stream_cm(final_msg):
    """Async context manager standing in for ``client.messages.stream(**kwargs)``:
    ``async with`` yields a stream whose ``get_final_message()`` returns final_msg."""
    stream = MagicMock()
    stream.get_final_message = AsyncMock(return_value=final_msg)
    cm = MagicMock()
    cm.__aenter__ = AsyncMock(return_value=stream)
    cm.__aexit__ = AsyncMock(return_value=False)
    return cm


@pytest.mark.asyncio
async def test_anthropic_stream_passthrough_when_disabled():
    msg = MagicMock()
    anthropic_client = MagicMock()
    anthropic_client.messages.stream = MagicMock(return_value=_stream_cm(msg))

    result = await observability.anthropic_stream(
        anthropic_client, name="chat", model="claude", messages=[], system="s"
    )

    assert result is msg
    # Streams (bypassing the non-streaming 10-min guard); never buffers via create.
    anthropic_client.messages.stream.assert_called_once_with(
        model="claude", messages=[], system="s"
    )
    anthropic_client.messages.create.assert_not_called()


@pytest.mark.asyncio
async def test_anthropic_stream_records_generation_when_enabled(monkeypatch):
    fake_client = MagicMock()
    generation = MagicMock()
    cm = MagicMock()
    cm.__enter__.return_value = generation
    cm.__exit__.return_value = False
    fake_client.start_as_current_generation.return_value = cm
    monkeypatch.setattr(observability, "_build_client", lambda: fake_client)
    observability.reset()

    msg = MagicMock()
    msg.content = [MagicMock(type="text", text="hello")]
    msg.usage = MagicMock(input_tokens=10, output_tokens=5)
    anthropic_client = MagicMock()
    anthropic_client.messages.stream = MagicMock(return_value=_stream_cm(msg))

    result = await observability.anthropic_stream(
        anthropic_client, name="chat", model="claude", messages=[], max_tokens=32000
    )

    assert result is msg
    fake_client.start_as_current_generation.assert_called_once()
    generation.update.assert_called_once()
    _, update_kwargs = generation.update.call_args
    assert update_kwargs["output"] == "hello"
    assert update_kwargs["usage_details"] == {"input": 10, "output": 5}


@pytest.mark.asyncio
@pytest.mark.parametrize("helper", ["anthropic_create", "anthropic_stream"])
async def test_anthropic_generation_model_parameters_are_max_tokens_only(monkeypatch, helper):
    """Anthropic generations report ``max_tokens`` as their only model parameter:
    the current Messages API version accepts no sampling params, so a
    ``temperature`` (or ``top_p`` / ``top_k``) in Langfuse would misreport what
    was sent."""
    fake_client = MagicMock()
    cm = MagicMock()
    cm.__enter__.return_value = MagicMock()
    cm.__exit__.return_value = False
    fake_client.start_as_current_generation.return_value = cm
    monkeypatch.setattr(observability, "_build_client", lambda: fake_client)
    observability.reset()

    msg = MagicMock()
    msg.content = [MagicMock(type="text", text="hello")]
    msg.usage = MagicMock(input_tokens=10, output_tokens=5)
    anthropic_client = MagicMock()
    anthropic_client.messages.create = AsyncMock(return_value=msg)
    anthropic_client.messages.stream = MagicMock(return_value=_stream_cm(msg))

    await getattr(observability, helper)(
        anthropic_client,
        name="generate",
        model="claude",
        messages=[],
        max_tokens=1024,
        temperature=0.4,
        top_p=0.9,
        top_k=40,
    )

    _, gen_kwargs = fake_client.start_as_current_generation.call_args
    assert gen_kwargs["model_parameters"] == {"max_tokens": 1024}, (
        f"expected model_parameters == {{'max_tokens': 1024}}, got {gen_kwargs['model_parameters']}"
    )


# --- trace context propagation ---------------------------------------------


def test_parse_trace_metadata_extracts_headers():
    parsed = observability.parse_trace_metadata(
        {"x-trace-id": "guid-123", "x-user-id": "user-7", "authorization": "Bearer x"}
    )
    assert parsed == {"cv_api_trace_id": "guid-123", "user_id": "user-7", "session_id": None}


def test_parse_trace_metadata_handles_missing():
    assert observability.parse_trace_metadata(None) == {
        "cv_api_trace_id": None,
        "user_id": None,
        "session_id": None,
    }
    assert observability.parse_trace_metadata({}) == {
        "cv_api_trace_id": None,
        "user_id": None,
        "session_id": None,
    }


@pytest.mark.asyncio
async def test_trace_interceptor_wraps_handler_with_metadata(monkeypatch):
    seen = {}

    @contextmanager_async
    async def fake_rpc_span(name, metadata, *, rpc_input=None):
        seen["name"] = name
        seen["metadata"] = metadata
        seen["input"] = rpc_input
        yield None

    monkeypatch.setattr(observability, "rpc_span", fake_rpc_span)

    inner = AsyncMock(return_value="reply")
    handler = MagicMock()
    handler.unary_unary = inner
    handler._replace = lambda unary_unary: _Replaced(unary_unary)

    async def continuation(details):
        return handler

    details = MagicMock()
    details.method = "/llm.LlmService/Generate"
    details.invocation_metadata = [("x-trace-id", "guid-123"), ("x-user-id", "user-7")]

    interceptor = TraceInterceptor()
    new_handler = await interceptor.intercept_service(continuation, details)
    result = await new_handler.unary_unary("request", "context")

    assert result == "reply"
    assert seen["name"] == "Generate"
    assert seen["metadata"] == {"x-trace-id": "guid-123", "x-user-id": "user-7"}
    # The gRPC request is captured as the trace input.
    assert seen["input"] == "request"


@pytest.mark.asyncio
async def test_rpc_span_records_input_and_output_when_enabled(monkeypatch):
    fake_client = MagicMock()
    span = MagicMock()
    cm = MagicMock()
    cm.__enter__.return_value = span
    cm.__exit__.return_value = False
    fake_client.start_as_current_span.return_value = cm
    monkeypatch.setattr(observability, "_build_client", lambda: fake_client)
    observability.reset()

    async with observability.rpc_span(
        "Generate", {"x-trace-id": "abc"}, rpc_input={"q": 1}
    ) as span_handle:
        observability.record_rpc_output(span_handle, {"a": 2})

    # Input recorded on the root span and the trace.
    _, span_kwargs = fake_client.start_as_current_span.call_args
    assert span_kwargs["input"] == {"q": 1}
    trace_calls = fake_client.update_current_trace.call_args_list
    assert any(call.kwargs.get("input") == {"q": 1} for call in trace_calls)
    # Output recorded on both once the response is known.
    assert any(call.kwargs.get("output") == {"a": 2} for call in trace_calls)
    span.update.assert_called_with(output={"a": 2})


# --- session grouping (US-AI-16) -------------------------------------------


def test_parse_trace_metadata_extracts_session_id():
    # F-AI-16.4 — the x-session-id header is parsed alongside the existing keys.
    parsed = observability.parse_trace_metadata(
        {"x-session-id": "sess-1", "x-trace-id": "guid-123", "x-user-id": "user-7"}
    )
    assert parsed == {
        "cv_api_trace_id": "guid-123",
        "user_id": "user-7",
        "session_id": "sess-1",
    }


def test_parse_trace_metadata_session_id_none_when_absent():
    # F-AI-16.6 — missing/empty session id is a no-op: parsed as None, never raising.
    assert observability.parse_trace_metadata(None)["session_id"] is None
    assert observability.parse_trace_metadata({})["session_id"] is None


@pytest.mark.asyncio
async def test_rpc_span_binds_session_id_when_present(monkeypatch):
    # F-AI-16.1 — the parsed x-session-id is bound onto the Langfuse root trace.
    fake_client = MagicMock()
    span = MagicMock()
    cm = MagicMock()
    cm.__enter__.return_value = span
    cm.__exit__.return_value = False
    fake_client.start_as_current_span.return_value = cm
    monkeypatch.setattr(observability, "_build_client", lambda: fake_client)
    observability.reset()

    async with observability.rpc_span(
        "Generate", {"x-trace-id": "abc", "x-session-id": "sess-1"}
    ):
        pass

    trace_calls = fake_client.update_current_trace.call_args_list
    assert any(call.kwargs.get("session_id") == "sess-1" for call in trace_calls)


@pytest.mark.asyncio
async def test_rpc_span_session_id_none_when_absent(monkeypatch):
    # F-AI-16.6 — with no x-session-id header, no session is bound (None), no raise.
    fake_client = MagicMock()
    span = MagicMock()
    cm = MagicMock()
    cm.__enter__.return_value = span
    cm.__exit__.return_value = False
    fake_client.start_as_current_span.return_value = cm
    monkeypatch.setattr(observability, "_build_client", lambda: fake_client)
    observability.reset()

    async with observability.rpc_span("Generate", {"x-trace-id": "abc"}):
        pass

    trace_calls = fake_client.update_current_trace.call_args_list
    assert trace_calls, "update_current_trace should have been called"
    # session_id must be bound explicitly as None (no session), never omitted,
    # and rpc_span must not raise on an absent header.
    assert any("session_id" in call.kwargs for call in trace_calls)
    assert all(call.kwargs.get("session_id") is None for call in trace_calls)


def test_to_serializable_passthrough_and_fallback():
    assert observability.to_serializable({"k": "v"}) == {"k": "v"}
    assert observability.to_serializable(None) is None
    # Non-proto, non-primitive objects fall back to str without raising.
    assert observability.to_serializable(object()) is not None


class _Replaced:
    def __init__(self, unary_unary):
        self.unary_unary = unary_unary


def contextmanager_async(func):
    import contextlib

    return contextlib.asynccontextmanager(func)
