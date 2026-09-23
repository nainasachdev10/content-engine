/** Claude writes a channel's production prompts (style guide, rules, music, formats) from a plain description. */
import { keyValue } from "./engine";

export async function tailorPrompts(input: {
  name: string;
  description: string;
  audience: string;
  kids: boolean;
  tone?: string;
  current: Record<string, string>;
}): Promise<{ niche?: string; prompts: Record<string, string>; music?: string; formats?: string[] }> {
  const key = keyValue("ANTHROPIC_API_KEY");
  if (!key) throw new Error("ANTHROPIC_API_KEY missing");
  const prompt = `You are configuring an automated YouTube channel. Write the production prompts for it.

Channel name: ${input.name}
What the owner said it's about: ${input.description}
Audience: ${input.audience}${input.kids ? " (MADE FOR KIDS — must satisfy YouTube Kids quality and monetization policy: calm, wonder-based, never scary/gross, strictly honest and educational)" : ""}
Tone the owner wants: ${input.tone || "not specified — pick what fits the niche"}

Here are the current generic prompts; rewrite each one so it is specific to THIS channel (keep the same structure and section headings, keep every honesty/no-clickbait rule, add niche-specific guidance, comparisons and vocabulary):
${JSON.stringify(input.current, null, 2)}

For "visualStyle" specifically: write real art direction, not adjectives. Name (1) a concrete artistic tradition or medium that suits the subject (e.g. "Kangra miniature painting meets Raja Ravi Varma oil portraiture", "1970s National Geographic photography", "Ghibli-style hand-painted cel animation", "documentary macro photography"), (2) palette and pigments/film stock, (3) light and lens character, (4) the iconography/period/costume/species rules that must be respected, and (5) what to avoid (glossy CGI, neon saturation, glowing eyes, symmetrical hero poses). This text is pasted into every image prompt.

Also:
- "niche": one precise sentence describing the niche for a content strategist (used in research), starting with the subject matter — no marketing fluff.
- "music": a one-sentence prompt for a background music bed suited to this channel (instrumental, unobtrusive, "no vocals").
- "formats": choose 4-8 of these narrative formats that suit the channel: story, mystery, countdown, versus, journey, mythbusting, how-it-works, what-if.

Respond with ONLY JSON: {"niche": "...", "prompts": {"scriptRules": "...", "visualStyle": "...", "thumbnailStyle": "...", "metadataGuidance": "...", "validationChecklist": "..."}, "music": "...", "formats": [...]}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-5", max_tokens: 4000, messages: [{ role: "user", content: prompt }] }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}`);
  const j = await res.json();
  const text = (j.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("no JSON");
  return JSON.parse(m[0]);
}
