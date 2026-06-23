/**
 * Central source of chart colors. Every Recharts fill/stroke must reference one
 * of these CSS custom properties — never a hardcoded hex/rgb value (NFR-2).
 */
export const CHART_COLOR_VARS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
] as const;

export type ChartColorIndex = 1 | 2 | 3 | 4 | 5;

/** Return the CSS variable reference for chart color N (1–5, wraps). */
export function chartColor(n: number): string {
  const idx = ((n - 1) % CHART_COLOR_VARS.length + CHART_COLOR_VARS.length) %
    CHART_COLOR_VARS.length;
  return CHART_COLOR_VARS[idx];
}
