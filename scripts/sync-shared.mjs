// Copies supabase/functions/_shared/* next to each function that uses it, so every deployed bundle is self-contained.
import { copyFileSync, readdirSync } from "node:fs";
const shared = "supabase/functions/_shared";
for (const fn of ["ai", "dodo-webhook", "status"]) for (const f of readdirSync(shared)) copyFileSync(`${shared}/${f}`, `supabase/functions/${fn}/${f}`);
console.log("shared files synced");
