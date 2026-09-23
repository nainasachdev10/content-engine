/**
 * Notifications — tells the reviewer when something needs them.
 *
 * Two channels, both optional and configured in the root .env:
 *   email  — Resend (RESEND_API_KEY, NOTIFY_EMAIL_TO, optional NOTIFY_EMAIL_FROM)
 *   push   — Web Push to every browser/phone subscribed from the dashboard
 *            (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY; generate with `engine push-keys`)
 *   telegram — a bot (TELEGRAM_BOT_TOKEN) messages every chat that has said /start to it
 *            (chats are stored in telegram_chats; see registerTelegramChats)
 *
 * Events are fire-and-forget: a notification failure is logged and never fails a run.
 */
import webpush from "web-push";
import { openDb } from "./db.js";
import { repoRoot } from "./env.js";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export type NotifyKind = "video_ready" | "run_failed" | "upload_done" | "upload_failed" | "edit_done" | "edit_failed";

export interface Notification {
  kind: NotifyKind;
  project: string;
  title: string;
  body: string;
  /** Dashboard path the notification should open, e.g. /review/run-abc123 */
  path: string;
  runId?: string;
  /** Repo-relative or absolute path to a thumbnail to embed in the email. */
  thumbnailPath?: string;
}

const env = (k: string) => process.env[k]?.trim() ?? "";

export function dashboardUrl(): string {
  return env("DASHBOARD_URL").replace(/\/$/, "") || "http://localhost:3777";
}

export function notifyStatus(): { email: boolean; push: boolean; pushSubscribers: number; telegram: boolean; telegramChats: number } {
  const email = !!(env("RESEND_API_KEY") && env("NOTIFY_EMAIL_TO"));
  const push = !!(env("VAPID_PUBLIC_KEY") && env("VAPID_PRIVATE_KEY"));
  let pushSubscribers = 0;
  let telegramChats = 0;
  try {
    pushSubscribers = (openDb().prepare("SELECT COUNT(*) AS n FROM push_subscriptions").get() as { n: number }).n;
    telegramChats = (openDb().prepare("SELECT COUNT(*) AS n FROM telegram_chats").get() as { n: number }).n;
  } catch {
    /* table not created yet */
  }
  return { email, push, pushSubscribers, telegram: !!env("TELEGRAM_BOT_TOKEN"), telegramChats };
}

/* ---------------- Telegram ---------------- */

const tg = (method: string) => `https://api.telegram.org/bot${env("TELEGRAM_BOT_TOKEN")}/${method}`;

/** Poll the bot for new chats that said /start and remember them (no webhook needed). */
export async function registerTelegramChats(): Promise<{ added: number; total: number; botName?: string }> {
  if (!env("TELEGRAM_BOT_TOKEN")) return { added: 0, total: 0 };
  const db = openDb();
  const me = (await (await fetch(tg("getMe"))).json()) as any;
  if (!me.ok) throw new Error(`Telegram rejected the bot token: ${me.description ?? me.error_code}`);
  const updates = (await (await fetch(tg("getUpdates?timeout=0"))).json()) as any;
  let added = 0;
  for (const u of updates.result ?? []) {
    const chat = u.message?.chat ?? u.my_chat_member?.chat;
    if (!chat?.id) continue;
    const name = [chat.first_name, chat.last_name, chat.title, chat.username && `@${chat.username}`].filter(Boolean).join(" ");
    const r = db
      .prepare("INSERT OR IGNORE INTO telegram_chats (chat_id, name, created_at) VALUES (?, ?, ?)")
      .run(String(chat.id), name, new Date().toISOString());
    if (r.changes) {
      added++;
      await fetch(tg("sendMessage"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chat.id, text: "Connected. You'll get a message here whenever a video is ready for your review, is published, or needs attention." }),
      });
    }
  }
  const total = (db.prepare("SELECT COUNT(*) AS n FROM telegram_chats").get() as { n: number }).n;
  return { added, total, botName: me.result?.username };
}

async function sendTelegram(n: Notification, url: string): Promise<void> {
  if (!env("TELEGRAM_BOT_TOKEN")) return;
  const chats = openDb().prepare("SELECT chat_id FROM telegram_chats").all() as { chat_id: string }[];
  if (!chats.length) return;
  const cta = ctaLabel(n.kind);
  const caption = `*${escapeMd(n.title)}*\n${escapeMd(n.body)}`;
  // Telegram only accepts public http(s) button URLs; on localhost fall back to plain text.
  const buttonOk = /^https?:\/\/(?!localhost|127\.)/.test(url);
  const reply_markup = buttonOk ? { inline_keyboard: [[{ text: cta, url }]] } : undefined;
  const captionFull = buttonOk ? caption : `${caption}\n${escapeMd(url)}`;
  const thumb = n.thumbnailPath ? (n.thumbnailPath.startsWith("/") ? n.thumbnailPath : join(repoRoot, n.thumbnailPath)) : null;
  let sent = 0;
  for (const c of chats) {
    let res: Response;
    if (thumb && existsSync(thumb)) {
      const form = new FormData();
      form.append("chat_id", c.chat_id);
      form.append("photo", new Blob([readFileSync(thumb)], { type: "image/png" }), "thumbnail.png");
      form.append("caption", captionFull);
      form.append("parse_mode", "MarkdownV2");
      if (reply_markup) form.append("reply_markup", JSON.stringify(reply_markup));
      res = await fetch(tg("sendPhoto"), { method: "POST", body: form });
    } else {
      res = await fetch(tg("sendMessage"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: c.chat_id, text: captionFull, parse_mode: "MarkdownV2", ...(reply_markup ? { reply_markup } : {}) }),
      });
    }
    if (res.ok) sent++;
    else {
      const body = await res.text();
      // 403 = the user blocked the bot; forget the chat.
      if (res.status === 403) openDb().prepare("DELETE FROM telegram_chats WHERE chat_id = ?").run(c.chat_id);
      else console.warn(`notify: telegram ${res.status}: ${body.slice(0, 120)}`);
    }
  }
  if (sent) console.log(`notify: telegram sent to ${sent} chat${sent === 1 ? "" : "s"}`);
}

