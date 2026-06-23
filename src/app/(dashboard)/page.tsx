import { Boxes, DollarSign, FolderKanban, Gauge, Percent } from "lucide-react";
import { DailyTokensChart } from "@/components/daily-tokens-chart";
import { KpiCard } from "@/components/kpi-card";
import { OverviewFilters } from "@/components/overview-filters";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  formatCurrency,
  formatModel,
  formatPercent,
  formatTokens,
} from "@/lib/format";
import {
  getDailyTokens,
  getModelTotals,
  getOverviewKpis,
} from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; model?: string }>;
}) {
  const sp = await searchParams;
  const days = Math.max(1, Math.min(365, Number(sp.days) || 30));
  const model = sp.model || undefined;

  const kpis = getOverviewKpis();
  const daily = getDailyTokens(days, model);
  const models = getModelTotals().map((m) => m.model);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <KpiCard
          icon={Gauge}
          label="Tokens this month"
          value={formatTokens(kpis.totalTokensThisMonth)}
          hint="Input + output"
        />
        <KpiCard
          icon={DollarSign}
          label="Est. cost this month"
          value={formatCurrency(kpis.estimatedCostThisMonth)}
          hint="Estimated from list prices, not actual billing"
        />
        <KpiCard
          icon={Percent}
          label="Cache hit rate"
          value={formatPercent(kpis.cacheHitRate)}
          hint="Cache reads vs. input (this month)"
        />
        <KpiCard
          icon={Boxes}
          label="Top model this week"
          value={kpis.mostUsedModelThisWeek ? formatModel(kpis.mostUsedModelThisWeek) : "—"}
          hint="By token count"
        />
        <KpiCard
          icon={FolderKanban}
          label="Active projects"
          value={String(kpis.activeProjectCount)}
          hint="Last 7 days"
        />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div className="flex flex-col gap-1.5">
            <CardTitle>Daily token usage</CardTitle>
            <CardDescription>
              Input vs. output tokens per day{model ? ` · ${formatModel(model)}` : ""}.
            </CardDescription>
          </div>
          <OverviewFilters models={models} />
        </CardHeader>
        <CardContent>
          <DailyTokensChart data={daily} />
        </CardContent>
      </Card>
    </div>
  );
}
