"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { DataTable, SortableHeader } from "@/components/data-table";
import {
  formatCurrency,
  formatDateMs,
  formatInt,
  formatPercent,
  formatTokens,
} from "@/lib/format";
import type { ProjectRow } from "@/lib/queries";

const columns: ColumnDef<ProjectRow>[] = [
  {
    accessorKey: "shortName",
    header: ({ column }) => <SortableHeader label="Project" column={column} />,
    cell: ({ row }) => (
      <span className="font-medium">{row.original.shortName}</span>
    ),
  },
  {
    accessorKey: "sessions",
    header: ({ column }) => <SortableHeader label="Sessions" column={column} />,
    cell: ({ row }) => <span className="tabular-nums">{formatInt(row.original.sessions)}</span>,
  },
  {
    accessorKey: "totalTokens",
    header: ({ column }) => <SortableHeader label="Total tokens" column={column} />,
    cell: ({ row }) => <span className="tabular-nums">{formatTokens(row.original.totalTokens)}</span>,
  },
  {
    accessorKey: "estimatedCost",
    header: ({ column }) => <SortableHeader label="Est. cost" column={column} />,
    cell: ({ row }) => (
      <span className="tabular-nums">{formatCurrency(row.original.estimatedCost)}</span>
    ),
  },
  {
    accessorKey: "cacheHitRate",
    header: ({ column }) => <SortableHeader label="Cache hit rate" column={column} />,
    cell: ({ row }) => (
      <Badge variant="secondary">{formatPercent(row.original.cacheHitRate)}</Badge>
    ),
  },
  {
    accessorKey: "lastActiveMs",
    header: ({ column }) => <SortableHeader label="Last active" column={column} />,
    cell: ({ row }) => (
      <span className="text-muted-foreground tabular-nums">
        {formatDateMs(row.original.lastActiveMs)}
      </span>
    ),
  },
];

export function ProjectsTable({ data }: { data: ProjectRow[] }) {
  const router = useRouter();
  return (
    <DataTable
      columns={columns}
      data={data}
      initialSorting={[{ id: "totalTokens", desc: true }]}
      onRowClick={(row) => router.push(`/projects/${row.projectId}`)}
      emptyMessage="No projects yet. Click Sync to import your sessions."
    />
  );
}
