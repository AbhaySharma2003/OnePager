// Builds supabase/sql/app_config.sql (upserts into public.app_config) from data/.
// Run: node scripts/sync-config.mjs  then apply the SQL in Supabase (SQL editor or MCP).
import fs from 'node:fs';
const rd = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const rules = rd('data/rules.json'), kw = rd('data/domain_keywords.json');
const strip = (o) => { const { _doc, ...r } = o; return r; };
const rulesText = [
  ...rules.presentation.map((r) => `- ${r.rule}`),
  ...Object.entries(rules.sections).flatMap(([s, list]) => [`${s.toUpperCase().replace(/_/g, ' ')}:`, ...list.map((r) => `- ${r.rule}`)]),
].join('\n');
const guide = Object.entries(rules.master_cv_guidelines).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`).join('\n');
const flagsSchema = { type: 'array', items: { type: 'object', properties: { section: { type: 'string' }, item: { type: 'string' }, issue: { type: 'string' }, ask: { type: 'string' } }, required: ['section', 'issue'] } };
const rows = {
  rules_text: rulesText,
  master_guidelines: guide,
  section_order: rules.section_order,
  domains: ['General', ...Object.keys(kw)],
  master_schema: strip(rd('data/master_cv.schema.json')),
  onepager_schema: strip(rd('data/onepager.schema.json')),
  flags_schema: flagsSchema,
  prompt_extract: fs.readFileSync('data/prompts/extract.md', 'utf8'),
  prompt_generate: fs.readFileSync('data/prompts/generate.md', 'utf8'),
  prompt_refine: fs.readFileSync('data/prompts/refine.md', 'utf8'),
  models: rd('data/models.json'),
};
const only = process.argv.slice(2);
const sql = Object.entries(rows).filter(([k]) => !only.length || only.includes(k)).map(([k, v]) =>
  `insert into public.app_config(key, value) values ('${k}', $cfg$${JSON.stringify(v)}$cfg$::jsonb)\n  on conflict (key) do update set value = excluded.value, updated_at = now();`).join('\n');
fs.writeFileSync('supabase/sql/app_config.sql', sql + '\n');
fs.writeFileSync('web/app/knowledge.js', `// AUTO-GENERATED from data/domain_keywords.json\nexport const DOMAINS = ${JSON.stringify(Object.keys(kw))};\nexport const DOMAIN_KEYWORDS = ${JSON.stringify(kw)};\n`);
console.log('app_config.sql', sql.length, 'bytes;', Object.keys(rows).filter((k) => !only.length || only.includes(k)).join(', '));
