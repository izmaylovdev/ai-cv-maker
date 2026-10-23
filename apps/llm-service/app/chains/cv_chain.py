from __future__ import annotations

import json
import re

from anthropic import AsyncAnthropic, AsyncAnthropicFoundry
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.prompts import ChatPromptTemplate
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_openai import ChatOpenAI
from pydantic import ValidationError

from app import observability
from app import settings as app_settings
from app.chains.anthropic_cache import cached_system
from app.chains.usage import TokenUsage
from app.guards import guard_cv_text
from app.schemas import (
    BlockNode,
    ExtractResponse,
    GenerateResponse,
    ProfileDocument,
)

# The document JSON contract the model must read and emit (ADR-0014 §9.2/§9.3, US-EDIT-19).
# The body is a flat block tree: `title` nodes act as section headings directly under root,
# followed by their content nodes — there are NO `section` wrapper nodes.
_DOCUMENT_SCHEMA = """\
A ProfileDocument is JSON shaped:
{
  "header": { "fullName": str, "title": str, "email": str, "phone": str, "location": str },
  "body": <root node>
}
The body is a single tree of BlockNodes. Every node is:
  { "type": str, "id": str, "attrs": { ... }, "children": [ <node>, ... ] }
`type` is from a CLOSED set; `attrs` holds leaf data; `children` is ordered
(array order IS document order). No other types and no raw HTML are allowed.

Node vocabulary and the children each may contain (the nesting matrix):
- root      → children: title | paragraph | list | chips | timeline | link  (flat body)
- title     attrs:{text}        → leaf; section heading, e.g. "Work Experience"
- paragraph → children: text*                            (a text block / one run)
- text      attrs:{text}        → leaf (no children); plain string
- link      attrs:{text,url}    → leaf
- list      → children: listItem*                        (bulleted list)
- listItem  → children: paragraph | list | chips | link  (rich item; nested lists ok)
- chips     → children: chip*                            (tag cloud: skills, tools)
- chip      attrs:{text}        → leaf (no children); short string
- timeline  → children: entry*                           (dated entries)
- entry     attrs:{title,dates} → children: paragraph | list   (rich description)

Rules:
- The body is FLAT. Use a `title` node to start a section, then put its content nodes
  (paragraph, list, chips, timeline, link) directly under root — NOT inside a wrapper.
  There is NO `section` node type.
- Do NOT nest timeline inside listItem/entry; no chips inside a chip;
  nothing inside text/chip/title. Max nesting ~4 levels.
- `dates` is FREE TEXT exactly as a CV would print it, e.g. "Jan 2022 – Present".
- A timeline entry `title` carries the role/degree and organisation,
  e.g. "Senior Engineer · Acme Corp".
- Use `chips` (not a list) for skills/tools/languages tag clouds.
- Keep every node's `id` unchanged when you receive one; mint a short unique id for
  new nodes.
"""


def _format_node(node: BlockNode, indent: int, lines: list[str]) -> None:
    """Recursively render a BlockNode subtree as readable indented text."""
    pad = "  " * indent
    if node.type == "paragraph":
        text = "".join(c.attrs.get("text", "") for c in node.children if c.type == "text")
        if text:
            lines.append(f"{pad}{text}")
        return
    elif node.type == "list":
        for item in node.children:
            if item.type != "listItem":
                continue
            lines.append(f"{pad}-")
            for child in item.children:
                _format_node(child, indent + 1, lines)
        return
    elif node.type == "chips":
        labels = [c.attrs.get("text", "") for c in node.children if c.type == "chip"]
        labels = [t for t in labels if t]
        if labels:
            lines.append(f"{pad}{', '.join(labels)}")
        return
    elif node.type == "timeline":
        for entry in node.children:
            if entry.type != "entry":
                continue
            title = entry.attrs.get("title", "")
            dates = entry.attrs.get("dates", "")
            head = " ".join(p for p in [title, f"({dates})" if dates else ""] if p)
            lines.append(f"{pad}- {head}")
            for child in entry.children:
                _format_node(child, indent + 1, lines)
        return

    for child in node.children:
        _format_node(child, indent, lines)


