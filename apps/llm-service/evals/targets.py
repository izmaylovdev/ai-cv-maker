"""Async target wrappers for each LLM operation.

Each function matches the azure-ai-evaluation target contract:
- accepts the JSONL row fields as keyword arguments
- returns a dict with `response` (str) plus benchmark fields
"""

from __future__ import annotations

import time

from app.chains.chat_chain import ChatMessage, chat_reply
from app.chains.cv_chain import (
    _build_optimize_inputs,
    _enhance_field_foundry_raw,
    _extract_profile_foundry_raw,
    _generate_cv_foundry_raw,
    _optimize_profile_foundry_raw,
    _profile_to_prompt_vars,
)
from app.schemas import ProfileInput


async def generate_target(profile: dict, message: str | None = None, query: str = "") -> dict:
    inputs = _profile_to_prompt_vars(ProfileInput(**profile), message)
    t0 = time.perf_counter()
    result, usage = await _generate_cv_foundry_raw(inputs)
    latency_ms = round((time.perf_counter() - t0) * 1000)
    return {
        "response": result.model_dump_json(),
        "latency_ms": latency_ms,
        "input_tokens": usage.input_tokens,
        "output_tokens": usage.output_tokens,
    }


async def optimize_target(profile: dict, message: str, query: str = "") -> dict:
    inputs = _build_optimize_inputs(ProfileInput(**profile), message)
    t0 = time.perf_counter()
    result, usage = await _optimize_profile_foundry_raw(inputs)
    latency_ms = round((time.perf_counter() - t0) * 1000)
    return {
        "response": result.model_dump_json(),
        "latency_ms": latency_ms,
        "input_tokens": usage.input_tokens,
        "output_tokens": usage.output_tokens,
    }


async def enhance_target(content: str, field_purpose: str, query: str = "") -> dict:
    t0 = time.perf_counter()
    result, usage = await _enhance_field_foundry_raw(content, field_purpose)
    latency_ms = round((time.perf_counter() - t0) * 1000)
    return {
        "response": result,
        "latency_ms": latency_ms,
        "input_tokens": usage.input_tokens,
        "output_tokens": usage.output_tokens,
    }


async def chat_target(profile: dict, message: str, history: list | None = None, query: str = "") -> dict:
    t0 = time.perf_counter()
    result = await chat_reply(
        ProfileInput(**profile),
        message,
        [ChatMessage(**m) for m in (history or [])],
    )
    latency_ms = round((time.perf_counter() - t0) * 1000)
    return {
        "response": result.reply,
        "has_proposal": result.proposal is not None,
        "latency_ms": latency_ms,
    }


async def extract_target(cv_text: str, query: str = "") -> dict:
    t0 = time.perf_counter()
    result, usage = await _extract_profile_foundry_raw(cv_text)
    latency_ms = round((time.perf_counter() - t0) * 1000)
    return {
        "response": result.model_dump_json(),
        "latency_ms": latency_ms,
        "input_tokens": usage.input_tokens,
        "output_tokens": usage.output_tokens,
    }
