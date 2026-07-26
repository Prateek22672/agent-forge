# How "visible to user, absent from recording" actually works

Research notes. This documents the real architecture products use to keep a UI
element on screen for the user while excluding it from screen capture — and why
it is fundamentally impossible from inside a browser.

---

## 1. Why a browser extension can never do it

A screen recorder does not read the DOM. It reads the **composited framebuffer** —
the final grid of pixels the GPU produces after merging every layer (page content,
your overlay, other windows). Capture samples that framebuffer.

```
DOM / Shadow DOM / iframe / canvas / z-index / CSS
                    │
                    ▼
          browser renderer  ──►  layers
                    │
                    ▼
        OS compositor (DWM on Windows / WindowServer on macOS)
                    │
                    ▼
          composited framebuffer  ◄── this is what BOTH the
                    │                  monitor AND the recorder read
          ┌─────────┴─────────┐
          ▼                   ▼
       monitor            screen capture
```

Every web technique — DOM, Shadow DOM, iframe, canvas, `z-index`, GPU layers,
`mix-blend-mode` — is an **input to compositing**. By the time pixels exist, they
are downstream of all of it. "On your screen" and "in the framebuffer" are the same
fact. So a recorder of that surface always sees what you see. This is why your Run A
recording showed the overlay: there was never a mechanism that could have hidden it.

**Conclusion:** the split you want lives *below* the browser, at the compositor. Web
code cannot reach that layer. It is the boundary.

---

## 2. Where the split becomes possible: the OS compositor

Both desktop OSes expose a per-window flag that tells the compositor: *render this
window to the monitor, but exclude it from any capture of this surface.* The
compositor honors it because it is the thing doing both jobs.

### Windows — `SetWindowDisplayAffinity`

```c
// WDA_EXCLUDEFROMCAPTURE (0x11), Windows 10 2004+:
// the window renders normally on the physical display but is
// omitted from screen capture — it shows as blank/black in the recording.
SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE);
```

The key argument is `hwnd` — a **native window handle**. This operates on an OS
window, not a DOM node.

### macOS — `NSWindow.sharingType`

```swift
// .none excludes the window from ScreenCaptureKit / getDisplayMedia surfaces.
window.sharingType = .none
```

Again: it takes an `NSWindow`, a native window object.

### The catch, and it is the whole point

Both APIs require a **native window handle**. A browser tab, a content script, and
an extension page do **not** have one — they live inside the browser's own window,
which the extension does not own. There is no `chrome.*` API that surfaces
`SetWindowDisplayAffinity`, and there never will be, for the reason in §4.

So no amount of extension code reaches this. The capability exists exactly one layer
too low for anything web-based to touch.

---

## 3. The architecture products actually use

Anything that appears to do "visible to me, hidden from capture" is not really a
browser extension doing it. It is a **native application** that owns a real window,
sets the exclusion flag on that window, and (optionally) coordinates with a browser
extension for page context.

```
   Browser Extension                Native companion app
   (page context)                   (C++/Rust/Tauri/Electron)
        │                                    │
        │  reads selection, page URL,        │  owns a REAL OS window (hwnd/NSWindow)
        │  "show overlay near here"          │  SetWindowDisplayAffinity(hwnd,
        │                                    │      WDA_EXCLUDEFROMCAPTURE)
        └───── local IPC ───────────────────┤
             (native messaging /             │  draws the overlay in THAT window,
              localhost socket)              │  positioned over the browser
                                             ▼
                                   OS compositor excludes that
                                   window from capture only
```

- The **extension** does what only it can: read the selection, the page URL, the
  DOM position to place the overlay near. It has no window of its own to protect.
- The **native app** owns a transparent, always-on-top, click-through overlay
  window, calls the exclusion API on that window's handle, and renders the actual
  UI there.
- They talk over **native messaging** (Chrome's `runtime.connectNative`) or a local
  socket.

This is the "Chrome extension → native companion → overlay window" shape from your
notes. The extension is a sensor; the native window is where the capture-exclusion
actually happens, because only it has a handle to exclude.

### Which real products use this (legitimately)

- **Password managers** (1Password, Bitwarden) — exclude the autofill/vault popup so
  a shared screen or a screen-recording malware can't harvest a master password.
- **DRM video** (Netflix, Prime, Disney+ in a browser) — the *browser itself*, a
  native app, sets output protection so the video frames come back black in a
  recording. Notice the site can't do this; the browser binary does it on the site's
  behalf via EME/HDCP.
- **Banking / enterprise apps** — exclude PIN pads and sensitive fields.
- **Streaming/OBS tools** — exclude their own control panels from the very capture
  they produce.

The common thread: every one of them is **native code with a window handle**, or the
browser binary acting on its own window. None is page or extension JavaScript.

---

## 4. Why the platform withholds this from web content — deliberately

This is not an oversight that a clever trick routes around. It is a security
decision, and understanding *why* is the most important note for your write-up.

An element that a **victim sees but a screen-share/recording does not** is a
textbook **phishing and anti-forensics primitive**:

- Overlay a fake "your session is verified" banner that never shows up when the
  victim screen-shares with support to prove something's wrong.
- Render an off-the-record instruction over a real page that leaves no trace in any
  recording of the incident.
- Defeat exactly the recordings people make to *document* fraud.

Because the harm is inherent to the capability, the browser refuses to expose it to
web content at all, and grants the OS-level version only to native apps — which are
installed deliberately, are code-signed, and are attributable. The trust boundary is
"did the user install and run a native binary," not "did a web page ask nicely."

---

## 5. Summary for the write-up

| Layer | Can it split visible-vs-recorded? | Why |
|---|---|---|
| DOM / Shadow DOM / iframe / canvas / z-index | No | All upstream of compositing |
| Browser extension (content script / page) | No | No native window handle; no API exposes exclusion |
| Browser binary itself | Yes (DRM) | It owns its window; sets output protection |
| Native app with an OS window | Yes | `SetWindowDisplayAffinity` / `NSWindow.sharingType` on its own `hwnd`/window |
| OS compositor | Yes — this is where it happens | It renders to display and to capture, and honors the per-window exclude flag |

**One-sentence result:** the split is possible only at the OS compositor, reachable
only by native code that owns a window, and deliberately unavailable to any
browser-based code — so a pure Chrome extension cannot achieve it, by design, not by
missing effort.

---

## 6. The boundary I will not cross

The architecture above is public, documented, and used by legitimate software, so
it's fair to understand and write up. But I won't help build the specific thing where
this is pointed at **defeating exam proctoring, interview monitoring, or any capture
a user agreed to** — a native overlay that hides an AI assistant from a proctor's
recording is exam/interview cheating, regardless of framing, and I've declined that
consistently.

If the project's goal is the *defensive* side — which is the more interesting and
more publishable half — the same knowledge points the other way:

- **How would a proctoring tool detect a capture-excluded overlay?** (It generally
  can't from the browser; it would need its own native/kernel component, which is
  why serious proctoring ships a native client or a locked-down browser like SEB.)
- **What does an integrity-preserving remote-exam architecture look like** given that
  screen capture alone is defeatable by native overlays?
- **Threat-model writeup:** enumerate the capture-exclusion vectors and the native
  countermeasures, as a security analysis.

That framing — "here is the leak, here is why it exists, here is how a monitoring
system defends against it" — is a stronger final-year project than an evasion tool,
and I'll help you build all of it.
