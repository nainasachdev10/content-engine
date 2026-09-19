/**
 * Notion integration — the client-facing surface of the content engine.
 *
 * Connection model is PER PROJECT:
 *   projects/<slug>/.env          NOTION_TOKEN=secret_...   (internal integration token)
 *   projects/<slug>/notion.json   { hubPageId, hubUrl, databases: {...}, createdAt }  (gitignored)
 *
 * Everything in this module is a silent no-op when the project has no Notion
 * connection, and every sync helper catches its own errors — a Notion outage
 * must never fail a video run.
 *
 * Uses the REST API directly (no SDK) with version header 2022-06-28.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { parse as parseDotenv } from "dotenv";
import type { Project, ProjectConfig } from "./project.js";
import { ffprobePath } from "./env.js";
import { anthropic, textOf, parseJson } from "./claude.js";
import { ALL_FORMAT_KEYS } from "./formats.js";

const NOTION_VERSION = "2022-06-28";
const API = "https://api.notion.com/v1";

// ---------------------------------------------------------------------------
// Config / connection
// ---------------------------------------------------------------------------

export interface NotionIds {
  hubPageId: string;
  hubUrl: string;
  databases: {
    teardowns: string;
    ideas: string;
    pipeline: string;
    runLog: string;
  };
  createdAt: string;
}

export type DbKey = keyof NotionIds["databases"];

export const notionIdsPath = (project: Project): string => join(project.dir, "notion.json");

export function loadNotionIds(project: Project): NotionIds | null {
  const p = notionIdsPath(project);
  if (!existsSync(p)) return null;
  try {
    const ids = JSON.parse(readFileSync(p, "utf8")) as NotionIds;
    return ids?.databases?.pipeline ? ids : null;
  } catch {
    return null;
  }
}

export function saveNotionIds(project: Project, ids: NotionIds): void {
  writeFileSync(notionIdsPath(project), JSON.stringify(ids, null, 2));
}

/** True only when BOTH a token and a completed setup exist. */
export function notionConfigured(project: Project): boolean {
  return !!project.notionToken && !!loadNotionIds(project);
}

/** Accepts a raw id, a dashed uuid, or any Notion URL and returns the 32-hex id. */
export function extractNotionId(input: string): string {
  // Dashed uuid first (page ids in copied links), then a bare 32-hex run that is
  // not part of a longer hex-ish word ("Client-Hub-<id>" must not eat the "b").
  const dashed = input.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g);
  if (dashed?.length) return dashed[dashed.length - 1].replace(/-/g, "").toLowerCase();
  const bare = input.match(/(?<![0-9a-fA-F])[0-9a-fA-F]{32}(?![0-9a-fA-F])/g);
  if (bare?.length) return bare[bare.length - 1].toLowerCase();
  throw new Error(`Could not find a Notion page id in "${input}"`);
}

// ---------------------------------------------------------------------------
// REST plumbing: serialised requests, ≥350ms apart, retry on 429
// ---------------------------------------------------------------------------

const MIN_GAP_MS = 350;
let chain: Promise<unknown> = Promise.resolve();
let lastAt = 0;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function rawRequest(token: string, method: string, path: string, body?: unknown): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    const wait = MIN_GAP_MS - (Date.now() - lastAt);
    if (wait > 0) await sleep(wait);
    lastAt = Date.now();

    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (res.status === 429 && attempt < 4) {
      const retryAfter = Number(res.headers.get("Retry-After") ?? 1);
      await sleep(Math.max(1, retryAfter) * 1000);
      continue;
    }
    if (res.status >= 500 && attempt < 3) {
      await sleep(1000 * (attempt + 1));
      continue;
    }
    const text = await res.text();
    if (!res.ok) throw new Error(`Notion ${method} ${path} → ${res.status}: ${text.slice(0, 400)}`);
    return text ? JSON.parse(text) : {};
  }
}

/** All Notion traffic goes through one serialised chain so the rate limit holds process-wide. */
function notionRequest(token: string, method: string, path: string, body?: unknown): Promise<any> {
  const next = chain.then(
    () => rawRequest(token, method, path, body),
    () => rawRequest(token, method, path, body)
  );
  chain = next.catch(() => {});
  return next;
}

