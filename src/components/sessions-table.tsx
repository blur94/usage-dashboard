"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { DataTable, SortableHeader } from "@/components/data-table";
import {
  formatCurrency,
  formatDateMs,
  formatInt,
  formatPercent,
  formatTokens,
} from "@/lib/format";
import type { SessionRow } from "@/lib/queries";

const columns: ColumnDef<SessionRow>[] = [
  {
    accessorKey: "sessionId",
    header: ({ column }) => <SortableHeader label="Session" column={column} />,
    cell: ({ row }) => (
      <span className="font-mono text-xs">…{row.original.sessionId.slice(-8)}</span>
    ),
  },
  {
    accessorKey: "lastActiveMs",
    header: ({ column }) => <SortableHeader label="Date" column={column} />,
    cell: ({ row }) => (
      <span className="tabular-nums">{formatDateMs(row.original.lastActiveMs)}</span>
    ),
  },
  {
    accessorKey: "turns",
    header: ({ column }) => <SortableHeader label="Turns" column={column} />,
    cell: ({ row }) => <span className="tabular-nums">{formatInt(row.original.turns)}</span>,
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
];

export function SessionsTable({ data }: { data: SessionRow[] }) {
  return (
    <DataTable
      columns={columns}
      data={data}
      initialSorting={[{ id: "lastActiveMs", desc: true }]}
      emptyMessage="No sessions for this project."
    />
  );
}
