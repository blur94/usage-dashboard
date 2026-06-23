"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { formatDayShort, formatTokens } from "@/lib/format";
import type { DailyPoint } from "@/lib/queries";

// Colors reference CSS custom properties only (NFR-2).
const chartConfig = {
  input: { label: "Input", color: "var(--chart-1)" },
  output: { label: "Output", color: "var(--chart-2)" },
} satisfies ChartConfig;

export function DailyTokensChart({ data }: { data: DailyPoint[] }) {
  return (
    <ChartContainer config={chartConfig} className="aspect-auto h-[320px] w-full">
      <BarChart accessibilityLayer data={data} margin={{ left: 4, right: 4 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={24}
          tickFormatter={formatDayShort}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={48}
          tickFormatter={(v) => formatTokens(Number(v))}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(label) => formatDayShort(String(label))}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="input" stackId="t" fill="var(--color-input)" radius={[0, 0, 2, 2]} />
        <Bar dataKey="output" stackId="t" fill="var(--color-output)" radius={[2, 2, 0, 0]} />
      </BarChart>
    </ChartContainer>
  );
}
