import { NextResponse } from "next/server";
import { runSync } from "@/lib/sync";

// Reads the local filesystem and SQLite — must run on Node, never the edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** FR-3: parse logs, insert new events, return count of newly inserted rows. */
export async function POST() {
  try {
    const result = runSync();
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Sync failed" },
      { status: 500 },
    );
  }
}
