import { NextResponse } from "next/server";

import { logoutCurrentSession } from "@/lib/auth/logout-runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    await logoutCurrentSession();
  } catch (error) {
    if (error instanceof Error && error.message === "AUTH_ORIGIN_DENIED") {
      return noStoreResponse("Forbidden", 403);
    }
    throw error;
  }
  const response = NextResponse.redirect(
    new URL("/login?loggedOut=1", request.url),
    303,
  );
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  return response;
}

function noStoreResponse(body: BodyInit | null, status: number) {
  return new NextResponse(body, {
    status,
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}
