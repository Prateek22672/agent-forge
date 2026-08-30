"""
Write-assist API — powers the browser extension's in-compose email tools
(auto-correct / rewrite / write-from-instruction) on Gmail, Outlook, etc.

Kept separate from the agent runtime: this is a single fast LLM call with no
tools, no memory lookup — it just transforms text, so it's instant from any
page the extension is injected into.
"""
from __future__ import annotations

import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth import get_current_user
from app.models import User
from app.security.ratelimit import rate_limit

router = APIRouter(prefix="/api/write", tags=["write"])


@router.get("/search")
def web_search_inline(
    q: str,
    user: User = Depends(get_current_user),
    _: None = Depends(rate_limit(30, 60)),
):
    """Real web results for the extension's inline 'search appears below the
    bar' feature — the user selects text, taps Web, and sees links + snippets
    right in the popup instead of being redirected to a new tab. Uses the same
    free multi-backend search as the agent's web_search tool."""
    from app.tools.web import web_search_results

    query = (q or "").strip()[:400]
    if not query:
        return {"results": []}
    try:
        return {"results": web_search_results(query, max_results=6)}
    except Exception:
        return {"results": []}


class StudyKitRequest(BaseModel):
    text: str = ""


@router.post("/studykit")
def study_kit(
    payload: StudyKitRequest,
    user: User = Depends(get_current_user),
    _: None = Depends(rate_limit(15, 60)),
):
    """The flagship study feature: turn any text (notes, an article, a
    selection) into a structured study kit — a short summary, flashcards, and a
    multiple-choice quiz — returned as JSON the extension renders as interactive
    flip-cards and a quiz. One model call; validated + repaired JSON so the UI
    always gets usable data."""
    import json
    import re

    from app.llm.router import get_fast_groq

    text = (payload.text or "").strip()
    if len(text) < 20:
        raise HTTPException(400, "Give me a bit more text to work with.")
    text = text[:8000]

    prompt = (
        "From the STUDY TEXT below, produce a study kit as STRICT JSON only "
        "(no prose, no markdown fences). Shape:\n"
        '{"summary": "3-4 sentence summary", '
        '"flashcards": [{"front": "question/term", "back": "answer/definition"}], '
        '"quiz": [{"question": "...", "options": ["a","b","c","d"], "answer": 0}]}\n'
        "Rules: 6-10 flashcards, 4-6 quiz questions, each quiz has exactly 4 "
        "options, `answer` is the 0-based index of the correct option. Base "
        "everything ONLY on the text. Output JSON and nothing else.\n\n"
        f"STUDY TEXT:\n{text}"
    )

    def _extract_json(s: str):
        s = s.strip()
        s = re.sub(r"^```(?:json)?|```$", "", s.strip(), flags=re.MULTILINE).strip()
        start, end = s.find("{"), s.rfind("}")
        if start != -1 and end != -1:
            s = s[start : end + 1]
        return json.loads(s)

    last_exc = None
    for _attempt in range(3):
        try:
            llm = get_fast_groq(0.3)
            if llm is None:
                raise HTTPException(503, "No model available right now.")
            out = llm.invoke(prompt)
            raw = out.content if isinstance(out.content, str) else str(out.content)
            data = _extract_json(raw)
            # Normalize/validate so the UI never breaks on a malformed field.
            cards = [
                {"front": str(c.get("front", "")).strip(), "back": str(c.get("back", "")).strip()}
                for c in (data.get("flashcards") or [])
                if c.get("front") and c.get("back")
            ][:10]
            quiz = []
            for q in (data.get("quiz") or [])[:6]:
                opts = [str(o).strip() for o in (q.get("options") or []) if str(o).strip()][:4]
                if q.get("question") and len(opts) == 4:
                    ans = q.get("answer", 0)
                    ans = ans if isinstance(ans, int) and 0 <= ans < 4 else 0
                    quiz.append({"question": str(q["question"]).strip(), "options": opts, "answer": ans})
            if not cards and not quiz:
                raise ValueError("empty kit")
            return {
                "summary": str(data.get("summary", "")).strip(),
                "flashcards": cards,
                "quiz": quiz,
            }
        except HTTPException:
            raise
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            continue
    raise HTTPException(503, f"Couldn't build a study kit — try again. ({last_exc})")


class QuickAnswer(BaseModel):
    text: str = ""      # the selected text
    question: str = ""  # optional user question about it


