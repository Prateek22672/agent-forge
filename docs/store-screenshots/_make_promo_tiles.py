"""Promo tiles for the Chrome Web Store: 440x280 small, 1400x560 marquee.

Same principle as the screenshots - the product UI in these tiles is rendered
from the extension's own stylesheet, so the thing being advertised is the
thing that ships. Everything else is built to survive being shown small: one
idea, high contrast, no paragraph anyone has to squint at.
"""
import pathlib
import re
import subprocess

ROOT = pathlib.Path("c:/My Projects/agent")
OUT = ROOT / "docs/store-screenshots"
WORK = pathlib.Path(
    "C:/Users/Lenovo/AppData/Local/Temp/claude/c--My-Projects-agent/1cca1e58-1424-4cc0-a73a-6fcba56b7934/scratchpad/shots"
)
WORK.mkdir(parents=True, exist_ok=True)
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"

src = (ROOT / "extension/content-global.js").read_text(encoding="utf-8")


def literal(name):
    start = src.index(f"const {name} = `") + len(f"const {name} = `")
    return src[start : src.index("`;", start)]


CSS = (literal("AF_CSS_TEXT") + literal("AF_CSS_EXTRA"))
LOGO = re.search(r'const AF_LOGO =\s*"([^"]+)"', src).group(1)
CSS = CSS.replace("url(${AF_LOGO})", f"url({LOGO})")

SVG_SEND = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>'
SVG_COPY = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>'
SVG_GRIP = '<svg width="18" height="10" viewBox="0 0 18 10" fill="currentColor"><circle cx="3" cy="3" r="1.35"/><circle cx="9" cy="3" r="1.35"/><circle cx="15" cy="3" r="1.35"/><circle cx="3" cy="7" r="1.35"/><circle cx="9" cy="7" r="1.35"/><circle cx="15" cy="7" r="1.35"/></svg>'

# The backdrop: one dark field, two coloured lights, a faint grid and a grain
# layer. Flat dark reads as cheap at tile size; light and texture read as made.
BACKDROP = """
.bg { position:absolute; inset:0; background:
    radial-gradient(1100px 620px at 78% 18%, rgba(99,102,241,.34), transparent 62%),
    radial-gradient(760px 520px at 12% 88%, rgba(217,70,239,.20), transparent 60%),
    radial-gradient(600px 400px at 50% 50%, rgba(56,189,248,.10), transparent 70%),
    linear-gradient(160deg, #0b0b12 0%, #07070c 55%, #0a0a10 100%); }
.grid { position:absolute; inset:0; opacity:.5;
  background-image: linear-gradient(rgba(255,255,255,.045) 1px, transparent 1px),
                    linear-gradient(90deg, rgba(255,255,255,.045) 1px, transparent 1px);
  background-size: 46px 46px;
  -webkit-mask-image: radial-gradient(circle at 50% 40%, #000 0%, transparent 78%); }
.grain { position:absolute; inset:0; opacity:.055; mix-blend-mode:overlay;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='140' height='140'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3'/></filter><rect width='140' height='140' filter='url(%23n)'/></svg>"); }
.vig { position:absolute; inset:0; box-shadow: inset 0 0 160px 40px rgba(0,0,0,.55); }
.mark { display:inline-flex; align-items:center; gap:12px; }
.mark .dot { width:44px; height:44px; border-radius:50%;
  background: url(LOGO_URL) center/cover no-repeat;
  box-shadow: 0 0 0 1px rgba(255,255,255,.16), 0 10px 30px rgba(99,102,241,.45); }
.mark .name { font: 800 25px/1 "Segoe UI", system-ui; letter-spacing:.22em; color:#fff; text-transform:uppercase; }
""".replace("LOGO_URL", LOGO)


def render(name, w, h, body, extra=""):
    html = f"""<!doctype html><html><head><meta charset="utf-8"><style>
*{{box-sizing:border-box}} html,body{{margin:0;padding:0;width:{w}px;height:{h}px;overflow:hidden;
  background:#07070c;font-family:-apple-system,"Segoe UI",Inter,system-ui,sans-serif;}}
{BACKDROP}
{extra}
</style><style>{CSS}</style></head><body>
<div class="bg"></div><div class="grid"></div><div class="grain"></div>
{body}
<div class="vig"></div>
</body></html>"""
    f = WORK / f"{name}.html"
    f.write_text(html, encoding="utf-8")
    png = WORK / f"{name}.raw.png"
    subprocess.run(
        [CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=2",
         f"--window-size={w},{h}", f"--screenshot={png}", f.as_uri()],
        capture_output=True, timeout=90,
    )
    from PIL import Image

    im = Image.open(png).convert("RGB").resize((w, h), Image.LANCZOS)  # 2x then down = crisp text
    dest = OUT / f"{name}.png"
    im.save(dest, "PNG")
    return dest, im.size, dest.stat().st_size // 1024


