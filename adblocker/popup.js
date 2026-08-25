let host = "";
let segScope = "site"; // "site" | "all"

const $ = (id) => document.getElementById(id);

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

async function currentHost() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return { host: hostOf(tab && tab.url), url: tab && tab.url };
  } catch {
    return { host: "", url: "" };
  }
}

function renderBreakdown(per) {
  const el = $("breakdown");
  const entries = Object.entries(per || {}).sort((a, b) => b[1] - a[1]).slice(0, 6);
  if (!entries.length) {
    el.innerHTML = `<div class="empty">Nothing yet — browse a bit.</div>`;
    return;
  }
  el.innerHTML = entries
    .map(
      ([d, c]) =>
        `<div class="brk-row"><span class="d">${d.replace(/</g, "&lt;")}</span><span class="c">${c.toLocaleString()}</span></div>`
    )
    .join("");
}

async function renderRules() {
  const { customAll = [], customSite = {} } = await chrome.storage.local.get(["customAll", "customSite"]);
  const rules = [];
  customAll.forEach((s) => rules.push({ scope: "all", sel: s }));
  (customSite[host] || []).forEach((s) => rules.push({ scope: host, sel: s, site: true }));
  const el = $("rules");
  if (!rules.length) {
    el.innerHTML = "";
    return;
  }
  el.innerHTML = rules
    .map(
      (r, i) =>
        `<div class="rule"><span class="scope">${r.site ? "this site" : "all"}</span><span class="sel">${r.sel.replace(/</g, "&lt;")}</span><span class="x" data-i="${i}" data-site="${!!r.site}" data-sel="${encodeURIComponent(r.sel)}">✕</span></div>`
    )
    .join("");
  el.querySelectorAll(".x").forEach((x) => {
    x.onclick = async () => {
      const sel = decodeURIComponent(x.dataset.sel);
      const store = await chrome.storage.local.get(["customAll", "customSite"]);
      if (x.dataset.site === "true") {
        const cs = store.customSite || {};
        cs[host] = (cs[host] || []).filter((s) => s !== sel);
        await chrome.storage.local.set({ customSite: cs });
      } else {
        await chrome.storage.local.set({ customAll: (store.customAll || []).filter((s) => s !== sel) });
      }
      renderRules();
    };
  });
}

async function refresh() {
  // Poll for the freshest count, then read state.
  try {
    await chrome.runtime.sendMessage({ type: "NOADS_POLL_NOW" });
  } catch {}
  const s = await chrome.storage.local.get(["paused", "pausedSites", "totalBlocked", "perDomain"]);
  $("power").checked = s.paused !== true;
  $("total").textContent = (s.totalBlocked || 0).toLocaleString();
  renderBreakdown(s.perDomain);

  const pausedHere = Array.isArray(s.pausedSites) && s.pausedSites.includes(host);
  const globallyOff = s.paused === true;
  const active = !pausedHere && !globallyOff;
  $("siteStatus").textContent = active ? "Active" : "Paused";
  $("siteStatus").className = "pill " + (active ? "on" : "off");
  $("pauseSite").textContent = pausedHere ? "Resume on this site" : "Pause on this site";
  renderRules();
}

async function main() {
  const cur = await currentHost();
  host = cur.host;
  $("host").textContent = host || "this site";

  $("power").onchange = () => {
    chrome.storage.local.set({ paused: !$("power").checked }, refresh);
  };

  $("pauseSite").onclick = async () => {
    const { pausedSites = [] } = await chrome.storage.local.get("pausedSites");
    const has = pausedSites.includes(host);
    const next = has ? pausedSites.filter((h) => h !== host) : pausedSites.concat(host);
    await chrome.storage.local.set({ pausedSites: next });
    refresh();
  };

  $("segSite").onclick = () => {
    segScope = "site";
    $("segSite").classList.add("active");
    $("segAll").classList.remove("active");
  };
  $("segAll").onclick = () => {
    segScope = "all";
    $("segAll").classList.add("active");
    $("segSite").classList.remove("active");
  };

  $("addSel").onclick = async () => {
    const sels = $("selInput").value
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!sels.length) return;
    const store = await chrome.storage.local.get(["customAll", "customSite"]);
    if (segScope === "all") {
      const set = new Set(store.customAll || []);
      sels.forEach((s) => set.add(s));
      await chrome.storage.local.set({ customAll: [...set] });
    } else {
      const cs = store.customSite || {};
      const set = new Set(cs[host] || []);
      sels.forEach((s) => set.add(s));
      cs[host] = [...set];
      await chrome.storage.local.set({ customSite: cs });
    }
    $("selInput").value = "";
    renderRules();
  };

  refresh();
}

main();
