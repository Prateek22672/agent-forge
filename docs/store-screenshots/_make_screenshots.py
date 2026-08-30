"""Generate Chrome Web Store screenshots for AgentFury's new features.

The mockups reuse the extension's REAL stylesheet, lifted straight out of
content-global.js, so the bar, badges, cards and menus in these images are the
same pixels users will see - not an artist's impression of them. Rendered with
headless Chrome at the store's 1280x800, then flattened to RGB (the store
rejects alpha).
"""
import base64
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path("c:/My Projects/agent")
OUT = ROOT / "docs/store-screenshots"
WORK = pathlib.Path(
    "C:/Users/Lenovo/AppData/Local/Temp/claude/c--My-Projects-agent/1cca1e58-1424-4cc0-a73a-6fcba56b7934/scratchpad/shots"
)
WORK.mkdir(parents=True, exist_ok=True)
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"

src = (ROOT / "extension/content-global.js").read_text(encoding="utf-8")


def literal(name: str) -> str:
    """Pull a backtick template literal out of the content script."""
    start = src.index(f"const {name} = `") + len(f"const {name} = `")
    end = src.index("`;", start)
    return src[start:end]


CSS = literal("AF_CSS_TEXT") + literal("AF_CSS_EXTRA")
LOGO = re.search(r'const AF_LOGO =\s*"([^"]+)"', src).group(1)
# The stylesheet interpolates the logo; do the same substitution the code does.
CSS = CSS.replace("url(${AF_LOGO})", f"url({LOGO})")

SVG_SEND = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>'
SVG_COPY = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>'
SVG_GRIP = '<svg width="18" height="10" viewBox="0 0 18 10" fill="currentColor"><circle cx="3" cy="3" r="1.35"/><circle cx="9" cy="3" r="1.35"/><circle cx="15" cy="3" r="1.35"/><circle cx="3" cy="7" r="1.35"/><circle cx="9" cy="7" r="1.35"/><circle cx="15" cy="7" r="1.35"/></svg>'
SVG_MIN = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 12h14"/></svg>'

SHELL = """<!doctype html><html><head><meta charset="utf-8"><style>
* {{ box-sizing: border-box; }}
html, body {{ margin: 0; padding: 0; width: 1280px; height: 800px; overflow: hidden;
  background: #101014; font-family: -apple-system, "Segoe UI", Inter, system-ui, sans-serif; }}
.frame {{ position: absolute; inset: 0; display: flex; flex-direction: column; }}
.chrome {{ height: 44px; flex: none; background: #202124; display: flex; align-items: center;
  gap: 10px; padding: 0 14px; border-bottom: 1px solid #000; }}
.dots {{ display: flex; gap: 6px; }}
.dots i {{ width: 11px; height: 11px; border-radius: 50%; display: block; }}
.url {{ flex: 1; height: 26px; background: #2f3033; border-radius: 999px; display: flex; align-items: center;
  padding: 0 12px; color: #9aa0a6; font-size: 12px; letter-spacing: .01em; }}
.ext {{ width: 24px; height: 24px; border-radius: 6px; background: #fff; color: #000; font-size: 9px;
  font-weight: 800; display: flex; align-items: center; justify-content: center; }}
.page {{ flex: 1; position: relative; overflow: hidden; }}
.caption {{ position: absolute; left: 0; right: 0; bottom: 0; height: 96px; z-index: 99;
  background: linear-gradient(180deg, rgba(10,10,14,0) 0%, rgba(10,10,14,.93) 42%, #0a0a0e 100%);
  display: flex; flex-direction: column; justify-content: flex-end; padding: 0 46px 20px; }}
.caption h2 {{ margin: 0; color: #fff; font-size: 25px; font-weight: 650; letter-spacing: -.015em; }}
.caption p {{ margin: 5px 0 0; color: rgba(255,255,255,.62); font-size: 14.5px; }}
{extra}
</style><style>{css}</style></head><body>
<div class="frame">
  <div class="chrome">
    <div class="dots"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i></div>
    <div class="url">{url}</div>
    <div class="ext">AF</div>
  </div>
  <div class="page">{page}</div>
</div>
<div class="caption"><h2>{title}</h2><p>{sub}</p></div>
</body></html>"""


