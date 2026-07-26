// Experiment 2 — record a self-initiated screen share to a downloadable file,
// with an optional auto-hide of the overlay while capturing.
//
// The point is empirical proof: run it once with auto-hide OFF (overlay appears
// in the saved video) and once with auto-hide ON (overlay is absent because it
// was removed). Two .webm files you can play back and submit.
//
// This is an extension page, so it can flip the same `af_privacy_mode` flag the
// content scripts watch. Scope note, on purpose: it reacts ONLY to the capture
// started by the button here. It is not — and cannot be — a detector for OBS /
// Game Bar / proctoring clients, because no browser API reports a capture
// initiated by another application.

const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const autoHide = document.getElementById("autoHide");
const capState = document.getElementById("capState");
const pmState = document.getElementById("pmState");
const dot = document.getElementById("dot");
const logEl = document.getElementById("log");
const downloadRow = document.getElementById("downloadRow");

let activeStream = null;
let recorder = null;
let chunks = [];
let usedAutoHide = false;
let runCount = 0;

function log(line) {
  const t = new Date().toLocaleTimeString();
  logEl.textContent += `[${t}] ${line}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

function reflectPrivacy(on) {
  pmState.textContent = on ? "ON (overlay hidden everywhere)" : "off";
}
chrome.storage.local.get("af_privacy_mode", (r) => reflectPrivacy(r.af_privacy_mode === true));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && "af_privacy_mode" in changes) {
    reflectPrivacy(changes.af_privacy_mode.newValue === true);
  }
});

function setCaptureActive(active) {
  capState.textContent = active ? "RECORDING" : "idle";
  dot.classList.toggle("on", active);
  startBtn.disabled = active;
  stopBtn.disabled = !active;
  autoHide.disabled = active;
}

function saveRecording() {
  if (!chunks.length) {
    log("No video data captured.");
    return;
  }
  const blob = new Blob(chunks, { type: "video/webm" });
  const url = URL.createObjectURL(blob);
  runCount += 1;
  const label = usedAutoHide ? "auto-hide" : "baseline";
  const name = `agentfury-capture-${runCount}-${label}.webm`;

  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.textContent = `⬇ Download ${name} (${label})`;
  a.style.display = "inline-block";
  a.style.margin = "6px 0";
  a.style.color = "#f5c542";
  const wrap = document.createElement("div");
  wrap.appendChild(a);
  downloadRow.appendChild(wrap);

  // Auto-trigger the save too, so the file lands in Downloads without a second click.
  a.click();
  log(`Saved ${name} — play it back to see whether the overlay appears.`);
}

startBtn.onclick = async () => {
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    activeStream = stream;
    usedAutoHide = autoHide.checked;

    const track = stream.getVideoTracks()[0];
    const surface = track.getSettings().displaySurface || "unknown";
    setCaptureActive(true);
    log(`Capture started — surface: ${surface} — mode: ${usedAutoHide ? "auto-hide (Run B)" : "baseline (Run A)"}`);

    if (usedAutoHide) {
      chrome.storage.local.set({ af_privacy_mode: true });
      log("Auto-hide ON → af_privacy_mode = true, overlay unmounts on all tabs");
    } else {
      log("Baseline → overlay left visible; it should appear in the video");
    }

    // Record the shared stream to memory, then save on stop.
    chunks = [];
    recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    recorder.onstop = () => {
      saveRecording();
      if (usedAutoHide) chrome.storage.local.set({ af_privacy_mode: false });
    };
    recorder.start();

    // If the user stops via Chrome's own "Stop sharing" bar, finalize too.
    track.addEventListener("ended", () => {
      log("Capture ended (stopped from Chrome's sharing bar)");
      if (recorder && recorder.state !== "inactive") recorder.stop();
      activeStream = null;
      setCaptureActive(false);
    });
  } catch (err) {
    log(`getDisplayMedia declined/failed: ${err.name}`);
  }
};

stopBtn.onclick = () => {
  log("Stop pressed — finalizing video");
  if (recorder && recorder.state !== "inactive") recorder.stop();
  if (activeStream) {
    activeStream.getTracks().forEach((t) => t.stop());
    activeStream = null;
  }
  setCaptureActive(false);
};
