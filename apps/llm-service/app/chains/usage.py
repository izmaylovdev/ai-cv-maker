from dataclasses import dataclass


@dataclass
class TokenUsage:
    prompt_tokens: int
    completion_tokens: int
    model_name: str
    # US-AI-17 — Anthropic prompt-caching counters. Zero on the LangChain path
    # and for providers that don't report cache usage.
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0

    @staticmethod
    def empty() -> "TokenUsage":
        return TokenUsage(prompt_tokens=0, completion_tokens=0, model_name="")

    @staticmethod
    def from_anthropic(usage, model_name: str) -> "TokenUsage":
        return TokenUsage(
            prompt_tokens=getattr(usage, "input_tokens", 0),
            completion_tokens=getattr(usage, "output_tokens", 0),
            model_name=model_name,
            cache_read_tokens=getattr(usage, "cache_read_input_tokens", 0) or 0,
            cache_write_tokens=getattr(usage, "cache_creation_input_tokens", 0) or 0,
        )

    @staticmethod
    def from_langchain_response(response, model_name: str = "") -> "TokenUsage":
        """Extract token counts from a LangChain AIMessage.

        Both ChatGoogleGenerativeAI and ChatOpenAI populate
        ``response.usage_metadata`` with ``input_tokens`` / ``output_tokens``.
        Falls back to ``TokenUsage.empty()`` when the metadata is absent.
        """
        usage_metadata = getattr(response, "usage_metadata", None)
        if usage_metadata:
            return TokenUsage(
                prompt_tokens=usage_metadata.get("input_tokens", 0),
                completion_tokens=usage_metadata.get("output_tokens", 0),
                model_name=model_name or getattr(response, "model_name", ""),
            )
        # Some providers expose usage in response_metadata instead
        response_metadata = getattr(response, "response_metadata", None) or {}
        token_usage = response_metadata.get("token_usage") or response_metadata.get("usage") or {}
        if token_usage:
            return TokenUsage(
                prompt_tokens=token_usage.get("prompt_tokens", token_usage.get("input_tokens", 0)),
                completion_tokens=token_usage.get("completion_tokens", token_usage.get("output_tokens", 0)),
                model_name=model_name or response_metadata.get("model_name", ""),
            )
        return TokenUsage.empty()
