import { NextResponse, type NextRequest } from "next/server";
import { isLockedOut, isValidSession, SESSION_COOKIE } from "@/lib/session";

export async function proxy(request: NextRequest) {
  if (isLockedOut()) {
    return new NextResponse("Set the APP_PASSWORD environment variable to use this app.", { status: 503 });
  }
  if (await isValidSession(request.cookies.get(SESSION_COOKIE)?.value)) {
    return NextResponse.next();
  }
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  // The cron route authenticates with CRON_SECRET instead of the session cookie.
  matcher: ["/((?!login|api/cron|_next/static|_next/image|favicon.ico).*)"],
};
