// Embeds data/prompts/{generate,refine}.md into the edge function source (as defaults; app_config can override).
import fs from 'node:fs';
const p = 'supabase/functions/ai/index.ts';
let s = fs.readFileSync(p, 'utf8');
for (const [name, file] of [['GENERATE_PROMPT', 'generate'], ['REFINE_PROMPT', 'refine']]) {
  const val = JSON.stringify(fs.readFileSync(`data/prompts/${file}.md`, 'utf8'));
  const re = new RegExp(`const ${name} = ".*";`);
  s = re.test(s) ? s.replace(re, () => `const ${name} = ${val};`) : s.replace('const keywordsText =', () => `const ${name} = ${val};\n\nconst keywordsText =`);
}
fs.writeFileSync(p, s);
console.log('embedded prompts');
