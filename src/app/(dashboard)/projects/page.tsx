import { ProjectsTable } from "@/components/projects-table";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getProjects } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default function ProjectsPage() {
  const projects = getProjects();

  return (
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
  );
}
