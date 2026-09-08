// Local file index for the spotlight popup — the part of AgentFury that only a
// desktop app can do: find anything on this laptop, instantly, offline.
//
// WHY AN INDEX INSTEAD OF WALKING ON EVERY KEYSTROKE
//   A cold walk of a home folder is seconds; a spotlight has to answer in
//   milliseconds. So we walk once in the background, keep a flat array in
//   memory, and match against that. Re-walks happen on a slow timer, and the
//   Downloads folder — the one people actually watch change — is re-read on
//   every open so a file saved five seconds ago is already there.
//
// WHAT IT DELIBERATELY DOES NOT DO
//   No file *contents* are read, ever — only names, paths, sizes and mtimes.
//   Nothing leaves the machine: this module has no network code, and the
//   spotlight answers from it without calling the backend at all.
const fs = require("fs");
const path = require("path");

// Directories that are all cost and no benefit to index — build output, package
// caches, VCS internals, and the OS's own churn.
const SKIP_DIRS = new Set([
  "node_modules", ".git", ".svn", ".hg", "__pycache__", ".venv", "venv", "env",
  ".next", ".nuxt", "dist", "build", "out", "target", ".gradle", ".m2",
  "AppData", "Application Data", "Library", "System Volume Information",
  "$RECYCLE.BIN", "Windows", "Program Files", "Program Files (x86)",
  ".cache", ".npm", ".yarn", ".pnpm-store", ".conda", "site-packages",
  "OneDriveTemp", ".Trash", ".local", "Recovery",
]);

const SKIP_EXT = new Set([".tmp", ".temp", ".lock", ".pyc", ".pyo", ".log", ".crdownload", ".part"]);

const MAX_DEPTH = 7;
const MAX_FILES = 80000;      // hard ceiling so a huge disk can't exhaust memory
const REINDEX_MS = 5 * 60 * 1000;

// What kind of thing is this? People look for "that PDF" or "the screenshot",
// not for a MIME type — so the buckets match how someone actually remembers a
// file, and the popup filters on exactly these.
const KIND_EXT = {
  image: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "heic", "avif", "tif", "tiff", "ico", "psd"],
  pdf: ["pdf"],
  doc: ["doc", "docx", "odt", "rtf", "txt", "md", "pages", "epub"],
  sheet: ["xls", "xlsx", "csv", "ods", "tsv"],
  slide: ["ppt", "pptx", "odp", "key"],
  video: ["mp4", "mkv", "mov", "avi", "webm", "m4v", "wmv", "flv"],
  audio: ["mp3", "wav", "flac", "m4a", "aac", "ogg", "wma"],
  code: ["js", "ts", "jsx", "tsx", "py", "java", "go", "rs", "rb", "php", "c", "cpp", "h", "hpp",
         "cs", "sh", "ps1", "sql", "html", "css", "scss", "vue", "svelte", "kt", "swift", "r", "ipynb"],
  data: ["json", "yaml", "yml", "toml", "ini", "env", "xml", "log", "db", "sqlite"],
  archive: ["zip", "rar", "7z", "tar", "gz", "xz", "bz2", "iso"],
  app: ["exe", "msi", "dmg", "appimage", "deb", "rpm", "apk", "bat", "cmd"],
};

const EXT_KIND = {};
for (const [kind, exts] of Object.entries(KIND_EXT)) {
  for (const e of exts) EXT_KIND[e] = kind;
}

function kindOf(name, isDir) {
  if (isDir) return "folder";
  const ext = path.extname(name).slice(1).toLowerCase();
  return EXT_KIND[ext] || "other";
}

// Filter chips in the popup. "doc" deliberately spans Word, text and markdown —
// to a person those are all "documents".
const GROUPS = {
  all: null,
  image: ["image"],
  pdf: ["pdf"],
  doc: ["doc", "slide"],
  sheet: ["sheet"],
  media: ["video", "audio"],
  code: ["code", "data"],
  folder: ["folder"],
};

let index = [];               // { name, lower, dir, path, mtime, size, isDir }
let indexing = false;
let lastIndexed = 0;
let roots = [];
let downloadsDir = null;

function setRoots(dirs, downloads) {
  roots = (dirs || []).filter(Boolean).filter((d) => {
    try { return fs.statSync(d).isDirectory(); } catch { return false; }
  });
  downloadsDir = downloads || null;
}

function walk(dir, depth, out, seen) {
  if (depth > MAX_DEPTH || out.length >= MAX_FILES) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // permission denied, or it vanished mid-walk — skip quietly
  }
  for (const e of entries) {
    if (out.length >= MAX_FILES) return;
    const name = e.name;
    if (name.startsWith(".") || name.startsWith("~$")) continue;
    const full = path.join(dir, name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(name)) continue;
      // Junctions/symlinks can loop back on themselves; a realpath seen-set is
      // the only reliable guard on Windows.
      let real;
      try { real = fs.realpathSync(full); } catch { continue; }
      if (seen.has(real)) continue;
      seen.add(real);
      out.push(entryFor(full, name, true, null));
      walk(full, depth + 1, out, seen);
    } else if (e.isFile()) {
      if (SKIP_EXT.has(path.extname(name).toLowerCase())) continue;
      out.push(entryFor(full, name, false, null));
    }
  }
}

function entryFor(full, name, isDir, st) {
  let mtime = 0;
  let size = 0;
  try {
    const s = st || fs.statSync(full);
    mtime = s.mtimeMs;
    size = s.size;
  } catch {}
  return {
    name,
    lower: name.toLowerCase(),
    dir: path.dirname(full),
    path: full,
    mtime,
    size,
    isDir,
    kind: kindOf(name, isDir),
  };
}

