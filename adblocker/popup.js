const dot = document.getElementById("dot");
const statusText = document.getElementById("statusText");
const toggle = document.getElementById("toggle");

function paint(paused) {
  dot.classList.toggle("off", paused);
  statusText.textContent = paused ? "Paused" : "Blocking is on";
  toggle.textContent = paused ? "Resume blocking" : "Pause on this browser";
  toggle.classList.toggle("paused", paused);
}

chrome.storage.local.get("paused", (r) => paint(r.paused === true));

toggle.onclick = () => {
  chrome.storage.local.get("paused", (r) => {
    const next = !(r.paused === true);
    chrome.storage.local.set({ paused: next }, () => paint(next));
  });
};
