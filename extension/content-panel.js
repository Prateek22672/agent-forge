// AgentFury — the sliding assistant drawer. Toggled by clicking the toolbar
// icon (background.js relays "AF_TOGGLE_PANEL" here). Docked to the right
// edge of the page and slides in/out horizontally — a real slider, not a
// popup that just fades in. The full app UI (Ask/Priority/Drafts/Remind/
// Settings) loads inside an iframe pointing at the extension's own
// sidepanel.html, so it's 100% the same app, just in this container — and it
// stays open while you browse instead of closing the instant it loses focus.
(function () {
  let panel = null;
  let closing = false;

  function closePanel() {
    if (!panel || closing) return;
    closing = true;
    panel.classList.remove("af-in"); // slides back out to the right
    panel.addEventListener(
      "transitionend",
      () => {
        panel?.remove();
        panel = null;
        closing = false;
      },
      { once: true }
    );
    // Fallback in case transitionend doesn't fire (e.g. panel removed mid-drag).
    setTimeout(() => {
      if (panel) {
        panel.remove();
        panel = null;
        closing = false;
      }
    }, 400);
  }

  function openPanel() {
    if (panel) return;
    panel = document.createElement("div");
    panel.className = "af-float-panel";
    panel.innerHTML = `
      <div class="af-float-head">
        <span class="af-float-title">AGENTFURY</span>
        <div class="af-float-actions">
          <button type="button" class="af-float-btn af-float-close" title="Close">×</button>
        </div>
      </div>
      <iframe class="af-float-frame" src="${chrome.runtime.getURL("sidepanel.html")}"></iframe>
    `;
    document.body.appendChild(panel);
    // Force layout so the initial (off-screen) transform is committed before
    // we add .af-in — otherwise the browser may skip straight to the end
    // state instead of animating the slide.
    void panel.offsetWidth;
    requestAnimationFrame(() => panel.classList.add("af-in"));

    panel.querySelector(".af-float-close").onclick = closePanel;
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

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && panel) closePanel();
  });
})();
