// AgentFury — the floating assistant panel (Monica/Grammarly-style). Toggled
// by clicking the toolbar icon (background.js relays "AF_TOGGLE_PANEL" here).
// A draggable card injected directly into the page, with the full app UI
// (Ask/Priority/Drafts/Remind/Settings) loaded inside an iframe pointing at
// the extension's own sidepanel.html — so it's 100% the same app, just in a
// floating window instead of the browser's dropdown popup, and it stays open
// while you browse instead of closing the instant it loses focus.
(function () {
  let panel = null;

  function closePanel() {
    if (panel) {
      panel.remove();
      panel = null;
    }
  }

  function openPanel() {
    if (panel) return;
    panel = document.createElement("div");
    panel.className = "af-float-panel";
    panel.innerHTML = `
      <div class="af-float-head">
        <span class="af-float-title">AGENTFURY</span>
        <div class="af-float-actions">
          <button type="button" class="af-float-btn af-float-min" title="Minimize">—</button>
          <button type="button" class="af-float-btn af-float-close" title="Close">×</button>
        </div>
      </div>
      <iframe class="af-float-frame" src="${chrome.runtime.getURL("sidepanel.html")}"></iframe>
    `;
    document.body.appendChild(panel);
    requestAnimationFrame(() => panel.classList.add("af-in"));

    panel.querySelector(".af-float-close").onclick = closePanel;
    panel.querySelector(".af-float-min").onclick = () => {
      panel.classList.toggle("af-minimized");
    };

    makeDraggable(panel, panel.querySelector(".af-float-head"));
  }

  function makeDraggable(el, handle) {
    let sx = 0,
      sy = 0,
      ox = 0,
      oy = 0,
      dragging = false;
    handle.addEventListener("mousedown", (e) => {
      // Don't start a drag from the action buttons themselves.
      if (e.target.closest(".af-float-btn")) return;
      dragging = true;
      sx = e.clientX;
      sy = e.clientY;
      const rect = el.getBoundingClientRect();
      ox = rect.left;
      oy = rect.top;
      el.classList.add("af-dragging");
      e.preventDefault();
    });
    document.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      const nx = ox + (e.clientX - sx);
      const ny = oy + (e.clientY - sy);
      el.style.left = `${Math.max(0, Math.min(nx, window.innerWidth - 60))}px`;
      el.style.top = `${Math.max(0, Math.min(ny, window.innerHeight - 40))}px`;
      el.style.right = "auto";
    });
    document.addEventListener("mouseup", () => {
      dragging = false;
      el.classList.remove("af-dragging");
    });
  }

  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === "AF_TOGGLE_PANEL") {
        if (panel) closePanel();
        else openPanel();
      }
    });
  } catch {
    /* extension context not ready on this tab yet */
  }
})();
