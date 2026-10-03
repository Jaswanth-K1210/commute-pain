# 🛺 Commute Pain Tracker

Hyderabad traffic, but make it a game. Logs real traffic-aware travel times every 30 min and tells you when **not** to leave office. Players add their own commutes, compete on the pain leaderboard, and talk on per-route walkie-talkie radio.

- **Logger:** `logger.py` → TomTom Routing API (+ alternatives) → Supabase, on a GitHub Actions cron
- **Site:** Next.js 16 + Tailwind 4 + Recharts on Vercel. Server-only Supabase access (no keys in the browser)
- **Pages:** `/` press start (name + 4-digit PIN) · `/leave` "Leave now?" verdicts · `/route/<slug>` heatmap + boss/safe slots + OG share card · `/leaderboard` · `/me` your commutes · `/radio/<slug>` route radio

```
logger.py, requirements.txt   # cron logger (also expires radio messages)
.github/workflows/log.yml     # every 30 min, 4:30am–1:30am IST
.github/workflows/ci.yml      # tests + build on every PR
supabase/migration.sql        # tables, views, storage bucket, seed routes
lib/pain.ts                   # verdict math     (tested: npm test)
lib/crypto.ts                 # PIN + sessions   (tested: npm test)
app/                          # pages, server actions, /api/radio, /api/geocode
```

## Setup (≈15 min)

### 1. TomTom key
<https://developer.tomtom.com/> → sign up → **Dashboard → Keys** → copy the default key (Routing + Search are enabled).
Free tier = 2,500 requests/day. Budget: ≤45 routes × 42 runs/day = 1,890, plus place searches (cached 24h). Each run prints its request count.

### 2. Supabase
1. New project at <https://supabase.com>.
2. **SQL Editor** → paste and run `supabase/migration.sql`. This creates the tables, the views, the private `radio` storage bucket and 6 community routes.
3. **Project Settings → API**: copy the **Project URL** and the **service_role / secret** key.

### 3. Session secret
`openssl rand -base64 32`. It signs logins and peppers PINs. Changing it later logs everyone out and invalidates every PIN.

### 4. Local dev
```bash
cp .env.example .env.local   # fill in all 4 values
npm i && npm run dev         # http://localhost:3000
npm test
```

### 5. GitHub Secrets (logger)
Repo → **Settings → Secrets and variables → Actions**: `TOMTOM_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`.
Then **Actions → log-commute → Run workflow** to log once immediately.
GitHub cron can lag 5–15 min (fine, slots floor to :00/:30 IST). On public repos, scheduled runs pause after 60 days without commits.

### 6. Vercel
<https://vercel.com/new> → import the repo → add env vars `TOMTOM_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SESSION_SECRET` → Deploy.
Or use the CLI: `vercel link && vercel env add … && vercel --prod`.

## How it works
- **Login:** name + 4-digit PIN. An unknown name creates a player, a known name checks the PIN. After that the device remembers your name, so you just type the PIN. PINs are scrypt-hashed with a server pepper, and 5 wrong PINs lock the account for 15 minutes.
- **Your commutes:** search start and destination (TomTom Search, Hyderabad only), max 3 per player and 45 total. They're logged from the next cron run, and TomTom alternative routes show up live on Leave Now.
- **Verdict:** current vs the median for the same IST weekday + half-hour slot (8 weeks). A slot needs **≥3 samples**, otherwise "collecting data…". ≤1.1× GO, ≤1.3× MEH, else WAIT, plus the next better slot today.
- **Leaderboard:** peak ÷ off-peak median (7am–10:30pm slots), with owner names.
- **Radio:** one channel per route, login required. Hold-to-talk voice (≤15s) or text and CB codes. Playback is band-passed and crunched, with static and a roger beep, all synthesized with WebAudio. Rules are enforced in `app/api/radio/[slug]/route.ts`: 10s cooldown, 140 chars, no phone numbers, everything deleted after 3h. Clips live in a private bucket behind 1h signed URLs.

## Contributing
1. Fork → `git checkout -b my-thing` → commit → open a PR against `main`.
2. CI runs `npm test` + `npm run build`. Keep it green.
3. Ideas welcome: better quips, new CB codes, more seed routes (add to the migration's insert), Supabase Realtime instead of polling.
4. Never commit `.env*` or keys.
