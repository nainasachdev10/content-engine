# Autonomous YouTube Content Pipeline — Build Spec

## 1. Goal
A pipeline that, on a schedule, autonomously: researches a topic → writes a script →
generates voiceover → generates visuals → assembles a video with captions →
generates a thumbnail → writes title/description/tags → uploads to YouTube.
No manual step required once running, but every module must also be runnable/testable
in isolation. 

## 2. Niche (fill in before starting)
- Niche: ______________________ (e.g. "science facts for kids", "history explainers")
- Video length target: ______ minutes
- Posting cadence: ______ videos/week
- Made-for-kids channel? Y/N (changes upload flags + restrictions, see §9)

## 3. Architecture (modules)

| # | Module | Input | Output | Suggested tool |
|---|--------|-------|--------|-----------------|
| 1 | Topic Research | niche, `published_topics.json` | 5-10 candidate topics + angle | Claude API + web_search |
| 2 | Script Generation | chosen topic | script.json (scenes: narration + visual_description) | Claude API |
| 3 | Voiceover | script.json | voiceover.mp3 + word timestamps | ElevenLabs API (stock voice, not a real-person clone) |
| 4 | Visuals | scene visual_descriptions | 1 image per scene | Flux / DALL-E API, or Pexels/Pixabay API for stock |
| 5 | Video Assembly | images + voiceover.mp3 + timestamps | raw_video.mp4 | Remotion (preferred) or ffmpeg |
| 6 | Captions | timestamps + raw_video.mp4 | final_video.mp4 (burned-in captions) | ffmpeg drawtext/subtitles filter |
| 7 | Thumbnail | topic + key scene image | thumbnail.png | Flux/DALL-E + PIL text overlay |
| 8 | Metadata | topic, script | title, description, tags | Claude API |
| 9 | Upload | final_video.mp4, thumbnail.png, metadata | published video | YouTube Data API v3 |
| 10 | Orchestrator | — | runs 1-9 in sequence, logs, retries | Node/Python script |
| 11 | Scheduler | — | triggers orchestrator on cadence | cron / GitHub Actions |
| 12 | State store | — | tracks published topics, avoids dupes | `published_topics.json` or SQLite |

## 4. Tech stack
- Language: Node.js (fits Remotion) or Python —m pick one, don't mix unnecessarily.
- Video: Remotion (React-based, code-driven rendering).
- Orchestration glue: single script, not n8n, for the MVP (n8n comes later if you want a visual layer on top — see §8).
- State: flat JSON file is enough at this scale. No DB needed yet.

## 5. Accounts/API keys needed (create these yourself — Claude cannot create accounts or enter credentials for you)
- Anthropic API key (Claude — script/topic/metadata generation)
- ElevenLabs API key (voiceover)
- Flux (via Replicate or fal.ai) or OpenAI API key (thumbnail/scene images)
- Google Cloud project with YouTube Data API v3 enabled + OAuth2 credentials (upload)
- Optional: Pexels/Pixabay API key if using stock footage instead of AI images

## 6. Folder structure
```
youtube-pipeline/
  src/
    research.ts
    script.ts
    voiceover.ts
    visuals.ts
    render/           <- Remotion project
    captions.ts
    thumbnail.ts
    metadata.ts
    upload.ts
    orchestrator.ts
  state/
    published_topics.json
  output/
    <video_id>/
      voiceover.mp3
      images/
      final_video.mp4
      thumbnail.png
  .env
  package.json
```

## 7. Environment variables (.env)
```
ANTHROPIC_API_KEY=
ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID=
IMAGE_API_KEY=
YOUTUBE_CLIENT_ID=
YOUTUBE_CLIENT_SECRET=
YOUTUBE_REFRESH_TOKEN=
NICHE=
VIDEO_LENGTH_MINUTES=
```

## 8. Build phases (in order — don't skip ahead)
1. **Phase 1 — modules in isolation.** Each of modules 1-9 runnable standalone via CLI command, printing/saving its output. Verify each output manually before wiring together.
2. **Phase 2 — orchestrator, manual trigger.** Chain 1-9 into one script, run manually end-to-end, inspect the final video before upload step is enabled.
3. **Phase 3 — upload enabled, still manual trigger.** Confirm a real video publishes correctly (privacy set to "unlisted" or "private" for the first few test runs).
4. **Phase 4 — scheduler on.** Add cron/GitHub Actions trigger. Only flip this on once Phase 3 has produced several videos you're happy with.
5. **Phase 5 (optional) — visual layer.** If you want a no-code view on top for tweaking prompts/branching without redeploying code, export the orchestrator's steps as an n8n workflow that calls the same underlying scripts.

## 9. Compliance notes
- YouTube requires AI-disclosure only for realistic content that could mislead a viewer. Illustrated/animated visuals + a stock (non-cloned) TTS voice generally do **not** require the "Altered or synthetic content" toggle — confirm per video if visuals ever lean photorealistic.
- If this is a kids-niche channel, set `selfDeclaredMadeForKids: true` on upload — this disables personalized ads, comments, and some other features. Decide this before building the metadata module, since it changes the upload payload.
- Don't clone a real person's voice without consent — use a stock ElevenLabs voice.

## 10. Definition of done for MVP
A single command runs the full pipeline for one topic and produces an unlisted, correctly-tagged YouTube video with captions and a thumbnail, without any manual editing step.