def bar(answer_html, question="", width=470, top=250, left=430, chips_extra="", light=True):
    """The real selection bar, with an answer already in it."""
    return f"""
<div class="af-sel-bar af-in{" af-light" if light else ""}" style="left:{left}px; top:{top}px; width:{width}px; max-width:none;">
  <div class="af-sel-handle"><span class="af-grip">{SVG_GRIP}</span><span class="af-min-label">AgentFury</span>
    <button class="af-min">{SVG_MIN}</button></div>
  <div class="af-sel-row">
    <input class="af-sel-input" value="{question}" placeholder="Ask about this…" />
    <button class="af-ic af-copy-ic">{SVG_COPY}</button>
    <button class="af-sel-send">{SVG_SEND}</button>
  </div>
  <div class="af-sel-chips">
    <button class="af-sel-chip af-answer">Answer</button>
    <button class="af-sel-chip">Google</button>
    <button class="af-sel-chip af-sel-action">Save</button>
    {chips_extra}
    <button class="af-sel-chip af-more-btn">More</button>
  </div>
  <div class="af-sel-answer af-in" style="max-height:none">{answer_html}</div>
</div>"""


SCENES = []

# ---------------------------------------------------------------- 1. quiz ---
SCENES.append(dict(
    name="af-1-answer-any-question",
    url="app.quilgo.com/app/quiz/science-101",
    title="Answers the question on the page",
    sub="A quiz, a worksheet, a practice paper — the badge finds the question and answers it. Nothing to highlight.",
    extra="""
.q-page { position:absolute; inset:0; background:#fff; padding: 46px 60px; }
.q-head { font: 600 15px/1.4 system-ui; color:#5f6368; }
.q-prog { height:5px; background:#e8eaed; border-radius:99px; margin:20px 0 34px; width:70%; }
.q-prog i { display:block; height:100%; width:22%; background:#1a73e8; border-radius:99px; }
.q-title { font: 650 24px/1.45 system-ui; color:#111; max-width:600px; margin:0 0 24px; }
.q-opt { display:flex; align-items:center; gap:14px; border:1px solid #e3e5e8; border-radius:14px;
  padding:14px 18px; margin-bottom:10px; max-width:600px; font:400 15.5px system-ui; color:#202124; }
.q-foot { display:flex; align-items:center; gap:18px; margin-top:22px; max-width:600px; }
.q-hint { font:400 14px system-ui; color:#5f6368; }
.q-next { margin-left:auto; background:#1a73e8; color:#fff; border:none; border-radius:99px;
  padding:11px 30px; font:600 14.5px system-ui; }
.q-opt i { width:17px; height:17px; border-radius:50%; border:2px solid #c9ccd1; display:block; flex:none; }
.q-opt.right { border-color:#34a853; background:#f2fbf5; }
.q-opt.right i { border-color:#34a853; background:#34a853; box-shadow: inset 0 0 0 3px #f2fbf5; }
""",
    page=f"""
<div class="q-page">
  <div class="q-head">General Knowledge &amp; Science · Question 1 of 5</div>
  <div class="q-prog"><i></i></div>
  <div class="q-title">Which chemical element has the highest melting point of all pure elements,
    making it ideal for incandescent light bulb filaments?</div>
  <div class="q-opt"><i></i> A. Carbon</div>
  <div class="q-opt right"><i></i> B. Tungsten</div>
  <div class="q-opt"><i></i> C. Iron</div>
  <div class="q-opt"><i></i> D. Titanium</div>
  <div class="q-foot"><span class="q-hint">Show hint ⌄</span><button class="q-next">Next</button></div>
</div>
<div class="af-q-badge af-in" style="left:690px; top:148px;">
  <span class="af-qb-main"><span class="af-ib-logo af-logo"></span><span>Answer</span></span>
  <button class="af-ib-more">⋯</button>
</div>
{bar('<div class="af-sel-answer-text"><strong>Answer: B) Tungsten</strong><br>It melts at 3,422&nbsp;°C — the highest melting point of any pure element — so the filament can glow white-hot without failing.</div>', left=690, top=196, width=430)}
"""))

