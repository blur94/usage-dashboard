import { ModelsChart } from "@/components/models-chart";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { getModelTotals } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default function ModelsPage() {
  const models = getModelTotals();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Models</CardTitle>
        <CardDescription>
          Total token consumption by model, across all time. Hover a bar for the
          estimated cost (from list prices, not actual billing).
        </CardDescription>
      </CardHeader>
      <CardContent>
        {models.length ? (
          <ModelsChart data={models} />
        ) : (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No model data</EmptyTitle>
              <EmptyDescription>Click Sync to import your sessions.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </CardContent>
    </Card>
  );
}
