"""US-AI-17 — Anthropic prompt caching (red-phase tests).

Spec §17 (doc/web-client/specs/ai-enhancement.md):
- F-AI-17.1  every Anthropic-path chain sends `system` as a content-block list
             whose last block carries cache_control {"type": "ephemeral"}.
- F-AI-17.2  (REVISED) the editor chat chain's Anthropic path sends `system` as
             TWO text blocks — the instruction prompt, then a profile-document
             block ("Current profile (JSON …):\n" + compact JSON) carrying the
             cache breakpoint — and the final user message is the RAW user text
             (byte-equal to next turn's history echo), its last content block
             cache-marked, on every loop iteration. Embedding the document via
             _build_prompt in each turn's final message made turn N's cached
             prefix never a prefix of turn N+1's messages.
- F-AI-17.3  the chat prompt (LangChain path's _build_prompt, unchanged) embeds
             the profile document as COMPACT JSON.
- F-AI-17.4  TokenUsage carries cache_read_tokens / cache_write_tokens.
- F-AI-17.5  gRPC UsageMetadata gains cache_read_tokens=4 / cache_write_tokens=5.
- F-AI-17.9  Langfuse usage_details include the Anthropic cache key names.
- F-AI-17.10 non-Anthropic (LangChain) path: no cache_control, zero cache counts.
"""
import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.chains.usage import TokenUsage
from app.schemas import ProfileDocument, ProfileHeader

from .conftest import chip_list_section, list_section, profile_document

CACHE_MARKER = {"type": "ephemeral"}


# ---------------------------------------------------------------------------
# Fakes. Plain classes (not MagicMock) so absent attributes really are absent
# and arithmetic over the fields stays integer.
# ---------------------------------------------------------------------------

class _UsageNoCache:
    """Anthropic usage as returned by providers without cache fields."""

    def __init__(self, inp: int, out: int):
        self.input_tokens = inp
        self.output_tokens = out


class _UsageWithCache(_UsageNoCache):
    def __init__(self, inp: int, out: int, cache_read: int, cache_write: int):
        super().__init__(inp, out)
        self.cache_read_input_tokens = cache_read
        self.cache_creation_input_tokens = cache_write


class _TextBlock:
    type = "text"

    def __init__(self, text: str):
        self.text = text


class _Message:
    def __init__(self, text: str, *, usage=None, stop_reason: str = "end_turn"):
        self.stop_reason = stop_reason
        self.content = [_TextBlock(text)]
        self.usage = usage or _UsageNoCache(10, 5)


def _last_block_has_cache_marker(blocks):
    assert isinstance(blocks, list) and blocks, (
        f"expected a non-empty content-block list, got {blocks!r}"
    )
    last = blocks[-1]
    assert last.get("cache_control") == CACHE_MARKER, (
        f"last block must carry cache_control {CACHE_MARKER}, got {last!r}"
    )


def _blocks_text(blocks) -> str:
    return "".join(b.get("text", "") for b in blocks)


def _msg_text(content) -> str:
    """Text of a message whose content is a plain string or a block list."""
    if isinstance(content, str):
        return content
    return _blocks_text(content)


# Revised F-AI-17.2/17.3: the chat document travels in system block 2 under
# this header, so it is part of the cached prefix instead of the final message.
DOC_BLOCK_PREFIX = 'Current profile (JSON — address nodes by their "id"):\n'


def _assert_cached_system(kwargs: dict, expected_text: str):
    """F-AI-17.1: `system` is a block list; last block cache-marked; the joined
    text equals what was previously sent as the plain-string system prompt."""
    system = kwargs["system"]
    assert isinstance(system, list), (
        "system must be sent as a content-block list to carry cache_control, "
        f"got {type(system).__name__}"
    )
    _last_block_has_cache_marker(system)
    assert _blocks_text(system) == expected_text


@pytest.fixture()
def profile() -> ProfileDocument:
    return profile_document(
        id="p1",
        header=ProfileHeader(fullName="Jane Doe", title="Software Engineer"),
        sections=[
            list_section("Experience", ["Built distributed systems"]),
            chip_list_section("Skills", ["Python", "Go"]),
        ],
    )


# ===========================================================================
# F-AI-17.4 — TokenUsage carries and accumulates the cache token counts
# ===========================================================================

def test_from_anthropic_maps_cache_fields():
    usage = TokenUsage.from_anthropic(_UsageWithCache(100, 20, 300, 50), "claude-x")

    assert usage.prompt_tokens == 100
    assert usage.completion_tokens == 20
    assert usage.cache_read_tokens == 300
    assert usage.cache_write_tokens == 50