# --------------------------------------------------------------- 2. image ---
SCENES.append(dict(
    name="af-2-read-any-image",
    url="www.google.com/search?q=physics+diagrams&tbm=isch",
    title="Reads the text inside any image",
    sub="Extract it, explain it, translate it, or solve the question in it — on any image, anywhere.",
    extra="""
.g-page { position:absolute; inset:0; background:#1b1c1f; padding:22px 26px; }
.g-grid { display:grid; grid-template-columns: repeat(4, 1fr); gap:14px; }
.g-card { border-radius:12px; overflow:hidden; background:#2a2b2f; height:186px; position:relative;
  display:flex; align-items:center; justify-content:center; color:#fff; }
.g-card span { font: 700 30px system-ui; letter-spacing:.02em; opacity:.92; }
.g-cap { font:400 12px system-ui; color:#9aa0a6; margin-top:7px; }
.slide { background: linear-gradient(135deg,#12203a,#0b1220); }
.slide b { display:block; font:700 15px system-ui; color:#fff; margin-bottom:9px; }
.slide p { margin:3px 0; font:400 12.5px system-ui; color:#c6cbd4; }
""",
    page=f"""
<div class="g-page">
  <div class="g-grid" style="margin-bottom:14px;">
    <div><div class="g-card slide" style="flex-direction:column; align-items:flex-start; padding:18px;">
      <b>Newton's Laws of Motion</b><p>1. An object stays at rest or in</p><p>uniform motion unless acted on</p>
      <p>2. F = ma</p><p>3. Every action has an equal and</p><p>opposite reaction</p></div>
      <div class="g-cap">physicsclassroom.com</div></div>
    <div><div class="g-card" style="background:linear-gradient(140deg,#3a2a52,#221a30)"><span>OPTICS</span></div>
      <div class="g-cap">byjus.com</div></div>
    <div><div class="g-card" style="background:linear-gradient(140deg,#123a33,#0b2320)"><span>CIRCUITS</span></div>
      <div class="g-cap">unacademy.com</div></div>
    <div><div class="g-card" style="background:linear-gradient(140deg,#3a1f1f,#241414)"><span>THERMO</span></div>
      <div class="g-cap">getty images</div></div>
  </div>
  <div class="g-grid">
    <div><div class="g-card" style="background:linear-gradient(140deg,#1f2b4a,#141c30)"><span>WAVES</span></div>
      <div class="g-cap">vedantu.com</div></div>
    <div><div class="g-card" style="background:linear-gradient(140deg,#3d3320,#241d12)"><span>MAGNETISM</span></div>
      <div class="g-cap">toppr.com</div></div>
    <div><div class="g-card" style="background:linear-gradient(140deg,#1b3a2a,#0f2318)"><span>MOTION</span></div>
      <div class="g-cap">khanacademy.org</div></div>
    <div><div class="g-card" style="background:linear-gradient(140deg,#2f2140,#1c1428)"><span>ENERGY</span></div>
      <div class="g-cap">physicswallah.com</div></div>
  </div>
</div>
<div class="af-img-badge af-in" style="left:38px; top:76px;">
  <span class="af-ib-main"><span class="af-ib-logo af-logo"></span><span>AI</span></span>
  <button class="af-ib-more">⋯</button>
</div>
<div class="af-panel af-img-card af-in" style="left:352px; top:110px; width:376px;">
  <div class="af-card-head"><span class="af-card-ic af-logo"></span>
    <div class="af-card-titles"><div class="af-card-title">Image AI</div>
      <div class="af-card-sub">newtons-laws-slide.png</div></div>
    <button class="af-x">✕</button></div>
  <div class="af-row-wrap">
    <button class="af-chip primary">Extract text</button><button class="af-chip">Explain</button>
    <button class="af-chip">Solve</button><button class="af-chip">Translate</button>
    <button class="af-chip">Search image ↗</button>
  </div>
  <div class="af-ask-row"><input class="af-ask-input" placeholder="Ask about this image…"><button class="af-ask-go">{SVG_SEND}</button></div>
  <div class="af-body"><div class="af-sel-answer-text">Newton's Laws of Motion<br>1. An object stays at rest or in uniform motion unless acted on<br>2. F = ma<br>3. Every action has an equal and opposite reaction</div></div>
  <div class="af-tools"><button class="af-tool">Copy text</button><button class="af-tool">Copy image</button>
    <button class="af-tool">Save note</button></div>
</div>
"""))

