# Deploying end to end

One deployment = one client. They get a private dashboard URL, create as many channels
(niches) as they like, and every channel gets research, Notion research, scripts, video,
review and publishing. You run the server; they never touch a terminal.

Total time for a new client, once you've done it once: ~45 minutes (mostly waiting on
Google and DNS).

---

## 0. Accounts you need (one-time, your side)

| Service | What for | Plan that works |
|---|---|---|
| Anthropic | research, scripts, QA, edits, channel setup | pay-as-you-go |
| ElevenLabs | narration | Creator ($22/mo, 100k chars ≈ 13 five-minute videos) or higher |
| Replicate | images, clips, presenter, music | add $20+ credit |
| Google Cloud | YouTube upload + analytics | free |
| Resend | notification emails | free tier |
| A VPS provider | the server | Hetzner CX32 / DigitalOcean 8 GB — 4 vCPU, 8 GB RAM, 80 GB disk |
| A domain | HTTPS URL for the dashboard (required for push + Google OAuth) | any |
| Optional: Higgsfield, Segmind | DoP clips / Higgsfield lipsync | only if a client wants them |

Rule of thumb per client: server ~$20/mo; a 5-minute hybrid video costs ≈ $2–4 in API
usage (more with a talking-head presenter).

## 1. Google Cloud (once per deployment or per client — see note)

1. console.cloud.google.com → new project → enable **YouTube Data API v3** and
   **YouTube Analytics API**.
2. OAuth consent screen → External → add scopes `youtube.upload`, `youtube`,
   `youtube.readonly`, `yt-analytics.readonly`. Set publishing status to **In production**
   (in *Testing*, refresh tokens expire after 7 days and uploads would stop). Google
   shows an "unverified app" screen until you submit for verification; up to 100 users
   can click through it. Submit for verification when you have several clients.
3. Credentials → OAuth client → **Web application** → authorized redirect URI:
   `https://<client-domain>/api/youtube/callback` (add one line per client domain).
4. Copy client ID + secret into the client's `.env`.

## 2. Server

```bash
# on a fresh Ubuntu 24.04 VPS
curl -fsSL https://get.docker.com | sh
apt-get install -y caddy git
mkdir -p /srv/clients && cd /srv/clients
git clone <your repo url> acme            # one folder per client
cd acme
cp .env.example .env && nano .env         # see section 3
docker compose up -d --build              # first build ≈ 5 min
```

`/etc/caddy/Caddyfile` (Caddy gets the TLS certificate automatically):

```
engine.acme-client.com {
    reverse_proxy localhost:3777
}
```
`systemctl reload caddy`. For a second client, clone into `/srv/clients/<name>`, change
the host port in that copy's `docker-compose.yml` (e.g. `3778:3777`), add a Caddy block.


## 2b. Hosted alternative: Railway or Render (no server to manage)

Both run the Docker image as-is and hand you an HTTPS URL. Railway is the better value
because renders are bursty and it bills actual usage; on Render you need the Pro plan
(4 GB) or renders run out of memory.

**Railway**
1. New project → Deploy from GitHub repo (it detects the Dockerfile).
2. Settings → Volumes → add a volume mounted at `/app/storage`.
3. Variables: the infrastructure set from section 3 with `STORAGE_DIR=/app/storage` and
   `DASHBOARD_URL=https://<service>.up.railway.app` (or your custom domain). Leave
   `FFMPEG_PATH` unset.
4. Settings → Resources: allow at least 4 GB RAM (8 GB for talking-head/HyperFrames-heavy channels).
5. Networking → Generate domain (or attach `engine.yourclient.com`). Use that URL for the
   Google OAuth redirect `…/api/youtube/callback`.

**Render**: Web Service from the repo (Docker), plan Pro (4 GB+), add a Disk mounted at
`/app/storage`, same variables as above.

**Vercel is not suitable** for the dashboard: it reads the run database and streams
video from local disk and spawns the engine as child processes, none of which serverless
hosting allows. Keep the dashboard in the same container — it costs nothing extra.

## 3. Host variables (infrastructure only)

```
YOUTUBE_CLIENT_ID=…             # YOUR Google app (one per deployment, not per client)
YOUTUBE_CLIENT_SECRET=…
DASHBOARD_PASSWORD=<what you give the client>
DASHBOARD_SESSION_SECRET=<openssl rand -hex 32>
DASHBOARD_URL=https://engine.acme-client.com
VAPID_PUBLIC_KEY=…              # npm run engine -- push-keys
VAPID_PRIVATE_KEY=…
VAPID_SUBJECT=mailto:you@example.com
STORAGE_DIR=/app/storage        # hosted platforms with one volume
```
`FFMPEG_PATH` and the browser path are set inside the image — don't set them.

**AI and notification keys are NOT host variables.** The client enters their own
Anthropic, ElevenLabs, Replicate and (optionally) Resend keys in the dashboard under
**Settings → Connections** (the setup wizard asks for them first). They're stored on the
volume and override anything on the host. If *you* pay for usage instead, you may set
`ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`, `IMAGE_API_KEY`, `RESEND_API_KEY`,
`NOTIFY_EMAIL_TO` on the host and the client never sees a key.

Check it's up: open the URL, sign in, you should land on the setup wizard.

## 4. Hand-over to the client (they do this, ~5 min)

Send them the URL, the password, and `docs/CLIENT-SETUP.md`. In the dashboard they:

1. **Describe their channel** (wizard step 1) — the engine writes the style guide,
   research rules, quality checklist, music and format mix from the description.
   Options: length, videos/week, kids channel, talking-head host.
2. **Connect YouTube** (step 2) — Google consent screen, done.
3. **Enable notifications** (step 3) — push on their phone/desktop; email if configured.
4. Optional **Notion**: channel page → Connect Notion → paste integration token + page
   link. The engine builds the hub + four databases; nightly it audits creators they add,
   scores ideas they add (and makes the best ones), and syncs metrics.
5. **More niches** = Channels → New channel. Each has its own YouTube connection,
   voice, style, schedule and Notion.

From then on: videos are made on schedule, they get notified, they approve on their
phone, it publishes. Nothing publishes without the approve click.

## 5. Operating it

```bash
docker compose logs -f --tail 100          # live logs
docker compose exec engine npm run engine -- runs        # run history
docker compose exec engine npm run engine -- notify-test # test notifications
git pull && docker compose up -d --build   # update
```
- **Backups**: `projects/` (configs, secrets, videos) and `data/` (run DB) — rsync or
  snapshot nightly. Generated videos in `projects/*/output` can be pruned after publish.
- **Disk**: each 5-minute video is ~150–400 MB of intermediates. 80 GB ≈ 150 videos;
  prune old `output/` folders or move them to object storage.
- **Failures** land on the client's Review page ("Needs attention") and in your logs;
  the scheduler retries transient failures once by itself.
- **Costs to watch**: ElevenLabs characters (the pipeline caches narration per scene so
  edits re-bill only changed lines) and Replicate credit.

## 6. Without Docker (e.g. this Mac)

`npm install && npm run build && npm start` runs dashboard + scheduler;
`scripts/com.contentengine.plist` keeps it alive across reboots. Use Cloudflare Tunnel
or ngrok for an HTTPS URL if a client needs to reach it.