def test_from_anthropic_defaults_cache_fields_to_zero_when_absent():
    usage = TokenUsage.from_anthropic(_UsageNoCache(100, 20), "claude-x")

    assert usage.cache_read_tokens == 0
    assert usage.cache_write_tokens == 0


def test_empty_has_zero_cache_counts():
    usage = TokenUsage.empty()

    assert usage.cache_read_tokens == 0
    assert usage.cache_write_tokens == 0


def test_from_langchain_response_yields_zero_cache_counts():
    class _Resp:
        usage_metadata = {"input_tokens": 10, "output_tokens": 5}
        response_metadata = {}

    usage = TokenUsage.from_langchain_response(_Resp(), "gpt-x")

    assert usage.prompt_tokens == 10
    assert usage.completion_tokens == 5
    assert usage.cache_read_tokens == 0
    assert usage.cache_write_tokens == 0


def test_add_usage_sums_cache_fields_across_turns():
    from app.chains.chat_chain import _add_usage

    acc = _add_usage(None, _UsageWithCache(100, 10, 300, 50), "claude-x")
    acc = _add_usage(acc, _UsageWithCache(40, 5, 200, 25), "claude-x")

    assert acc.prompt_tokens == 140
    assert acc.completion_tokens == 15
    assert acc.cache_read_tokens == 500
    assert acc.cache_write_tokens == 75


# ===========================================================================
# F-AI-17.1 — system-prompt cache breakpoint on every Anthropic-path chain
# ===========================================================================

@pytest.mark.asyncio
async def test_chat_system_prompt_carries_cache_breakpoint(profile):
    """Revised F-AI-17.2: chat `system` is TWO text blocks — the instruction
    prompt, then the profile-document block carrying the cache breakpoint."""
    from app.chains import chat_chain

    stream = AsyncMock(return_value=_Message(json.dumps({"reply": "ok", "proposal": None})))

    with patch.object(chat_chain, "_build_anthropic_messages_client", return_value=MagicMock()), \
         patch.object(chat_chain, "_get_anthropic_model", return_value="claude-x"), \
         patch("app.settings.llm_provider", return_value="anthropic"), \
         patch("app.observability.anthropic_stream", new=stream):
        await chat_chain.chat_reply(profile, "What are my skills?", [])

    system = stream.call_args.kwargs["system"]
    assert isinstance(system, list), (
        f"system must be a content-block list, got {type(system).__name__}"
    )
    assert len(system) == 2, (
        f"system must be two blocks (instructions + document), got {len(system)}"
    )

    # Block 1: the instruction prompt, byte-equal to the old plain-string prompt.
    assert system[0].get("text") == chat_chain._SYSTEM_PROMPT

    # Block 2: the profile document as COMPACT JSON, cache-marked.
    doc_block = system[-1]
    assert doc_block.get("cache_control") == CACHE_MARKER, (
        f"document block must carry cache_control {CACHE_MARKER}, got {doc_block!r}"
    )
    doc_text = doc_block.get("text", "")
    assert doc_text.startswith(DOC_BLOCK_PREFIX)
    assert profile.model_dump_json(exclude_none=True) in doc_text, (
        "document must be embedded in system block 2 as compact JSON"
    )
    assert profile.model_dump_json(indent=2, exclude_none=True) not in doc_text


@pytest.mark.asyncio
async def test_generate_system_prompt_carries_cache_breakpoint(profile):
    from app.chains import cv_chain

    doc_json = profile.model_dump_json(exclude_none=True)
    create = AsyncMock(return_value=_Message(doc_json))

    with patch.object(cv_chain, "_build_anthropic_messages_client", return_value=MagicMock()), \
         patch.object(cv_chain, "_get_anthropic_model", return_value="claude-x"), \
         patch("app.settings.anthropic_max_tokens", return_value=1024), \
         patch("app.observability.anthropic_create", new=create):
        await cv_chain._generate_cv_foundry_raw(
            cv_chain._profile_to_prompt_vars(profile), provider="anthropic"
        )

    _assert_cached_system(create.call_args.kwargs, cv_chain._SYSTEM_PROMPT)


@pytest.mark.asyncio
async def test_extract_system_prompt_carries_cache_breakpoint(profile):
    from app.chains import cv_chain

    doc_json = profile.model_dump_json(exclude_none=True)
    create = AsyncMock(return_value=_Message(doc_json))

    with patch.object(cv_chain, "_build_anthropic_messages_client", return_value=MagicMock()), \
         patch.object(cv_chain, "_get_anthropic_model", return_value="claude-x"), \
         patch("app.settings.anthropic_max_tokens", return_value=1024), \
         patch("app.observability.anthropic_create", new=create):
        await cv_chain._extract_profile_foundry_raw(
            "Jane Doe\nSoftware Engineer\nSkills: Python, Go", provider="anthropic"
        )

    _assert_cached_system(create.call_args.kwargs, cv_chain._EXTRACT_SYSTEM_PROMPT)


