// Full-text index over the CONTENTS of local files — the thing that turns Quick
// Find from "find a filename" into "find what I actually wrote".
//
// WHY THIS IS LOCAL-ONLY, AND WHY THERE ARE NO EMBEDDINGS
//   Embeddings would mean shipping the text of every document to somebody's
//   API before the user has asked a question. That is exactly the trade this
//   product refuses to make silently. So retrieval runs entirely on the laptop
//   using BM25 — a plain ranking function, no model, no network, no account —
//   and only the handful of snippets that actually match a question are ever
//   sent anywhere, and only when the user asks a question.
//
//   That is still retrieval-augmented generation: the retrieval is local, the
//   generation uses only what retrieval found.
//
// WHAT GETS READ
//   Text-shaped files only, under a size cap. Binary formats (PDF, Office) are
//   not parsed here — see extractors.js — and anything unreadable is skipped
//   silently rather than failing an indexing pass.
const fs = require("fs");
const path = require("path");
const { extractText, isExtractable } = require("./extractors");

const MAX_BYTES = 4 * 1024 * 1024;   // skip anything huge; the tail is rarely the point
const CHUNK = 900;                   // characters — roughly a paragraph or two
const OVERLAP = 150;                 // so a sentence split across a boundary still matches
const MAX_DOCS = 6000;
const MAX_CHUNKS = 60000;

// Words carrying no discriminating power. Kept short on purpose: an aggressive
// stop list hurts phrase-ish queries more than it helps.
const STOP = new Set(
  ("a an and are as at be but by for from has have he i in is it its of on or that the to was were will with you your this "
   + "we they them our their what which when where who how").split(" ")
);

const tokenize = (s) =>
  (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s._-]/g, " ")
    .split(/[\s._-]+/)
    .filter((t) => t.length > 1 && t.length < 40 && !STOP.has(t));

let docs = [];            // { id, path, name, mtime, size, kind }
let chunks = [];          // { docId, text, len }
let postings = new Map(); // token -> Map(chunkIdx -> termFreq)
let docFreq = new Map();  // token -> number of chunks containing it
let avgLen = 1;
let building = false;
let lastBuilt = 0;
let statePath = null;
let enabled = false;

function setStatePath(p) {
  statePath = p;
}

function setEnabled(v) {
  enabled = !!v;
  if (!enabled) clear();
}

function clear() {
  docs = [];
  chunks = [];
  postings = new Map();
  docFreq = new Map();
  avgLen = 1;
  lastBuilt = 0;
  try {
    if (statePath && fs.existsSync(statePath)) fs.unlinkSync(statePath);
  } catch {}
}

function chunkText(text) {
  const out = [];
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return out;
  for (let i = 0; i < clean.length && out.length < 400; i += CHUNK - OVERLAP) {
    const piece = clean.slice(i, i + CHUNK);
    if (piece.trim().length > 40) out.push(piece);
    if (i + CHUNK >= clean.length) break;
  }
  return out;
}

function addDocument(file, text) {
  const pieces = chunkText(text);
  if (!pieces.length) return;
  const docId = docs.length;
  docs.push({
    id: docId,
    path: file.path,
    name: file.name,
    mtime: file.mtime,
    size: file.size,
    kind: file.kind,
  });
  for (const piece of pieces) {
    if (chunks.length >= MAX_CHUNKS) return;
    const idx = chunks.length;
    const toks = tokenize(piece);
    chunks.push({ docId, text: piece, len: toks.length || 1 });
    const seen = new Set();
    for (const t of toks) {
      let m = postings.get(t);
      if (!m) { m = new Map(); postings.set(t, m); }
      m.set(idx, (m.get(idx) || 0) + 1);
      if (!seen.has(t)) {
        seen.add(t);
        docFreq.set(t, (docFreq.get(t) || 0) + 1);
      }
    }
  }
}

