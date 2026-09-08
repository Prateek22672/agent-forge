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

Gmail read is restricted — the **highest** bar, and the only reason this is hard.

---

## Two editions, one codebase

Gmail is the entire problem, so it's the entire difference between the builds.
One env var on the backend switches them; the extension is byte-identical.

| | `GOOGLE_GMAIL_SCOPES` | Scopes requested | Verification |
| --- | --- | --- | --- |
| **Personal** (your own use) | `true` | Gmail + Calendar | Stay in Testing, add yourself as a Test user |
| **Public** (published) | `false` | Calendar only | Free verification, days |

Because the Public edition drops Gmail, it never touches a restricted scope —
**no CASA assessment, no cost.** That's the whole point of the split.

---

## Publishing the Public edition (the submission path)

### Step 1 — flip the edition
On the public backend (Render env):
```
GOOGLE_GMAIL_SCOPES=false
```
Verify at `/api/auth/google/client-id` — the `scopes` array must contain no
`gmail.*` entries and `gmail_enabled` must be `false`.

### Step 2 — prepare what Google asks for
- **Domain ownership** verified in [Google Search Console](https://search.google.com/search-console)
  — use the *same* Google account that owns the Cloud project.
- A public **homepage** and **privacy policy**, both on that domain
  (`docs/CROCS_SECURITY.md` is most of the policy content already).
- An **app logo**, 120×120 PNG, no rounded corners.

### Step 3 — fill in the consent screen
[Cloud Console → OAuth consent screen](https://console.cloud.google.com/apis/credentials/consent):
app name, support email, logo, app domain, homepage, privacy policy, developer
contact email. Under **Data access**, remove every `gmail.*` scope so the listed
scopes match what the Public build actually requests — a mismatch is the most
common rejection.

### Step 4 — record the demo video
Unlisted YouTube link. It must show: the OAuth consent screen with your app name
visible, the URL bar showing your verified domain, and each requested scope
actually being used in the product.

### Step 5 — submit
**Publishing status → Publish app**, then **Submit for verification** with a
one-line justification per scope. Sensitive-only review is typically days.

### Keeping Gmail for yourself
Leave your personal/local deployment on `GOOGLE_GMAIL_SCOPES=true` and stay in
**Testing** mode with your account under **Test users** (up to 100). You'll see
the "unverified" screen and click **Advanced → Continue** — fine for one user,
and it needs no verification at all.

> If you ever want Gmail for the *public*, that's OAuth verification **plus** a
> CASA Tier-2 assessment: a third-party audit, renewed annually, typically
> thousands per year. Avoid it unless Gmail becomes the product.

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
GOOGLE_GMAIL_SCOPES=false       # Public edition. true = Personal (Gmail on).
```

**OAuth consent screen (also helps trust):**
- App name, support email, app logo.
- App domain + homepage + privacy policy links.
- Scopes list matching what the app requests.

---

## TL;DR
- **Public build:** `GOOGLE_GMAIL_SCOPES=false` → Calendar only → free
  verification in days, no warning for anyone.
- **Your build:** `GOOGLE_GMAIL_SCOPES=true`, stay in Testing with yourself as a
  Test user → full Gmail, no verification needed.
- **Gmail for the public:** verification + CASA audit. Expensive and annual —
  only if Gmail becomes the product.
