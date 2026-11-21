# KING API (hub)

One server for your bot AND your website: AI chat, image reading, voice-to-text, a download router, a tools pack and a website backend.
Upload every file here to the ROOT of your GitHub repo (replace the old server.js and package.json). Render redeploys by itself.

## Endpoints
Private (send your password: `Authorization: Bearer <KING_API_KEYS>` or `?key=...`)
- `GET|POST /ask`, `POST /vision`, `POST /transcribe`, `POST /v1/chat/completions`   (AI, as before)
- `GET|POST /download?url=<link>&type=video|audio`   or   `?q=<song name>`   one link, many sources
- `GET /download/providers`   which sources are on / resting
- `GET|POST /tools/translate?text=...&to=french`

Public (no key, safe to call from your website; CORS on, per-visitor limit)
- `GET /dl/f/<token>`   the file itself (the link from /download, expires in 30 min)   |   `GET /dl/platforms`
- `GET /tools/qr?text=...&size=512&format=png|svg`   `GET /tools/weather?city=Lagos`   `GET /tools/currency?from=USD&to=NGN&amount=100`
- `GET /tools/shorten?url=...`   `GET /tools/calc?expr=2*(3+4)^2&mode=deg`   `GET /tools/convert?value=5&from=km&to=mi`   `GET /tools/time?tz=Africa/Lagos`   `GET /tools`
- `GET /site/portfolio`   `GET /site/catalog?type=video|music&q=&tag=&id=&limit=`   (read from portfolio.json / catalog.json: edit them on GitHub)
- `POST /site/contact {name,email,message}`   `POST /site/ask {q}`   (visitors chat with your AI, strictly limited)

## Settings (Render > Environment). Everything is optional.
| Name | What it does |
|---|---|
| WORKER_TOKEN | secret shared with your king-worker device (16+ characters). Turns your own downloader on |
| DOWNLOADER_API_KEY | your ES Teams key: YouTube by link or name |
| COBALT_URL, COBALT_KEY | a cobalt downloader instance: Instagram, Facebook, X, Pinterest, Reddit, SoundCloud... |
| KINGBOT_DL_URL | your older Railway API (default kingbot-api.up.railway.app). Write `off` to disable |
| DL_PROVIDERS | force the sources and their order, e.g. `worker` (only your own) or `worker,cobalt` |
| ALLOWED_ORIGINS | your website address(es), comma separated, e.g. `https://mysite.com` (default: everyone) |
| PUBLIC_RATE | requests per minute per visitor on public routes (default 60) |
| TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID | contact-form messages arrive in your Telegram |
| CONTACT_WEBHOOK_URL | or send them to a Discord/other webhook |
| SITE_AI_RATE, SITE_AI_DAILY_CAP | visitor AI chat limits (default 6 per minute, 300 per day) |
| MAX_PROXY_MB | biggest file streamed through the API (default 200) |

## Your own downloader (king-worker)
`worker.js` lets a phone or PC of yours do the downloading with yt-dlp, with no third-party API. Set `WORKER_TOKEN` here, run `king-worker` on the device (see its README), and add `DL_PROVIDERS=worker` to use nothing else.
- `POST /worker/poll`, `PUT /worker/file/:id`, `POST /worker/fail/:id` are used by the worker (protected by WORKER_TOKEN). `GET /worker/status` (your key) shows if it is online.
- You can run several workers (each with its own `WORKER_NAME`): if one is blocked by a platform, the job goes to another one on a different network. `/worker/status` lists them.
- Settings: `WORKER_TOKEN`, `WORKER_MAX_MB` (100), `WORKER_STORE_MB` (300: everything kept at once, oldest deleted first), `WORKER_JOB_TIMEOUT_MS` (90000), `WORKER_FILE_TTL_MS` (30 min).

## Download sources (honest notes)
- TikTok works with no setup. YouTube needs DOWNLOADER_API_KEY or your Railway API. Instagram/Facebook/X/Pinterest need COBALT_URL (or the Railway API).
- A source that fails 3 times is skipped for 5 minutes, then tried again. Links from Spotify, Netflix, Apple Music and other DRM / paid services are refused on purpose.

## From your website
    const r = await fetch('https://YOUR-API.onrender.com/tools/weather?city=Lagos'); const data = await r.json();
    await fetch('https://YOUR-API.onrender.com/site/contact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, email, message }) });
Never put your KING_API_KEYS password in website code: anyone can read it. The public routes need no password.
