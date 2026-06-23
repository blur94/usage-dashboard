import { runSync } from "../src/lib/sync";

const { parsed, inserted } = runSync();
console.log(`Parsed ${parsed} usage events; inserted ${inserted} new rows.`);
