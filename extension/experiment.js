// Experiment 2 — auto-hide during a self-initiated screen share.
//
// This is an extension page (chrome-extension://<id>/experiment.html), so it has
// full chrome.* access and can flip the same `af_privacy_mode` flag the content
// scripts already watch via chrome.storage.onChanged. Starting a share sets it
// on (overlay unmounts on every tab); the track's `ended` event sets it back off.
//
// Scope note, on purpose: this reacts ONLY to the capture started by the button
// below. It is not — and cannot be — a detector for OBS / Game Bar / proctoring
// clients, because no browser API reports capture initiated by another app.

const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const capState = document.getElementById("capState");
const pmState = document.getElementById("pmState");
const dot = document.getElementById("dot");
const logEl = document.getElementById("log");

let activeStream = null;

function log(line) {
  const t = new Date().toLocaleTimeString();
  logEl.textContent += `[${t}] ${line}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

function reflectPrivacy(on) {
  pmState.textContent = on ? "ON (overlay hidden everywhere)" : "off";
}

// Keep the readout honest if the flag is changed from elsewhere (Settings, shortcut).
chrome.storage.local.get("af_privacy_mode", (r) => reflectPrivacy(r.af_privacy_mode === true));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && "af_privacy_mode" in changes) {
    reflectPrivacy(changes.af_privacy_mode.newValue === true);
  }
});

function setCaptureActive(active) {
  capState.textContent = active ? "ACTIVE" : "idle";
  dot.classList.toggle("on", active);
  startBtn.disabled = active;
  stopBtn.disabled = !active;
}

function stopShare() {
  if (activeStream) {
    activeStream.getTracks().forEach((t) => t.stop());
    activeStream = null;
  }
}

startBtn.onclick = async () => {
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    activeStream = stream;
    const track = stream.getVideoTracks()[0];
    const surface = track.getSettings().displaySurface || "unknown";
    setCaptureActive(true);
    log(`Capture started — surface: ${surface}`);

    // The privacy trigger: capture began, so hide the overlay everywhere.
    chrome.storage.local.set({ af_privacy_mode: true });
    log("Set af_privacy_mode = true → overlay unmounts on all tabs");

    // 'ended' fires when the user clicks Chrome's "Stop sharing" bar, or when we
    // call track.stop() ourselves. Restore the overlay either way.
    track.addEventListener("ended", () => {
      activeStream = null;
      setCaptureActive(false);
      log("Capture ended → restoring overlay");
      chrome.storage.local.set({ af_privacy_mode: false });
    });
  } catch (err) {
    log(`getDisplayMedia declined/failed: ${err.name}`);
  }
};

stopBtn.onclick = () => {
  log("Stop pressed");
  stopShare();
};
