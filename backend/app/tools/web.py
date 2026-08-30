"""
Web tools — search and page fetching. Both are 100% free, no API key.

LEARNING NOTE — what a "tool" is:
    A LangChain tool is just a Python function wrapped with @tool. The decorator
    reads the function's name, type hints, and docstring to build a JSON schema.
    That schema is handed to the LLM so it knows the tool exists, what arguments
    it takes, and when to call it. The docstring is therefore PROMPT TEXT — write
    it for the model, describing clearly when and how to use the tool.
"""
from __future__ import annotations

import httpx
from bs4 import BeautifulSoup
from langchain_core.tools import tool


def _ddg_once(query: str, region: str, max_results: int, backend: str) -> list[dict]:
    """One search against one backend. Raises on failure - the caller decides."""
    from ddgs import DDGS

    with DDGS() as ddgs:
        results = list(
            ddgs.text(
                query,
                region=region,
                safesearch="off",
                max_results=max_results,
                backend=backend,
            )
        )
    return [
        {
            "title": r.get("title", ""),
            "url": r.get("href", "") or r.get("url", ""),
            "snippet": r.get("body", ""),
        }
        for r in results
    ]


def web_search_results(
    query: str, max_results: int = 6, region: str = "in-en", deadline: float = 6.0
) -> list[dict]:
    """Structured web results (title/url/snippet) for the extension's inline
    "search appears below the bar" feature.

    The backends are HEDGED, not tried in turn. Sequentially, one slow or
    failing provider added its whole timeout to every search before the next
    was even attempted - which is where a 12-second "instant" answer came
    from, with the model itself accounting for well under a second of it.
    Firing three at once and taking whoever answers first makes the search as
    fast as the fastest provider on the day, and a stuck one costs nothing but
    a thread. `deadline` caps the whole thing so the endpoint can never hang.

    They are free endpoints and the extra requests are cheap; latency here is
    what the user actually feels.
    """
    import concurrent.futures as futures

    backends = ["auto", "google", "bing"]
    fallback = ["brave", "duckduckgo"]

    def _race(names: list[str], budget: float) -> list[dict]:
        pool = futures.ThreadPoolExecutor(max_workers=len(names))
        try:
            pending = {pool.submit(_ddg_once, query, region, max_results, b): b for b in names}
            try:
                for fut in futures.as_completed(pending, timeout=budget):
                    try:
                        out = fut.result()
                    except Exception:
                        continue
                    if out:
                        return out
            except futures.TimeoutError:
                pass
            return []
        finally:
            # Don't wait on the losers: whoever is still blocked on a slow
            # provider can finish into the void.
            pool.shutdown(wait=False, cancel_futures=True)

    hit = _race(backends, deadline)
    if hit:
        return hit
    return _race(fallback, max(2.0, deadline / 2))


@tool
def web_search(query: str, max_results: int = 5, region: str = "in-en") -> str:
    """Search the public web and return the top results.

    Use this whenever you need current information, facts you are unsure about,
    news, prices, schedules, or to find URLs. Returns a numbered list of title,
    URL, and snippet. `region` can be e.g. 'in-en' (India), 'us-en', 'wt-wt'.
    """
    from ddgs import DDGS

    # The free DuckDuckGo endpoint rate-limits aggressively and sometimes returns
    # nothing. ddgs can route through several search backends, so we try a few in
    # turn and take the first that yields results. This fixes the "No results"
    # loop that previously made the agent retry until it ran out of steps.
    backends = ["auto", "google", "bing", "brave", "duckduckgo"]
    last_err: Exception | None = None
    for backend in backends:
        try:
            with DDGS() as ddgs:
                results = list(
                    ddgs.text(
                        query,
                        region=region,
                        safesearch="off",
                        max_results=max_results,
                        backend=backend,
                    )
                )
        except Exception as exc:  # invalid backend / network / rate-limit
            last_err = exc
            continue
        if results:
            lines = []
            for i, r in enumerate(results, 1):
                title = r.get("title", "")
                url = r.get("href", "") or r.get("url", "")
                body = r.get("body", "")
                lines.append(f"{i}. {title}\n   {url}\n   {body}")
            return "\n".join(lines)

    if last_err:
        return f"Search is rate-limited right now ({last_err}). Try again shortly."
    return (
        "No results found. Tell the user you couldn't find live data and answer "
        "from your own knowledge instead, noting it may be out of date."
    )


@tool
def fetch_url(url: str) -> str:
    """Fetch a web page and return its readable text content (truncated).

    Use this after web_search to read the full contents of a specific page,
    or whenever the user gives you a URL to read/summarise.
    """
    try:
        resp = httpx.get(
            url,
            timeout=20,
            follow_redirects=True,
            headers={"User-Agent": "Mozilla/5.0 (AgentFury)"},
        )
        resp.raise_for_status()
    except Exception as exc:
        return f"Failed to fetch {url}: {exc}"

    soup = BeautifulSoup(resp.text, "html.parser")
    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()
    text = " ".join(soup.get_text(separator=" ").split())
    return text[:6000]  # keep within the model's context budget