def _format_document(doc: ProfileDocument) -> str:
    """Render a document as readable text for the prompt context (ADR-0014 flat body)."""
    h = doc.header
    lines: list[str] = ["Header:", f"  Name: {h.fullName}", f"  Title: {h.title}"]
    if h.location:
        lines.append(f"  Location: {h.location}")
    if h.email:
        lines.append(f"  Email: {h.email}")
    if h.phone:
        lines.append(f"  Phone: {h.phone}")

    # Group flat root children by title nodes into logical sections (ADR-0014).
    sections: list[tuple[str | None, list[BlockNode]]] = []
    current_heading: str | None = None
    current_nodes: list[BlockNode] = []
    for node in doc.body.children:
        if node.type == "title":
            if current_nodes or current_heading is not None:
                sections.append((current_heading, current_nodes))
            current_heading = node.attrs.get("text", "")
            current_nodes = []
        else:
            current_nodes.append(node)
    if current_nodes or current_heading is not None:
        sections.append((current_heading, current_nodes))

    if not sections:
        lines.append("\nSections: (none)")
        return "\n".join(lines)

    for heading, nodes in sections:
        if heading is not None:
            lines.append(f"\nSection — {heading}")
        for node in nodes:
            _format_node(node, 1, lines)
    return "\n".join(lines)


_SYSTEM_PROMPT = """\
You are an expert CV writer and career coach. You receive a candidate's profile as a \
ProfileDocument (a header plus a flat body of title + content nodes) and rewrite it into \
a polished, professional CV — returned as a ProfileDocument with the SAME structure.

Rules:
- Preserve the structure the user authored: keep the same title headings, node order, and \
the same number of timeline/list items. Improve the wording, do not restructure.
- Write impactful, concise prose. Use action verbs and quantify achievements where possible.
- For free-form sections (e.g. a summary paragraph after a title node), tighten to 2–4 sentences.
- For timeline entries, rewrite their paragraph children into 2–4 impact-focused sentences; \
keep `title` and the free-text `dates` attrs exactly as given.
- For list items (e.g. skills), normalise names (e.g. "TypeScript" not "typescript").
- Never invent facts (companies, dates, institutions). Keep header contact fields unchanged.
- Return ONLY valid JSON for the ProfileDocument. No markdown, no extra text.

{schema}
""".format(schema=_DOCUMENT_SCHEMA)

_HUMAN_PROMPT = """\
Rewrite the following profile into a polished CV.{message_context} Return the ProfileDocument JSON.

Current profile:
{document}
"""


def _profile_to_prompt_vars(profile: ProfileDocument, message: str | None = None) -> dict[str, str]:
    message_context = f" The candidate is targeting: {message}." if message and message.strip() else ""
    return {
        "message_context": message_context,
        "document": _format_document(profile),
    }


def _strip_optional_json_fence(raw: str) -> str:
    text = raw.strip()
    if not text.startswith("```"):
        return text
    text = re.sub(r"^```(?:json)?\s*", "", text, count=1, flags=re.IGNORECASE)
    text = re.sub(r"\s*```\s*$", "", text, count=1)
    return text.strip()


def _parse_document_json(text: str, *, kind: str) -> ProfileDocument:
    cleaned = _strip_optional_json_fence(text)
    try:
        return ProfileDocument.model_validate_json(cleaned)
    except (ValidationError, ValueError) as exc:
        snippet = text[:2000] + ("…" if len(text) > 2000 else "")
        raise ValueError(f"Model did not return valid {kind} document JSON: {exc}\n---\n{snippet}") from exc


