// Pulling readable text out of local files, using nothing but Node's built-ins.
//
// WHY NO LIBRARY
//   Every parser added here is code that runs over the user's private documents
//   and ships in the installer. Node already has zlib, which is all that PDF and
//   the Office formats actually need: a PDF page is a Flate-compressed stream,
//   and a .docx is a zip of XML. Extraction is best-effort by design — a file we
//   cannot read is skipped, never guessed at.
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const TEXT_EXT = new Set([
  "txt", "md", "markdown", "csv", "tsv", "json", "yaml", "yml", "toml", "ini",
  "log", "xml", "html", "htm", "css", "scss", "js", "jsx", "ts", "tsx", "py",
  "java", "go", "rs", "rb", "php", "c", "cpp", "h", "hpp", "cs", "sh", "ps1",
  "sql", "vue", "svelte", "kt", "swift", "r", "env", "cfg", "conf", "rst",
]);

const BINARY_EXT = new Set(["pdf", "docx", "pptx", "xlsx"]);

// Machine-written files. They are text, and they are enormous, and they mention
// half of npm — so they match almost any query while answering none of them.
// (A search for "database schema tables" surfaced package-lock.json above the
// actual slide deck about database schemas, purely on package names.) Nobody
// searches for what they wrote in a lockfile, so they stay out of the index.
const NOISE = [
  /^package-lock\.json$/i,
  /^yarn\.lock$/i,
  /^pnpm-lock\.yaml$/i,
  /^poetry\.lock$/i,
  /^composer\.lock$/i,
  /^Cargo\.lock$/i,
  /\.min\.(js|css)$/i,
  /\.map$/i,
  /^\.?eslintcache$/i,
  /^tsconfig\.tsbuildinfo$/i,
];

const extOf = (name) => path.extname(name).slice(1).toLowerCase();

const isNoise = (name) => NOISE.some((re) => re.test(name));

const isExtractable = (name) => {
  if (isNoise(name)) return false;
  const e = extOf(name);
  return TEXT_EXT.has(e) || BINARY_EXT.has(e);
};

// ---------------------------------------------------------------------------
// Plain text
// ---------------------------------------------------------------------------
async function readTextFile(file) {
  const buf = await fs.promises.readFile(file);
  // A NUL byte in the first block means this isn't really text, whatever the
  // extension claims — bail rather than indexing mojibake.
  const head = buf.subarray(0, 1024);
  if (head.includes(0)) return "";
  let text = buf.toString("utf8");
  if (extOf(file) === "html" || extOf(file) === "htm") {
    text = text
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ");
  }
  return text;
}

// ---------------------------------------------------------------------------
// ZIP (docx / pptx / xlsx are all zip containers)
// Minimal reader: walks the central directory, inflates the entries we want.
// ---------------------------------------------------------------------------
function readZipEntries(buf, wanted) {
  const out = {};
  // End of central directory record — scan backwards for its signature.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return out;

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);

  for (let i = 0; i < count && p + 46 <= buf.length; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;

    if (!wanted(name)) continue;
    // The local header repeats the name/extra lengths; the data starts after it.
    if (buf.readUInt32LE(localOff) !== 0x04034b50) continue;
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const data = buf.subarray(start, start + compSize);
    try {
      out[name] = method === 0 ? data : zlib.inflateRawSync(data);
    } catch {
      /* a corrupt entry shouldn't lose the rest of the file */
    }
  }
  return out;
}

const stripXml = (xml) =>
  xml
    // Keep paragraph and row breaks as spaces so words don't fuse together.
    .replace(/<\/(w:p|a:p|w:tr|row)>/g, " \n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");

async function readOfficeFile(file) {
  const buf = await fs.promises.readFile(file);
  const ext = extOf(file);
  let want;
  if (ext === "docx") want = (n) => n === "word/document.xml";
  else if (ext === "pptx") want = (n) => /^ppt\/slides\/slide\d+\.xml$/.test(n);
  else if (ext === "xlsx") want = (n) => n === "xl/sharedStrings.xml";
  else return "";

  const entries = readZipEntries(buf, want);
  const parts = Object.keys(entries)
    .sort()
    .map((k) => stripXml(entries[k].toString("utf8")));
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// PDF
// Text lives in content streams, usually Flate-compressed, as show-text
// operators: (literal) Tj  and  [(a) -2 (b)] TJ.
// ---------------------------------------------------------------------------
function decodePdfString(s) {
  return s
    .replace(/\\([nrtbf])/g, (_, c) =>
      ({ n: "\n", r: "\n", t: " ", b: "", f: " " }[c] || " "))
    .replace(/\\([0-7]{1,3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)))
    .replace(/\\(.)/g, "$1");
}

function textFromPdfStream(str) {
  let out = "";
  // [(chunk) n (chunk)] TJ — kerned runs
  const tjArrays = str.match(/\[((?:[^\[\]\\]|\\.)*)\]\s*TJ/g) || [];
  for (const arr of tjArrays) {
    const lits = arr.match(/\(((?:[^()\\]|\\.)*)\)/g) || [];
    for (const l of lits) out += decodePdfString(l.slice(1, -1));
    out += " ";
  }
  // (chunk) Tj — plain runs
  const tj = str.match(/\(((?:[^()\\]|\\.)*)\)\s*Tj/g) || [];
  for (const l of tj) {
    const m = l.match(/\(((?:[^()\\]|\\.)*)\)/);
    if (m) out += decodePdfString(m[1]) + " ";
  }
  return out;
}

async function readPdfFile(file) {
  const buf = await fs.promises.readFile(file);
  let text = "";
  let pos = 0;
  // Walk stream ... endstream pairs; inflate the ones that are compressed.
  while (text.length < 400000) {
    const s = buf.indexOf("stream", pos);
    if (s < 0) break;
    const e = buf.indexOf("endstream", s);
    if (e < 0) break;
    let start = s + 6;
    if (buf[start] === 0x0d) start++;
    if (buf[start] === 0x0a) start++;
    const raw = buf.subarray(start, e);
    pos = e + 9;
    let body = null;
    try {
      body = zlib.inflateSync(raw);
    } catch {
      // Not Flate (or damaged) — only worth reading raw if it looks like text.
      if (raw.length < 200000 && !raw.subarray(0, 200).includes(0)) body = raw;
    }
    if (!body) continue;
    const str = body.toString("latin1");
    if (str.includes("Tj") || str.includes("TJ")) text += textFromPdfStream(str) + "\n";
  }
  return text;
}

// ---------------------------------------------------------------------------
async function extractText(file, name = file) {
  const e = extOf(name);
  let text = "";
  if (TEXT_EXT.has(e)) text = await readTextFile(file);
  else if (e === "pdf") text = await readPdfFile(file);
  else if (e === "docx" || e === "pptx" || e === "xlsx") text = await readOfficeFile(file);
  if (!text) return "";
  // Collapse whitespace and cap: past this point a document contributes noise,
  // not signal, and the index has to stay small enough to hold in memory.
  return text.replace(/\s+/g, " ").trim().slice(0, 200000);
}

module.exports = { extractText, isExtractable, isNoise, TEXT_EXT, BINARY_EXT };
