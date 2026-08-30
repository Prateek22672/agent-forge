"""Shared pre-processing, retrieval packing and post-processing for the fast
answer endpoints (selection bar, image card, in-field proofreading).

WHY THIS EXISTS
    Every one of those endpoints was doing the same thing badly: shovel raw
    page text straight into a model, then hand the raw completion straight
    back to the UI. That costs more than it needs to (the text is full of nav
    junk, cookie banners and duplicated lines, and the same selection gets
    asked twice a minute) and it reads worse than it needs to (LaTeX markers,
    "Sure! Here's..." preambles, citations pointing at sources that were never
    returned).

    Three cheap stages fix both, and none of them needs a second model call:

    PRE   clean_input() strips the junk and keeps the parts that carry meaning
          (a multiple-choice question's OPTIONS live at the end, so a naive
          head-truncate is the one thing you must not do). detect_kind()
          classifies what was selected with regexes, so the prompt can be
          specific instead of a catch-all - the single biggest quality win
          per token spent.

    RAG   pack_context() turns raw search results into a ranked, de-duplicated,
          numbered context block within a character budget. Lexical scoring
          only: no embedding call, no vector store, no extra cost or latency.

    POST  clean_output() removes the tics that make a good answer look sloppy,
          and fix_citations() deletes references to sources that don't exist.

    On top of that, answer_cache makes an identical repeat question free, and
    pick_model() spends the bigger model only where it earns its cost.
"""
from __future__ import annotations

import hashlib
import re
import threading
import time
import unicodedata

# ---------------------------------------------------------------------------
# PRE-PROCESSING
# ---------------------------------------------------------------------------

# Lines that are page furniture, not content. Matched on the WHOLE line (after
# stripping) so a sentence that merely mentions "share this" is never dropped.
_JUNK_LINE = re.compile(
    r"^(?:"
    r"accept(?: all)?(?: cookies)?|cookie(?: policy| settings| preferences)?|"
    r"advertisement|sponsored|skip to (?:main )?content|"
    r"sign ?in|log ?in|sign ?up|subscribe(?: now)?|share(?: this)?|"
    r"related (?:articles|posts|stories)|read more|show more|load more|"
    r"privacy policy|terms(?: of service| & conditions)?|all rights reserved|"
    r"back to top|menu|home|next|previous|©.*"
    r")$",
    re.I,
)

_MCQ_OPTION = re.compile(r"(?m)^\s*\(?([A-Ea-e1-5])[\).:\]]\s+\S")
_WH_START = re.compile(
    r"^(who|what|when|where|why|how|which|whose|whom|is|are|was|were|do|does|did|can|could|"
    r"should|would|will|explain|define|describe|calculate|find|solve|prove|name)\b",
    re.I,
)
_CODE_HINT = re.compile(
    r"(?m)(^\s*(?:def|class|function|import|from|const|let|var|public|private|SELECT|#include)\b"
    r"|[{};]\s*$|=>|::|</\w+>)"
)


def clean_input(text: str, limit: int = 6000) -> str:
    """Normalize and de-junk text before it costs tokens.

    Keeps the head AND the tail when trimming: the answer options of a
    multiple-choice question, the total of an invoice and the conclusion of an
    article all live at the END, and a plain [:limit] silently throws away the
    part the user actually asked about.
    """
    if not text:
        return ""
    # NFKC folds the fullwidth/ligature/odd-space characters PDFs and slide
    # decks are full of into their plain equivalents, so the model sees one
    # form instead of five.
    text = unicodedata.normalize("NFKC", str(text))
    text = text.replace("\r\n", "\n").replace("\r", "\n").replace("\u00a0", " ")
    text = re.sub(r"[ \t]+", " ", text)

    kept: list[str] = []
    previous = None
    for raw in text.split("\n"):
        line = raw.strip()
        if _JUNK_LINE.match(line):
            continue
        # Copying a page often duplicates every line (a sticky header, a
        # screen-reader label); collapse consecutive repeats.
        if line and line == previous:
            continue
        previous = line
        kept.append(line)

    out = re.sub(r"\n{3,}", "\n\n", "\n".join(kept)).strip()
    if len(out) <= limit:
        return out
    head = int(limit * 0.7)
    tail = limit - head - 20
    return out[:head].rstrip() + "\n…\n" + out[-tail:].lstrip()


