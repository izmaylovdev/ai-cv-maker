"""Langfuse LLM observability (ADR-0010).

Tracing is **opt-in and no-op when unconfigured**: the Langfuse client is built
only when ``LANGFUSE_PUBLIC_KEY``, ``LANGFUSE_SECRET_KEY`` and ``LANGFUSE_HOST``
are all present. With no credentials every helper here degrades to a pass-through
with zero behavioural change, so local dev, CI and tests are unaffected.

Two invocation paths are instrumented through this single module:

- LangChain path (google / openai / azure_openai): :func:`lc_invoke` attaches a
  Langfuse ``CallbackHandler`` per call.
- Direct Anthropic path (anthropic / foundry): :func:`anthropic_create` wraps the
  call in a Langfuse *generation* with model name and token usage.

cv-api propagates its active OpenTelemetry trace id and the authenticated user id
as gRPC metadata (``x-trace-id`` / ``x-user-id``); :func:`rpc_span` opens the root
trace per RPC and binds those so a Langfuse trace correlates with the Tempo trace
(ADR-0016) for the same request.
"""

from __future__ import annotations

import contextlib
import logging
import os
from typing import Any, AsyncIterator

_logger = logging.getLogger(__name__)

# gRPC metadata header names carrying cv-api trace context (lowercase per gRPC).
TRACE_ID_HEADER = "x-trace-id"
USER_ID_HEADER = "x-user-id"
SESSION_ID_HEADER = "x-session-id"

_client: Any | None = None
_initialized = False


def _build_client() -> Any | None:
    """Construct the Langfuse client, or ``None`` when not fully configured."""
    public_key = (os.getenv("LANGFUSE_PUBLIC_KEY") or "").strip()
    secret_key = (os.getenv("LANGFUSE_SECRET_KEY") or "").strip()
    host = (os.getenv("LANGFUSE_HOST") or "").strip()
    if not (public_key and secret_key and host):
        return None
    try:
        from langfuse import Langfuse

        return Langfuse(public_key=public_key, secret_key=secret_key, host=host)
    except Exception as exc:  # pragma: no cover - defensive: never break the service
        _logger.warning("Langfuse init failed; LLM tracing disabled: %s", exc)
        return None


def client() -> Any | None:
    """Return the lazily-built Langfuse client (cached), or ``None`` if disabled."""
    global _client, _initialized
    if not _initialized:
        _client = _build_client()
        _initialized = True
        if _client is not None:
            _logger.info("Langfuse LLM tracing enabled (host=%s)", os.getenv("LANGFUSE_HOST"))
    return _client


def is_enabled() -> bool:
    return client() is not None


def reset() -> None:
    """Drop the cached client so config is re-read (used by tests)."""
    global _client, _initialized
    _client = None
    _initialized = False


def parse_trace_metadata(metadata: dict[str, str] | None) -> dict[str, str | None]:
    """Extract cv-api trace context from gRPC invocation metadata."""
    metadata = metadata or {}
    return {
        "cv_api_trace_id": metadata.get(TRACE_ID_HEADER) or None,
        "user_id": metadata.get(USER_ID_HEADER) or None,
        "session_id": metadata.get(SESSION_ID_HEADER) or None,
    }


def to_serializable(message: Any) -> Any:
    """Best-effort convert a gRPC request/response to a JSON-friendly value.

    Protobuf messages become dicts; already-serialisable values pass through;
    anything else falls back to ``str``. Never raises — capture is best-effort.
    """
    if message is None or isinstance(message, (str, int, float, bool, dict, list)):
        return message
    try:
        from google.protobuf.json_format import MessageToDict

        return MessageToDict(message, preserving_proto_field_name=True)
    except Exception:
        try:
            return str(message)
        except Exception:  # pragma: no cover - defensive
            return None


@contextlib.asynccontextmanager
async def rpc_span(
    name: str, metadata: dict[str, str] | None, *, rpc_input: Any = None
) -> AsyncIterator[Any]:
    """Open the root Langfuse trace for one RPC.

    Binds the cv-api correlation id (deterministically mapped to a Langfuse trace
    id) and the authenticated user id from gRPC metadata, and records ``rpc_input``
    as the trace input. Yields the root span (or ``None`` when disabled) so the
    caller can attach the response via :func:`record_rpc_output`. No-op when
    disabled.
    """
    c = client()
    if c is None:
        yield None
        return

    ctx = parse_trace_metadata(metadata)
    seed = ctx["cv_api_trace_id"]
    user_id = ctx["user_id"]
    session_id = ctx["session_id"]

    from langfuse import Langfuse

    trace_context = {"trace_id": Langfuse.create_trace_id(seed=seed)} if seed else None
    try:
        with c.start_as_current_span(
            name=name, trace_context=trace_context, input=rpc_input
        ) as span:
            try:
                c.update_current_trace(
                    name=name,
                    user_id=user_id,
                    session_id=session_id,
                    tags=["llm-service"],
                    input=rpc_input,
                    metadata={"cv_api_trace_id": seed} if seed else None,
                )
            except Exception as exc:  # pragma: no cover - tracing must not fail the RPC
                _logger.debug("Langfuse update_current_trace failed: %s", exc)
            yield span
    finally:
        # Best-effort flush; Cloud Run may freeze the instance between requests
        # (ADR-0008 scale-to-zero), so we don't rely solely on background flushes.
        try:
            c.flush()
        except Exception as exc:  # pragma: no cover
            _logger.debug("Langfuse flush failed: %s", exc)


