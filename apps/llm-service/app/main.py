from dotenv import load_dotenv

load_dotenv()

import asyncio
import os

import grpc.aio
from grpc_health.v1 import health_pb2, health_pb2_grpc
from prometheus_client import start_http_server

from app.grpc.metrics_interceptor import MetricsInterceptor
from app.grpc.servicer import LlmServiceImpl
from app.grpc.llm_service_pb2_grpc import add_LlmServiceServicer_to_server

_GRPC_PORT = int(os.getenv("GRPC_PORT", "8080"))
_METRICS_PORT = int(os.getenv("METRICS_PORT", "9090"))


class _AsyncHealthServicer(health_pb2_grpc.HealthServicer):
    async def Check(self, request, context):
        return health_pb2.HealthCheckResponse(status=health_pb2.HealthCheckResponse.SERVING)

    async def Watch(self, request, context):
        await context.write(health_pb2.HealthCheckResponse(status=health_pb2.HealthCheckResponse.SERVING))


async def serve():
    server = grpc.aio.server(interceptors=[MetricsInterceptor()])

    add_LlmServiceServicer_to_server(LlmServiceImpl(), server)

    health_pb2_grpc.add_HealthServicer_to_server(_AsyncHealthServicer(), server)

    server.add_insecure_port(f"[::]:{_GRPC_PORT}")
    await server.start()

    start_http_server(_METRICS_PORT)

    await server.wait_for_termination()


if __name__ == "__main__":
    asyncio.run(serve())
