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


def test_setup_failure_degrades_to_noop(monkeypatch):
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4317")

    import opentelemetry.sdk.trace as sdk_trace

    def _boom(*args, **kwargs):
        raise RuntimeError("induced failure")

    monkeypatch.setattr(sdk_trace, "TracerProvider", _boom)
    assert tracing.configure_tracing() is None


def test_shutdown_without_provider_is_safe():
    tracing.shutdown()  # must not raise when never configured
