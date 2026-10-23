"""Tests for runtime LLM configuration defaults."""

from __future__ import annotations

import pytest

from app import settings


def test_google_model_defaults_to_served_gemini_flash(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("LLM_MODEL", raising=False)
    assert settings.google_model() == "gemini-3.8-flash"


def test_google_model_blank_override_falls_back_to_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LLM_MODEL", "   ")
    assert settings.google_model() == "gemini-3.8-flash"


def test_google_model_honours_llm_model_override(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LLM_MODEL", "gemini-2.5-flash")
    assert settings.google_model() == "gemini-2.5-flash"