@router.post("/answer")
def quick_answer(
    payload: QuickAnswer,
    user: User = Depends(get_current_user),
    _: None = Depends(rate_limit(40, 60)),
):
    """Fast selection-bar answer: ONE direct model call — no agent graph, no
    tools, no memory lookup — so it returns as fast as Groq can go. Handles
    questions/MCQs, term explanations, and code. Separate from the full agent
    chat (which is richer but slower); this path exists purely for speed."""
    from app.llm.router import get_fast_groq

    text = (payload.text or "").strip()[:6000]
    question = (payload.question or "").strip()[:1000]
    if not text and not question:
        raise HTTPException(400, "Nothing to answer.")

    if question:
        prompt = (
            f"Selected text:\n{text}\n\nUser's question: {question}\n\n"
            "Answer directly and concisely. If code is the best answer, return it "
            "in a fenced ```code block``` with the right language. No preamble."
        )
    else:
        prompt = (
            f"Selected text:\n{text}\n\n"
            "Respond based on what it is:\n"
            "- A question (incl. multiple choice): give the correct answer first "
            "(name the option, e.g. 'C'), then a one-line reason.\n"
            "- A term/concept: explain clearly in 1–3 sentences.\n"
            "- A statement: say whether it's correct and why, briefly.\n"
            "- If code is asked for or is the best answer, return it in a fenced "
            "```code block``` with the right language.\n"
            "Be accurate and concise. No preamble."
        )

    llm = None
    last_exc: Exception | None = None
    for _attempt in range(3):
        try:
            llm = llm or get_fast_groq(0.4)
            if llm is None:
                break
            out = llm.invoke(prompt)
            answer = out.content if isinstance(out.content, str) else str(out.content)
            return {"answer": answer.strip()}
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            llm = None
            continue
    raise HTTPException(503, f"AI is busy — try again in a moment. ({last_exc})")


@router.get("/search-answer")
def web_search_answer(
    q: str,
    user: User = Depends(get_current_user),
    _: None = Depends(rate_limit(20, 60)),
):
    """Search + verdict ("Google AI mode", but cheap): run the free web search,
    hand the snippets to a fast model, and return a synthesized ANSWER plus the
    sources it drew from — instead of dumping raw links the user has to sift.
    Cost stays low: ddgs is free and get_fast_groq is the cheapest model."""
    from app.llm.router import get_fast_groq
    from app.tools.web import web_search_results

    query = (q or "").strip()[:400]
    if not query:
        return {"answer": "", "results": []}

    try:
        results = web_search_results(query, max_results=6)
    except Exception:
        results = []

    context = "\n\n".join(
        f"[{i}] {r.get('title','')}\n{r.get('snippet','')}\n{r.get('url','')}"
        for i, r in enumerate(results, 1)
    )
    prompt = (
        f"Question or topic: {query}\n\n"
        f"Web results:\n{context or '(no results returned)'}\n\n"
        "Give a direct, correct answer in 1–4 sentences. If it's a question "
        "(including multiple choice), state the answer first (name the correct "
        "option). Prefer the web results; cite them inline like [1] when you use "
        "one. If the results don't actually address it, answer from your own "
        "knowledge and say the web didn't have a direct source. No preamble."
    )

    llm = None
    last_exc: Exception | None = None
    for _attempt in range(3):
        try:
            llm = llm or get_fast_groq(0.3)
            if llm is None:
                break
            out = llm.invoke(prompt)
            answer = out.content if isinstance(out.content, str) else str(out.content)
            return {"answer": answer.strip(), "results": results}
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            llm = None
            continue
    # Model unavailable — still return the raw results so the user gets something.
    return {"answer": "", "results": results, "error": str(last_exc) if last_exc else ""}


class PolishRequest(BaseModel):
    text: str = ""
    instruction: str = ""  # e.g. "write a polite follow-up asking for status"
    mode: str = "improve"  # improve | shorten | formal | friendly | write
    # Best-effort context read from the compose window (subject line, "To"
    # recipient chips) — lets "write" address the recipient by name instead of
    # generic filler like "Dear Project Manager", and keeps rewrites aware of
    # what the email is actually about.
    subject: str = ""
    recipients: list[str] = []


