"""Tests for OpenTelemetry distributed tracing setup (ADR-0016).

Covers the contract that matters: tracing is a no-op (no interceptor) when
``OTEL_EXPORTER_OTLP_ENDPOINT`` is unset, and that setup failures degrade to a
no-op rather than crashing startup.
"""

from __future__ import annotations

import pytest

from app import tracing


@pytest.fixture(autouse=True)
def _clean_otel_env(monkeypatch):
    """Each test starts with no OTLP config and a fresh provider cache."""
    for var in ("OTEL_EXPORTER_OTLP_ENDPOINT", "OTEL_SERVICE_NAME"):
        monkeypatch.delenv(var, raising=False)
    tracing._provider = None
    yield
    tracing._provider = None


def test_no_interceptor_when_endpoint_unset():
    assert tracing.configure_tracing() is None


def test_no_interceptor_when_endpoint_blank(monkeypatch):
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "   ")
    assert tracing.configure_tracing() is None


def test_returns_interceptor_when_configured(monkeypatch):
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4317")
    interceptor = tracing.configure_tracing()
    assert interceptor is not None
    assert tracing._provider is not None
    tracing.shutdown()


def test_tempo_provider_is_local_not_global(monkeypatch):
    """The Tempo provider must not become the global tracer provider.

    Langfuse (ADR-0010) is also OpenTelemetry-based and hooks the global provider;
    a global Tempo provider would leak every gRPC instrumentation span into
    Langfuse as an empty duplicate trace. Keeping it local prevents that (ADR-0018).
    """
    from opentelemetry import trace

    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4317")
    global_before = trace.get_tracer_provider()

    interceptor = tracing.configure_tracing()

    assert interceptor is not None
    assert tracing._provider is not None
    # configure_tracing must leave the global provider untouched.
    assert trace.get_tracer_provider() is global_before
    assert trace.get_tracer_provider() is not tracing._provider
    tracing.shutdown()


def test_setup_failure_degrades_to_noop(monkeypatch):
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4317")

    import opentelemetry.sdk.trace as sdk_trace

    def _boom(*args, **kwargs):
        raise RuntimeError("induced failure")

    monkeypatch.setattr(sdk_trace, "TracerProvider", _boom)
    assert tracing.configure_tracing() is None


def test_shutdown_without_provider_is_safe():
    tracing.shutdown()  # must not raise when never configured
