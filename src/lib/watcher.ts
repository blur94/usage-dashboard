import { type FSWatcher, watch } from "chokidar";
import { getProjectsRoot } from "./parse-claude-logs";
import { runSync } from "./sync";

/**
 * FR-4 (optional): watch Claude Code's session logs and sync automatically
 * whenever a `.jsonl` file changes. Syncs are debounced so a burst of writes
 * during an active session triggers a single sync.
 */
export function startWatcher(options?: {
  debounceMs?: number;
  onSync?: (result: { parsed: number; inserted: number }) => void;
}): FSWatcher {
  const debounceMs = options?.debounceMs ?? 1500;
  const root = getProjectsRoot();

  let timer: NodeJS.Timeout | null = null;
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      try {
        const result = runSync();
        options?.onSync?.(result);
      } catch (error) {
        console.error("[watcher] sync failed:", error);
      }
    }, debounceMs);
  };

  const watcher = watch(root, {
    persistent: true,
    ignoreInitial: true,
    // Only react to session log files.
    ignored: (path, stats) =>
      Boolean(stats?.isFile() && !path.endsWith(".jsonl")),
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
  });

  watcher.on("add", schedule).on("change", schedule);
  return watcher;
}
