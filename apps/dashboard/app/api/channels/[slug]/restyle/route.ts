import { NextRequest, NextResponse } from "next/server";
import { readConfig, writeConfig } from "../../../../../lib/engine";
import { tailorPrompts } from "../../../../../lib/tailor";

/** Rewrite the channel's style guide (all prompts + music + formats) from its description
 *  and an optional art-direction note, e.g. after the look isn't landing. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const config = readConfig(slug);
  if (!config) return new NextResponse("Channel not found", { status: 404 });
  const { direction } = await req.json().catch(() => ({ direction: "" }));
  try {
    const t = await tailorPrompts({
      name: config.name,
      description: `${config.niche}${direction ? `\n\nART DIRECTION FROM THE OWNER (must be followed): ${direction}` : ""}`,
      audience: config.audience.description,
      kids: !!config.audience.madeForKids,
      tone: direction || undefined,
      current: config.prompts,
    });
    Object.assign(config.prompts, t.prompts);
    if (t.music) config.music = { ...config.music, prompt: t.music };
    if (t.niche && !direction) config.niche = t.niche;
    writeConfig(slug, config);
    return NextResponse.json({ visualStyle: config.prompts.visualStyle });
  } catch (err) {
    return new NextResponse(`Could not rewrite the style guide: ${String(err).slice(0, 200)}`, { status: 500 });
  }
}
