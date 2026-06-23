import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SessionsTable } from "@/components/sessions-table";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getProjectMeta, getSessions } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function ProjectSessionsPage({
  params,
}: {
  params: Promise<{ hash: string }>;
}) {
  const { hash } = await params;
  const meta = getProjectMeta(hash);
  if (!meta) notFound();

  const sessions = getSessions(hash);

  return (
    <div className="flex flex-col gap-4">
      <Button variant="ghost" size="sm" className="-ml-2 w-fit" asChild>
        <Link href="/projects">
          <ChevronLeft data-icon="inline-start" />
          All projects
        </Link>
      </Button>

      <Card>
        <CardHeader>
          <CardTitle>{meta.shortName}</CardTitle>
          <CardDescription>
            {sessions.length} session{sessions.length === 1 ? "" : "s"}, newest first.
            Costs are estimates from list prices, not actual billing.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SessionsTable data={sessions} />
        </CardContent>
      </Card>
    </div>
  );
}
