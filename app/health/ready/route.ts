import { getDatabase } from "@/lib/db/client";
import { checkDatabaseHealth } from "@/lib/db/health";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const health = await checkDatabaseHealth(getDatabase());
    return Response.json(
      health.ready ? { status: "ready" } : { status: "unavailable" },
      {
        status: health.ready ? 200 : 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch {
    return Response.json(
      { status: "unavailable" },
      {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