def detect_kind(text: str) -> str:
    """What did the user actually select? Drives which prompt is used.

    Regex only - a model call to decide how to call a model would double the
    cost of the cheapest thing we do.
    """
    t = (text or "").strip()
    if not t:
        return "empty"
    if len(_MCQ_OPTION.findall(t)) >= 3 or re.search(r"which of the following", t, re.I):
        return "mcq"
    if "```" in t or len(_CODE_HINT.findall(t)) >= 2:
        return "code"
    if t.endswith("?") or _WH_START.match(t):
        return "question"
    if len(t.split()) <= 6:
        return "term"
    return "passage"


_KIND_GUIDE = {
    "mcq": (
        "This is a multiple-choice question. Reply in exactly this shape:\n"
        "Answer: <letter>) <the option's text>\n"
        "Why: <one or two sentences>\n"
        "Do not restate the other options."
    ),
    "question": (
        "This is a question. Give the direct answer in the first line, then at "
        "most two sentences of reasoning. No preamble."
    ),
    "code": (
        "This is code. Say what it does in one or two sentences, then point out "
        "any bug or fix that matters. Return code only in a fenced block with "
        "the right language tag."
    ),
    "term": (
        "This is a term or short phrase. Define it in 1-3 plain sentences, then "
        "give one concrete example. No preamble."
    ),
    "passage": (
        "This is a passage. Say what it means in at most 4 sentences, or answer "
        "the implicit question it raises. If it makes a claim, say whether it "
        "is correct. No preamble."
    ),
    "empty": "Answer the user's question directly and concisely.",
}


def build_answer_prompt(text: str, question: str, kind: str) -> str:
    """One prompt, shaped by what was selected."""
    guide = _KIND_GUIDE.get(kind, _KIND_GUIDE["passage"])
    if question:
        return (
            f"SELECTED TEXT:\n{text}\n\n"
            f"USER'S QUESTION: {question}\n\n"
            "Answer the question using the selected text where it is relevant, "
            "and your own knowledge where it is not. Be accurate and concise, "
            "lead with the answer, and skip any preamble. If code is the best "
            "answer, put it in a fenced block with the right language tag."
        )
    return f"SELECTED TEXT:\n{text}\n\n{guide}"


# ---------------------------------------------------------------------------
# RETRIEVAL PACKING (the R in RAG)
# ---------------------------------------------------------------------------

_STOP = {
    "the", "a", "an", "of", "to", "in", "is", "are", "was", "were", "and", "or", "for",
    "on", "at", "by", "with", "that", "this", "it", "as", "be", "from", "what", "which",
    "how", "why", "who", "when", "where", "does", "do", "did", "can", "i", "you",
}


def _tokens(s: str) -> list[str]:
    return [w for w in re.findall(r"[a-z0-9']+", (s or "").lower()) if w not in _STOP and len(w) > 1]


