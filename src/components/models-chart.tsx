"use client";

import { Bar, BarChart, Cell, XAxis, YAxis } from "recharts";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { chartColor } from "@/lib/chart-colors";
import { formatCurrency, formatModel, formatTokens } from "@/lib/format";
import type { ModelRow } from "@/lib/queries";

const chartConfig = {
  totalTokens: { label: "Tokens" },
} satisfies ChartConfig;

export function ModelsChart({ data }: { data: ModelRow[] }) {
  const rows = data.map((d) => ({ ...d, label: formatModel(d.model) }));

  return (
    <ChartContainer config={chartConfig} className="aspect-auto h-[360px] w-full">
      <BarChart
        accessibilityLayer
        data={rows}
        layout="vertical"
        margin={{ left: 12, right: 24 }}
      >
        <XAxis
          type="number"
          dataKey="totalTokens"
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => formatTokens(Number(v))}
        />
        <YAxis
          type="category"
          dataKey="label"
          tickLine={false}
          axisLine={false}
          width={90}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              formatter={(value, _name, item) =>
                `${formatTokens(Number(value))} tokens · ${formatCurrency(
                  (item?.payload as { estimatedCost?: number })?.estimatedCost ?? 0,
                )} est.`
              }
            />
          }
        />
        <Bar dataKey="totalTokens" radius={4}>
          {rows.map((row, i) => (
            <Cell key={row.model} fill={chartColor(i + 1)} />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
