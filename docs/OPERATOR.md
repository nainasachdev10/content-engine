# Operator guide

## One instance per client

Each client gets their own copy of the engine (a VPS or container) with their own
`.env`, `projects/` and `data/`. That is the isolation model: no multi-tenant code, no
shared keys, and the approval gate is enforced per instance.

```bash
git clone <repo> && cd content-engine
cp .env.example .env         # fill in (see below)
docker compose up -d --build # or: npm install && npm run build && npm start
```

Put it behind HTTPS (Caddy/Cloudflare Tunnel/nginx) and set `DASHBOARD_URL` to the
public URL — notification links and the YouTube OAuth redirect use it.

## Keys (`.env`)

| Key | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | research, scripts, metadata, validation, edits, channel setup |
| `ELEVENLABS_API_KEY` | narration (Starter plan or higher for real volume) |
| `IMAGE_API_KEY` | Replicate: images, image-to-video clips, music beds |
| `YOUTUBE_CLIENT_ID/SECRET` | Google OAuth client; add `<DASHBOARD_URL>/api/youtube/callback` as an authorized redirect URI |
| `DASHBOARD_PASSWORD`, `DASHBOARD_SESSION_SECRET` | dashboard login |
| `DASHBOARD_URL` | public URL of the dashboard |
| `RESEND_API_KEY`, `NOTIFY_EMAIL_TO` | email notifications (optional) |
| `VAPID_*` | push notifications — `npm run engine -- push-keys` (optional) |
| `FFMPEG_PATH` | full ffmpeg build (Docker image sets this) |
| `SEGMIND_API_KEY` | only for channels with `presenter.provider = "higgsfield"` (Higgsfield Speech2Video is served by Segmind; Higgsfield's own API has no lipsync endpoint). The default presenter engine, OmniHuman, runs on `IMAGE_API_KEY`. |

## Which engine does what (and why)

| Job | Default | Alternative | Why |
|---|---|---|---|
| Scene images, thumbnails | Replicate — Flux Schnell | — | fast, cheap, one key |
| Hero-scene clips (image→video) | Replicate — Kling 2.5 Turbo Pro (`video.clipModel` overridable: `google/veo-3.1-fast`, `bytedance/seedance-1-pro`…) | Higgsfield DoP (`video.clipProvider = "higgsfield"`, keys `HIGGSFIELD_API_KEY_ID/SECRET`) | Replicate hosts the same frontier models Higgsfield resells, takes base64 inputs and shares the key. Higgsfield only wins for DoP's cinematic camera presets, so it's opt-in per channel. |
| Talking-head clips | Replicate — OmniHuman | Higgsfield Speech2Video via Segmind (`presenter.provider = "higgsfield"`, `SEGMIND_API_KEY`) | Higgsfield's own API has no lipsync endpoint. |
| Music bed | Replicate — MusicGen | — | generated once per channel |
| Narration | ElevenLabs | — | |
| Writing, research, QA, edits | Anthropic | — | |

## Running unattended

`npm start` (or the Docker image) runs the dashboard and the scheduler together. The
scheduler, every 5 minutes:

- starts a video for each channel whose schedule is on and is due (lands in the review queue);
- retries the most recent failed run **once** unless the error is one a retry can't fix
  (quota, missing key, validation fail, auth);
- marks runs that have been silent for 3 h as failed so a dead process never blocks a channel;
- runs the three Notion jobs once a day per connected channel.

On a Mac, `scripts/com.contentengine.plist` keeps it alive across reboots (instructions
inside the file). On a server use Docker with `restart: unless-stopped` (already set).

## Talking-head channels

Set `presenter.enabled` in a channel (dashboard: Channel → Settings → *On-camera host*).
The script marks ~35% of scenes `shot: "presenter"` (hook, transitions, ending); the
visuals stage renders those as lip-synced clips of a consistent host image
(`projects/<slug>/assets/presenter.png`, generated once from the description — replace
it with a real 16:9 photo to use a real person). Audio longer than 14 s is split and
the pieces concatenated. Everything else in the pipeline is unchanged.

Per channel (written by the dashboard, gitignored): `projects/<slug>/.env` holds
`YOUTUBE_REFRESH_TOKEN` and `NOTION_TOKEN`; `projects/<slug>/notion.json` holds the
Notion page/database ids.

## CLI (`npm run engine -- …`)

```
list                              channels and last run
init <slug> --niche "…"           scaffold a channel (the dashboard does this + AI tailoring)
run <slug> [--topic "…"]          make a video → review queue (never uploads)
stage <name> <slug> --dir <dir>   re-run one stage
edit <slug> --dir <dir> --instruction "…"
rollback <slug> --dir <dir> --version N
auth <slug>                       terminal OAuth fallback
notion setup <slug> --page <url>  build hub + databases (token from projects/<slug>/.env)
notion status <slug>
job teardown|ideas-audit|metrics <slug>   Notion jobs (scheduler runs them daily)
scheduler                         cadence runs + daily Notion jobs
push-keys / notify-test           notifications
```

## The hard rule

`engine run`, the scheduler, edits and retries all stop at `pending_approval`. The only
code path that calls `runUpload` is the dashboard's `POST /api/runs/:id/approve`, which
a signed-in human triggers from the review page. Keep it that way.
