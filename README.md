# 🛺 Commute Pain Tracker

Hyderabad traffic, but make it a game. Logs real traffic-aware travel times every 30 min and tells you when **not** to leave office. Players add their own commutes, compete on the pain leaderboard, and talk on per-route walkie-talkie radio.

- **Logger:** `logger.py` → TomTom Routing API (+ alternatives) → MongoDB Atlas, on a GitHub Actions cron
- **Site:** Next.js 16 + Tailwind 4 + Recharts on Vercel. Server-only MongoDB access (no keys in the browser)
- **Radio:** one LiveKit room per route, login required (the server mints a 2h ticket that only allows a microphone). Holding the button unmutes your mic live, and releasing mutes it and frees the mic. Incoming voice is band-passed and crunched, with static and a roger beep, all synthesized with WebAudio. Text chips go over LiveKit data messages. **Nothing is recorded or stored**: if you're not tuned in, you miss it. Rules (15s per transmission, 10s text cooldown, no phone numbers) are enforced in the client.
- **Pages:** `/` press start (name + 4-digit PIN) · `/leave` "Leave now?" verdicts · `/route/<slug>` heatmap + boss/safe slots + OG share card · `/leaderboard` · `/me` your commutes · `/radio/<slug>` route radio

```
logger.py, requirements.txt   # cron logger (also creates indexes + seeds 6 community routes)
.github/workflows/log.yml     # every 30 min, 4:30am–1:30am IST
.github/workflows/ci.yml      # tests + build on every PR
lib/pain.ts                   # verdict math     (tested: npm test)
lib/crypto.ts                 # PIN + sessions   (tested: npm test)
lib/db.ts                     # MongoDB queries (median-per-slot aggregation, cached 5 min)
app/                          # pages, server actions, /api/radio (LiveKit token), /api/geocode
```

## Setup (≈15 min)

### 1. TomTom key
<https://developer.tomtom.com/> → sign up → **Dashboard → Keys** → copy the default key (Routing + Search are enabled).
Free tier = 2,500 requests/day. Budget: ≤45 routes × 42 runs/day = 1,890, plus place searches (cached 24h). Each run prints its request count.

### 2. MongoDB Atlas
1. <https://cloud.mongodb.com> → create a free **M0** cluster.
2. **Database Access** → add a user with readWrite permissions.
3. **Network Access** → add `0.0.0.0/0`. Vercel and GitHub Actions use changing IPs, and the password still protects the cluster.
4. **Connect → Drivers** → copy the `mongodb+srv://…` URI and put your password in it.
5. You don't need to create anything by hand. The logger's first run creates the indexes and the 6 community routes, and logs older than 60 days expire automatically.

### 2b. LiveKit (radio)
<https://cloud.livekit.io> → new project → **Settings → Keys** → copy `LIVEKIT_URL` (`wss://…`), the API key and the secret. The free tier is plenty for walkie-talkie use.

### 3. Session secret
`openssl rand -base64 32`. It signs logins and peppers PINs. Changing it later logs everyone out and invalidates every PIN.

### 4. Local dev
```bash
cp .env.example .env.local   # fill in all values
npm i && npm run dev         # http://localhost:3000
npm test
```

### 5. GitHub Secrets (logger)
Repo → **Settings → Secrets and variables → Actions**: `TOMTOM_API_KEY`, `MONGODB_URI`.
Then **Actions → log-commute → Run workflow** to log once immediately.
GitHub cron can lag 5–15 min (fine, slots floor to :00/:30 IST). On public repos, scheduled runs pause after 60 days without commits.

### 6. Vercel
<https://vercel.com/new> → import the repo → add all env vars from `.env.example` → Deploy.
Or use the CLI: `vercel link && vercel env add … && vercel --prod`.

## How it works
- **Login:** name + 4-digit PIN. An unknown name creates a player, a known name checks the PIN. After that the device remembers your name, so you just type the PIN. PINs are scrypt-hashed with a server pepper, and 5 wrong PINs lock the account for 15 minutes.
- **Your commutes:** search start and destination (TomTom Search, Hyderabad only), max 3 per player and 45 total. They're logged from the next cron run, and TomTom alternative routes show up live on Leave Now.
- **Verdict:** current vs the median (Mongo `$median`) for the same IST weekday + half-hour slot (8 weeks). A slot needs **≥3 samples**, otherwise "collecting data…". ≤1.1× GO, ≤1.3× MEH, else WAIT, plus the next better slot today.
- **Leaderboard:** peak ÷ off-peak median (7am–10:30pm slots), with owner names.
- **Radio:** one channel per route, login required. Hold-to-talk voice (≤15s) or text and CB codes. Playback is band-passed and crunched, with static and a roger beep, all synthesized with WebAudio. Rules are enforced in `app/api/radio/[slug]/route.ts`: 10s cooldown, 140 chars, no phone numbers, everything deleted after 3h. Clips live in a private bucket behind 1h signed URLs.

## Contributing
1. Fork → `git checkout -b my-thing` → commit → open a PR against `main`.
2. CI runs `npm test` + `npm run build`. Keep it green.
3. Ideas welcome: better quips, new CB codes, more seed routes (`SEEDS` in logger.py), server-side moderation for radio.
4. Never commit `.env*` or keys.