# --------------------------------------------------------------- marquee ----
MARQUEE_EXTRA = """
.wrap { position:absolute; inset:0; display:flex; align-items:center; padding:0 64px; }
.left { width:600px; flex:none; }
.h1 { margin:26px 0 0; font:700 52px/1.08 "Segoe UI", system-ui; letter-spacing:-.028em; color:#fff; }
.h1 em { font-style:normal; background:linear-gradient(92deg,#a5b4fc,#f0abfc 60%,#7dd3fc);
  -webkit-background-clip:text; background-clip:text; color:transparent; }
.sub { margin:18px 0 0; font:400 18.5px/1.6 "Segoe UI", system-ui; color:rgba(255,255,255,.66); max-width:520px; }
.pills { display:flex; gap:9px; margin-top:28px; flex-wrap:wrap; }
.pill { font:600 12.5px "Segoe UI", system-ui; color:rgba(255,255,255,.86); background:rgba(255,255,255,.07);
  border:1px solid rgba(255,255,255,.13); border-radius:999px; padding:8px 15px; backdrop-filter:blur(8px); }
.stage { position:absolute; left:672px; top:0; bottom:0; width:720px; }
.float { position:absolute !important; transform-origin:center; }
.stage .af-q-badge, .stage .af-img-badge, .stage .af-edit-badge { position:absolute !important; }
.glow { position:absolute; left:180px; top:120px; width:420px; height:320px; border-radius:50%;
  background:radial-gradient(circle, rgba(129,140,248,.55), transparent 68%); filter:blur(46px); }
.shot { border-radius:16px; overflow:hidden; box-shadow:0 40px 90px rgba(0,0,0,.62), 0 0 0 1px rgba(255,255,255,.09); }
.qcard { width:360px; background:#fff; padding:20px 22px; }
.qcard .qq { font:650 16.5px/1.45 system-ui; color:#101114; margin-bottom:14px; }
.qcard .oo { font:400 13.5px system-ui; color:#3c4043; border:1px solid #e6e8ec; border-radius:10px;
  padding:9px 12px; margin-bottom:7px; }
.qcard .oo.hit { border-color:#34a853; background:#f1fbf4; font-weight:600; color:#137333; }
"""

MARQUEE = f"""
<div class="wrap">
  <div class="left">
    <div class="mark"><span class="dot"></span><span class="name">Agent&nbsp;Fury</span></div>
    <h1 class="h1">Select to search.<br><em>Select to answer.</em></h1>
    <p class="sub">Answers what's on the page, reads the text inside any image,
       fixes what you type — and copies where sites say you can't.</p>
    <div class="pills">
      <span class="pill">Answers questions on the page</span>
      <span class="pill">OCR on any image</span>
      <span class="pill">Fixes as you type</span>
      <span class="pill">Copy anywhere</span>
    </div>
  </div>
  <div class="stage">
    <div class="glow"></div>
    <div class="float shot qcard" style="left:16px; top:92px; width:340px; transform: rotate(-3.4deg) scale(.96);">
      <div class="qq">Which element has the highest melting point of all pure elements?</div>
      <div class="oo">A. Carbon</div>
      <div class="oo hit">B. Tungsten</div>
      <div class="oo">C. Iron</div>
    </div>
    <div class="float" style="left:246px; top:196px; transform: rotate(2.2deg);">
      <div class="af-sel-bar af-in" style="position:relative; left:0; top:0; width:374px; max-width:none;
           box-shadow:0 44px 90px rgba(0,0,0,.62), 0 0 0 1px rgba(255,255,255,.08);">
        <div class="af-sel-handle"><span class="af-grip">{SVG_GRIP}</span></div>
        <div class="af-sel-row"><input class="af-sel-input" placeholder="Ask about this…">
          <button class="af-ic">{SVG_COPY}</button><button class="af-sel-send">{SVG_SEND}</button></div>
        <div class="af-sel-chips"><button class="af-sel-chip af-answer">Answer</button>
          <button class="af-sel-chip">Google</button><button class="af-sel-chip af-sel-action">Save</button></div>
        <div class="af-sel-answer af-in" style="max-height:none">
          <div class="af-sel-answer-text"><strong>Answer: B) Tungsten</strong><br>
            Melts at 3,422&nbsp;°C — the highest of any pure element.</div></div>
      </div>
    </div>
    <div class="float af-q-badge af-in" style="left:230px; top:56px; transform:rotate(-3deg);">
      <span class="af-qb-main"><span class="af-ib-logo af-logo"></span><span>Answer</span></span>
      <button class="af-ib-more">⋯</button>
    </div>
    <div class="float shot" style="left:22px; top:378px; width:196px; height:118px;
         background:linear-gradient(140deg,#16233f,#0d1526); transform:rotate(1.6deg);
         display:flex; align-items:center; justify-content:center;">
      <span style="font:700 17px system-ui; color:#dbe3f4; letter-spacing:.04em;">SCANNED PAGE</span>
    </div>
    <div class="float af-img-badge af-in" style="left:34px; top:390px; transform:rotate(1.6deg);">
      <span class="af-ib-main"><span class="af-ib-logo af-logo"></span><span>AI</span></span>
      <button class="af-ib-more">⋯</button>
    </div>
    <div class="float shot" style="left:246px; top:392px; width:290px; background:#fff; padding:13px 15px;
         transform:rotate(-1.4deg);">
      <div style="font:400 13px/1.6 system-ui; color:#3c4043;">
        Thanks — <s style="color:#9aa0a6; text-decoration-color:#e5484d">i has recieved</s>
        <b style="color:#137333">I have received</b> your note…</div>
    </div>
    <div class="float af-edit-badge af-in af-has-issues" style="left:492px; top:432px; transform:rotate(-1.4deg);">
      <span class="af-ib-logo af-logo"></span><span class="af-badge-label">3</span>
    </div>
  </div>
</div>
"""