// ---------------------------------------------------------------------------
// Property builders (pure — unit tested)
// ---------------------------------------------------------------------------

const MAX_TEXT = 1900;

export function chunkText(s: string, size = MAX_TEXT): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
  return out.length ? out : [""];
}

const richArray = (s: string) => chunkText(s).map((t) => ({ type: "text", text: { content: t } }));

export const P = {
  title: (s?: string) => (s ? { title: richArray(s) } : undefined),
  rich: (s?: string | null) => (s ? { rich_text: richArray(s) } : undefined),
  select: (name?: string | null) => (name ? { select: { name: String(name).slice(0, 100) } } : undefined),
  multi: (names?: string[] | null) =>
    names?.length ? { multi_select: names.filter(Boolean).map((n) => ({ name: String(n).slice(0, 100) })) } : undefined,
  url: (u?: string | null) => (u ? { url: u } : undefined),
  number: (n?: number | null) => (typeof n === "number" && Number.isFinite(n) ? { number: n } : undefined),
  date: (iso?: string | null) => (iso ? { date: { start: iso } } : undefined),
  relation: (ids?: string[] | null) => (ids?.length ? { relation: ids.map((id) => ({ id })) } : undefined),
};

/** Drop undefined entries so callers can build property bags declaratively. */
export function props(bag: Record<string, unknown | undefined>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(bag)) if (v !== undefined) out[k] = v;
  return out;
}

export function paragraphBlocks(text: string): any[] {
  return chunkText(text).map((t) => ({
    object: "block",
    type: "paragraph",
    paragraph: { rich_text: [{ type: "text", text: { content: t } }] },
  }));
}

const heading2 = (text: string) => ({
  object: "block",
  type: "heading_2",
  heading_2: { rich_text: [{ type: "text", text: { content: text.slice(0, 1900) } }] },
});

const bullet = (text: string) => ({
  object: "block",
  type: "bulleted_list_item",
  bulleted_list_item: { rich_text: [{ type: "text", text: { content: text.slice(0, 1900) } }] },
});

// ---------------------------------------------------------------------------
// Database schemas (product-agnostic)
// ---------------------------------------------------------------------------

const TEXT = { rich_text: {} };

export const DB_TITLES: Record<DbKey, string> = {
  teardowns: "Creator Teardowns",
  ideas: "Content Ideas",
  pipeline: "Content Pipeline",
  runLog: "Run Log",
};

const sel = (...options: string[]) => ({ select: { options: options.map((name) => ({ name })) } });

function teardownSchema(): Record<string, any> {
  return {
    Creator: { title: {} },
    "Channel URL": { url: {} },
    Platform: sel("YouTube", "Shorts", "Instagram", "TikTok"),
    Subscribers: { number: {} },
    Niche: { multi_select: { options: [] } },
    "Their pillars": TEXT,
    "Hook style": TEXT,
    "Title + thumbnail pattern": TEXT,
    "Structure / pacing": TEXT,
    "Caption + CTA style": TEXT,
    Cadence: TEXT,
    "Steal this": TEXT,
    "Avoid this": TEXT,
    "Adaptation notes": TEXT,
    "Last audited": { date: {} },
    Status: sel("To audit", "Audited", "Applied"),
  };
}

function ideasSchema(teardownsDbId: string): Record<string, any> {
  return {
    Idea: { title: {} },
    "Source link": { url: {} },
    "Notes / expectation": TEXT,
    Pillar: { select: { options: [] } },
    Format: sel("Long-form", "Short", "Community post"),
    Score: { number: {} },
    Verdict: sel("Promote", "Park", "Kill"),
    "Audit notes": TEXT,
    "Source creator": { relation: { database_id: teardownsDbId, single_property: {} } },
    "Date added": { date: {} },
    Status: sel("To audit", "Audited", "Done"),
  };
}

