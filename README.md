# Content Engine

An automated YouTube channel factory with a human approval gate. The engine researches
topics, writes scripts, records narration, generates visuals, edits, mixes music,
writes metadata, designs thumbnails and quality-checks every video. A person then
reviews it in the dashboard and approves it — **nothing is ever published without
that approval, and there is no auto-approve path anywhere in the code.**

```
apps/dashboard/       Next.js dashboard (review inbox, channels, activity, settings)
packages/pipeline/    the engine CLI (`npm run engine -- <command>`)
projects/<slug>/      one folder per channel: config.json, .env (secrets), output/
data/                 run database (SQLite) and logs
scripts/start.mjs     production entrypoint: dashboard + scheduler
```

## Run it locally

```bash
cp .env.example .env            # fill in the keys
npm install
npm run engine -- push-keys      # paste the three VAPID lines into .env (push notifications)
npm run dashboard                # http://localhost:3777  (dev)
npm run scheduler                # optional: makes videos on each channel's schedule
```

Production (dashboard + scheduler, auto-restart): `npm run build && npm start`, or
`docker compose up -d --build` (mounts `projects/` and `data/` as volumes).

## Client experience

1. **Setup wizard** (first visit): describe the channel in a sentence → the engine
   writes the full style guide → connect YouTube (Google consent screen) → enable
   notifications. About five minutes, no terminal.
2. **Review inbox** (home): every finished video waits here with thumbnail, duration and
   quality-check result. Open one to watch it, click through the script, then
   **Approve & publish**, **Request changes** (plain-English edit; only the affected parts
   are redone and every version is kept), or **Reject**.
3. **Notifications**: email (Resend) and/or push (works on desktop, Android and
   iPhone-as-home-screen-app) when a video is ready, published, or needs attention.
4. **Channels**: create more channels the same way; each has its own YouTube
   connection, voice, schedule, and optional Notion workspace.
5. **Talking-head channels** (optional): turn on *On-camera host* and describe the
   presenter; the hook, transitions and ending are delivered to camera by a consistent
   lip-synced host (OmniHuman on Replicate by default, or Higgsfield Speech2Video via
   Segmind), the rest stays cinematic B-roll.
6. **Notion** (optional, per channel): a hub page (the channel's brand brief, read by
   the engine on every run) plus four databases — Creator Teardowns, Content Ideas,
   Content Pipeline, Run Log. Ideas the client adds are scored nightly and the best
   ones are made automatically; every video's progress, publish URL and metrics land
   in the pipeline database.

See `docs/DEPLOY.md` for the end-to-end deployment runbook (server, Google Cloud,
keys, client hand-over), `docs/CLIENT-SETUP.md` for the onboarding you hand to a client,
and `docs/OPERATOR.md` for engines, keys and the CLI.

## Google OAuth note

The dashboard's "Connect YouTube" button uses the redirect
`<DASHBOARD_URL>/api/youtube/callback`. Add that exact URL to the OAuth client's
authorized redirect URIs in Google Cloud (a "Web application" client). The terminal
flow `npm run engine -- auth <slug>` still works as a fallback.
