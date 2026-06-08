FROM python:3.12-slim

WORKDIR /app

# Install dependencies (includes grpcio-tools for proto generation)
COPY apps/llm-service/pyproject.toml .
RUN pip install --no-cache-dir .

# Copy proto and generate gRPC stubs fresh — no manual step required
COPY proto/llm_service.proto /proto/llm_service.proto
COPY apps/llm-service/app/ app/
RUN python -m grpc_tools.protoc \
      -I /proto \
      --python_out=app/grpc \
      --grpc_python_out=app/grpc \
      /proto/llm_service.proto \
    && sed -i 's/^import llm_service_pb2/from . import llm_service_pb2/' app/grpc/llm_service_pb2_grpc.py

EXPOSE 8000
EXPOSE 50051
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
