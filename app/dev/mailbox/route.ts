import {
  consumeLocalMockEmail,
  type ConfiguredMailboxReadResult,
} from "@/lib/providers/email/local-mock-mailbox";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const PRIVATE_HEADERS = Object.freeze({
  "Cache-Control": "no-store",
  Pragma: "no-cache",
  "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  Vary: "Authorization",
});

export async function GET(request: Request) {
  let result: ConfiguredMailboxReadResult;
  try {
    result = consumeLocalMockEmail(request.headers.get("authorization"));
  } catch {
    return privateJson({ status: "not_found" }, 404);
  }

  if (result.status === "closed" || result.status === "unauthorized") {
    return privateJson({ status: "not_found" }, 404);
  }
  if (result.status === "empty") {
    return privateJson({ email: null }, 200);
  }
  return privateJson({ email: result.envelope }, 200);
}

// Prevent Next.js from deriving a consuming HEAD implementation from GET.
export async function HEAD() {
  return new Response(null, { status: 404, headers: PRIVATE_HEADERS });
}

// Do not advertise a development-only capture surface through automatic OPTIONS.
export async function OPTIONS() {
  return new Response(null, { status: 404, headers: PRIVATE_HEADERS });
}

function privateJson(body: unknown, status: number) {
  return Response.json(body, { status, headers: PRIVATE_HEADERS });
}