@pytest.mark.asyncio
async def test_user_chat_system_prompt_carries_cache_breakpoint():
    from app.chains import user_chat_chain

    create = AsyncMock(return_value=_Message("Add measurable achievements."))

    with patch.object(user_chat_chain, "_build_anthropic_messages_client", return_value=MagicMock()), \
         patch.object(user_chat_chain, "_get_anthropic_model", return_value="claude-x"), \
         patch("app.settings.llm_provider", return_value="anthropic"), \
         patch("app.observability.anthropic_create", new=create):
        await user_chat_chain.user_chat_reply([], "How can I improve my CV?", [])

    _assert_cached_system(create.call_args.kwargs, user_chat_chain._SYSTEM_PROMPT)


@pytest.mark.asyncio
async def test_job_chat_system_prompt_carries_cache_breakpoint():
    from app.chains import job_chat_chain

    create = AsyncMock(return_value=_Message(json.dumps({"reply": "ok", "proposal": None})))

    with patch.object(job_chat_chain, "_build_anthropic_messages_client", return_value=MagicMock()), \
         patch.object(job_chat_chain, "_get_anthropic_model", return_value="claude-x"), \
         patch("app.settings.llm_provider", return_value="anthropic"), \
         patch("app.observability.anthropic_create", new=create):
        await job_chat_chain.job_chat_reply(
            [],
            job_title="Senior Engineer",
            job_description="Go and TypeScript.",
            field_context="cover letter",
            message="what does this role need?",
            history=[],
        )

    _assert_cached_system(create.call_args.kwargs, job_chat_chain._SYSTEM_PROMPT)


@pytest.mark.asyncio
async def test_cover_letter_system_prompt_carries_cache_breakpoint(profile):
    from app.chains import cover_letter_chain
    from app.chains.cover_letter_chain import CoverLetterRequest

    create = AsyncMock(
        return_value=_Message("PROFILE_INDEX: 0\nCOVER_LETTER: I am a great fit.")
    )
    request = CoverLetterRequest(
        profiles=[profile],
        profile_ids=["p1"],
        job_title="Senior Engineer",
        job_description="Go and TypeScript.",
        field_context="cover letter",
    )

    with patch.object(cover_letter_chain, "_build_anthropic_messages_client", return_value=MagicMock()), \
         patch.object(cover_letter_chain, "_get_anthropic_model", return_value="claude-x"), \
         patch("app.settings.llm_provider", return_value="anthropic"), \
         patch("app.observability.anthropic_create", new=create):
        await cover_letter_chain.generate_cover_letter(request)

    _assert_cached_system(create.call_args.kwargs, cover_letter_chain._SYSTEM_PROMPT)


@pytest.mark.asyncio
async def test_profile_selector_system_prompt_carries_cache_breakpoint(profile):
    from app.chains import profile_selector_chain

    other = profile_document(
        id="p2",
        header=ProfileHeader(fullName="Jane Doe", title="Data Engineer"),
        sections=[chip_list_section("Skills", ["SQL"])],
    )
    create = AsyncMock(return_value=_Message(json.dumps({"selected_profile_id": "p1"})))

    with patch.object(profile_selector_chain, "_build_anthropic_messages_client", return_value=MagicMock()), \
         patch.object(profile_selector_chain, "_get_anthropic_model", return_value="claude-x"), \
         patch("app.settings.llm_provider", return_value="anthropic"), \
         patch("app.observability.anthropic_create", new=create):
        await profile_selector_chain.select_best_profile([profile, other], "Go role")

    _assert_cached_system(create.call_args.kwargs, profile_selector_chain._SYSTEM_PROMPT)


# ===========================================================================
# F-AI-17.2 — chat chain: breakpoint on the final message, every iteration
# ===========================================================================