// Build from a list of file entries (as produced by file-search.js).
async function build(files, onProgress) {
  if (!enabled || building) return;
  building = true;
  try {
    docs = [];
    chunks = [];
    postings = new Map();
    docFreq = new Map();

    const candidates = files
      .filter((f) => !f.isDir && f.size > 0 && f.size <= MAX_BYTES && isExtractable(f.name))
      .sort((a, b) => b.mtime - a.mtime)     // recent files matter most
      .slice(0, MAX_DOCS);

    let done = 0;
    for (const f of candidates) {
      try {
        const text = await extractText(f.path, f.name);
        if (text) addDocument(f, text);
      } catch {
        // A single unreadable file must never abort the pass.
      }
      if (++done % 200 === 0) {
        onProgress && onProgress(done, candidates.length);
        // Yield so the UI thread and the hotkey stay responsive during a build.
        await new Promise((r) => setImmediate(r));
      }
      if (chunks.length >= MAX_CHUNKS) break;
    }

    avgLen = chunks.length
      ? chunks.reduce((a, c) => a + c.len, 0) / chunks.length
      : 1;
    lastBuilt = Date.now();
    save();
  } finally {
    building = false;
  }
}

// BM25. k1 controls how fast term frequency saturates, b how much long chunks
// are penalised; these are the standard defaults and behave well here.
const K1 = 1.4;
const B = 0.75;

function search(query, limit = 6) {
  if (!enabled || !chunks.length) return [];
  const terms = tokenize(query);
  if (!terms.length) return [];
  const N = chunks.length;
  const scores = new Map();

  for (const t of terms) {
    const m = postings.get(t);
    if (!m) continue;
    const df = docFreq.get(t) || 1;
    // +0.5/+0.5 smoothing keeps the idf of a very common term at zero rather
    // than negative, so a stopword-ish term can't push results downward.
    const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
    for (const [idx, tf] of m) {
      const len = chunks[idx].len;
      const norm = tf * (K1 + 1) / (tf + K1 * (1 - B + B * (len / avgLen)));
      scores.set(idx, (scores.get(idx) || 0) + idf * norm);
    }
  }
  if (!scores.size) return [];

  // One hit per document: five chunks from the same file is not five answers.
  const best = new Map();
  for (const [idx, s] of scores) {
    const d = chunks[idx].docId;
    if (!best.has(d) || best.get(d).score < s) best.set(d, { idx, score: s });
  }

  return [...best.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, limit)
    .map(([docId, { idx, score }]) => ({
      file: docs[docId],
      snippet: chunks[idx].text,
      score,
    }));
}

function save() {
  if (!statePath || !enabled) return;
  try {
    // Only the raw material is persisted; the postings are rebuilt on load,
    // because serialising nested Maps costs more than recomputing them.
    fs.writeFileSync(
      statePath,
      JSON.stringify({ v: 1, builtAt: lastBuilt, docs, chunks }),
      "utf8"
    );
  } catch {}
}

function load() {
  if (!statePath || !enabled) return false;
  try {
    if (!fs.existsSync(statePath)) return false;
    const raw = JSON.parse(fs.readFileSync(statePath, "utf8"));
    if (raw.v !== 1 || !Array.isArray(raw.chunks)) return false;
    docs = raw.docs || [];
    chunks = raw.chunks || [];
    postings = new Map();
    docFreq = new Map();
    chunks.forEach((c, idx) => {
      const toks = tokenize(c.text);
      const seen = new Set();
      for (const t of toks) {
        let m = postings.get(t);
        if (!m) { m = new Map(); postings.set(t, m); }
        m.set(idx, (m.get(idx) || 0) + 1);
        if (!seen.has(t)) {
          seen.add(t);
          docFreq.set(t, (docFreq.get(t) || 0) + 1);
        }
      }
    });
    avgLen = chunks.length ? chunks.reduce((a, c) => a + c.len, 0) / chunks.length : 1;
    lastBuilt = raw.builtAt || 0;
    return true;
  } catch {
    return false;
  }
}

const stats = () => ({
  enabled,
  building,
  documents: docs.length,
  chunks: chunks.length,
  lastBuilt,
});

module.exports = { setStatePath, setEnabled, build, search, save, load, clear, stats };
