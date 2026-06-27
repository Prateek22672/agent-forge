# Connecting Gmail with Google sign-in (OAuth)

This lets users click **"Connect Google"** and grant read-only Gmail access — no
app password, fully revocable, the trusted modern flow. You set this up **once**;
after that every user of your app just clicks the button.

> Until this is configured, the app still runs — the "Connect Google" button just
> shows a friendly "not set up yet" message, and the email tool falls back to the
> optional IMAP app-password method.

## One-time setup (free, ~5 minutes)

1. Go to <https://console.cloud.google.com/> and create (or pick) a project.
2. **Enable the Gmail API**: APIs & Services → Library → search "Gmail API" → Enable.
3. **OAuth consent screen**: APIs & Services → OAuth consent screen →
   - User type: **External** → Create.
   - Fill app name + your email. Add yourself under **Test users**.
   - Scopes can be left default here (we request them at runtime).
4. **Create credentials**: APIs & Services → Credentials → Create Credentials →
   **OAuth client ID** →
   - Application type: **Web application**.
   - Authorized redirect URI — add exactly:
     ```
     http://localhost:8000/api/connections/google/callback
     ```
   - Create, then copy the **Client ID** and **Client secret**.
5. Put them in `backend/.env`:
   ```dotenv
   GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=xxxxxxxx
   ```
6. Restart the backend. The **Connect Google** button now works; after you
   consent, the top bar shows **"Gmail connected via <your address> ✓"**.

## What we request and store

- **Scope:** `gmail.readonly` + your email address (for the badge). Read-only —
  the app cannot send or delete mail.
- **Token storage:** the refresh token is kept in your **OS keychain** (Windows
  Credential Manager / macOS Keychain), never in the database or a plaintext file.
- **Revoke any time:** <https://myaccount.google.com/permissions>, or click
  "Disconnect" in the app.

## Going to production later

For real users (beyond test mode) you'd submit the consent screen for Google
verification and host the redirect URI on your domain instead of localhost. The
code already reads the redirect URI from `OAUTH_REDIRECT_URI`, so that's a config
change, not a code change.
