"""OpenTelemetry distributed tracing to Grafana Tempo (ADR-0016).

Opt-in and **no-op when unconfigured**: the tracer provider and OTLP exporter
are installed only when ``OTEL_EXPORTER_OTLP_ENDPOINT`` is set. With no endpoint
every entry point here degrades to a pass-through, so local dev, CI and tests
are unaffected (mirroring the Langfuse pattern in :mod:`app.observability`).

The gRPC **server** interceptor returned by :func:`configure_tracing` extracts
the W3C ``traceparent`` that cv-api's gRPC client injects, so llm-service spans
nest under the cv-api trace and the whole request renders as one Tempo waterfall.
This is orthogonal to Langfuse (ADR-0010), which stays focused on LLM content.
"""

from __future__ import annotations

import logging
import os
from typing import Any

_logger = logging.getLogger(__name__)

_provider: Any | None = None


def configure_tracing() -> Any | None:
    """Install the OTLP tracer provider and return a grpc.aio server interceptor.

    Returns ``None`` when ``OTEL_EXPORTER_OTLP_ENDPOINT`` is unset or setup fails,
    in which case the caller adds no tracing interceptor (tracing stays off).
    Safe to call once at startup.
    """
    global _provider

    endpoint = (os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT") or "").strip()
    if not endpoint:
        return None

    try:
        from opentelemetry import trace
        from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
        from opentelemetry.instrumentation.grpc import aio_server_interceptor
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor

        if _provider is None:
            service_name = (os.getenv("OTEL_SERVICE_NAME") or "llm-service").strip()
            _provider = TracerProvider(
                resource=Resource.create({"service.name": service_name})
            )
            # OTLPSpanExporter reads OTEL_EXPORTER_OTLP_ENDPOINT itself; an http://
            # endpoint is treated as insecure (local Tempo, no TLS).
            _provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
            trace.set_tracer_provider(_provider)
            _logger.info("OpenTelemetry tracing enabled (endpoint=%s)", endpoint)

        return aio_server_interceptor()
    except Exception as exc:  # pragma: no cover - tracing must never break startup
        _logger.warning("OpenTelemetry init failed; tracing disabled: %s", exc)
        return None


def shutdown() -> None:
    """Flush and shut down the tracer provider (call on service shutdown)."""
    global _provider
    if _provider is None:
        return
    try:
        _provider.shutdown()
    except Exception as exc:  # pragma: no cover
        _logger.debug("OpenTelemetry shutdown failed: %s", exc)
