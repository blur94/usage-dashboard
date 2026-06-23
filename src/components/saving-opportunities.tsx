import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatCurrency } from "@/lib/format";
import type { ProjectInsightRow } from "@/lib/queries";

/** Top projects by estimated potential savings from a one-tier-down switch. */
export function SavingOpportunities({ data }: { data: ProjectInsightRow[] }) {
  const top = data.filter((p) => p.potentialSavings > 0).slice(0, 5);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Top saving opportunities</CardTitle>
        <CardDescription>
          Estimated savings if eligible work ran one model tier down. Estimates
          from list prices, not actual billing.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {top.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No tier-down savings available — every project is already on a
            cost-effective tier.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {top.map((p) => (
              <li
                key={p.projectId}
                className="flex items-center justify-between gap-4"
              >
                <span className="font-medium">{p.shortName}</span>
                <span className="tabular-nums text-muted-foreground">
                  save up to {formatCurrency(p.potentialSavings)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
