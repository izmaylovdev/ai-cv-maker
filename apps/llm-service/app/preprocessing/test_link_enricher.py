import pytest
import httpx
from unittest.mock import AsyncMock, patch, MagicMock

from app.preprocessing.link_enricher import enrich, LinkFetchError


# ---------------------------------------------------------------------------
# No URL — message passes through unchanged
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_plain_text_returns_unchanged():
    result = await enrich("Senior React developer at a fintech startup")
    assert result.text == "Senior React developer at a fintech startup"
    assert result.link_preview is None


@pytest.mark.asyncio
async def test_empty_string_returns_unchanged():
    result = await enrich("")
    assert result.text == ""
    assert result.link_preview is None


# ---------------------------------------------------------------------------
# URL detected — successful fetch
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_url_in_message_fetches_and_extracts_text():
    html = """
    <html>
      <head><title>Senior Backend Engineer — Acme Corp</title></head>
      <body>
        <h1>Job Title: Senior Backend Engineer</h1>
        <p>Responsibilities: Build scalable APIs. Required: Python, Go.</p>
      </body>
    </html>
    """
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.text = html

    with patch("app.preprocessing.link_enricher.httpx.AsyncClient") as mock_client_cls:
        mock_client = AsyncMock()
        mock_client.get = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client_cls.return_value = mock_client

        result = await enrich("https://jobs.example.com/senior-backend-engineer")

    assert "Senior Backend Engineer" in result.text
    assert "Python" in result.text
    assert result.link_preview is not None
    assert result.link_preview.url == "https://jobs.example.com/senior-backend-engineer"


@pytest.mark.asyncio
async def test_url_embedded_in_text_is_detected():
    html = "<html><head><title>Job</title></head><body><p>Backend role. Python required.</p></body></html>"
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.text = html

    with patch("app.preprocessing.link_enricher.httpx.AsyncClient") as mock_client_cls:
        mock_client = AsyncMock()
        mock_client.get = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client_cls.return_value = mock_client

        result = await enrich("optimize for this job: https://jobs.example.com/job-123")

    assert "Backend role" in result.text
    assert result.link_preview is not None


@pytest.mark.asyncio
async def test_link_preview_title_extracted_from_og_title():
    html = """
    <html>
      <head>
        <meta property="og:title" content="Staff Engineer at Acme">
        <meta property="og:description" content="We are looking for a Staff Engineer.">
        <title>Fallback title</title>
      </head>
      <body><p>Full job description here.</p></body>
    </html>
    """
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.text = html

    with patch("app.preprocessing.link_enricher.httpx.AsyncClient") as mock_client_cls:
        mock_client = AsyncMock()
        mock_client.get = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client_cls.return_value = mock_client

        result = await enrich("https://jobs.example.com/staff-engineer")

    assert result.link_preview is not None
    assert result.link_preview.title == "Staff Engineer at Acme"
    assert "looking for a Staff Engineer" in result.link_preview.description


@pytest.mark.asyncio
async def test_body_text_truncated_to_8000_chars():
    long_body = "word " * 10000
    html = f"<html><head><title>Big Job</title></head><body><p>{long_body}</p></body></html>"
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.text = html

    with patch("app.preprocessing.link_enricher.httpx.AsyncClient") as mock_client_cls:
        mock_client = AsyncMock()
        mock_client.get = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client_cls.return_value = mock_client

        result = await enrich("https://jobs.example.com/big-job")

    assert len(result.text) <= 8000


# ---------------------------------------------------------------------------
# Error cases — LinkFetchError raised
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_network_error_raises_link_fetch_error():
    with patch("app.preprocessing.link_enricher.httpx.AsyncClient") as mock_client_cls:
        mock_client = AsyncMock()
        mock_client.get = AsyncMock(side_effect=httpx.ConnectError("DNS failed"))
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client_cls.return_value = mock_client

        with pytest.raises(LinkFetchError, match="Could not reach"):
            await enrich("https://unreachable.example.com/job")


@pytest.mark.asyncio
async def test_non_2xx_response_raises_link_fetch_error():
    mock_response = MagicMock()
    mock_response.status_code = 404

    with patch("app.preprocessing.link_enricher.httpx.AsyncClient") as mock_client_cls:
        mock_client = AsyncMock()
        mock_client.get = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client_cls.return_value = mock_client

        with pytest.raises(LinkFetchError, match="404"):
            await enrich("https://jobs.example.com/not-found")


@pytest.mark.asyncio
async def test_timeout_raises_link_fetch_error():
    with patch("app.preprocessing.link_enricher.httpx.AsyncClient") as mock_client_cls:
        mock_client = AsyncMock()
        mock_client.get = AsyncMock(side_effect=httpx.TimeoutException("timed out"))
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client_cls.return_value = mock_client

        with pytest.raises(LinkFetchError, match="Timed out"):
            await enrich("https://slow.example.com/job")


@pytest.mark.asyncio
async def test_empty_body_after_stripping_raises_link_fetch_error():
    html = "<html><head><title>Empty</title></head><body>   </body></html>"
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.text = html

    with patch("app.preprocessing.link_enricher.httpx.AsyncClient") as mock_client_cls:
        mock_client = AsyncMock()
        mock_client.get = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client_cls.return_value = mock_client

        with pytest.raises(LinkFetchError, match="No readable content"):
            await enrich("https://jobs.example.com/blank-page")