def record_rpc_output(span: Any, output: Any) -> None:
    """Record the RPC response as the trace/root-span output. No-op when disabled.

    Must be called while ``span`` is still current (inside :func:`rpc_span`) so the
    output propagates to the enclosing trace as well as the root span.
    """
    c = client()
    if c is None or span is None:
        return
    serialized = to_serializable(output)
    try:
        span.update(output=serialized)
        c.update_current_trace(output=serialized)
    except Exception as exc:  # pragma: no cover - tracing must not fail the RPC
        _logger.debug("Langfuse record output failed: %s", exc)


def _langchain_callbacks() -> list[Any]:
    if not is_enabled():
        return []
    try:
        from langfuse.langchain import CallbackHandler

        return [CallbackHandler()]
    except Exception as exc:  # pragma: no cover
        _logger.debug("Langfuse CallbackHandler unavailable: %s", exc)
        return []


async def lc_invoke(llm: Any, messages: Any, *, name: str) -> Any:
    """Invoke a LangChain chat model, attaching the Langfuse callback handler.

    Equivalent to ``await llm.ainvoke(messages)`` when tracing is disabled.
    """
    callbacks = _langchain_callbacks()
    if not callbacks:
        return await llm.ainvoke(messages)
    return await llm.ainvoke(messages, config={"callbacks": callbacks, "run_name": name})


def _anthropic_text(message: Any) -> str:
    try:
        return "".join(
            block.text
            for block in message.content
            if getattr(block, "type", None) == "text"
        )
    except Exception:  # pragma: no cover - output capture is best-effort
        return ""


def _anthropic_usage(message: Any) -> dict[str, int] | None:
    usage = getattr(message, "usage", None)
    if usage is None:
        return None
    try:
        details = {
            "input": int(usage.input_tokens),
            "output": int(usage.output_tokens),
        }
        # US-AI-17 — surface prompt-cache counts under Anthropic's own key names
        # so Langfuse prices cached reads/writes correctly. Only added when the
        # provider actually reports them.
        for key in ("cache_read_input_tokens", "cache_creation_input_tokens"):
            value = getattr(usage, key, None)
            if isinstance(value, int):
                details[key] = value
        return details
    except Exception:  # pragma: no cover
        return None


async def _messages_call(anthropic_client: Any, kwargs: dict, *, stream: bool) -> Any:
    """Issue the Anthropic request and return the final Message.

    When ``stream`` is True the response is consumed as a server-sent stream and
    reassembled via ``get_final_message()`` — the same Message shape a plain
    ``create`` returns, but it bypasses the SDK's non-streaming 10-minute guard,
    which otherwise rejects a large ``max_tokens`` outright (see
    ``chat_chain._MAX_TOKENS``).
    """
    if stream:
        async with anthropic_client.messages.stream(**kwargs) as s:
            return await s.get_final_message()
    return await anthropic_client.messages.create(**kwargs)


async def _anthropic_generation(
    anthropic_client: Any, *, name: str, stream: bool, kwargs: dict
) -> Any:
    """Run an Anthropic request inside a Langfuse generation (a no-op pass-through
    when tracing is disabled). Shared by :func:`anthropic_create` (buffered) and
    :func:`anthropic_stream` (streamed)."""
    c = client()
    if c is None:
        return await _messages_call(anthropic_client, kwargs, stream=stream)

    with c.start_as_current_generation(
        name=name,
        model=kwargs.get("model"),
        input=kwargs.get("messages"),
        metadata={"system": kwargs.get("system")} if kwargs.get("system") else None,
        model_parameters={
            k: kwargs[k] for k in ("max_tokens", "temperature") if k in kwargs
        },
    ) as generation:
        message = await _messages_call(anthropic_client, kwargs, stream=stream)
        try:
            generation.update(
                output=_anthropic_text(message),
                usage_details=_anthropic_usage(message),
            )
        except Exception as exc:  # pragma: no cover - tracing must not fail the call
            _logger.debug("Langfuse generation update failed: %s", exc)
        return message


async def anthropic_create(anthropic_client: Any, *, name: str, **kwargs: Any) -> Any:
    """Call ``anthropic_client.messages.create(**kwargs)`` inside a Langfuse generation.

    Records model name, the prompt messages, the completion text and token usage.
    Equivalent to a bare ``messages.create`` call when tracing is disabled.
    """
    return await _anthropic_generation(
        anthropic_client, name=name, stream=False, kwargs=kwargs
    )


async def anthropic_stream(anthropic_client: Any, *, name: str, **kwargs: Any) -> Any:
    """Like :func:`anthropic_create` but consumes the response as a stream and
    returns the assembled final Message. Streaming skips the SDK's non-streaming
    10-minute guard, so a large ``max_tokens`` (full-profile chat edits) is not
    rejected. Same return shape and Langfuse tracing as ``anthropic_create``."""
    return await _anthropic_generation(
        anthropic_client, name=name, stream=True, kwargs=kwargs
    )


def flush() -> None:
    """Flush pending traces (call on shutdown)."""
    c = client()
    if c is None:
        return
    try:
        c.flush()
    except Exception as exc:  # pragma: no cover
        _logger.debug("Langfuse flush failed: %s", exc)
