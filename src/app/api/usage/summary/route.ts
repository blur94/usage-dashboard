import { type NextRequest, NextResponse } from "next/server";
import { getDailyTokens, getOverviewKpis } from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Overview data API: KPI cards plus the daily input/output time series.
 * Query params: `days` (default 30) and optional `model` filter (FR-5, FR-9).
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const days = Math.max(1, Math.min(365, Number(params.get("days")) || 30));
  const model = params.get("model") || undefined;

  try {
    return NextResponse.json({
      days,
      model: model ?? null,
      kpis: getOverviewKpis(),
      daily: getDailyTokens(days, model),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Query failed" },
      { status: 500 },
    );
  }
}
