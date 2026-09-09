// Turning a sentence into a file operation — the part that makes Quick Find an
// agent rather than a search box.
//
// TWO RULES, BOTH LOAD-BEARING
//
// 1. NOTHING RUNS WITHOUT CONFIRMATION. Every plan is returned for the user to
//    look at first — which files, where they'll go, how many. A search that
//    guesses wrong shows you the wrong list; an action that guesses wrong
//    rearranges your disk. The preview is the whole safety model.
//
// 2. NOTHING IS DESTROYED. The supported verbs copy; they never move, delete or
//    overwrite. Originals stay exactly where they were, and a name collision
//    gets a numbered suffix rather than clobbering the file that's there. If a
//    plan is wrong, the worst outcome is a folder you delete.
//
// Parsing is local and deterministic on purpose. "Copy my resumes to the
// desktop" should not depend on a network round-trip, and it should do the same
// thing every time — an LLM that occasionally picks a different folder is worse
// than no feature.
const fs = require("fs");
const path = require("path");

// Verbs that mean "gather these files somewhere", spelled the several ways
// people actually say it.
const ACTION_RE =
  /\b(create|make|new)\s+(a\s+)?(new\s+)?folder\b|\b(copy|collect|gather|group|put|move|organi[sz]e)\b/i;
// Stops at a preposition. In "a folder called Papers on the desktop" the name is
// "Papers" and everything after "on" is the destination — a greedy match named
// the folder "Papers on the desktop".
const FOLDER_NAME_RE =
  /\b(?:folder|directory)\s+(?:called|named)\s+["']?([\w -]{1,40}?)["']?(?=\s+(?:on|in|at|to|under|inside)\b|[,.]|$)/i;

// Where the result should land. "Move" is listed so the sentence still parses,
// but it is executed as a copy — see rule 2.
const DESTS = [
  [/\bdesktop\b/i, "desktop"],
  [/\bdocuments?\b/i, "documents"],
  [/\bdownloads?\b/i, "downloads"],
];

// Words that carry no signal about WHICH files are meant. Includes the common
// misspellings of "copying", because a typo in an instruction should not turn
// into a search term — "coping resumes" found nothing, since no file is named
// "coping".
const NOISE = new Set(
  ("create make new a an the my all of them into in to on at and folder directory called named " +
   "copy copying coping copied collect collecting gather gathering group grouping put putting " +
   "move moving organise organize organising organizing keep keeping place placing placed only " +
   "please files file everything every each here there that this those these with for from " +
   "one single same together also as well")
    .split(" ")
);

// Extension words → the kind filter Quick Find already understands.
const KIND_WORDS = {
  resume: null, // a topic, not a kind — matched by name instead
  pdf: "pdf", pdfs: "pdf",
  image: "image", images: "image", photo: "image", photos: "image", screenshot: "image", screenshots: "image",
  doc: "doc", docs: "doc", document: "doc", documents: "doc",
  sheet: "sheet", sheets: "sheet", spreadsheet: "sheet", spreadsheets: "sheet", excel: "sheet",
  video: "media", videos: "media", music: "media", audio: "media",
  code: "code", script: "code", scripts: "code",
};

const titleCase = (s) =>
  s.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());

function looksLikeAction(q) {
  return ACTION_RE.test(q || "");
}