def _anthropic_text_content(message) -> str:
    parts: list[str] = []
    for block in message.content:
        if getattr(block, "type", None) == "text":
            parts.append(block.text)
    if not parts:
        raise ValueError("No text content in model response")
    return "".join(parts)


def _build_anthropic_messages_client(provider: str) -> AsyncAnthropic | AsyncAnthropicFoundry:
    if provider == "anthropic":
        api_key = app_settings.anthropic_api_key()
        if not api_key:
            raise ValueError("ANTHROPIC_API_KEY is required when LLM_PROVIDER=anthropic.")
        return AsyncAnthropic(api_key=api_key)
    # foundry / azure variants
    api_key = app_settings.foundry_api_key()
    if not api_key:
        raise ValueError(
            "FOUNDRY_API_KEY is required when LLM_PROVIDER is foundry "
            "(Azure Foundry key from Keys and Endpoint)."
        )
    base_url = app_settings.foundry_base_url()
    resource = app_settings.foundry_resource()
    if base_url:
        return AsyncAnthropicFoundry(api_key=api_key, base_url=base_url)
    if resource:
        return AsyncAnthropicFoundry(api_key=api_key, resource=resource)
    raise ValueError(
        "Set ANTHROPIC_FOUNDRY_BASE_URL (full URL to .../anthropic) or "
        "ANTHROPIC_FOUNDRY_RESOURCE (resource name for *.services.ai.azure.com)."
    )


def _get_anthropic_model(provider: str) -> str:
    if provider == "anthropic":
        return app_settings.anthropic_model()
    return app_settings.foundry_model()


async def _generate_cv_foundry_raw(inputs: dict[str, str], global_preferences: str = "", provider: str = "foundry"):
    model = _get_anthropic_model(provider)
    if not model:
        raise ValueError(
            "Set LLM_MODEL or ANTHROPIC_FOUNDRY_DEPLOYMENT to your Foundry deployment name "
            "(e.g. claude-haiku-4-5)."
        )
    client = _build_anthropic_messages_client(provider)
    user_content = _HUMAN_PROMPT.format(**inputs)
    system_prompt = _SYSTEM_PROMPT
    if global_preferences and global_preferences.strip():
        system_prompt = f"{_SYSTEM_PROMPT}\n\nUser preferences (apply to all output):\n{global_preferences}"
    message = await observability.anthropic_create(
        client,
        name="generate",
        model=model,
        max_tokens=app_settings.anthropic_max_tokens(),
        system=cached_system(system_prompt),
        messages=[{"role": "user", "content": user_content}],
    )
    document = _parse_document_json(_anthropic_text_content(message), kind="CV")
    return GenerateResponse(document=document), message.usage


async def _generate_cv_foundry(inputs: dict[str, str], global_preferences: str = "", provider: str = "foundry") -> tuple[GenerateResponse, TokenUsage]:
    result, raw_usage = await _generate_cv_foundry_raw(inputs, global_preferences, provider)
    model = _get_anthropic_model(provider) or ""
    return result, TokenUsage.from_anthropic(raw_usage, model)


def _build_llm() -> BaseChatModel:
    provider = app_settings.llm_provider()
    temperature = app_settings.llm_temperature()

    if provider in ("openai", "openai_compatible", "lm_studio", "lm-studio"):
        return ChatOpenAI(
            model=app_settings.openai_model(),
            temperature=temperature,
            api_key=app_settings.openai_api_key(),
            base_url=app_settings.openai_base_url(),
        )

    if provider == "azure_openai":
        from langchain_openai import AzureChatOpenAI
        return AzureChatOpenAI(
            azure_deployment=app_settings.foundry_model(),
            azure_endpoint=app_settings.foundry_base_url(),
            api_key=app_settings.foundry_api_key(),
            api_version=app_settings.azure_openai_api_version(),
            temperature=temperature,
        )

    if provider == "google":
        return ChatGoogleGenerativeAI(
            model=app_settings.google_model(),
            temperature=temperature,
        )

    if provider in ("anthropic", "foundry", "anthropic_foundry", "azure_foundry"):
        raise ValueError(
            f"LLM_PROVIDER={provider!r} uses the Anthropic SDK directly, not LangChain; "
            "call generate_cv() which routes by provider."
        )

    raise ValueError(
        f"Unknown LLM_PROVIDER={provider!r}. Use 'google', 'openai', 'anthropic', or 'foundry'."
    )


