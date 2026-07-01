from dotenv import load_dotenv

load_dotenv()

import asyncio
import logging
import os

import grpc.aio
from grpc_health.v1 import health_pb2, health_pb2_grpc
from prometheus_client import start_http_server

from app import observability, tracing
from app.grpc.metrics_interceptor import MetricsInterceptor
from app.grpc.trace_interceptor import TraceInterceptor
from app.grpc.servicer import LlmServiceImpl
from app.grpc.llm_service_pb2_grpc import add_LlmServiceServicer_to_server

_GRPC_PORT = int(os.getenv("GRPC_PORT", "8080"))
_METRICS_PORT = int(os.getenv("METRICS_PORT", "9090"))

_logger = logging.getLogger(__name__)


class _AsyncHealthServicer(health_pb2_grpc.HealthServicer):
    async def Check(self, request, context):
        return health_pb2.HealthCheckResponse(status=health_pb2.HealthCheckResponse.SERVING)

    async def Watch(self, request, context):
        await context.write(health_pb2.HealthCheckResponse(status=health_pb2.HealthCheckResponse.SERVING))


async def serve():
    # OpenTelemetry server interceptor runs outermost (ADR-0016) so the Tempo
    # span extracted from cv-api's traceparent parents everything below, then the
    # Langfuse root trace (TraceInterceptor) and metrics timing. Each is a no-op
    # when its backend is absent.
    otel_interceptor = tracing.configure_tracing()
    interceptors = [otel_interceptor] if otel_interceptor is not None else []
    interceptors += [TraceInterceptor(), MetricsInterceptor()]
    server = grpc.aio.server(interceptors=interceptors)

    add_LlmServiceServicer_to_server(LlmServiceImpl(), server)

    health_pb2_grpc.add_HealthServicer_to_server(_AsyncHealthServicer(), server)

    server.add_insecure_port(f"[::]:{_GRPC_PORT}")
    await server.start()

    # A metrics-port collision (e.g. the local Prometheus container already
    # binds 9090) must not take down the gRPC server, which is the actual
    # service. Log and continue without the metrics endpoint.
    try:
        start_http_server(_METRICS_PORT)
    except OSError as exc:
        _logger.warning(
            "Prometheus metrics server not started on port %d: %s", _METRICS_PORT, exc
        )

    try:
        await server.wait_for_termination()
    finally:
        # Flush buffered traces on shutdown (SIGTERM on Cloud Run) so nothing is
        # lost when the instance is frozen/stopped (ADR-0008).
        observability.flush()
        tracing.shutdown()


if __name__ == "__main__":
    asyncio.run(serve())
