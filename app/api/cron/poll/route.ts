import { timingSafeEqual } from "node:crypto";
import { pollInbox } from "@/lib/poll";

export const maxDuration = 60;

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(request.headers.get("authorization") ?? "");
  return expected.length === received.length && timingSafeEqual(expected, received);
}

// Vercel Cron calls this with "Authorization: Bearer $CRON_SECRET" on the schedule in vercel.json.
export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return Response.json(await pollInbox());
  } catch (error) {
    console.error("Inbox poll failed", error);
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
}