@pytest.mark.asyncio
async def test_chat_final_message_carries_cache_breakpoint_and_history_untouched(profile):
    """Revised F-AI-17.2: the final user message is the RAW user text — byte-equal
    to what the client echoes back as history next turn — so turn N's messages
    are a prefix of turn N+1's. The document travels in system block 2 instead."""
    from app.chains import chat_chain
    from app.chains.chat_chain import ChatMessage

    history = [
        ChatMessage(role="user", content="Hello"),
        ChatMessage(role="assistant", content="Hi! How can I help with your CV?"),
    ]
    stream = AsyncMock(return_value=_Message(json.dumps({"reply": "ok", "proposal": None})))

    with patch.object(chat_chain, "_build_anthropic_messages_client", return_value=MagicMock()), \
         patch.object(chat_chain, "_get_anthropic_model", return_value="claude-x"), \
         patch("app.settings.llm_provider", return_value="anthropic"), \
         patch("app.observability.anthropic_stream", new=stream):
        await chat_chain.chat_reply(profile, "What are my skills?", history)

    kwargs = stream.call_args.kwargs
    messages = kwargs["messages"]

    # Earlier (history) messages are sent unchanged — plain string content.
    assert messages[0] == {"role": "user", "content": "Hello"}
    assert messages[1] == {"role": "assistant", "content": "Hi! How can I help with your CV?"}

    # The final message's content is a block list whose LAST block is cache-marked,
    # and its text is EXACTLY the raw user message (string→block conversion only
    # at the final message, no prompt template around it).
    final = messages[-1]
    assert final["role"] == "user"
    _last_block_has_cache_marker(final["content"])
    assert _blocks_text(final["content"]) == "What are my skills?"

    # The document lives in system block 2, and nowhere in the messages.
    compact = profile.model_dump_json(exclude_none=True)
    assert compact in kwargs["system"][-1].get("text", "")
    assert compact not in repr(messages), (
        "the profile document must not be embedded in the (uncacheable-across-"
        "turns) final user message"
    )


@pytest.mark.asyncio
async def test_chat_second_tool_loop_iteration_reapplies_cache_breakpoint(profile):
    from app.chains import chat_chain
    from app.chains.chat_chain import OtherProfile

    other = OtherProfile(
        id="op1",
        name="Backend CV",
        document=profile_document(
            id="op1",
            header=ProfileHeader(fullName="Jane Doe", title="Backend Engineer"),
            sections=[chip_list_section("Skills", ["Rust"])],
        ),
    )

    tool_block = MagicMock()
    tool_block.type = "tool_use"
    tool_block.name = "list_profiles"
    tool_block.input = {}
    tool_block.id = "tu_1"

    first = MagicMock()
    first.stop_reason = "tool_use"
    first.content = [tool_block]
    first.usage = _UsageNoCache(10, 5)

    second = _Message(json.dumps({"reply": "ok", "proposal": None}))
    stream = AsyncMock(side_effect=[first, second])

    with patch.object(chat_chain, "_build_anthropic_messages_client", return_value=MagicMock()), \
         patch.object(chat_chain, "_get_anthropic_model", return_value="claude-x"), \
         patch("app.settings.llm_provider", return_value="anthropic"), \
         patch("app.observability.anthropic_stream", new=stream):
        await chat_chain.chat_reply(
            profile, "borrow the Rust experience from my Backend CV", [], [other]
        )

    assert stream.call_count == 2

    # Second iteration: the final message is now the tool_result turn; its last
    # content block must carry the cache marker again.
    second_messages = stream.call_args_list[1].kwargs["messages"]
    final = second_messages[-1]
    assert final["role"] == "user"
    blocks = final["content"]
    assert isinstance(blocks, list) and blocks
    assert blocks[-1].get("cache_control") == CACHE_MARKER, (
        f"tool-loop iteration must re-apply the cache breakpoint, got {blocks[-1]!r}"
    )

    # Revised F-AI-17.2: the pre-tool user message is the RAW user text (no
    # _build_prompt template, no embedded document) — on both iterations.
    raw = "borrow the Rust experience from my Backend CV"
    assert _msg_text(second_messages[0]["content"]) == raw
    assert _msg_text(stream.call_args_list[0].kwargs["messages"][-1]["content"]) == raw


@pytest.mark.asyncio
async def test_chat_document_system_block_is_byte_identical_across_requests(profile):
    """Revised F-AI-17.2 — the byte-stability property the old contract broke:
    when the document hasn't changed, the cache-marked document system block is
    byte-identical across consecutive requests (different user messages), so a
    follow-up turn can actually hit the provider's prompt cache."""
    from app.chains import chat_chain

    stream = AsyncMock(return_value=_Message(json.dumps({"reply": "ok", "proposal": None})))

    with patch.object(chat_chain, "_build_anthropic_messages_client", return_value=MagicMock()), \
         patch.object(chat_chain, "_get_anthropic_model", return_value="claude-x"), \
         patch("app.settings.llm_provider", return_value="anthropic"), \
         patch("app.observability.anthropic_stream", new=stream):
        await chat_chain.chat_reply(profile, "What are my skills?", [])
        await chat_chain.chat_reply(profile, "Rename my title to Staff Engineer", [])

    first_doc_block = stream.call_args_list[0].kwargs["system"][-1]
    second_doc_block = stream.call_args_list[1].kwargs["system"][-1]

    # It IS the document block (not just any repeated block) and it is marked.
    assert profile.model_dump_json(exclude_none=True) in first_doc_block.get("text", "")
    assert first_doc_block.get("cache_control") == CACHE_MARKER

    assert first_doc_block.get("text") == second_doc_block.get("text"), (
        "the document system block must be byte-identical across turns for an "
        "unchanged document — otherwise cross-turn cache reads cannot happen"
    )


