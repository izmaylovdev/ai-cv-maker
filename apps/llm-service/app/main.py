from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.chains.cv_chain import generate_cv, optimize_profile
from app.schemas import GenerateRequest, GenerateResponse, OptimizeRequest, OptimizeResponse

app = FastAPI(title="CV LLM Service", version="1.0.0")

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