# ---------------------------------------------------------------- 3. snip ---
SCENES.append(dict(
    name="af-3-snip-and-read",
    url="docs.internal.example.com/scanned/report-q3.pdf",
    title="Drag a box over anything on screen",
    sub="Text painted on a canvas, a frame of a video, a scanned page — if you can see it, it can be read.",
    extra="""
.pdf { position:absolute; inset:0; background:#3c3c3c; display:flex; align-items:center; justify-content:center; }
.sheet { width:720px; height:560px; background:#fbfbf8; border-radius:3px; box-shadow:0 20px 50px rgba(0,0,0,.5);
  padding:44px 52px; transform: rotate(-.35deg); }
.sheet h3 { margin:0 0 6px; font:700 21px Georgia, serif; color:#1a1a1a; }
.sheet .meta { font:400 12px Georgia, serif; color:#6b6b6b; margin-bottom:22px; }
.sheet p { font:400 14.5px/1.75 Georgia, serif; color:#242424; margin:0 0 13px; }
.scan { filter: blur(.25px) contrast(.94); }
""",
    page=f"""
<div class="pdf"><div class="sheet scan">
  <h3>Quarterly Operations Report</h3>
  <div class="meta">Scanned copy · Q3 · Facilities &amp; Logistics</div>
  <p>Total throughput increased 18.4% against the prior quarter, driven almost entirely by the
     second shift at the Nagpur site.</p>
  <p>Downtime fell to 3.1 hours per week. The remaining loss is concentrated in the
     changeover between batch types, which the new scheduling rule does not yet cover.</p>
  <p>Recommendation: extend the rule to cover changeovers before the next cycle.</p>
</div></div>
<div class="af-snip" style="position:absolute; inset:0;">
  <div class="af-snip-hint" style="top:22px;">Drag over anything to read its text — Esc to cancel</div>
  <div class="af-snip-box" style="left:322px; top:212px; width:560px; height:132px;"></div>
</div>
<div class="af-panel af-img-card af-light af-in" style="left:322px; top:362px; width:392px; z-index:2147483005;">
  <div class="af-card-head"><span class="af-card-ic af-logo"></span>
    <div class="af-card-titles"><div class="af-card-title">Image AI</div>
      <div class="af-card-sub">Screen selection · 560×132</div></div>
    <button class="af-x">✕</button></div>
  <div class="af-body"><div class="af-sel-answer-text">Total throughput increased 18.4% against the prior quarter, driven almost entirely by the second shift at the Nagpur site.</div></div>
  <div class="af-tools"><button class="af-tool">Copy text</button><button class="af-tool">Save note</button>
    <button class="af-tool">Ask AI about this ↗</button></div>
</div>
"""))

# --------------------------------------------------------------- 4. typing ---
SCENES.append(dict(
    name="af-4-fix-as-you-type",
    url="support.example.com/tickets/4821/reply",
    title="Fixes your writing as you type",
    sub="Spelling and grammar caught instantly, offline. Accept one fix at a time — your sentence is never rewritten for you.",
    extra="""
.t-page { position:absolute; inset:0; background:#f6f7f9; padding:40px 60px; }
.t-page h3 { margin:0 0 4px; font:650 19px system-ui; color:#16181d; }
.t-page .sub { font:400 13px system-ui; color:#6b7280; margin-bottom:24px; }
.box { background:#fff; border:1px solid #e2e5ea; border-radius:14px; padding:16px 18px; max-width:760px;
  min-height:190px; font:400 15px/1.7 system-ui; color:#1f2937; box-shadow:0 1px 3px rgba(0,0,0,.04); position:relative; }
.box u { text-decoration: underline wavy #ef4444; text-underline-offset: 4px; }
.send { margin-top:14px; background:#1a73e8; color:#fff; border:none; border-radius:10px;
  padding:10px 22px; font:600 14px system-ui; }
""",
    page=f"""
<div class="t-page">
  <h3>Reply to ticket #4821</h3>
  <div class="sub">Customer: Meera S. · Priority: normal</div>
  <div class="box">Hi Meera,<br><br>Thanks for writing in. <u>i has recieved</u> your email yesterday and
    <u>i</u> will <u>definately</u> look into the billing issue for you <u>tommorow</u> morning.<br><br>
    <u>Their</u> is a few things I want to check first.</div>
  <button class="send">Send reply</button>
  <div style="margin-top:26px; max-width:760px; border-top:1px solid #e6e9ee; padding-top:16px;
              font:400 13px/1.7 system-ui; color:#6b7280;">
    <b style="color:#374151">Earlier in this thread</b><br>
    Meera S. — “The invoice for March shows two charges for the same seat. Could you check?”
  </div>
</div>
<div class="af-edit-badge af-in af-has-issues" style="left:762px; top:300px;">
  <span class="af-ib-logo af-logo"></span><span class="af-badge-label">5</span></div>
<div class="af-panel af-edit-menu af-light af-in" style="left:596px; top:334px;">
  <div class="af-card-head"><span class="af-card-ic af-logo"></span>
    <div class="af-card-titles"><div class="af-card-title">Edit with AI</div>
      <div class="af-card-sub">Whole field — no highlighting needed</div></div>
    <button class="af-x">✕</button></div>
  <div class="af-suggests">
    <div class="af-suggest-head"><span>5 suggestions</span><button class="af-tool">Fix all</button></div>
    <button class="af-suggest"><span class="af-dot" style="background:#e5484d"></span>
      <span class="af-suggest-text"><s>recieved</s> → <b>received</b></span></button>
    <button class="af-suggest"><span class="af-dot" style="background:#f5a524"></span>
      <span class="af-suggest-text"><s>i has</s> → <b>I have</b></span></button>
    <button class="af-suggest"><span class="af-dot" style="background:#e5484d"></span>
      <span class="af-suggest-text"><s>definately</s> → <b>definitely</b></span></button>
    <button class="af-suggest"><span class="af-dot" style="background:#e5484d"></span>
      <span class="af-suggest-text"><s>tommorow</s> → <b>tomorrow</b></span></button>
  </div>
  <div class="af-row-wrap"><button class="af-chip primary">Fix</button><button class="af-chip">Shorten</button>
    <button class="af-chip">Formal</button><button class="af-chip">Answer</button></div>
</div>
"""))