// Build a plan. Returns null when the sentence isn't an action, so the caller
// can fall through to ordinary search.
function plan(query, { search, homePaths }) {
  const q = (query || "").trim();
  if (!q || !looksLikeAction(q)) return null;

  // Destination — default to Desktop, which is what "put it somewhere I can see
  // it" almost always means.
  let destKey = "desktop";
  for (const [re, key] of DESTS) {
    if (re.test(q)) { destKey = key; break; }
  }
  const destRoot = homePaths[destKey];
  if (!destRoot) return null;

  // An explicit folder name is pulled out FIRST and removed from the sentence.
  // Left in, "a folder called Papers" makes "papers" a search term and the plan
  // looks for files named Papers, which is not what was asked at all.
  const named = q.match(FOLDER_NAME_RE);
  const withoutName = named ? q.replace(named[0], " ") : q;

  // Subject: what's left once the instruction words are removed.
  const words = withoutName.toLowerCase().replace(/[^\w\s-]/g, " ").split(/\s+/).filter(Boolean);
  const subject = words.filter((w) => !NOISE.has(w) && !DESTS.some(([re]) => re.test(w)));
  if (!subject.length) return null;

  // A kind word narrows the filter; the rest describes the name.
  let kind = "all";
  const nameParts = [];
  const spoken = []; // the user's own words, kept for naming the folder
  for (const w of subject) {
    spoken.push(w);
    if (Object.prototype.hasOwnProperty.call(KIND_WORDS, w)) {
      if (KIND_WORDS[w]) kind = KIND_WORDS[w];
      else nameParts.push(w); // e.g. "resume" — a topic, matched by name
    } else {
      nameParts.push(w);
    }
  }

  // Match on ANY subject word, not all of them together. People pluralise when
  // they mean the set ("my resumes") while the files are singular
  // ("Prateek_Resume_Updated"), so a combined query matches nothing. Each term
  // is tried on its own and singularised, and the results are unioned.
  const seen = new Set();
  let matches = [];
  const terms = nameParts.length ? nameParts : [];
  for (const t of terms) {
    const variants = t.endsWith("s") && t.length > 3 ? [t, t.slice(0, -1)] : [t];
    for (const v of variants) {
      for (const f of search(v, 400, kind) || []) {
        if (f.isDir || seen.has(f.path)) continue;
        seen.add(f.path);
        matches.push(f);
      }
    }
  }
  // "copy my screenshots" with no usable name term — fall back to the kind alone.
  if (!terms.length && kind !== "all") {
    matches = (search("", 400, kind) || []).filter((f) => !f.isDir);
  }

  const nameQuery = nameParts.join(" ");
  if (!matches.length) {
    return { ok: false, reason: `Nothing on this laptop matches “${nameQuery || kind}”.` };
  }
  matches.sort((a, b) => b.mtime - a.mtime);

  // Name it after what was said, not after the filter it resolved to:
  // "screenshots" is a better folder than "Image".
  const folderName = named
    ? named[1].trim()
    : titleCase(spoken.join(" ")) || titleCase(kind) || "Collected";

  return {
    ok: true,
    op: "copy",
    folderName,
    destRoot,
    destPath: path.join(destRoot, folderName),
    kind,
    nameQuery,
    files: matches.map((f) => ({ name: f.name, path: f.path, size: f.size })),
  };
}

// A destination that doesn't collide with something already there.
function uniqueDir(base) {
  if (!fs.existsSync(base)) return base;
  for (let i = 2; i < 200; i++) {
    const c = `${base} (${i})`;
    if (!fs.existsSync(c)) return c;
  }
  return `${base} (${Date.now()})`;
}

function uniqueFile(dir, name) {
  let target = path.join(dir, name);
  if (!fs.existsSync(target)) return target;
  const ext = path.extname(name);
  const stem = path.basename(name, ext);
  for (let i = 2; i < 500; i++) {
    target = path.join(dir, `${stem} (${i})${ext}`);
    if (!fs.existsSync(target)) return target;
  }
  return path.join(dir, `${stem} (${Date.now()})${ext}`);
}

async function execute(p) {
  if (!p || p.op !== "copy" || !Array.isArray(p.files) || !p.files.length) {
    return { ok: false, error: "Nothing to do." };
  }
  const dir = uniqueDir(p.destPath);
  try {
    await fs.promises.mkdir(dir, { recursive: true });
  } catch (e) {
    return { ok: false, error: "Couldn't create that folder." };
  }

  let copied = 0;
  const failed = [];
  for (const f of p.files) {
    try {
      // COPY, never rename: the original has to survive a wrong guess.
      await fs.promises.copyFile(f.path, uniqueFile(dir, f.name));
      copied++;
    } catch {
      failed.push(f.name);
    }
  }
  return { ok: true, folder: dir, copied, failed: failed.slice(0, 5), failedCount: failed.length };
}

module.exports = { looksLikeAction, plan, execute };
