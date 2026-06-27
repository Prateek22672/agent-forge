# AgentForge Desktop App (Electron)

A native installable app that **connects to your live cloud backend** (the same
Render API your web app uses), so accounts and data are shared between web and
desktop. What the desktop shell adds:

- A real installed app (Start menu / dock) with a **system tray**.
- It keeps running in the tray, so the in-app reminder poller fires **real OS
  notifications even when the window is closed**.
- **Silent auto-update** from GitHub Releases — ship updates without users
  reinstalling.

> Architecture: the desktop app is a thin native shell that loads your deployed
> URL. There's no separate backend to bundle or sync — it *is* your cloud app,
> wrapped natively with a tray + notifications + updater.

---

## 1. One-time setup

1. **Point it at your app.** In `desktop/main.js` set `APP_URL` to your Vercel
   URL (or pass `AGENTFORGE_URL` at runtime):
   ```js
   const APP_URL = process.env.AGENTFORGE_URL || "https://YOUR-APP.vercel.app";
   ```
2. Install deps:
   ```bash
   cd desktop
   npm install
   ```

## 2. Run it (dev)
```bash
cd desktop
npm start
```
A window opens loading your cloud app. Close it → it minimises to the tray and
keeps running (so reminders still notify). Quit fully from the tray menu.

## 3. Build the Windows installer
```bash
cd desktop
npm run dist
```
Produces `desktop/dist/AgentForge-Setup-<version>.exe` — a normal installer
(choose folder, desktop shortcut). **This step runs on your machine** (it bundles
the native Electron runtime); it can't be produced on a server.

- **macOS** (`.dmg`) and **Linux** (`.AppImage`) targets are configured too, but
  the Mac build must run **on a Mac** (or a macOS CI runner) — you can't build a
  Mac app from Windows.

## 4. Publish + auto-update (GitHub Releases)

The app auto-updates from **GitHub Releases** (configured in `package.json` →
`build.publish`, pointing at `Prateek22672/agent-forge`).

To cut a release:
```bash
cd desktop
# set a GitHub token with 'repo' scope so it can upload the release
setx GH_TOKEN your_token     # (PowerShell: $env:GH_TOKEN="...")
npm run publish              # builds + uploads installer + latest.yml to a release
```
Or build locally (`npm run dist`) and **manually upload** the `.exe` **and the
generated `latest.yml`** to a GitHub Release. The `latest.yml` is what lets
installed apps detect the new version.

**How updates reach users:** on launch, the app checks the latest GitHub Release;
if a newer version exists it downloads it in the background and installs on next
restart. To ship an update you just **bump `version` in `desktop/package.json`**
and publish a new release.

> Bonus: because the desktop shell only *loads* your web app, most UI/feature
> changes ship instantly via your normal Vercel deploy — you only need a new
> desktop release when you change the shell itself (tray, updater, etc.).

## 5. Wire the home-page Download button

Once you've published a release, point the landing "Download" button at:
```
https://github.com/Prateek22672/agent-forge/releases/latest
```
(Re-enable it in `frontend/src/components/Landing.jsx` — it's currently set to
"coming soon".)

## 6. Icons
`desktop/build/icon.ico` (Windows) and `icon.png` (Linux) are generated. For a
polished look, replace them with a real 512×512 icon (and add `icon.icns` for the
Mac build). electron-builder derives the rest.

## 6b. macOS first run (unsigned app)

Without an Apple Developer cert the `.dmg` is **unsigned**, so on first open macOS
says **"AgentForge is damaged and can't be opened"** (Apple Silicon) or
"unidentified developer" (Intel). This is Gatekeeper quarantining a downloaded
unsigned app — not actual damage.

**Fix for testers (one line):**
1. Drag **AgentForge** into **Applications**.
2. Open **Terminal** and run:
   ```bash
   xattr -cr /Applications/AgentForge.app
   ```
3. Open it normally. (Alternatively: right-click the app → **Open** → **Open**.)

**Permanent fix:** join the **Apple Developer Program** ($99/yr), then set
`CSC_LINK`/`CSC_KEY_PASSWORD` (cert) and an Apple ID for **notarization** in the
mac CI job. Once notarized, it opens with a normal double-click, no warning.

## 7. Notes & limits (honest)
- **Background notifications** work while the app runs in the tray. If the user
  fully **Quits**, nothing polls — true "app fully closed" push needs web-push
  infra (a later add).
- The app stores its **session token locally** (Electron's persistent storage),
  so users stay logged in between launches. All real data lives in your cloud
  Postgres.
- Code-signing: unsigned installers show a Windows SmartScreen warning ("More
  info → Run anyway"). For a public release, sign with a code-signing cert
  (configure in `build.win.certificateFile`).