# ===========================================================================
# F-AI-17.3 — chat prompt embeds the document as COMPACT JSON
# (the LangChain-path _build_prompt — unchanged by the revised contract)
# ===========================================================================

def test_chat_prompt_embeds_document_as_compact_json(profile):
    from app.chains.chat_chain import _build_prompt

    prompt = _build_prompt(profile, "hi")

    compact = profile.model_dump_json(exclude_none=True)
    indented = profile.model_dump_json(indent=2, exclude_none=True)

    assert compact in prompt, "document must be embedded compactly (no indent)"
    assert indented not in prompt, "indented document JSON must no longer be sent"


# ===========================================================================
# F-AI-17.5 — gRPC UsageMetadata cache fields + servicer mapping
# ===========================================================================

def test_usage_metadata_proto_has_cache_token_fields():
    from app.grpc import llm_service_pb2

    fields = llm_service_pb2.UsageMetadata.DESCRIPTOR.fields_by_name
    assert "cache_read_tokens" in fields
    assert "cache_write_tokens" in fields
    # Additive proto change — fields 4 and 5 keep old clients wire-compatible.
    assert fields["cache_read_tokens"].number == 4
    assert fields["cache_write_tokens"].number == 5


def test_usage_proto_maps_cache_fields_from_token_usage():
    from app.grpc.servicer import _usage_proto

    usage = TokenUsage(
        prompt_tokens=10,
        completion_tokens=5,
        model_name="claude-x",
        cache_read_tokens=7,
        cache_write_tokens=3,
    )
    proto = _usage_proto(usage)

    assert proto.prompt_tokens == 10
    assert proto.completion_tokens == 5
    assert proto.cache_read_tokens == 7
    assert proto.cache_write_tokens == 3


# ===========================================================================
# F-AI-17.9 — Langfuse usage_details carry the Anthropic cache key names
# ===========================================================================

def test_anthropic_usage_includes_cache_keys_when_present():
    from app.observability import _anthropic_usage

    message = MagicMock()
    message.usage = _UsageWithCache(100, 20, 300, 50)

    details = _anthropic_usage(message)

    assert details["input"] == 100
    assert details["output"] == 20
    assert details["cache_read_input_tokens"] == 300
    assert details["cache_creation_input_tokens"] == 50


def test_anthropic_usage_stays_plain_when_cache_fields_absent():
    from app.observability import _anthropic_usage

    message = MagicMock()
    message.usage = _UsageNoCache(100, 20)

    details = _anthropic_usage(message)

    assert details == {"input": 100, "output": 20}


# ===========================================================================
# F-AI-17.10 — LangChain path: no cache_control anywhere, zero cache counts
# ===========================================================================

@pytest.mark.asyncio
async def test_langchain_path_sends_no_cache_control_and_records_zero_cache(profile):
    from app.chains import chat_chain

    class _Resp:
        content = json.dumps({"reply": "ok", "proposal": None})
        usage_metadata = {"input_tokens": 10, "output_tokens": 5}
        response_metadata = {}

    lc_invoke = AsyncMock(return_value=_Resp())

    with patch.object(chat_chain, "_build_llm", return_value=MagicMock()), \
         patch("app.settings.llm_provider", return_value="openai"), \
         patch("app.observability.lc_invoke", new=lc_invoke), \
         patch("app.chains.chat_chain._llm_model_name", return_value="gpt-x"):
        _result, usage = await chat_chain.chat_reply(profile, "What are my skills?", [])

    # No cache_control anywhere in what was sent to the LangChain model.
    sent = repr(lc_invoke.call_args)
    assert "cache_control" not in sent

    # Recorded usage carries zeros for the new counts — cost math unchanged.
    assert usage.prompt_tokens == 10
    assert usage.completion_tokens == 5
    assert usage.cache_read_tokens == 0
    assert usage.cache_write_tokens == 0
