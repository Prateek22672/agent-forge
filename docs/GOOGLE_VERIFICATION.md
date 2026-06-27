# Google OAuth — getting "trusted" (removing the unverified-app warning)

When users see **"Google hasn't verified this app → Back to safety"**, it's
because your OAuth app is in **Testing** and/or requests **sensitive/restricted
scopes** without verification. This is Google policy, not a bug. Here's the
honest map and the practical path for a beta.

## Scope tiers (this is what determines everything)

| Scope | Tier | Verification needed for public use |
| --- | --- | --- |
| `openid`, `userinfo.email`, `userinfo.profile` | **non-sensitive** | **None** — anyone can sign in, no warning |
| `calendar.events` | **sensitive** | App verification (privacy policy, domain, video) |
| `gmail.readonly`, `gmail.send` | **restricted** | App verification **+ CASA security assessment** (3rd-party audit, weeks, usually paid) |

Your app uses Gmail (restricted) — the **highest** bar.

---

## The practical path (recommended for your beta)

### Step 1 — ship sign-in for everyone, no warning
Set on the backend (Render env):
```
GOOGLE_DATA_SCOPES=false
```
Now "Sign in with Google" requests only login scopes → **no warning, any Google
user can sign up.** Gmail/Calendar tools are gated until you verify (they return
a friendly "reconnect to enable" message).

Then in **Google Cloud Console → OAuth consent screen**: set **Publishing status
= In production** (with only non-sensitive scopes, this needs no review).

### Step 2 — Gmail for a few testers (no verification)
Keep `GOOGLE_DATA_SCOPES=true` **and** stay in **Testing** mode, adding each
tester under **OAuth consent screen → Test users** (up to 100). Testers will see
the warning but can click **Advanced → Continue**. Good for a closed beta.

> You can run BOTH ideas by environment: data scopes ON for your private/test
> deployment, OFF for the public-facing one.

### Step 3 — full verification (Gmail for the public, no warning)
Only when the product is proven. You'll need:
- A public **homepage** + **privacy policy** URL (your `docs/CROCS_SECURITY.md`
  is most of the policy content).
- **Domain ownership verified** in Google Search Console.
- An **app logo** and a **recorded demo video** of the consent flow.
- Submit for **OAuth verification**; for Gmail (restricted), complete a **CASA
  Tier-2 security assessment** (third party, typically a few weeks + annual cost).

---

## Connecting the deployed URLs (do this after Vercel + Render are up)

**Google Cloud Console → Credentials → your OAuth client:**
- **Authorized JavaScript origins:** your Vercel URL, e.g.
  `https://agentforge.vercel.app`
- **Authorized redirect URIs:** your Render callback, exactly:
  `https://YOUR-BACKEND.onrender.com/api/connections/google/callback`

**Render env vars:**
```
FRONTEND_ORIGIN=https://agentforge.vercel.app
OAUTH_REDIRECT_URI=https://YOUR-BACKEND.onrender.com/api/connections/google/callback
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_DATA_SCOPES=false        # public beta (no warning) — or true for testers
```

**OAuth consent screen (also helps trust):**
- App name, support email, app logo.
- App domain + homepage + privacy policy links.
- Scopes list matching what the app requests.

---

## TL;DR
- **Remove the warning today:** `GOOGLE_DATA_SCOPES=false` + publish in production
  → login works for everyone, no Gmail.
- **Gmail now:** keep it on, add testers as Test users (warning, but works).
- **Gmail for everyone, no warning:** full verification + CASA — a real project,
  do it later.
