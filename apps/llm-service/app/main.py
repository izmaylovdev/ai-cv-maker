from dotenv import load_dotenv

load_dotenv()

import os
from contextlib import asynccontextmanager

import grpc.aio
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.chains.cv_chain import extract_profile, generate_cv, optimize_profile
from app.grpc.servicer import LlmServiceImpl
from app.grpc.llm_service_pb2_grpc import add_LlmServiceServicer_to_server
from app.schemas import ExtractRequest, ExtractResponse, GenerateRequest, GenerateResponse, OptimizeRequest, OptimizeResponse

_GRPC_PORT = int(os.getenv("GRPC_PORT", "50051"))


@asynccontextmanager
async def lifespan(app: FastAPI):
    grpc_server = grpc.aio.server()
    add_LlmServiceServicer_to_server(LlmServiceImpl(), grpc_server)
    grpc_server.add_insecure_port(f"[::]:{_GRPC_PORT}")
    await grpc_server.start()
    yield
    await grpc_server.stop(grace=5)


app = FastAPI(title="CV LLM Service", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/generate", response_model=GenerateResponse)
async def generate(request: GenerateRequest) -> GenerateResponse:
    try:
        return await generate_cv(request.profile, request.message)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/optimize", response_model=OptimizeResponse)
async def optimize(request: OptimizeRequest) -> OptimizeResponse:
    try:
        return await optimize_profile(request.profile, request.message)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/extract", response_model=ExtractResponse)
async def extract(request: ExtractRequest) -> ExtractResponse:
    try:
        return await extract_profile(request.cv_text)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