@router.post("/polish")
def polish(payload: PolishRequest, user: User = Depends(get_current_user)):
    from app.llm.router import get_fast_groq

    llm = get_fast_groq(0.4)
    if llm is None:
        raise HTTPException(503, "No model available right now.")

    context_lines = []
    if payload.subject.strip():
        context_lines.append(f"Subject: {payload.subject.strip()}")
    if payload.recipients:
        context_lines.append("To: " + ", ".join(payload.recipients[:5]))
    context = ("\n".join(context_lines) + "\n\n") if context_lines else ""

    mode_guides = {
        "improve": "Fix grammar/spelling and tighten the wording. Keep the meaning, "
        "tone, and length close to the original.",
        "shorten": "Make it noticeably shorter and punchier while keeping the key points.",
        "formal": "Rewrite in a polished, professional/formal tone.",
        "friendly": "Rewrite in a warm, friendly, conversational tone.",
        "write": "Write a complete, ready-to-send email body from the instruction below.",
    }
    guide = mode_guides.get(payload.mode, mode_guides["improve"])

    if payload.mode == "write":
        prompt = (
            f"{context}Write a complete, ready-to-send email body (no subject line) "
            f"from this instruction:\n\n{payload.instruction or payload.text}\n\n"
            "If a recipient name is given above, address them by first name in the "
            "greeting; otherwise use a neutral greeting (no placeholder brackets like "
            "[Name]). Be concrete and specific to the instruction — avoid generic "
            "filler sentences that could apply to any email. Output ONLY the email "
            "body text."
        )
    else:
        if not payload.text.strip():
            raise HTTPException(400, "No text to work with.")
        extra = f" Additional instruction: {payload.instruction}" if payload.instruction else ""
        prompt = (
            f"{context}{guide}{extra}\n\nDo not add a greeting/signature that wasn't "
            f"already there. Output ONLY the rewritten text, nothing else.\n\nTEXT:\n{payload.text}"
        )

    # Resilience: a single Groq key can transiently rate-limit or hiccup. Retry
    # across a few rotated keys/models instead of letting one failure surface
    # as a raw, unhandled "Internal Server Error" to the extension.
    last_exc: Exception | None = None
    for _ in range(3):
        try:
            candidate = llm or get_fast_groq(0.4)
            if candidate is None:
                break
            out = candidate.invoke(prompt)
            text = out.content if isinstance(out.content, str) else str(out.content)
            return {"text": text.strip()}
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            llm = None  # force a fresh (likely different-key) client next loop
            continue
    raise HTTPException(503, f"AI is temporarily busy — try again in a moment. ({last_exc})")


# ---------------------------------------------------------------------------
# Image understanding (OCR + "explain this image") — powers the AI badge the
# extension puts on every image on the page.
#
# Why it lives here and not in files_api: files_api is the pure-python
# document extractor (pypdf/docx/xlsx) and deliberately has no OCR — it tells
# the user so when a scanned PDF comes in. This endpoint is that missing
# piece, done with a multimodal MODEL instead of a native OCR engine: no
# tesseract binary to install on the host, no paid OCR API, and it reads
# handwriting, screenshots, charts and diagrams that classic OCR mangles.
#
# The image reaches us one of two ways, and both matter:
#   * image_b64 — the extension read the pixels itself (canvas/fetch). This is
#     the only path that works for images behind a login, blob:/data: URLs, or
#     a <canvas> element, since the server can't see any of those.
#   * image_url — the extension couldn't read them (a cross-origin image with
#     no CORS header taints a canvas), so we fetch the URL server-side.
# ---------------------------------------------------------------------------

MAX_IMAGE_BYTES = 4 * 1024 * 1024  # Groq's inline-image ceiling; Gemini allows more


class ImageRequest(BaseModel):
    image_b64: str = ""   # raw base64 or a full data: URI
    image_url: str = ""   # fallback: we fetch it server-side
    mode: str = "ocr"     # ocr | explain | translate | solve | ask
    question: str = ""    # only for mode="ask"


def _safe_image_url(url: str) -> str:
    """Reject anything that isn't a plain public http(s) image URL.

    This endpoint fetches a URL supplied by the page the user happens to be
    on, so without this check any site could point us at 169.254.169.254
    (cloud metadata), 127.0.0.1, or an internal 10.x service and read the
    response back through the model's description. Resolve the hostname first
    and refuse every private/loopback/link-local address it maps to.
    """
    import ipaddress
    import socket
    from urllib.parse import urlparse

    parsed = urlparse((url or "").strip())
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise HTTPException(400, "Only http(s) image URLs can be fetched.")
    try:
        infos = socket.getaddrinfo(parsed.hostname, None)
    except Exception:
        raise HTTPException(400, "Couldn't resolve that image host.")
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
            raise HTTPException(400, "That image URL points at a private address.")
    return parsed.geturl()


def _fetch_image(url: str) -> tuple[str, str]:
    """Download an image URL -> (base64, mime). Size- and type-checked."""
    import base64

    import httpx

    safe = _safe_image_url(url)
    try:
        resp = httpx.get(
            safe,
            timeout=20,
            follow_redirects=True,
            headers={"User-Agent": "Mozilla/5.0 (compatible; AgentFury/1.0)"},
        )
        resp.raise_for_status()
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(400, "Couldn't download that image.")

    mime = (resp.headers.get("content-type") or "").split(";")[0].strip().lower()
    if not mime.startswith("image/"):
        raise HTTPException(400, "That URL isn't an image.")
    if len(resp.content) > MAX_IMAGE_BYTES:
        raise HTTPException(413, "That image is too large (over 4 MB).")
    return base64.b64encode(resp.content).decode("ascii"), mime


