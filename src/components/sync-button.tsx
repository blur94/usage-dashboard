"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** FR-3: triggers /api/sync, then refreshes server-rendered data. */
export function SyncButton() {
  const router = useRouter();
  const [isSyncing, setIsSyncing] = useState(false);
  const [isPending, startTransition] = useTransition();

  const onSync = async () => {
    setIsSyncing(true);
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      if (!res.ok) throw new Error(`Sync failed (${res.status})`);
      const data: { inserted: number; parsed: number } = await res.json();
      toast.success(
        data.inserted > 0
          ? `Synced ${data.inserted.toLocaleString()} new event${data.inserted === 1 ? "" : "s"}.`
          : "Up to date — no new events.",
      );
      startTransition(() => router.refresh());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Sync failed.");
    } finally {
      setIsSyncing(false);
    }
  };

  const busy = isSyncing || isPending;

  return (
    <Button onClick={onSync} disabled={busy} size="sm" variant="outline">
      <RefreshCw className={cn(busy && "animate-spin")} data-icon="inline-start" />
      {busy ? "Syncing…" : "Sync"}
    </Button>
  );
}
