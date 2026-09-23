import { NextRequest, NextResponse } from "next/server";
import { execEngine, readConfig, writeConfig, repoRoot } from "../../../lib/engine";
import { tailorPrompts } from "../../../lib/tailor";
import { existsSync } from "node:fs";
import { join } from "node:path";

const ALL_FORMATS = ["story", "mystery", "countdown", "versus", "journey", "mythbusting", "how-it-works", "what-if"];

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "channel";

/**
 * Create a channel from a plain-language description. `engine init` scaffolds the
 * folder with the generic template, then Claude tailors every prompt (niche, audience,
 * script rules, visual style, thumbnail style, music, formats) to the description.
 */
export async function POST(req: NextRequest) {
  const { name, description, audience, kids, lengthMinutes, perWeek, tone, presenter, presenterDesc } = await req.json();
  if (!name || !description || String(description).length < 15) return new NextResponse("Tell us a bit more about the channel", { status: 400 });

  let slug = slugify(name);
  for (let i = 2; existsSync(join(repoRoot, "projects", slug)); i++) slug = `${slugify(name)}-${i}`;

  const init = await execEngine(["init", slug, "--niche", String(description).slice(0, 500), "--name", String(name).slice(0, 80)]);
  if (!init.ok) return new NextResponse(init.out.slice(-500), { status: 500 });
  const config = readConfig(slug);

  // Plain-language answers → structured settings, then Claude writes the prompts.
  config.video.lengthMinutes = Math.min(30, Math.max(1, Number(lengthMinutes) || 5));
  config.schedule.cadencePerWeek = Math.min(21, Math.max(1, Number(perWeek) || 3));
  // Channels made through the wizard run on their schedule out of the box (still approval-gated).
  config.schedule.autoRun = true;
  config.audience.madeForKids = !!kids;
  config.audience.description = audience || (kids ? "kids aged 6-10" : "a general audience curious about this topic");
  config.video.visualsMode = "hybrid";
  if (presenter) {
    config.presenter = { enabled: true, provider: "omnihuman", description: String(presenterDesc || "").slice(0, 300), share: 0.35 };
  }

  try {
    const tailored = await tailorPrompts({ name, description, audience: config.audience.description, kids: !!kids, tone, current: config.prompts });
    Object.assign(config.prompts, tailored.prompts);
    if (tailored.music) config.music = { ...config.music, prompt: tailored.music };
    if (Array.isArray(tailored.formats) && tailored.formats.length >= 3) {
      config.video.formats = tailored.formats.filter((f: string) => ALL_FORMATS.includes(f));
    }
    if (tailored.niche) config.niche = tailored.niche;
  } catch (err) {
    // The generic template still works; the client can refine prompts in settings.
    console.warn(`channel tailoring skipped: ${String(err).slice(0, 200)}`);
  }
  writeConfig(slug, config);
  return NextResponse.json({ slug });
}