def _split_data_uri(raw: str) -> tuple[str, str]:
    """Accept either a bare base64 blob or a full `data:image/png;base64,...`
    URI (what a canvas readback in the extension produces) -> (b64, mime)."""
    raw = (raw or "").strip()
    if raw.startswith("data:"):
        head, _, payload = raw.partition(",")
        mime = head[5:].split(";")[0] or "image/png"
        return payload.strip(), mime
    return raw, "image/png"


_IMAGE_PROMPTS = {
    "ocr": (
        "Extract ALL text visible in this image, exactly as written - same "
        "wording, same order, same line breaks. Keep tables readable as rows. "
        "Do not translate, summarize, correct, or comment on it. Output only "
        "the extracted text. If there is no text in the image, reply exactly: "
        "No text found in this image."
    ),
    "explain": (
        "Explain this image clearly and specifically in 2-5 sentences: what it "
        "shows and what it means. If it is a chart or diagram, state what it "
        "measures and the main takeaway. If it is a screenshot of text, "
        "summarize what the text says. No preamble."
    ),
    "translate": (
        "Read all the text in this image and translate it into English. Give "
        "only the translation, keeping the original line structure. If it is "
        "already English, return it as-is."
    ),
    "solve": (
        "This image contains a question, problem, or exercise. Read it, then "
        "give the correct answer first (for multiple choice, name the option, "
        "e.g. 'C', and its text), followed by a short explanation of how you "
        "got it. Show the working for maths. Be accurate and concise."
    ),
}


@router.post("/image")
def image_understand(
    payload: ImageRequest,
    user: User = Depends(get_current_user),
    _: None = Depends(rate_limit(20, 60)),
):
    """Read an image with a vision model: OCR it, explain it, translate it, or
    answer a question about it. One call, no agent graph - same speed contract
    as /write/answer."""
    from app.llm.router import get_vision_llms

    mode = (payload.mode or "ocr").strip().lower()
    if mode not in _IMAGE_PROMPTS and mode != "ask":
        mode = "ocr"

    if payload.image_b64:
        b64, mime = _split_data_uri(payload.image_b64)
        # base64 inflates bytes by ~4/3 - check the decoded size, not the string.
        if len(b64) * 3 // 4 > MAX_IMAGE_BYTES:
            raise HTTPException(413, "That image is too large (over 4 MB).")
    elif payload.image_url:
        b64, mime = _fetch_image(payload.image_url)
    else:
        raise HTTPException(400, "No image given.")
    if not b64:
        raise HTTPException(400, "That image came through empty.")

    if mode == "ask":
        question = (payload.question or "").strip()[:1000]
        if not question:
            raise HTTPException(400, "Ask a question about the image.")
        prompt = (
            f"Look at this image and answer the user's question about it: {question}\n"
            "Answer directly and concisely, based on what is actually visible. "
            "If the image does not show enough to answer, say so. No preamble."
        )
    else:
        prompt = _IMAGE_PROMPTS[mode]

    data_uri = f"data:{mime};base64,{b64}"

    candidates = get_vision_llms(0.2)
    if not candidates:
        raise HTTPException(
            503,
            "No vision model is configured - add a Gemini key (or a Groq key "
            "with a vision model) in the admin panel.",
        )

    last_exc: Exception | None = None
    for llm, provider in candidates:
        # The image block is provider-shaped: Gemini takes the data URI as a
        # plain string, Groq follows the OpenAI {"url": ...} shape.
        image_block = (
            {"type": "image_url", "image_url": data_uri}
            if provider == "gemini"
            else {"type": "image_url", "image_url": {"url": data_uri}}
        )
        try:
            from langchain_core.messages import HumanMessage

            out = llm.invoke(
                [HumanMessage(content=[{"type": "text", "text": prompt}, image_block])]
            )
            text = out.content if isinstance(out.content, str) else str(out.content)
            # Some multimodal models narrate their reasoning in <think> tags
            # before answering; the user wants the answer, not the monologue.
            text = re.sub(r"<think>.*?</think>", "", text, flags=re.S).strip()
            if not text:
                raise ValueError("empty response")
            return {"text": text, "mode": mode, "provider": provider}
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            continue
    raise HTTPException(503, f"Couldn't read that image - try again. ({last_exc})")