def _llm_model_name() -> str:
    """Return the configured model name for the current provider."""
    provider = app_settings.llm_provider()
    if provider == "google":
        return app_settings.google_model() or ""
    if provider in ("openai", "openai_compatible", "lm_studio", "lm-studio"):
        return app_settings.openai_model() or ""
    if provider == "azure_openai":
        return app_settings.foundry_model() or ""
    if provider == "anthropic":
        return app_settings.anthropic_model() or ""
    return ""


async def _invoke_llm_for_generate(
    system_prompt: str,
    inputs: dict[str, str],
) -> tuple[GenerateResponse, TokenUsage]:
    """Call the LLM directly (no structured output) and parse the JSON response.

    This lets us capture usage_metadata from the AIMessage.
    """
    from langchain_core.messages import HumanMessage, SystemMessage

    llm = _build_llm()
    messages = [
        SystemMessage(content=system_prompt),
        HumanMessage(content=_HUMAN_PROMPT.format(**inputs)),
    ]
    response = await observability.lc_invoke(llm, messages, name="generate")
    document = _parse_document_json(str(response.content), kind="CV")
    usage = TokenUsage.from_langchain_response(response, _llm_model_name())
    return GenerateResponse(document=document), usage


async def generate_cv(
    profile: ProfileDocument,
    message: str | None = None,
    global_preferences: str = "",
) -> tuple[GenerateResponse, TokenUsage]:
    inputs = _profile_to_prompt_vars(profile, message)
    provider = app_settings.llm_provider()

    if provider in ("anthropic", "foundry", "anthropic_foundry", "azure_foundry"):
        return await _generate_cv_foundry(inputs, global_preferences, provider)

    system_prompt = _SYSTEM_PROMPT
    if global_preferences and global_preferences.strip():
        system_prompt = f"{_SYSTEM_PROMPT}\n\nUser preferences (apply to all output):\n{global_preferences}"

    return await _invoke_llm_for_generate(system_prompt, inputs)



_EXTRACT_SYSTEM_PROMPT = """\
You are an expert CV parser. Your task is to extract a candidate's profile from raw CV/resume \
text and return it as a ProfileDocument.

Rules:
- Put identity and contact details in the header (fullName, title, email, phone, location); use \
empty strings for fields not present.
- The body is FLAT: start each logical section with a `title` node directly under root, \
then place the section's content nodes (paragraph, timeline, chips, list) directly under root \
too — NOT inside a wrapper node. There is no `section` node type.
- For a professional summary/objective (or synthesise one if absent): emit a title node \
with text "Summary" followed by a paragraph node.
- For work history: emit a title node with text "Work Experience" followed by a timeline node; \
each entry's `title` attr is "<role> · <company>" and `dates` is the free-text range exactly \
as written, e.g. "Jan 2019 – Present" (use "Present"/"Current" verbatim if ongoing).
- For education: emit a title node with text "Education" followed by a timeline node; \
each entry's `title` is "<degree> in <field> · <institution>" and `dates` the year range.
- For skills/tools: emit a title node with text "Skills" followed by a chips node with one \
chip per skill/tool; normalise names (e.g. "TypeScript" not "typescript").
- Only include sections that have content. Mint a short unique id for every node.
- Also suggest a profile name (US-PROF-8): a short role-oriented label for this profile, \
e.g. "Senior Backend Engineer", at most 100 characters. Prefer the CV's stated professional \
title; else infer a title from the most recent role; else use the candidate's full name. \
Never invent a role not supported by the CV. Use "" if nothing is derivable.
- Return ONLY one valid JSON object shaped {{ "profileName": str, "document": ProfileDocument }}. \
No markdown, no extra text.

{schema}
""".format(schema=_DOCUMENT_SCHEMA)

