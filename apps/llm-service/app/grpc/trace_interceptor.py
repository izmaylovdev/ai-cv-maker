"""gRPC server interceptor that opens a Langfuse root trace per RPC.

Reads the cv-api trace context from invocation metadata (``x-trace-id`` /
``x-user-id``, see ADR-0010) and wraps each unary handler in
:func:`app.observability.rpc_span`. No-op when Langfuse is not configured.
"""

from __future__ import annotations

from typing import Awaitable, Callable

import grpc
import grpc.aio

from app import observability


class TraceInterceptor(grpc.aio.ServerInterceptor):
    async def intercept_service(
        self,
        continuation: Callable[[grpc.HandlerCallDetails], Awaitable[grpc.RpcMethodHandler]],
        handler_call_details: grpc.HandlerCallDetails,
    ) -> grpc.RpcMethodHandler:
        handler = await continuation(handler_call_details)

        if handler is None or handler.unary_unary is None:
            return handler

        method_name = handler_call_details.method.split("/")[-1]
        metadata = dict(handler_call_details.invocation_metadata or [])
        original = handler.unary_unary

        async def traced(request, context, _orig=original, _name=method_name, _meta=metadata):
            async with observability.rpc_span(
                _name, _meta, rpc_input=observability.to_serializable(request)
            ) as span:
                response = await _orig(request, context)
                observability.record_rpc_output(span, response)
                return response

        return handler._replace(unary_unary=traced)
