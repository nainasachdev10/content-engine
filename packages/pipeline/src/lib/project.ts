/**
 * Per-project (per-channel/niche) configuration.
 *
 * A project is a folder under projects/<slug>/ containing:
 *   config.json  — all niche-specific settings and prompt text (committed)
 *   .env         — channel-specific secrets: YOUTUBE_REFRESH_TOKEN, NOTION_TOKEN (gitignored)
 *   notion.json  — Notion hub/database ids written by `engine notion setup` (gitignored)
 *   state/published_topics.json
 *   output/<video-slug>/...
 *
 * Adding a new niche = `engine init <slug>` + editing config.json. No code changes.
 */
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseDotenv } from "dotenv";
import { repoRoot } from "./env.js";

export interface ProjectConfig {
  name: string;
  niche: string;
  language?: string;
  video: {
    lengthMinutes: number;
    visualsMode: "slideshow" | "hybrid" | "video";
    heroScenes: "auto" | number[];
    renderer: "hyperframes" | "ffmpeg";
    /** Allowed narrative formats (keys from lib/formats.ts). Default: all. */
    formats?: string[];
    /** Image-to-video engine for hero scenes: "replicate" (default) or "higgsfield" (DoP). */
    clipProvider?: "replicate" | "higgsfield";
    /** Model id on that provider (defaults: kwaivgi/kling-v2.5-turbo-pro / higgsfield-ai/dop/standard). */
    clipModel?: string;
    /** Replicate image model for stills/thumbnails (default black-forest-labs/flux-1.1-pro). */
    imageModel?: string;
  };
  voice: {
    provider: "elevenlabs";
    voiceId: string;
    modelId: string;
    /** ElevenLabs voice_settings — lower stability + some style = livelier, less robotic read. */
    settings?: {
      stability?: number;
      similarity_boost?: number;
      style?: number;
      speed?: number;
    };
  };
  /** Background music bed, generated once per project (Replicate musicgen) and
   *  ducked under the voiceover at mix time. */
  music?: {
    enabled: boolean;
    prompt: string;
    /** Music loudness relative to full scale, in dB (default -21). */
    gainDb?: number;
  };
  /** Talking-head host: scenes the script marks shot:"presenter" become lip-synced clips
   *  of a consistent presenter (projects/<slug>/assets/presenter.png). */
  presenter?: {
    enabled: boolean;
    /** "omnihuman" (Replicate, default) or "higgsfield" (Speech2Video via Segmind). */
    provider?: "omnihuman" | "higgsfield";
    /** Who the host is, e.g. "a warm woman in her 40s with short grey hair, marine-biologist vibe". */
    description?: string;
    /** Rough fraction of scenes on camera (default 0.35). */
    share?: number;
  };
  audience: {
    madeForKids: boolean;
    description: string;
  };
  prompts: {
    scriptRules: string;
    visualStyle: string;
    thumbnailStyle: string;
    metadataGuidance: string;
    validationChecklist: string;
  };
  captionTheme?: {
    fontSize?: number;
    fontFamily?: string;
  };
  youtube: {
    categoryId: string;
    defaultPrivacy: "private" | "unlisted" | "public";
    channelUrl?: string;
  };
  schedule: {
    cadencePerWeek: number;
  };
  models: {
    research: string;
    script: string;
    metadata: string;
    validate: string;
  };
  /** Editorial backbone shown on the Notion hub page. Derived once (see lib/notion.ts
   *  ensureBrand) and persisted here so the hub stays stable across setups. */
  brand?: {
    positioning?: string;
    pillars?: string[];
    hardRules?: string[];
    series?: string[];
    weeklyRhythm?: string;
    visualToneSystem?: string;
  };
}

export interface Project {
  slug: string;
  dir: string;
  outputRoot: string;
  stateFile: string;
  config: ProjectConfig;
  /** From projects/<slug>/.env — empty string until the channel's OAuth token is set up. */
  youtubeRefreshToken: string;
  /** From projects/<slug>/.env — empty string until the client connects Notion. */
  notionToken: string;
}

export const projectsRoot = join(repoRoot, "projects");

const REQUIRED_PATHS = [
  "name",
  "niche",
  "video.lengthMinutes",
  "video.visualsMode",
  "video.renderer",
  "voice.voiceId",
  "voice.modelId",
  "audience.madeForKids",
  "audience.description",
  "prompts.scriptRules",
  "prompts.visualStyle",
  "prompts.thumbnailStyle",
  "prompts.metadataGuidance",
  "prompts.validationChecklist",
  "youtube.categoryId",
  "youtube.defaultPrivacy",
  "schedule.cadencePerWeek",
  "models.research",
  "models.script",
  "models.metadata",
  "models.validate",
] as const;

function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<any>((o, k) => (o == null ? undefined : o[k]), obj);
}

export function listProjects(): string[] {
  if (!existsSync(projectsRoot)) return [];
  return readdirSync(projectsRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(projectsRoot, d.name, "config.json")))
    .map((d) => d.name)
    .sort();
}