function reindex() {
  if (indexing) return;
  indexing = true;
  // setImmediate keeps the walk off the tick that triggered it, so opening the
  // spotlight never waits on a re-index that happens to fire at the same moment.
  setImmediate(() => {
    const out = [];
    const seen = new Set();
    for (const r of roots) {
      try { seen.add(fs.realpathSync(r)); } catch {}
      walk(r, 0, out, seen);
    }
    index = out;
    lastIndexed = Date.now();
    indexing = false;
  });
}

function ensureFresh() {
  if (!index.length && !indexing) reindex();
  else if (Date.now() - lastIndexed > REINDEX_MS) reindex();
}

// Downloads is the folder people check right after saving something, so it gets
// read live rather than waiting for the next background pass.
function readDownloads(limit = 40) {
  if (!downloadsDir) return [];
  let entries;
  try {
    entries = fs.readdirSync(downloadsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const ext = path.extname(e.name).toLowerCase();
    if (SKIP_EXT.has(ext)) continue; // hide half-finished browser downloads
    out.push(entryFor(path.join(downloadsDir, e.name), e.name, e.isDirectory(), null));
  }
  out.sort((a, b) => b.mtime - a.mtime);
  return out.slice(0, limit);
}

const BOUNDARY = " -_.()[]/,+&'";

// Score a filename against the query. Returns -1 for no match.
//
// Substring wins outright. The subsequence fallback (letters in order, gaps
// allowed) is what makes "rep.pdf" find "report.pdf" — but left unconstrained it
// also "finds" noads inside "…Visakhapatnam.xlsx", which is worse than no result
// at all. So a scattered match is rejected: the letters have to land in a tight
// span, and a match that doesn't start on a word boundary has to be tighter
// still. Queries under three characters skip the fallback entirely, since two
// letters appear in order in almost any long name.
function fuzzy(hay, needle) {
  const exact = hay.indexOf(needle);
  if (exact === 0) return 1000 - hay.length;            // prefix — the strongest signal
  if (exact > 0) {
    const prev = hay[exact - 1];
    return 700 - exact - hay.length * 0.1 + (BOUNDARY.includes(prev) ? 40 : 0);
  }
  if (needle.length < 3) return -1;

  let hi = 0;
  let score = 0;
  let run = 0;
  let first = -1;
  let last = -1;
  for (let ni = 0; ni < needle.length; ni++) {
    const c = needle[ni];
    let found = -1;
    while (hi < hay.length) {
      if (hay[hi] === c) { found = hi; hi++; break; }
      hi++;
    }
    if (found === -1) return -1;
    if (first === -1) first = found;
    last = found;
    const prev = found > 0 ? hay[found - 1] : " ";
    const boundary = BOUNDARY.includes(prev);
    run = found === hi - 1 && ni > 0 ? run + 1 : 0;
    score += 10 + run * 6 + (boundary ? 8 : 0);
  }

  const span = last - first + 1;
  if (span > needle.length * 3 + 6) return -1;          // letters too scattered to be meant
  const startsWord = first === 0 || BOUNDARY.includes(hay[first - 1]);
  if (!startsWord && span > needle.length * 2) return -1;

  // Rank below every substring hit, and penalise looseness.
  return Math.min(score, 600) - first * 0.5 - hay.length * 0.05 - (span - needle.length) * 4;
}

function recencyBoost(mtime) {
  if (!mtime) return 0;
  const days = (Date.now() - mtime) / 86400000;
  if (days < 1) return 120;
  if (days < 7) return 70;
  if (days < 30) return 35;
  if (days < 180) return 12;
  return 0;
}

const kindFilter = (group) => {
  const kinds = GROUPS[group];
  if (!kinds) return () => true;
  const set = new Set(kinds);
  return (it) => set.has(it.kind);
};

function search(query, limit = 25, group = "all") {
  ensureFresh();
  const q = (query || "").trim().toLowerCase();
  const keep = kindFilter(group);
  if (!q) return recent(limit, group);

  // Merge a live Downloads read into the index so a just-saved file is findable
  // before the next background pass picks it up.
  const pool = index.concat(readDownloads(60));
  const seenPath = new Set();
  const hits = [];
  for (const it of pool) {
    if (seenPath.has(it.path)) continue;
    seenPath.add(it.path);
    if (!keep(it)) continue;
    let s = fuzzy(it.lower, q);
    if (s < 0) continue;
    s += recencyBoost(it.mtime);
    if (downloadsDir && it.dir === downloadsDir) s += 25;
    // A file is usually what was meant — unless folders are what was asked for.
    if (it.isDir && group !== "folder") s -= 15;
    hits.push({ item: it, score: s });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit).map((h) => h.item);
}

// The empty-query view: what changed most recently, Downloads first.
function recent(limit = 25, group = "all") {
  ensureFresh();
  const keep = kindFilter(group);
  const dl = readDownloads(30).filter(keep);
  const seen = new Set(dl.map((d) => d.path));
  const rest = index
    .filter((i) => !seen.has(i.path) && i.mtime && keep(i) && (!i.isDir || group === "folder"))
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit);
  return dl.slice(0, 12).concat(rest).slice(0, limit);
}

// Counts per filter chip, so the popup can grey out empty ones instead of
// offering a tab that leads nowhere.
function counts(query) {
  ensureFresh();
  const out = {};
  for (const g of Object.keys(GROUPS)) out[g] = search(query, 999, g).length;
  return out;
}

function stats() {
  return { files: index.length, indexing, lastIndexed };
}

module.exports = { setRoots, reindex, search, recent, counts, readDownloads, stats, kindOf, GROUPS };