# ----------------------------------------------------------------- small ----
SMALL_EXTRA = """
.s-wrap { position:absolute; inset:0; display:flex; flex-direction:column; justify-content:center;
  padding:0 34px; }
.s-h1 { margin:20px 0 0; font:700 31px/1.12 "Segoe UI", system-ui; letter-spacing:-.026em; color:#fff; }
.s-h1 em { font-style:normal; background:linear-gradient(92deg,#a5b4fc,#f0abfc);
  -webkit-background-clip:text; background-clip:text; color:transparent; }
.s-sub { margin:13px 0 0; font:600 12.5px "Segoe UI", system-ui; letter-spacing:.06em;
  text-transform:uppercase; color:rgba(255,255,255,.5); }
.promo-badge { position:absolute; left:300px; bottom:20px; display:inline-flex; align-items:center;
  gap:7px; height:30px; padding:0 14px 0 6px; background:rgba(24,26,42,.94); color:#eef0ff;
  border:1px solid rgba(126,140,255,.45); border-radius:999px;
  font:600 12.5px "Segoe UI", system-ui; letter-spacing:.01em; transform:rotate(-3deg);
  box-shadow:0 12px 30px rgba(0,0,0,.55); }
.promo-badge .dot { width:20px; height:20px; border-radius:50%; flex:none;
  background:url(" + LOGO + ") center/cover no-repeat; }
.s-glow { position:absolute; left:230px; top:-50px; width:280px; height:240px; border-radius:50%;
  background:radial-gradient(circle, rgba(129,140,248,.5), transparent 66%); filter:blur(40px); }
.mark .dot { width:34px; height:34px; }
.mark .name { font-size:19px; letter-spacing:.2em; }
"""

SMALL = """
<div class="s-glow"></div>
<div class="s-wrap" style="padding-bottom:26px;">
  <div class="mark"><span class="dot"></span><span class="name">Agent&nbsp;Fury</span></div>
  <h1 class="s-h1">Select to search.<br><em>Select to answer.</em></h1>
  <p class="s-sub">Any page · any image · anywhere</p>
</div>
<div class="promo-badge"><span class="dot"></span><span>Answer</span></div>
"""

if __name__ == "__main__":
    for name, w, h, body, extra in [
        ("af-promo-marquee-1400x560", 1400, 560, MARQUEE, MARQUEE_EXTRA),
        ("af-promo-small-440x280", 440, 280, SMALL, SMALL_EXTRA),
    ]:
        dest, size, kb = render(name, w, h, body, extra.replace('" + LOGO + "', LOGO))
        print(f"  {dest.name:<32} {size[0]}x{size[1]}  {kb} KB")