export function loadProject(slug: string): Project {
  const dir = join(projectsRoot, slug);
  const configPath = join(dir, "config.json");
  if (!existsSync(configPath)) {
    const known = listProjects();
    throw new Error(
      `No project "${slug}" (missing ${configPath}).` +
        (known.length ? ` Known projects: ${known.join(", ")}` : " Create one with: engine init <slug>")
    );
  }

  const config = JSON.parse(readFileSync(configPath, "utf8")) as ProjectConfig;
  const missing = REQUIRED_PATHS.filter((p) => {
    const v = getPath(config, p);
    return v === undefined || v === null || v === "";
  });
  if (missing.length > 0) {
    throw new Error(`Project "${slug}" config.json is missing required field(s): ${missing.join(", ")}`);
  }

  // Project-scoped secrets are parsed directly (not merged into process.env) so
  // two projects loaded in one process can never leak tokens into each other.
  const envPath = join(dir, ".env");
  const projectEnv = existsSync(envPath) ? parseDotenv(readFileSync(envPath, "utf8")) : {};

  const stateDir = join(dir, "state");
  const stateFile = join(stateDir, "published_topics.json");
  mkdirSync(stateDir, { recursive: true });
  if (!existsSync(stateFile)) writeFileSync(stateFile, JSON.stringify({ topics: [] }, null, 2));

  return {
    slug,
    dir,
    outputRoot: join(dir, "output"),
    stateFile,
    config,
    youtubeRefreshToken: projectEnv.YOUTUBE_REFRESH_TOKEN ?? "",
    notionToken: projectEnv.NOTION_TOKEN ?? "",
  };
}

/** Template written by `engine init` — generic, usable as-is, every field editable. */
export function defaultConfig(name: string, niche: string): ProjectConfig {
  return {
    name,
    niche,
    language: "en",
    video: { lengthMinutes: 5, visualsMode: "slideshow", heroScenes: "auto", renderer: "hyperframes" },
    voice: {
      provider: "elevenlabs",
      voiceId: "Xb7hH8MSUJpSbSDYk0k2",
      modelId: "eleven_multilingual_v2",
      settings: { stability: 0.4, similarity_boost: 0.75, style: 0.25 },
    },
    music: {
      enabled: true,
      prompt:
        "gentle ambient instrumental bed, warm and unobtrusive, soft pads and light percussion, no strong melody, background music for spoken narration, no vocals",
      gainDb: -21,
    },
    audience: { madeForKids: false, description: "a general audience curious about this topic" },
    prompts: {
      scriptRules: [
        "RETENTION (keep them watching):",
        '- SCENE 1 (the hook): open cold with the single most fascinating fact or question of the whole video in the FIRST sentence — no greetings, no "today we\'ll learn about". Then promise a payoff.',
        "- CURIOSITY LOOPS: open a question early that only gets answered near the end, and remind viewers it's coming.",
        '- RE-HOOKS: every 3-4 scenes, drop a pattern interrupt — "but here\'s the interesting part" or a direct question to the viewer.',
        "- ENDING: deliver the payoff of the opening question, then tease a follow-up question, plus a quick like/subscribe ask.",
        "QUALITY:",
        "- HONESTY: no sensationalism, exaggeration, or misleading claims. Every fact must be genuinely true.",
        "- LANGUAGE: short clear sentences, vivid concrete comparisons, no unexplained jargon.",
      ].join("\n"),
      visualStyle:
        "Editorial documentary photography look: natural light, real-world materials and textures, restrained color grade (muted midtones, no neon), 35mm lens perspective, subjects mid-action with foreground/background depth. Believable, specific, and grounded — never glossy CGI, glowing effects or symmetrical hero poses.",
      thumbnailStyle:
        "Bold, high-contrast YouTube thumbnail composition: the video's most striking subject large in the right two-thirds with soft glowing rim lighting, vibrant complementary colors, simple uncluttered background, and a clearly darker empty area covering the left third reserved for text. Honest — never misleading shock imagery.",
      metadataGuidance:
        "Metadata must be honest and accurate: title under 70 chars, curiosity-driven but never clickbait or ALL-CAPS hype; description 2-3 paragraphs with the hook in the first 2 lines, ending with 3-5 relevant hashtags; 15-25 genuinely relevant tags with no keyword stuffing.",
      validationChecklist: [
        "1. Sensationalism, shock-bait, exaggerated or misleading claims (in narration, title, description, OR thumbnail)",
        "2. Clickbait mismatch: thumbnail/title promising something the video doesn't deliver",
        "3. Low-quality/inauthentic signals: keyword stuffing, repetitive filler, no genuine value to the viewer",
        "4. Factual claims that are wrong or unverifiable",
      ].join("\n"),
    },
    captionTheme: { fontSize: 58, fontFamily: '"Arial Rounded MT Bold", "Helvetica Rounded", Arial, sans-serif' },
    youtube: { categoryId: "27", defaultPrivacy: "unlisted", channelUrl: "" },
    schedule: { cadencePerWeek: 3 },
    models: {
      research: "claude-opus-4-8",
      script: "claude-opus-4-8",
      metadata: "claude-opus-4-8",
      validate: "claude-sonnet-5",
    },
  };
}
