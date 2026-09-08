// Desktop settings, stored as one small JSON file next to the app's data.
//
// The setting that matters here is where the contents of the user's files may
// live. It defaults to "off": reading someone's documents is not something to
// start doing because they installed a launcher. Quick Find works on filenames
// out of the box, and only reads inside files once the user has said yes.
const fs = require("fs");
const path = require("path");

// "off"   — filenames only. Nothing is read from inside any file. (default)
// "local" — file text is indexed ON THIS LAPTOP. Nothing is uploaded; only the
//           few snippets matching a question are sent, and only when asked.
// "cloud" — the same index, plus the user's account may store it server-side so
//           it follows them between machines.
const MODES = ["off", "local", "cloud"];

const DEFAULTS = {
  contentMode: "off",
  contentConsentAt: 0,   // when the user actually agreed; 0 means never asked
  indexRoots: null,      // null = the standard folders
};

let file = null;
let data = { ...DEFAULTS };

function init(userDataDir) {
  file = path.join(userDataDir, "settings.json");
  try {
    if (fs.existsSync(file)) {
      const raw = JSON.parse(fs.readFileSync(file, "utf8"));
      data = { ...DEFAULTS, ...raw };
      if (!MODES.includes(data.contentMode)) data.contentMode = "off";
    }
  } catch {
    data = { ...DEFAULTS };
  }
  return data;
}

function save() {
  if (!file) return;
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
  } catch {}
}

const get = () => ({ ...data });

function setContentMode(mode) {
  if (!MODES.includes(mode)) return get();
  data.contentMode = mode;
  // Record consent only when they turn reading ON — flipping back to "off"
  // shouldn't look like a fresh agreement if they later turn it on again.
  if (mode !== "off") data.contentConsentAt = Date.now();
  save();
  return get();
}

module.exports = { init, get, setContentMode, save, MODES };
