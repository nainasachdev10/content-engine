import { NextRequest, NextResponse } from "next/server";
import { readConfig, writeConfig } from "../../../../../lib/engine";

const REQUIRED: [string, (v: any) => boolean, string][] = [
  ["name", (v) => typeof v === "string" && v.length > 0, "Give the channel a name"],
  ["niche", (v) => typeof v === "string" && v.length > 10, "Describe what the channel is about"],
  ["video.lengthMinutes", (v) => Number.isFinite(v) && v >= 1 && v <= 30, "Video length must be 1-30 minutes"],
  ["video.visualsMode", (v) => ["slideshow", "hybrid", "video"].includes(v), "Bad visuals mode"],
  ["video.renderer", (v) => ["hyperframes", "ffmpeg"].includes(v), "Bad renderer"],
  ["voice.voiceId", (v) => typeof v === "string" && v.length > 5, "Narrator voice is required"],
  ["audience.description", (v) => typeof v === "string" && v.length > 0, "Describe the audience"],
  ["schedule.cadencePerWeek", (v) => Number.isFinite(v) && v >= 1 && v <= 21, "Videos per week must be 1-21"],
  ["youtube.defaultPrivacy", (v) => ["public", "unlisted", "private"].includes(v), "Bad privacy setting"],
  ["prompts.scriptRules", (v) => typeof v === "string" && v.length > 20, "Writing rules are required"],
  ["prompts.visualStyle", (v) => typeof v === "string" && v.length > 10, "Visual style is required"],
  ["prompts.thumbnailStyle", (v) => typeof v === "string" && v.length > 10, "Thumbnail style is required"],
  ["prompts.metadataGuidance", (v) => typeof v === "string" && v.length > 10, "Title & description rules are required"],
  ["prompts.validationChecklist", (v) => typeof v === "string" && v.length > 10, "Quality-check list is required"],
];

const get = (o: any, path: string) => path.split(".").reduce((x, k) => (x == null ? undefined : x[k]), o);

function deepMerge(base: any, over: any): any {
  if (Array.isArray(over) || typeof over !== "object" || over === null) return over;
  const out = { ...base };
  for (const k of Object.keys(over)) out[k] = deepMerge(base?.[k], over[k]);
  return out;
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  if (!/^[a-z0-9-]+$/.test(slug)) return new NextResponse("Bad slug", { status: 400 });
  const current = readConfig(slug);
  if (!current) return new NextResponse("Channel not found", { status: 404 });

  const incoming = await req.json();
  for (const [path, check, msg] of REQUIRED) {
    if (!check(get(incoming, path))) return new NextResponse(msg, { status: 400 });
  }
  // Deep-merge so nested fields the form doesn't expose (models, captionTheme, brand…) survive.
  writeConfig(slug, deepMerge(current, incoming));
  return new NextResponse("saved");
}
