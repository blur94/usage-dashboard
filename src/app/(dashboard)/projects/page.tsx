import { ProjectsTable } from "@/components/projects-table";
import { SavingOpportunities } from "@/components/saving-opportunities";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getProjectInsights, getProjects } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default function ProjectsPage() {
  const projects = getProjects();
  const insights = getProjectInsights();

  return (
    <div className="flex flex-col gap-6">
      <SavingOpportunities data={insights} />
      <Card>
        <CardHeader>
          <CardTitle>Projects</CardTitle>
          <CardDescription>
            Token usage across {projects.length} project
            {projects.length === 1 ? "" : "s"}. Click a row to view its sessions.
            Costs are estimates from list prices, not actual billing.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProjectsTable data={projects} />
        </CardContent>
      </Card>
    </div>
  );
}
