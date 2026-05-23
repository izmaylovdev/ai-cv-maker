"""Runtime configuration for the LLM backend (Gemini, OpenAI-compatible, or Microsoft Foundry / Claude)."""

from __future__ import annotations

import os


def llm_provider() -> str:
    return os.getenv("LLM_PROVIDER", "google").lower().strip()


def llm_model() -> str:
    return (os.getenv("LLM_MODEL") or "").strip()


def llm_temperature() -> float:
    raw = os.getenv("LLM_TEMPERATURE", "0.4")
    try:
        return float(raw)
    except ValueError:
        return 0.4


def google_model() -> str:
    return llm_model() or "gemini-1.5-flash"


def openai_base_url() -> str:
    return os.getenv("OPENAI_BASE_URL", "http://127.0.0.1:1234/v1").strip().rstrip("/")


def openai_api_key() -> str:
    return os.getenv("OPENAI_API_KEY", "lm-studio")


def openai_model() -> str:
    name = llm_model()
    if name:
        return name
    return os.getenv("OPENAI_MODEL", "local-model")


def foundry_api_key() -> str:
    return (os.getenv("FOUNDRY_API_KEY") or "").strip()


def foundry_resource() -> str | None:
    r = (os.getenv("FOUNDRY_DEPLOYMENT_NAME") or "").strip()
    return r or None


def foundry_base_url() -> str | None:
    u = (os.getenv("FOUNDRY_BASE_URL") or "").strip().rstrip("/")
    return u or None


def foundry_model() -> str:
    """Foundry deployment name (same value as `model` in Anthropic Messages API)."""
    name = (
        llm_model()
        or (os.getenv("FOUNDRY_DEPLOYMENT_NAME") or "").strip()
    )
    return name


def foundry_max_tokens() -> int:
    raw = os.getenv("ANTHROPIC_FOUNDRY_MAX_TOKENS", "8192")
    try:
        return max(256, int(raw))
    except ValueError:
        return 8192


def azure_openai_api_version() -> str:
    return os.getenv("AZURE_OPENAI_API_VERSION", "2024-12-01-preview")
