import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const tsc = fileURLToPath(new URL('node_modules/typescript/bin/tsc', root));
const result = spawnSync(process.execPath, [tsc, '--project', 'tsconfig.build.json'], {
  cwd: fileURLToPath(root),
  stdio: 'inherit',
});
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
