from __future__ import annotations

import re
from dataclasses import dataclass

import httpx
from bs4 import BeautifulSoup

_URL_RE = re.compile(r'https?://\S+')
_MAX_BYTES = 500_000
_MAX_CHARS = 8_000
_TIMEOUT = 10.0


class LinkFetchError(Exception):
    pass


@dataclass
class LinkPreview:
    url: str
    title: str
    description: str


@dataclass
class EnrichedMessage:
    text: str
    link_preview: LinkPreview | None


async def enrich(message: str) -> EnrichedMessage:
    match = _URL_RE.search(message)
    if not match:
        return EnrichedMessage(text=message, link_preview=None)

    url = match.group(0).rstrip('.,;:!?)')

    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=_TIMEOUT) as client:
            response = await client.get(
                url,
                headers={"User-Agent": "Mozilla/5.0 (compatible; CV-Optimizer/1.0)"},
            )
    except httpx.TimeoutException:
        raise LinkFetchError(f"Timed out fetching URL: {url}")
    except httpx.HTTPError as exc:
        raise LinkFetchError(f"Could not reach the URL: {exc}")

    if response.status_code >= 300:
        raise LinkFetchError(f"URL returned {response.status_code}: {url}")

    soup = BeautifulSoup(response.text[:_MAX_BYTES], "html.parser")

    og_title = soup.find("meta", property="og:title")
    title = (
        (og_title.get("content") if og_title else None)
        or (soup.title.string if soup.title else "")
        or ""
    ).strip()

    og_desc = soup.find("meta", property="og:description")
    description = ((og_desc.get("content") if og_desc else None) or "").strip()

    for tag in soup(["script", "style", "nav", "header", "footer"]):
        tag.decompose()
    body = soup.find("body")
    body_text = " ".join((body or soup).get_text(separator=" ", strip=True).split())

    if not body_text:
        raise LinkFetchError(f"No readable content found at URL: {url}")

    body_text = body_text[:_MAX_CHARS]

    if not description:
        description = body_text[:200]

    return EnrichedMessage(
        text=body_text,
        link_preview=LinkPreview(url=url, title=title, description=description),
    )
