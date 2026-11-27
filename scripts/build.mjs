import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

const sourceDir = new URL('../src/', import.meta.url);
const outputDir = new URL('../dist/', import.meta.url);
const sources = await readdir(sourceDir);
await mkdir(outputDir, { recursive: true });

for (const file of sources.filter(file => file.endsWith('.ts'))) {
  const source = await readFile(new URL(file, sourceDir), 'utf8');
  const code = stripTypeScriptTypes(source).replace(/( from '\.\/[^']+)\.ts'/g, "$1.js'");
  await writeFile(new URL(file.replace(/\.ts$/, '.js'), outputDir), code);
}
console.log('CLI собран в dist/.');