# ----------------------------------------------------------------- 5. copy ---
SCENES.append(dict(
    name="af-5-copy-anywhere",
    url="notes.protected-course.example/module-7/lecture",
    title="Copy and select where sites block it",
    sub="Selection, copy, right-click and paste all restored. Where a page still refuses, Alt+click reads it anyway.",
    extra="""
.c-page { position:absolute; inset:0; background:#fff; padding:44px 70px; }
.c-page .tag { display:inline-block; font:600 11px system-ui; letter-spacing:.08em; text-transform:uppercase;
  color:#b45309; background:#fef3c7; border-radius:99px; padding:5px 11px; margin-bottom:18px; }
.c-page h3 { margin:0 0 16px; font:650 23px system-ui; color:#111827; }
.c-page p { font:400 15.5px/1.85 Georgia, serif; color:#374151; max-width:800px; margin:0 0 14px; }
.sel { background:#c7cdf7; border-radius:2px; }
""",
    page=f"""
<div class="c-page">
  <span class="tag">🔒 Copying disabled on this page</span>
  <h3>Module 7 — Distributed Consensus</h3>
  <p><span class="sel">A consensus algorithm must guarantee three properties: termination, so every correct
     process eventually decides; agreement, so no two correct processes decide differently; and validity,
     so the value decided was proposed by some process.</span></p>
  <p>In an asynchronous network with even one faulty process, the FLP result shows that no deterministic
     algorithm can guarantee all three — which is why practical systems relax timing assumptions instead.</p>
</div>
{bar('<div class="af-sel-answer-text">The three guarantees are <strong>termination</strong> (every correct process decides), <strong>agreement</strong> (no two decide differently) and <strong>validity</strong> (the decided value was proposed). FLP shows no deterministic algorithm achieves all three under full asynchrony with one faulty process.</div>', left=110, top=292, width=520, chips_extra='<button class="af-sel-chip">Copy page text</button>')}
<div class="af-toast af-in" style="bottom:120px;">Copied 1,284 characters</div>
"""))


def build():
    made = []
    for scene in SCENES:
        html = SHELL.format(css=CSS, extra=scene["extra"], page=scene["page"], url=scene["url"],
                            title=scene["title"], sub=scene["sub"])
        src_file = WORK / f"{scene['name']}.html"
        src_file.write_text(html, encoding="utf-8")
        png = WORK / f"{scene['name']}.png"
        subprocess.run(
            [CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars",
             "--force-device-scale-factor=1", "--window-size=1280,800",
             f"--screenshot={png}", src_file.as_uri()],
            capture_output=True, timeout=90,
        )
        if not png.exists():
            print("FAILED to render", scene["name"])
            continue
        from PIL import Image

        im = Image.open(png).convert("RGB").resize((1280, 800), Image.LANCZOS)
        dest = OUT / f"{scene['name']}.png"
        im.save(dest, "PNG")
        made.append((dest.name, im.size, dest.stat().st_size // 1024))
    return made


if __name__ == "__main__":
    for name, size, kb in build():
        print(f"  {name:<34} {size[0]}x{size[1]}  {kb} KB")
