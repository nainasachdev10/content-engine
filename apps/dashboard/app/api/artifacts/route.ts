import { NextRequest, NextResponse } from "next/server";
import { createReadStream, existsSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { repoRoot } from "../../../lib/engine";

const TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".mp3": "audio/mpeg",
  ".srt": "text/plain; charset=utf-8",
  ".json": "application/json",
};

/** Serve files strictly from projects/<slug>/output/ — never anything else. */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams.get("p") ?? "";
  const abs = resolve(repoRoot, p);
  const projectsRoot = resolve(repoRoot, "projects") + sep;
  if (!abs.startsWith(projectsRoot) || !abs.includes(`${sep}output${sep}`)) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  if (!existsSync(abs)) return new NextResponse("Not found", { status: 404 });

  const ext = abs.slice(abs.lastIndexOf("."));
  const type = TYPES[ext] ?? "application/octet-stream";
  const size = statSync(abs).size;

  // Range support so <video> can seek.
  const range = req.headers.get("range");
  if (range) {
    const m = range.match(/bytes=(\d+)-(\d*)/);
    if (m) {
      const start = Number(m[1]);
      const end = m[2] ? Number(m[2]) : size - 1;
      const stream = createReadStream(abs, { start, end });
      return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
        status: 206,
        headers: {
          "Content-Type": type,
          "Content-Range": `bytes ${start}-${end}/${size}`,
          "Accept-Ranges": "bytes",
          "Content-Length": String(end - start + 1),
        },
      });
    }
  }
  const stream = createReadStream(abs);
  return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
    headers: { "Content-Type": type, "Content-Length": String(size), "Accept-Ranges": "bytes" },
  });
}
