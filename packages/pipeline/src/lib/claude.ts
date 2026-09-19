/** Shared "ask Claude, parse the JSON it returns" helper used by research/script/metadata/validate. */
import Anthropic from "@anthropic-ai/sdk";
import { secrets, requireSecrets } from "./env.js";

let client: Anthropic | null = null;

export function anthropic(): Anthropic {
  requireSecrets("anthropicApiKey");
  if (!client) client = new Anthropic({ apiKey: secrets.anthropicApiKey });
  return client;
}

export function textOf(response: Anthropic.Message): string {
  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/** Extract the first JSON object/array from model output; throws with the raw text on failure. */
export function parseJson<T>(text: string, shape: "object" | "array" = "object"): T {
  const match = text.match(shape === "array" ? /\[[\s\S]*\]/ : /\{[\s\S]*\}/);
  if (!match) throw new Error(`Model did not return JSON. Raw output:\n${text}`);
  return JSON.parse(match[0]) as T;
}
