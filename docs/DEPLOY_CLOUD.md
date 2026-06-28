# Deploy to the cloud — Vercel (frontend) + Render (backend) + Postgres

This gets a shareable URL you can hand to testers. Works on Mac, Windows, and
phones — no install. Data is durable (Postgres) and secrets are encrypted at rest.

```
 Tester ──▶ Vercel (React UI)
                │  /api/* proxied
                ▼
            Render (FastAPI)  ──▶  Postgres (accounts, chats, reminders, secrets)
```

> Local dev is unchanged — without `DATABASE_URL` the app still uses SQLite + the
> OS keychain. The cloud paths only switch on when `DATABASE_URL` is set.

---

## 0. Push the repo

```bash
git add -A && git commit -m "AgentFury"
git push   # to GitHub/GitLab
```
`.env` and `data/` are gitignored — your real keys are **not** committed. You'll
set them as env vars in Render instead.

---

## 1. Backend on Render (with Postgres)

**Option A — Blueprint (uses `render.yaml`, easiest):**
1. Render dashboard → **New + → Blueprint** → pick your repo.
2. Render reads `render.yaml` and creates the **web service + a free Postgres**.
3. Fill the env vars it marks as required (see §3).

**Option B — manual:**
1. **New + → Postgres** (free) → copy its *Internal Database URL*.
2. **New + → Web Service** → repo → Root Directory `backend`,
   Build `pip install -r requirements.txt`,
   Start `uvicorn app.main:app --host 0.0.0.0 --port $PORT`.
3. Add the env vars in §3 (including `DATABASE_URL` = the Postgres URL).

When it's live you'll have a URL like `https://agentforge-backend.onrender.com`.

---

## 2. Frontend on Vercel

1. Edit **`frontend/vercel.json`** → replace `YOUR-BACKEND.onrender.com` with your
   real Render host. Commit + push.
2. Vercel → **New Project** → import the repo → **Root Directory = `frontend`**.
3. Deploy. You'll get a URL like `https://agentforge.vercel.app`.

The `vercel.json` proxies `/api/*` to Render (so there's no CORS hassle) and
serves the SPA for `/` and `/admin`.

---

## 3. Backend environment variables (Render)

| Var | Value |
| --- | --- |
| `DATABASE_URL` | from the Render Postgres (Blueprint wires this automatically) |
| `SECRET_KEY` | a long random string (`openssl rand -hex 32`). **Keep it stable** — changing it logs everyone out and makes stored tokens unreadable |
| `GROQ_API_KEY` | your Groq key (serves all testers — your free quota) |
| `GROQ_API_KEYS` | optional extra keys, comma-separated |
| `GEMINI_API_KEY` | optional |
| `FRONTEND_ORIGIN` | your Vercel URL, e.g. `https://agentforge.vercel.app` |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | **change from dj/dj** |
| `AGENTFURY_DATA_DIR` | `/tmp/agentforge` (scratch for the vector store) |

For Google sign-in / Gmail (optional):
| Var | Value |
| --- | --- |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | from Google Cloud |
| `OAUTH_REDIRECT_URI` | `https://YOUR-BACKEND.onrender.com/api/connections/google/callback` |

Then in Google Cloud Console add that exact redirect URI to your OAuth client,
and add testers under **OAuth consent → Test users**.

---

## 4. What's durable vs not (be honest with testers)

| Data | Storage | Survives restart? |
| --- | --- | --- |
| Accounts, agents, chats, reminders, notes, brain, drafts | **Postgres** | ✅ yes |
| OAuth tokens & admin-added API keys | **Postgres, Fernet-encrypted** | ✅ yes |
| Vector/semantic memory (Chroma) | `/tmp` scratch | ⚠️ resets on restart — but the underlying **facts persist in Postgres**, so nothing important is lost; only the "search by meaning" index rebuilds |

> Render's **free** tier sleeps after ~15 min idle (first request then takes
> ~30–60s to wake) and free Postgres has limits/expiry. Fine for a few testers;
> upgrade the plan for anything real.

---

## 5. Security in the cloud (Crocs)

- Secrets are **Fernet-encrypted in the database** — a leaked DB dump is useless
  without `SECRET_KEY`. (Locally we still use the OS keychain.)
- Everything is served over **HTTPS** (Vercel + Render provide it) — so tokens
  and any admin-added key are encrypted in transit.
- **Change `ADMIN_USERNAME`/`ADMIN_PASSWORD`** from the `dj`/`dj` default before
  sharing the link. See `docs/CROCS_SECURITY.md`.

---

## 6. Quick checklist

- [ ] Repo pushed (no `.env` committed).
- [ ] Render: web service + Postgres up; env vars set; `SECRET_KEY` stable.
- [ ] `vercel.json` host points at the Render backend; Vercel deployed.
- [ ] `FRONTEND_ORIGIN` = Vercel URL; `OAUTH_REDIRECT_URI` = Render URL.
- [ ] Google redirect URI + test users added (if using Google).
- [ ] Admin password changed from `dj`/`dj`.
- [ ] Open the Vercel URL → sign up → it works. Share the link.