function pipelineSchema(ideasDbId: string): Record<string, any> {
  return {
    Video: { title: {} },
    Pillar: { select: { options: [] } },
    Series: { select: { options: [] } },
    Format: sel(...ALL_FORMAT_KEYS, "Long-form", "Short"),
    "Target date": { date: {} },
    Hook: TEXT,
    "Title options": TEXT,
    "Thumbnail concept": TEXT,
    Length: { number: {} },
    CTA: TEXT,
    Effort: sel("Low", "Medium", "High"),
    "Source idea": { relation: { database_id: ideasDbId, single_property: {} } },
    "Publish URL": { url: {} },
    Views: { number: {} },
    CTR: { number: {} },
    "Avg view duration": { number: {} },
    "Subs gained": { number: {} },
    "Result notes": TEXT,
    "Run ID": TEXT,
    Status: sel("Idea", "Scripted", "Recorded", "Edited", "Scheduled", "Published", "Analysed", "Rejected"),
  };
}

function runLogSchema(): Record<string, any> {
  return {
    Run: { title: {} },
    Job: sel("Video run", "Teardown", "Ideas audit", "Metrics sync", "Research"),
    "Rows processed": { number: {} },
    Summary: TEXT,
    Errors: TEXT,
    Duration: { number: {} },
    Date: { date: {} },
  };
}

// ---------------------------------------------------------------------------
// Brand + hub rendering
// ---------------------------------------------------------------------------

export interface Brand {
  positioning?: string;
  pillars?: string[];
  hardRules?: string[];
  series?: string[];
  weeklyRhythm?: string;
  visualToneSystem?: string;
}

export interface HubSection {
  heading: string;
  paragraphs?: string[];
  bullets?: string[];
}

/** Pure: turn a project config into the hub page's sections. Unit tested. */
export function renderHubSections(config: ProjectConfig): HubSection[] {
  const brand = config.brand ?? {};
  const positioning = brand.positioning ?? `${config.name} — ${config.niche}`;
  const pillars = brand.pillars?.length ? brand.pillars : [];
  const hardRules = brand.hardRules?.length
    ? brand.hardRules
    : [
        ...config.prompts.scriptRules.split("\n").filter((l) => l.trim().startsWith("-")).map((l) => l.replace(/^\s*-\s*/, "")),
        ...config.prompts.validationChecklist.split("\n").filter((l) => l.trim()).map((l) => `Never: ${l.replace(/^\s*\d+\.\s*/, "")}`),
      ].slice(0, 12);
  const formats = config.video.formats?.length ? config.video.formats : ALL_FORMAT_KEYS;
  const rhythm =
    brand.weeklyRhythm ??
    `${config.schedule.cadencePerWeek} video${config.schedule.cadencePerWeek === 1 ? "" : "s"} per week, ` +
      `~${config.video.lengthMinutes} minutes each. Narrative formats in rotation: ${formats.join(", ")}.`;
  const visual = brand.visualToneSystem ?? `${config.prompts.visualStyle}\n\nThumbnails: ${config.prompts.thumbnailStyle}`;

  const sections: HubSection[] = [
    { heading: "Positioning", paragraphs: [positioning] },
    pillars.length
      ? { heading: "Pillars", bullets: pillars }
      : { heading: "Pillars", paragraphs: ["(not set yet — run `engine notion setup` again to derive them)"] },
    { heading: "Hard rules", bullets: hardRules.length ? hardRules : ["(none recorded)"] },
    { heading: "Target audience", paragraphs: [config.audience.description] },
    { heading: "Format mix / weekly rhythm", paragraphs: [rhythm] },
    { heading: "Series names", bullets: brand.series?.length ? brand.series : ["(no named series yet)"] },
    { heading: "Visual + tone system", paragraphs: visual.split("\n\n").filter(Boolean) },
  ];
  return sections;
}

/** Sections → Notion blocks. */
export function renderHub(config: ProjectConfig): any[] {
  const blocks: any[] = [];
  for (const s of renderHubSections(config)) {
    blocks.push(heading2(s.heading));
    for (const p of s.paragraphs ?? []) blocks.push(...paragraphBlocks(p));
    for (const b of s.bullets ?? []) blocks.push(bullet(b));
  }
  return blocks;
}

