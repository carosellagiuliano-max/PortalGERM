import { getCurrentUser } from "@/lib/auth/current-user";
import { getDatabase } from "@/lib/db/client";
import { getInterviewCalendarForActor } from "@/lib/recruiting/interviews";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: Readonly<{ params: Promise<{ id: string }> }>,
) {
  const [user, { id }] = await Promise.all([
    getCurrentUser(),
    context.params,
  ]);
  if (user === null) return unavailable();
  const result = await getInterviewCalendarForActor(
    id,
    user.id,
    getDatabase(),
    new Date(),
  );
  if (result === null) return unavailable();
  return new Response(result.calendar, {
    status: 200,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "Content-Disposition": `attachment; filename="${result.filename}"`,
      "Content-Type": "text/calendar; charset=utf-8",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function unavailable() {
  return new Response(null, {
    status: 404,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
