import { NextResponse } from "next/server";
import { getRuns, getNotifications } from "../../../lib/engine";

export const dynamic = "force-dynamic";

/** Small payload polled by the navigation: badge counts + latest notifications. */
export async function GET() {
  const runs = getRuns(undefined, 200);
  return NextResponse.json({
    counts: {
      queue: runs.filter((r) => ["pending_approval", "upload_failed"].includes(r.status)).length,
      active: runs.filter((r) => ["running", "editing", "approved"].includes(r.status)).length,
    },
    notifications: getNotifications(12),
  });
}
