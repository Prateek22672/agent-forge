# Push notifications (PWA / Web Push)

Sends reminder (and later priority-email) notifications to a user's devices —
even when the app is closed — using Web Push + VAPID.

```
reminder due  ──▶  cron (every 1 min)  ──▶  /api/cron/fire-reminders
                                               │ finds due reminders
                                               ▼
                                          Web Push  ──▶  user's phone/desktop
```

---

## 1. Render env vars (already generated for you)

Add these to **Render → Environment** (the keys below were generated for this app):

```
VAPID_PUBLIC_KEY=BFaVPhsS98xmH1ZJhn1_z-NfnBkX84g1D7jb1S5pUMUsmkCzxvLOG9_M4FHm4IC34bbNbSbSEwM1kfKzbwKcn2c
VAPID_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\nMIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgFf5J7B9BgfbbIlbk\nAlEozL3snbx1twd8hTqkscP74GShRANCAARWlT4bEvfMZh9WSYZ9f8/jX5wZF/OINQ+429UuaVDFLJpAs8byzhvfzOBR5uCAt+G2zW0m0hMDNZHys28CnJ9n\n-----END PRIVATE KEY-----
VAPID_SUBJECT=mailto:you@yourdomain.com
CRON_SECRET=b9ed2eea20e09d37110b38804c281792
```

> Keep `VAPID_PRIVATE_KEY` and `CRON_SECRET` secret. To rotate, regenerate with
> `python -c "from py_vapid import Vapid01; v=Vapid01(); v.generate_keys(); ..."`.

Render redeploys on save. Then `/api/push/vapid-public-key` returns
`{"enabled": true}`.

---

## 2. The cron (fires reminders on time)

Render's free tier sleeps, so an **external cron** pings the endpoint every minute.
Use a free service like **cron-job.org** or **UptimeRobot**:

- **URL:**
  `https://agent-forge-7tv7.onrender.com/api/cron/fire-reminders?secret=b9ed2eea20e09d37110b38804c281792`
- **Method:** POST
- **Schedule:** every 1 minute

Each call finds reminders whose `due_at` has passed, **pushes** them, and marks
them notified. (The ping also keeps the free Render instance awake — a nice bonus.)

### Priority-inbox cron (optional, for auto-scan + push)
Add a **second** cron job (every ~15 min) so new important emails are detected
and pushed without opening the app:

- **URL:** `https://agent-forge-7tv7.onrender.com/api/cron/scan-priority?secret=b9ed2eea20e09d37110b38804c281792`
- **Method:** POST · **Schedule:** every 15 minutes

It scans each Gmail-connected user's recent inbox, flags important mail with the
LLM, and pushes the new ones. (Users can also tap **Scan now** on the Priority
page anytime.)

---

## 3. User flow (in the app)

1. **Settings → Notifications → Enable** (must be a tap — required on iOS).
2. Browser asks permission → granted → the device subscribes (`/api/push/subscribe`).
3. **Send test** to confirm it works.
4. From then on, due reminders arrive as notifications even with the app closed.

**Mobile:** for reliable background delivery, the user should **Install** the PWA
to their home screen first (iOS 16.4+ requires the PWA to be installed for push).

---

## 4. How it's wired (for reference)

| Piece | File |
| --- | --- |
| Sender (VAPID) | `backend/app/push.py` |
| Subscribe + test + cron | `backend/app/api/push_api.py` |
| Subscription store | `push_subscriptions` table (`models.py`) |
| Service worker (push handler) | `frontend/public/sw.js` |
| Subscribe helper | `frontend/src/push.js` |
| Enable button | Settings → Notifications |

Dead subscriptions (404/410 from the push service) are pruned automatically.
