"use client";

import { parseAsInteger, parseAsString, useQueryState } from "nuqs";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatModel } from "@/lib/format";

const DAY_OPTIONS = [
  { value: 7, label: "Last 7 days" },
  { value: 30, label: "Last 30 days" },
  { value: 90, label: "Last 90 days" },
];

const ALL = "all";

/** Date-range and model filters, persisted to the URL via nuqs (FR-9). */
export function OverviewFilters({ models }: { models: string[] }) {
  const [days, setDays] = useQueryState(
    "days",
    parseAsInteger.withDefault(30).withOptions({ shallow: false }),
  );
  const [model, setModel] = useQueryState(
    "model",
    parseAsString.withOptions({ shallow: false }),
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={String(days)}
        onValueChange={(v) => setDays(Number(v))}
      >
        <SelectTrigger size="sm" className="w-[150px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {DAY_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={String(o.value)}>
                {o.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>

      <Select
        value={model ?? ALL}
        onValueChange={(v) => setModel(v === ALL ? null : v)}
      >
        <SelectTrigger size="sm" className="w-[170px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value={ALL}>All models</SelectItem>
            {models.map((m) => (
              <SelectItem key={m} value={m}>
                {formatModel(m)}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
}
