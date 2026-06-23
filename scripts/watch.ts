import { Temporal } from "@js-temporal/polyfill";
import { getProjectsRoot } from "../src/lib/parse-claude-logs";
import { runSync } from "../src/lib/sync";
import { startWatcher } from "../src/lib/watcher";

// Sync once on startup so the DB is current, then watch for changes.
const { parsed, inserted } = runSync();
console.log(`Initial sync: ${parsed} events parsed, ${inserted} new.`);
console.log(`Watching ${getProjectsRoot()} for changes… (Ctrl+C to stop)`);

startWatcher({
  onSync: ({ inserted }) =>
    console.log(`[${Temporal.Now.instant().toString()}] synced, ${inserted} new rows.`),
});
