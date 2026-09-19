/**
 * One-time OAuth setup for a project's YouTube channel.
 * Runs a loopback flow: opens Google consent in the browser, catches the
 * redirect on localhost, exchanges the code, and writes YOUTUBE_REFRESH_TOKEN
 * to projects/<slug>/.env.
 *
 * The Google Cloud OAuth client must allow the loopback redirect. A "Desktop app"
 * client allows any localhost port; a "Web application" client needs
 * http://localhost:8845/callback added to its authorized redirect URIs.
 */
import { google } from "googleapis";
import { createServer } from "node:http";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execFile } from "node:child_process";
import type { Project } from "../lib/project.js";
import { secrets, requireSecrets } from "../lib/env.js";

const PORT = 8845;
const REDIRECT = `http://localhost:${PORT}/callback`;
const SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube",
  // Read-only channel/video data for the Notion teardown + metrics jobs.
  "https://www.googleapis.com/auth/youtube.readonly",
  // YouTube Analytics (averageViewDuration, subscribersGained) for the metrics job.
  // Existing tokens keep working for uploads; re-run `engine auth <slug>` to grant these.
  "https://www.googleapis.com/auth/yt-analytics.readonly",
];

export async function runAuth(project: Project): Promise<void> {
  requireSecrets("youtubeClientId", "youtubeClientSecret");
  const oauth2 = new google.auth.OAuth2(secrets.youtubeClientId, secrets.youtubeClientSecret, REDIRECT);
  const url = oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // force a refresh_token even if previously granted
    scope: SCOPES,
  });

  console.log(`\nAuthorize the "${project.config.name}" channel:\n`);
  console.log(url);
  console.log(`\nOpening browser... sign in with the Google account that owns THIS project's channel.`);
  execFile("open", [url], () => {}); // macOS; harmless no-op elsewhere

  const code = await new Promise<string>((resolvePromise, reject) => {
    const server = createServer((req, res) => {
      const u = new URL(req.url ?? "/", REDIRECT);
      if (u.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }
      const err = u.searchParams.get("error");
      const c = u.searchParams.get("code");
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(
        err
          ? `<h2>Authorization failed: ${err}</h2>`
          : "<h2>Channel authorized — you can close this tab and return to the terminal.</h2>"
      );
      server.close();
      if (err || !c) reject(new Error(`OAuth error: ${err ?? "no code returned"}`));
      else resolvePromise(c);
    });
    server.listen(PORT);
    setTimeout(() => {
      server.close();
      reject(new Error("Timed out after 5 minutes waiting for OAuth consent"));
    }, 5 * 60 * 1000).unref();
  });

  const { tokens } = await oauth2.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error(
      "Google returned no refresh_token. Remove the app's access at https://myaccount.google.com/permissions and retry."
    );
  }

  const envPath = join(project.dir, ".env");
  let env = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  if (/^YOUTUBE_REFRESH_TOKEN=/m.test(env)) {
    env = env.replace(/^YOUTUBE_REFRESH_TOKEN=.*$/m, `YOUTUBE_REFRESH_TOKEN=${tokens.refresh_token}`);
  } else {
    env += `${env.endsWith("\n") || env === "" ? "" : "\n"}YOUTUBE_REFRESH_TOKEN=${tokens.refresh_token}\n`;
  }
  writeFileSync(envPath, env);
  console.log(`\nRefresh token saved to ${envPath} (gitignored). Uploads for "${project.slug}" are now enabled.`);
}
