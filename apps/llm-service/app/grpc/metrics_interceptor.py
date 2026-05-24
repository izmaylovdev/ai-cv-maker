import time
from typing import Awaitable, Callable

import grpc
import grpc.aio
from prometheus_client import Histogram

grpc_duration = Histogram(
    "grpc_server_handled_seconds",
    "Duration of gRPC server calls in seconds",
    ["method"],
)


class MetricsInterceptor(grpc.aio.ServerInterceptor):
    async def intercept_service(
        self,
        continuation: Callable[[grpc.HandlerCallDetails], Awaitable[grpc.RpcMethodHandler]],
        handler_call_details: grpc.HandlerCallDetails,
    ) -> grpc.RpcMethodHandler:
        method_name = handler_call_details.method.split("/")[-1]
        handler = await continuation(handler_call_details)

        if handler is None or handler.unary_unary is None:
            return handler

        original = handler.unary_unary

        async def timed(request, context, _orig=original, _name=method_name):
            start = time.perf_counter()
            try:
                return await _orig(request, context)
            finally:
                grpc_duration.labels(method=_name).observe(time.perf_counter() - start)

        return handler._replace(unary_unary=timed)