def pack_context(results: list[dict], query: str, max_chars: int = 2600) -> tuple[str, list[dict]]:
    """Rank, de-duplicate and number search results into a context block.

    Lexical scoring (query-term overlap, weighted toward the title, with a
    bonus for an exact phrase hit) rather than embeddings: for six web
    snippets the ranking quality is indistinguishable, and it costs nothing
    and adds no latency. The budget matters more than the ranking anyway -
    stuffing six full snippets in makes the model average across them, which
    is exactly how "here are 6 links, go sift" answers get produced.

    Returns (context, used) where `used` is in the same order the context
    numbers them, so [1] in the answer really is used[0].
    """
    q_terms = set(_tokens(query))
    phrase = (query or "").strip().lower()

    scored: list[tuple[float, dict]] = []
    seen_urls: set[str] = set()
    seen_titles: set[str] = set()
    for r in results or []:
        url = (r.get("url") or "").strip()
        title = (r.get("title") or "").strip()
        snippet = (r.get("snippet") or "").strip()
        if not (title or snippet):
            continue
        key_url = re.sub(r"[?#].*$", "", url).rstrip("/").lower()
        key_title = re.sub(r"\W+", " ", title.lower()).strip()
        # The same story syndicated across five sites adds no information but
        # spends the whole budget.
        if key_url in seen_urls or (key_title and key_title in seen_titles):
            continue
        seen_urls.add(key_url)
        if key_title:
            seen_titles.add(key_title)

        t_terms = set(_tokens(title))
        s_terms = set(_tokens(snippet))
        score = 2.0 * len(q_terms & t_terms) + 1.0 * len(q_terms & s_terms)
        if phrase and len(phrase) > 12 and phrase in (title + " " + snippet).lower():
            score += 3.0
        if snippet:
            score += 0.5  # a result with no snippet is a link, not evidence
        scored.append((score, {"title": title, "snippet": snippet, "url": url}))

    scored.sort(key=lambda p: p[0], reverse=True)

    used: list[dict] = []
    chunks: list[str] = []
    spent = 0
    for _score, r in scored[:6]:
        budget = max(180, (max_chars - spent) // 2)
        snippet = r["snippet"][:budget]
        if len(r["snippet"]) > len(snippet):
            snippet = snippet.rsplit(" ", 1)[0] + "…"  # never cut mid-word
        block = f"[{len(used) + 1}] {r['title']}\n{snippet}\n{r['url']}"
        if spent + len(block) > max_chars and used:
            break
        chunks.append(block)
        used.append(r)
        spent += len(block)
    return "\n\n".join(chunks), used


# ---------------------------------------------------------------------------
# POST-PROCESSING
# ---------------------------------------------------------------------------

_THINK = re.compile(r"<think>.*?</think>", re.S | re.I)
_PREAMBLE = re.compile(
    r"^(?:sure[,!.]?|certainly[,!.]?|of course[,!.]?|great question[,!.]?|"
    r"here(?:'s| is) (?:the |a )?(?:answer|explanation|summary)[:.]?|"
    r"as an ai(?: language model)?[,.]?[^\n]*)\s*",
    re.I,
)
_LATEX_INLINE = re.compile(r"\$([^$\n]{1,80})\$")
_LATEX_CMD = re.compile(r"\\(?:text|mathrm|mathbf|mathit)\{([^}]*)\}")


def clean_output(text: str, max_chars: int = 4000) -> str:
    """Strip the tics that make a correct answer look careless.

    LaTeX is the one users notice most: a vision model describing a physics
    diagram writes "the focal points ($f$), the object distance ($o$)", and
    a plain-text bubble renders those dollar signs literally.
    """
    if not text:
        return ""
    out = _THINK.sub("", str(text)).strip()
    out = _PREAMBLE.sub("", out, count=1)
    out = _LATEX_CMD.sub(r"\1", out)
    out = out.replace("\\(", "").replace("\\)", "").replace("\\[", "").replace("\\]", "")
    out = _LATEX_INLINE.sub(r"\1", out)
    out = re.sub(r"[ \t]+\n", "\n", out)
    out = re.sub(r"\n{3,}", "\n\n", out)
    out = out.strip()
    if len(out) > max_chars:
        cut = out[:max_chars]
        out = cut[: cut.rfind("\n")].rstrip() if "\n" in cut[-400:] else cut.rstrip() + "…"
    return out


def looks_degenerate(text: str) -> bool:
    """Did the model start repeating itself instead of finishing?

    This is the failure users actually see on OCR: the correct text comes out
    first, then the model keeps going and emits chopped-up fragments of what
    it already said -

        "LIVE LIFE WITH NO EXCUSES,
         TRAVEL WITH NO REGRET".
         - OSCAR WILDE
         "LIVE L
         TRAV
         IFE WITH NO
         O EXCUSES,

    Two independent signals, because either alone has false positives: lines
    that are strict fragments of an earlier line, and one short phrase
    repeated far more often than any real text repeats it.
    """
    if not text:
        return False
    lines = [re.sub(r"\W+", " ", l).strip().upper() for l in text.splitlines()]
    lines = [l for l in lines if len(l) >= 3]
    fragments = 0
    for i, line in enumerate(lines):
        for prev in lines[:i]:
            if line != prev and line in prev:
                fragments += 1
                break
    if fragments >= 2:
        return True

    words = re.findall(r"[A-Za-z']+", text.upper())
    if len(words) >= 12:
        grams: dict[str, int] = {}
        for i in range(len(words) - 2):
            g = " ".join(words[i : i + 3])
            grams[g] = grams.get(g, 0) + 1
        if grams and max(grams.values()) >= 4:
            return True
    return False


def clean_ocr(text: str) -> str:
    """Post-process extracted text: keep every real line, drop the echoes.

    Only the aggressive de-duplication is conditional on degeneration being
    detected - a table legitimately repeats short cell values, and stripping
    those on every response would corrupt good output to fix bad output.
    """
    if not text:
        return ""
    out = re.sub(r"\n{3,}", "\n\n", "\n".join(l.rstrip() for l in text.splitlines()).strip())
    if not looks_degenerate(out):
        # Untouched. A transcription is only useful if it is faithful, and
        # a table can legitimately repeat a row - so nothing is removed
        # from output that shows no sign of having gone wrong.
        return out

    # Degenerate: drop back-to-back repeats, then anything that is merely a
    # piece of something already said.

    # Degenerate: keep the first occurrence of each line and drop anything that
    # is merely a piece of something already said.
    kept: list[str] = []
    seen: list[str] = []
    previous = None
    for line in out.splitlines():
        if line.strip() and line.strip() == previous:
            continue
        previous = line.strip()
        text_only = line.strip()
        if not text_only:
            if kept and kept[-1] != "":
                kept.append("")
            continue
        norm = re.sub(r"\W+", " ", text_only).strip().upper()
        if len(norm) < 3:
            kept.append(line)
            continue
        if norm in seen:
            continue
        if any(norm != prev and norm in prev for prev in seen):
            continue
        seen.append(norm)
        kept.append(line)
    return "\n".join(kept).strip()


def fix_citations(text: str, source_count: int) -> str:
    """Delete citations pointing at sources that were never returned.

    A model handed 4 sources will still occasionally write [7]. Left in, it
    sends the reader looking for a link that does not exist.
    """
    if not text:
        return ""
    if source_count <= 0:
        return re.sub(r"\s*\[\d{1,2}\]", "", text)

    def _keep(m: re.Match) -> str:
        n = int(m.group(1))
        return m.group(0) if 1 <= n <= source_count else ""

    out = re.sub(r"\s*\[(\d{1,2})\]", _keep, text)
    return re.sub(r"[ \t]{2,}", " ", out).strip()


# ---------------------------------------------------------------------------
# COST CONTROL
# ---------------------------------------------------------------------------


class TTLCache:
    """A tiny in-process LRU with expiry.

    Students re-ask the same highlighted MCQ, re-open the same image, and hit
    the same field twice. Serving those from memory is the cheapest possible
    win: no key spent, no rate limit consumed, and the reply is instant. Kept
    in-process on purpose - a Redis dependency for a 10-minute cache of short
    strings would cost more than it saves.
    """

    def __init__(self, maxsize: int = 512, ttl: float = 900.0) -> None:
        self.maxsize = maxsize
        self.ttl = ttl
        self._data: dict[str, tuple[float, object]] = {}
        self._lock = threading.Lock()

    @staticmethod
    def key(*parts: object) -> str:
        raw = "\x1f".join(str(p) for p in parts)
        return hashlib.sha256(raw.encode("utf-8", "ignore")).hexdigest()

    def get(self, key: str):
        with self._lock:
            hit = self._data.get(key)
            if not hit:
                return None
            stamp, value = hit
            if time.time() - stamp > self.ttl:
                self._data.pop(key, None)
                return None
            # Refresh insertion order so the LRU eviction below is meaningful.
            self._data.pop(key)
            self._data[key] = (stamp, value)
            return value

    def set(self, key: str, value) -> None:
        with self._lock:
            self._data[key] = (time.time(), value)
            while len(self._data) > self.maxsize:
                self._data.pop(next(iter(self._data)))


answer_cache = TTLCache()


# Long or code-heavy input is where the bigger model actually changes the
# answer; everything else is a waste of the price difference. This is the
# whole cost policy, in one function.
STRONG_MODEL = "openai/gpt-oss-120b"


def pick_model(text: str, kind: str = "", question: str = "") -> str:
    from app import runtime_settings
    from app.config import settings

    fast = runtime_settings.get("fast_model") or settings.fast_model

    size = len(text or "") + len(question or "")
    if kind == "code" or size > 3500:
        return STRONG_MODEL
    return fast