/** Plain-text version of the hub — the local fallback when the API is unreachable. */
export function renderHubText(config: ProjectConfig): string {
  return renderHubSections(config)
    .map((s) => `## ${s.heading}\n${[...(s.paragraphs ?? []), ...(s.bullets ?? []).map((b) => `- ${b}`)].join("\n")}`)
    .join("\n\n");
}

/**
 * Ensure config.brand.positioning/pillars exist — one Claude call (models.metadata),
 * persisted back into config.json so the hub is stable across setups.
 */
export async function ensureBrand(project: Project): Promise<Brand> {
  const { config } = project;
  if (config.brand?.pillars?.length && config.brand.positioning) return config.brand;

  const prompt = `You are naming the editorial backbone of a YouTube channel.

Channel name: ${config.name}
Niche: ${config.niche}
Audience: ${config.audience.description}
Typical video length: ${config.video.lengthMinutes} minutes, ${config.schedule.cadencePerWeek}/week.

Respond with ONLY JSON, no other text:
{"positioning": "one sentence describing exactly what this channel is and who it is for",
 "pillars": ["3 to 5 short content pillar names, 2-4 words each, that every video should belong to"],
 "series": ["0 to 3 recurring series names that would fit this channel"]}`;

  const res = await anthropic().messages.create({
    model: config.models.metadata,
    max_tokens: 1000,
    messages: [{ role: "user", content: prompt }],
  });
  const derived = parseJson<Brand>(textOf(res));

  const brand: Brand = {
    ...(config.brand ?? {}),
    positioning: config.brand?.positioning ?? derived.positioning,
    pillars: config.brand?.pillars?.length ? config.brand.pillars : (derived.pillars ?? []).slice(0, 5),
    series: config.brand?.series?.length ? config.brand.series : derived.series ?? [],
  };
  config.brand = brand;

  // Persist so the hub does not drift on every setup.
  const configPath = join(project.dir, "config.json");
  try {
    const onDisk = JSON.parse(readFileSync(configPath, "utf8"));
    onDisk.brand = brand;
    writeFileSync(configPath, JSON.stringify(onDisk, null, 2));
  } catch (err) {
    console.warn(`notion: could not persist derived brand into config.json: ${String(err)}`);
  }
  return brand;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function requireToken(project: Project): string {
  if (!project.notionToken) {
    throw new Error(
      `Project "${project.slug}" has no NOTION_TOKEN in ${join(project.dir, ".env")}.\n` +
        `Create an internal integration at https://www.notion.so/my-integrations, copy the token, then add:\n` +
        `  NOTION_TOKEN=secret_...`
    );
  }
  return project.notionToken;
}

async function listChildren(token: string, blockId: string): Promise<any[]> {
  const out: any[] = [];
  let cursor: string | undefined;
  do {
    const res = await notionRequest(
      token,
      "GET",
      `/blocks/${blockId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ""}`
    );
    out.push(...(res.results ?? []));
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return out;
}

async function createDatabase(
  token: string,
  parentPageId: string,
  title: string,
  properties: Record<string, any>
): Promise<string> {
  const res = await notionRequest(token, "POST", "/databases", {
    parent: { type: "page_id", page_id: parentPageId },
    title: [{ type: "text", text: { content: title } }],
    properties,
  });
  return res.id as string;
}

/**
 * Idempotent: reuses projects/<slug>/notion.json when present, otherwise looks for
 * an existing hub page (and existing child databases) under the parent before creating.
 */
export async function setupNotion(project: Project, opts: { parentPageId: string }): Promise<NotionIds> {
  const token = requireToken(project);
  const parentPageId = extractNotionId(opts.parentPageId);
  const hubTitle = `${project.config.name} — Hub`;

  await ensureBrand(project);

  const existing = loadNotionIds(project);
  let hubPageId = existing?.hubPageId ?? "";
  let hubUrl = existing?.hubUrl ?? "";

  if (hubPageId) {
    try {
      const page = await notionRequest(token, "GET", `/pages/${hubPageId}`);
      if (page.archived) hubPageId = "";
      else hubUrl = page.url ?? hubUrl;
    } catch {
      hubPageId = "";
    }
  }

  if (!hubPageId) {
    // Look for a hub page we made earlier under this parent (notion.json lost / new machine).
    const children = await listChildren(token, parentPageId);
    const match = children.find(
      (b) => b.type === "child_page" && b.child_page?.title === hubTitle && !b.archived
    );
    if (match) {
      hubPageId = match.id;
      const page = await notionRequest(token, "GET", `/pages/${hubPageId}`);
      hubUrl = page.url ?? "";
      console.log(`Found existing hub page "${hubTitle}".`);
    } else {
      const page = await notionRequest(token, "POST", "/pages", {
        parent: { type: "page_id", page_id: parentPageId },
        properties: { title: { title: [{ type: "text", text: { content: hubTitle } }] } },
        children: renderHub(project.config).slice(0, 100),
      });
      hubPageId = page.id;
      hubUrl = page.url ?? "";
      console.log(`Created hub page "${hubTitle}".`);
    }
  }

  // Reuse any databases already living under the hub (match by title).
  const hubChildren = await listChildren(token, hubPageId);
  const byTitle = new Map<string, string>();
  for (const b of hubChildren) {
    if (b.type === "child_database" && b.child_database?.title) byTitle.set(b.child_database.title, b.id);
  }

  const databases = { ...(existing?.databases ?? {}) } as NotionIds["databases"];
  const resolve = async (key: DbKey, schema: () => Record<string, any>): Promise<string> => {
    const known = databases[key];
    if (known) {
      try {
        const db = await notionRequest(token, "GET", `/databases/${known}`);
        if (!db.archived) return known;
      } catch {
        /* gone — recreate below */
      }
    }
    const found = byTitle.get(DB_TITLES[key]);
    if (found) {
      console.log(`Found existing database "${DB_TITLES[key]}".`);
      return found;
    }
    const id = await createDatabase(token, hubPageId, DB_TITLES[key], schema());
    console.log(`Created database "${DB_TITLES[key]}".`);
    return id;
  };

  databases.teardowns = await resolve("teardowns", teardownSchema);
  databases.ideas = await resolve("ideas", () => ideasSchema(databases.teardowns));
  databases.pipeline = await resolve("pipeline", () => pipelineSchema(databases.ideas));
  databases.runLog = await resolve("runLog", runLogSchema);

  const ids: NotionIds = {
    hubPageId,
    hubUrl,
    databases,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  };
  saveNotionIds(project, ids);
  invalidateHubCache(project);
  return ids;
}

// ---------------------------------------------------------------------------
// Hub context (read side, cached)
// ---------------------------------------------------------------------------

const HUB_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const hubCachePath = (project: Project) => join(project.dir, "state", "hub-cache.txt");

export function invalidateHubCache(project: Project): void {
  try {
    if (existsSync(hubCachePath(project))) writeFileSync(hubCachePath(project), "");
  } catch {
    /* ignore */
  }
}

function blockText(block: any): string {
  const t = block?.[block?.type];
  const rt: any[] = t?.rich_text ?? t?.title ?? [];
  const text = Array.isArray(rt) ? rt.map((r) => r.plain_text ?? r.text?.content ?? "").join("") : "";
  if (!text) return "";
  switch (block.type) {
    case "heading_1":
    case "heading_2":
    case "heading_3":
      return `\n## ${text}`;
    case "bulleted_list_item":
    case "numbered_list_item":
    case "to_do":
      return `- ${text}`;
    default:
      return text;
  }
}

/**
 * The client's hub page as plain text, for prompt injection.
 * Cached to projects/<slug>/state/hub-cache.txt for 6h so runs don't hammer the API.
 */
export async function readHubContext(project: Project): Promise<string | null> {
  if (!notionConfigured(project)) return null;
  const cache = hubCachePath(project);
  try {
    if (existsSync(cache)) {
      const st = statSync(cache);
      const cached = readFileSync(cache, "utf8");
      if (cached.trim() && Date.now() - st.mtimeMs < HUB_CACHE_TTL_MS) return cached;
    }
  } catch {
    /* fall through to fetch */
  }

  try {
    const token = requireToken(project);
    const ids = loadNotionIds(project)!;
    const blocks = await listChildren(token, ids.hubPageId);
    const text = blocks.map(blockText).filter(Boolean).join("\n").trim();
    if (!text) return null;
    try {
      mkdirSync(join(project.dir, "state"), { recursive: true });
      writeFileSync(cache, text);
    } catch {
      /* cache is best-effort */
    }
    return text;
  } catch (err) {
    console.warn(`notion: could not read hub context: ${String(err).slice(0, 200)}`);
    try {
      const stale = readFileSync(cache, "utf8");
      return stale.trim() || null;
    } catch {
      return null;
    }
  }
}

export const HUB_PROMPT_HEADER = "CHANNEL BRAND CONTEXT (from the client's Notion hub — follow it):";

/** Convenience for prompt builders: "" when no hub, otherwise a header + body + blank line. */
export async function hubPromptBlock(project: Project): Promise<string> {
  const hub = await readHubContext(project);
  return hub ? `${HUB_PROMPT_HEADER}\n${hub}\n\n` : "";
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

export async function queryDatabase(
  project: Project,
  db: DbKey,
  body: Record<string, unknown> = {}
): Promise<any[]> {
  const token = requireToken(project);
  const ids = loadNotionIds(project);
  if (!ids) return [];
  const out: any[] = [];
  let cursor: string | undefined;
  do {
    const res = await notionRequest(token, "POST", `/databases/${ids.databases[db]}/query`, {
      ...body,
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    out.push(...(res.results ?? []));
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return out;
}

export async function createPage(
  project: Project,
  db: DbKey,
  properties: Record<string, unknown>,
  children?: any[]
): Promise<string> {
  const token = requireToken(project);
  const ids = loadNotionIds(project)!;
  const res = await notionRequest(token, "POST", "/pages", {
    parent: { database_id: ids.databases[db] },
    properties,
    ...(children?.length ? { children: children.slice(0, 100) } : {}),
  });
  return res.id as string;
}

export async function updatePage(
  project: Project,
  pageId: string,
  properties: Record<string, unknown>
): Promise<void> {
  const token = requireToken(project);
  await notionRequest(token, "PATCH", `/pages/${pageId}`, { properties });
}

export async function appendBlocks(project: Project, pageId: string, children: any[]): Promise<void> {
  const token = requireToken(project);
  for (let i = 0; i < children.length; i += 100) {
    await notionRequest(token, "PATCH", `/blocks/${pageId}/children`, { children: children.slice(i, i + 100) });
  }
}

/** Plain title text of a database row, whatever the title property is called. */
export function pageTitle(page: any): string {
  const p = page?.properties ?? {};
  for (const v of Object.values<any>(p)) {
    if (v?.type === "title") return (v.title ?? []).map((r: any) => r.plain_text ?? "").join("").trim();
  }
  return "";
}

export const propText = (page: any, name: string): string => {
  const v = page?.properties?.[name];
  if (!v) return "";
  if (v.type === "rich_text") return (v.rich_text ?? []).map((r: any) => r.plain_text ?? "").join("");
  if (v.type === "title") return (v.title ?? []).map((r: any) => r.plain_text ?? "").join("");
  if (v.type === "url") return v.url ?? "";
  if (v.type === "select") return v.select?.name ?? "";
  if (v.type === "date") return v.date?.start ?? "";
  if (v.type === "number") return v.number == null ? "" : String(v.number);
  return "";
};

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

// ---------------------------------------------------------------------------
// Status mapping (pure — unit tested)
// ---------------------------------------------------------------------------

export type EngineSyncStatus =
  | "idea"
  | "scripted"
  | "recorded"
  | "edited"
  | "pending_approval"
  | "uploaded"
  | "rejected"
  | "failed";

const STATUS_MAP: Record<EngineSyncStatus, string | null> = {
  idea: "Idea",
  scripted: "Scripted",
  recorded: "Recorded",
  edited: "Edited",
  pending_approval: "Scheduled",
  uploaded: "Published",
  rejected: "Rejected",
  failed: null, // keep whatever status the row already has; the error goes in Result notes
};

export function notionStatusFor(status: EngineSyncStatus): string | null {
  return STATUS_MAP[status] ?? null;
}

// ---------------------------------------------------------------------------
// Sync helpers — every one is a no-op when unconfigured and never throws
// ---------------------------------------------------------------------------

async function guard<T>(project: Project, what: string, fn: () => Promise<T>): Promise<T | null> {
  if (!notionConfigured(project)) return null;
  try {
    return await fn();
  } catch (err) {
    console.warn(`notion: ${what} failed — ${String(err).slice(0, 300)}`);
    return null;
  }
}

export interface ResearchTopicLike {
  topic: string;
  angle?: string;
  why_now?: string;
}

/** One Content Ideas row per researched topic (deduped by title). */
export async function syncResearchIdeas(
  project: Project,
  topics: ResearchTopicLike[],
  runId?: string
): Promise<number> {
  const n = await guard(project, "syncResearchIdeas", async () => {
    const existing = new Set((await queryDatabase(project, "ideas")).map((p) => norm(pageTitle(p))));
    let created = 0;
    for (const [i, t] of topics.entries()) {
      if (!t?.topic || existing.has(norm(t.topic))) continue;
      await createPage(
        project,
        "ideas",
        props({
          Idea: P.title(t.topic),
          "Notes / expectation": P.rich(t.angle),
          Format: P.select("Long-form"),
          Score: P.number(Math.max(5, 10 - i)),
          Verdict: P.select(i === 0 ? "Promote" : "Park"),
          "Audit notes": P.rich(t.why_now ? `${t.why_now}${runId ? `\n(engine research ${runId})` : ""}` : undefined),
          "Date added": P.date(new Date().toISOString()),
          Status: P.select("Audited"),
        })
      );
      existing.add(norm(t.topic));
      created++;
    }
    console.log(`notion: ${created} idea row(s) synced.`);
    return created;
  });
  return n ?? 0;
}

async function probeDurationSec(file: string): Promise<number | undefined> {
  return new Promise((resolve) => {
    execFile(
      ffprobePath(),
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file],
      (err, stdout) => {
        const n = Number(String(stdout).trim());
        resolve(err || !Number.isFinite(n) ? undefined : Math.round(n));
      }
    );
  });
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

/** script.json → numbered paragraph blocks for the pipeline row's page body. */
export function scriptBlocks(script: { style_note?: string; scenes?: { narration?: string }[] }): any[] {
  const blocks: any[] = [];
  if (script.style_note) blocks.push(...paragraphBlocks(`Style: ${script.style_note}`));
  (script.scenes ?? []).forEach((s, i) => {
    if (s?.narration) blocks.push(...paragraphBlocks(`${i + 1}. ${s.narration}`));
  });
  return blocks;
}

export interface PipelineSyncOpts {
  runId: string;
  videoDir?: string;
  status: EngineSyncStatus;
  topic?: string;
  /** Pre-known Notion page to update (e.g. a row created by the ideas audit). */
  pageId?: string;
  extra?: Record<string, unknown>;
  error?: string;
  publishUrl?: string;
}

/** Upsert the Content Pipeline row for a run, keyed on Run ID. */
export async function syncPipelineRow(project: Project, opts: PipelineSyncOpts): Promise<string | null> {
  return guard(project, "syncPipelineRow", async () => {
    const script = opts.videoDir ? readJson<any>(join(opts.videoDir, "script.json")) : null;
    const metadata = opts.videoDir ? readJson<any>(join(opts.videoDir, "metadata.json")) : null;
    const title = opts.topic ?? script?.topic ?? metadata?.title ?? `Run ${opts.runId}`;

    // Find the row: explicit page id → Run ID match → same title.
    let pageId = opts.pageId ?? null;
    if (!pageId) {
      const byRun = await queryDatabase(project, "pipeline", {
        filter: { property: "Run ID", rich_text: { equals: opts.runId } },
      });
      pageId = byRun[0]?.id ?? null;
    }
    if (!pageId) {
      const all = await queryDatabase(project, "pipeline");
      pageId = all.find((p) => norm(pageTitle(p)) === norm(title))?.id ?? null;
    }

    const status = notionStatusFor(opts.status);
    const bag: Record<string, unknown | undefined> = {
      Video: P.title(title),
      "Run ID": P.rich(opts.runId),
      ...(status ? { Status: P.select(status) } : {}),
      ...(opts.error ? { "Result notes": P.rich(`Run failed: ${opts.error}`.slice(0, 1900)) } : {}),
      ...(opts.publishUrl ? { "Publish URL": P.url(opts.publishUrl) } : {}),
    };

    if (script) {
      bag.Hook = P.rich(script.scenes?.[0]?.narration);
      bag.Format = P.select(script.format);
    }
    if (metadata) {
      bag["Title options"] = P.rich(
        [metadata.title, metadata.thumbnail_text].filter(Boolean).join("\n")
      );
      bag["Thumbnail concept"] = P.rich(metadata.thumbnail_text ?? metadata.thumbnail_concept);
    }
    if (opts.videoDir) {
      const final = join(opts.videoDir, "final_video.mp4");
      if (existsSync(final)) bag.Length = P.number(await probeDurationSec(final));
    }
    Object.assign(bag, opts.extra ?? {});

    if (pageId) {
      await updatePage(project, pageId, props(bag));
      return pageId;
    }

    // First creation: link the originating idea row and write the script as the page body.
    const ideas = await queryDatabase(project, "ideas");
    const idea = ideas.find((p) => norm(pageTitle(p)) === norm(title));
    if (idea) bag["Source idea"] = P.relation([idea.id]);
    if (!bag.Format) bag.Format = P.select("Long-form");
    bag["Target date"] = P.date(new Date().toISOString());

    const created = await createPage(project, "pipeline", props(bag), script ? scriptBlocks(script) : undefined);
    console.log(`notion: pipeline row created for ${opts.runId}.`);
    return created;
  });
}

export interface RunLogEntry {
  job: "Video run" | "Teardown" | "Ideas audit" | "Metrics sync" | "Research";
  rowsProcessed: number;
  summary: string;
  errors?: string;
  durationSec?: number;
}

export async function appendRunLog(project: Project, entry: RunLogEntry): Promise<void> {
  await guard(project, "appendRunLog", async () => {
    const now = new Date();
    await createPage(
      project,
      "runLog",
      props({
        Run: P.title(`${now.toISOString().slice(0, 10)} — ${entry.job}`),
        Job: P.select(entry.job),
        "Rows processed": P.number(entry.rowsProcessed),
        Summary: P.rich(entry.summary),
        Errors: P.rich(entry.errors),
        Duration: P.number(entry.durationSec),
        Date: P.date(now.toISOString()),
      })
    );
    return true;
  });
}

// ---------------------------------------------------------------------------
// Idea queue — client ideas the engine's next scheduled run should pick up
// ---------------------------------------------------------------------------

export interface QueuedIdea {
  title: string;
  angle: string;
  notionPageId: string;
  /** Pipeline row created for this idea, so the run updates it instead of making a new one. */
  pipelinePageId?: string;
  addedAt: string;
}

export const ideaQueuePath = (project: Project): string => join(project.dir, "state", "idea-queue.json");

export function readIdeaQueue(project: Project): QueuedIdea[] {
  try {
    const q = JSON.parse(readFileSync(ideaQueuePath(project), "utf8"));
    return Array.isArray(q) ? q : [];
  } catch {
    return [];
  }
}

export function writeIdeaQueue(project: Project, queue: QueuedIdea[]): void {
  mkdirSync(join(project.dir, "state"), { recursive: true });
  writeFileSync(ideaQueuePath(project), JSON.stringify(queue, null, 2));
}

export function pushIdeaQueue(project: Project, idea: QueuedIdea): void {
  const q = readIdeaQueue(project);
  if (q.some((i) => norm(i.title) === norm(idea.title))) return;
  q.push(idea);
  writeIdeaQueue(project, q);
}

/** Pop the oldest queued client idea (returns null when the queue is empty). */
export function popIdeaQueue(project: Project): QueuedIdea | null {
  const q = readIdeaQueue(project);
  const next = q.shift();
  if (!next) return null;
  writeIdeaQueue(project, q);
  return next;
}