const escapeMd = (s: string) => s.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (c) => `\\${c}`);

export async function notify(n: Notification): Promise<void> {
  const url = `${dashboardUrl()}${n.path}`;
  const results = await Promise.allSettled([sendEmail(n, url), sendPush(n, url), sendTelegram(n, url)]);
  for (const r of results) {
    if (r.status === "rejected") console.warn(`notify: ${String(r.reason).slice(0, 200)}`);
  }
  try {
    openDb()
      .prepare("INSERT INTO notifications (kind, project, run_id, title, body, path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(n.kind, n.project, n.runId ?? null, n.title, n.body, n.path, new Date().toISOString());
  } catch (err) {
    console.warn(`notify: could not record notification: ${String(err)}`);
  }
}

async function sendEmail(n: Notification, url: string): Promise<void> {
  const key = env("RESEND_API_KEY");
  const to = env("NOTIFY_EMAIL_TO");
  if (!key || !to) return;
  const from = env("NOTIFY_EMAIL_FROM") || "Content Engine <onboarding@resend.dev>";

  const attachments: { filename: string; content: string }[] = [];
  let thumbHtml = "";
  if (n.thumbnailPath) {
    const abs = n.thumbnailPath.startsWith("/") ? n.thumbnailPath : join(repoRoot, n.thumbnailPath);
    if (existsSync(abs)) {
      attachments.push({ filename: "thumbnail.png", content: readFileSync(abs).toString("base64") });
      thumbHtml = `<img src="cid:thumbnail.png" alt="" style="width:100%;max-width:480px;border-radius:10px;display:block;margin:0 0 18px" />`;
    }
  }
  const cta = ctaLabel(n.kind);
  const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:28px 20px;color:#232329">
  <p style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#71717a;margin:0 0 10px">${escapeHtml(n.project)}</p>
  <h1 style="font-size:20px;line-height:1.3;margin:0 0 14px;color:#17171a">${escapeHtml(n.title)}</h1>
  ${thumbHtml}
  <p style="font-size:15px;line-height:1.55;margin:0 0 22px;white-space:pre-line">${escapeHtml(n.body)}</p>
  <a href="${url}" style="display:inline-block;background:#17171a;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 18px;border-radius:8px">${cta}</a>
  <p style="font-size:12px;color:#a1a1aa;margin:26px 0 0">Nothing is published until you approve it in the dashboard.</p>
</div>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: to.split(",").map((s) => s.trim()).filter(Boolean),
      subject: n.title,
      html,
      attachments: attachments.map((a) => ({ ...a, content_id: a.filename })),
    }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
  console.log(`notify: email sent → ${to}`);
}

async function sendPush(n: Notification, url: string): Promise<void> {
  const pub = env("VAPID_PUBLIC_KEY");
  const priv = env("VAPID_PRIVATE_KEY");
  if (!pub || !priv) return;
  const db = openDb();
  const subs = db.prepare("SELECT endpoint, subscription_json FROM push_subscriptions").all() as {
    endpoint: string;
    subscription_json: string;
  }[];
  if (!subs.length) return;
  webpush.setVapidDetails(env("VAPID_SUBJECT") || "mailto:admin@example.com", pub, priv);

  const payload = JSON.stringify({ title: n.title, body: n.body, url, tag: n.runId ?? n.kind });
  let sent = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification(JSON.parse(s.subscription_json), payload, { TTL: 86400 });
      sent++;
    } catch (err: any) {
      // 404/410 = the browser dropped the subscription; forget it.
      if (err?.statusCode === 404 || err?.statusCode === 410) {
        db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(s.endpoint);
      } else {
        console.warn(`notify: push failed for one subscriber: ${String(err?.body ?? err).slice(0, 120)}`);
      }
    }
  }
  if (sent) console.log(`notify: push sent to ${sent} device${sent === 1 ? "" : "s"}`);
}

function ctaLabel(kind: NotifyKind): string {
  switch (kind) {
    case "video_ready":
    case "edit_done":
      return "Review video";
    case "upload_done":
      return "See it on YouTube";
    default:
      return "Open dashboard";
  }
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