_EXTRACT_HUMAN_PROMPT = """\
Extract the profile from the following CV text and return the {{"profileName", "document"}} JSON object.

CV Text:
{cv_text}
"""


def _fallback_profile_name(document: ProfileDocument) -> str:
    """F-PROF-8.2 code-side fallback: header.title, then header.fullName, else ""."""
    return document.header.title or document.header.fullName or ""


def _parse_extract_response(text: str) -> ExtractResponse:
    """Parse the extraction answer: `{"profileName", "document"}` wrapper (US-PROF-8),
    falling back to a bare ProfileDocument (legacy shape) — the name field must
    never make extraction fail."""
    cleaned = _strip_optional_json_fence(text)
    try:
        payload = json.loads(cleaned)
    except ValueError:
        payload = None
    if isinstance(payload, dict) and "document" in payload:
        try:
            document = ProfileDocument.model_validate(payload["document"])
        except ValidationError as exc:
            snippet = text[:2000] + ("…" if len(text) > 2000 else "")
            raise ValueError(
                f"Model did not return valid extract document JSON: {exc}\n---\n{snippet}"
            ) from exc
        raw_name = payload.get("profileName")
        profile_name = raw_name.strip() if isinstance(raw_name, str) else ""
        return ExtractResponse(
            document=document,
            profile_name=profile_name[:100] or _fallback_profile_name(document),
        )
    # Legacy shape: the model returned a bare ProfileDocument.
    document = _parse_document_json(text, kind="extract")
    return ExtractResponse(document=document, profile_name=_fallback_profile_name(document))


async def _extract_profile_foundry_raw(cv_text: str, provider: str = "foundry"):
    guard_cv_text(cv_text)
    model = _get_anthropic_model(provider)
    if not model:
        raise ValueError("Set LLM_MODEL or ANTHROPIC_FOUNDRY_DEPLOYMENT to your Foundry deployment name.")
    client = _build_anthropic_messages_client(provider)
    user_content = _EXTRACT_HUMAN_PROMPT.format(cv_text=cv_text)
    message = await observability.anthropic_create(
        client,
        name="extract",
        model=model,
        max_tokens=app_settings.anthropic_max_tokens(),
        system=cached_system(_EXTRACT_SYSTEM_PROMPT),
        messages=[{"role": "user", "content": user_content}],
    )
    result = _parse_extract_response(_anthropic_text_content(message))
    return result, message.usage


async def _extract_profile_foundry(cv_text: str, provider: str = "foundry") -> tuple[ExtractResponse, TokenUsage]:
    result, raw_usage = await _extract_profile_foundry_raw(cv_text, provider)
    model = _get_anthropic_model(provider) or ""
    return result, TokenUsage.from_anthropic(raw_usage, model)


async def extract_profile(cv_text: str) -> tuple[ExtractResponse, TokenUsage]:
    provider = app_settings.llm_provider()

    if provider in ("anthropic", "foundry", "anthropic_foundry", "azure_foundry"):
        return await _extract_profile_foundry(cv_text, provider)

    from langchain_core.messages import HumanMessage, SystemMessage

    llm = _build_llm()
    messages = [
        SystemMessage(content=_EXTRACT_SYSTEM_PROMPT),
        HumanMessage(content=_EXTRACT_HUMAN_PROMPT.format(cv_text=cv_text)),
    ]
    response = await observability.lc_invoke(llm, messages, name="extract")
    result = _parse_extract_response(str(response.content))
    usage = TokenUsage.from_langchain_response(response, _llm_model_name())
    return result, usage
