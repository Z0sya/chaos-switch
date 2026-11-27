import { parseArgs } from 'node:util';
import { open } from 'node:fs/promises';
import { faults, startFixture, startScheduledFixture, type Fault } from './http.ts';
import { runDemo } from './suite.ts';
import { runExperiment } from './experiment.ts';
import { compilePlan, decodeScenario, maxScenarioBytes } from './scenario.ts';
import { startStudio } from './studio.ts';

const entry = process.argv[1]?.endsWith('.ts') ? 'src/cli.ts' : 'dist/cli.js';
const usage = `CHAOS SWITCH
  node ${entry} demo
  node ${entry} run <scenario.json>
  node ${entry} serve [--fault healthy|delay|503|disconnect] [--port 0..65535]
                       [--delay-ms 1..15000]
  node ${entry} serve --scenario <scenario.json> [--port 0..65535]
  node dist/cli.js studio [--port 0..65535]

demo executes the four original isolated cases.
run compares a healthy baseline with your scenario, as JSON.
serve starts a synthetic GET /inventory on 127.0.0.1. Port 0 selects a free port.`;

function unsigned(value: string, name: string, min: number, max: number) {
  const number = Number(value);
  if (!/^\d+$/.test(value) || number < min || number > max) {
    throw new Error(`${name}: ожидается целое число от ${min} до ${max}.`);
  }
  return number;
}

export function parseCommand(args: string[]) {
  const [command, ...options] = args;
  if (args.length === 0 || (command === '--help' && options.length === 0)) {
    return { command: 'help' } as const;
  }
  if (command === 'demo' && options.length === 0) {
    return { command } as const;
  }
  if (command === 'run' && options.length === 1 && options[0] && !options[0].startsWith('-')) {
    return { command, file: options[0] } as const;
  }
  if (command === 'studio') {
    const { values } = parseArgs({
      args: options,
      strict: true,
      options: { port: { type: 'string', default: '0' } },
    });
    return { command, port: unsigned(values.port, '--port', 0, 65535) } as const;
  }
  if (command !== 'serve') {
    throw new Error('Use demo, run, serve or studio. The CLI does not accept a target address.');
  }

  const { values } = parseArgs({
    args: options,
    strict: true,
    allowPositionals: false,
    options: {
      fault: { type: 'string' },
      scenario: { type: 'string' },
      port: { type: 'string', default: '0' },
      'delay-ms': { type: 'string' },
    },
  });
  const port = unsigned(values.port, '--port', 0, 65535);
  if (values.scenario !== undefined) {
    if (!values.scenario || values.fault !== undefined || values['delay-ms'] !== undefined) {
      throw new Error('Use --scenario without --fault or --delay-ms.');
    }
    return { command: 'serve-scenario', file: values.scenario, port } as const;
  }
  const fault = faults.find(candidate => candidate === (values.fault ?? 'healthy'));
  if (!fault) {
    throw new Error(`Неизвестный режим ${values.fault}. Допустимы ${faults.join(', ')}.`);
  }
  if (values['delay-ms'] !== undefined && fault !== 'delay') {
    throw new Error('--delay-ms применяется только с --fault delay.');
  }
  const delayMs = unsigned(values['delay-ms'] ?? '750', '--delay-ms', 1, 15000);
  return { command, fault, port, delayMs } satisfies { command: 'serve'; fault: Fault; port: number; delayMs: number };
}

async function loadScenario(file: string) {
  if (/^(?:[/\\]{2}|\w{2,}:\/\/)/.test(file)) throw new Error('Use a local scenario file.');
  const handle = await open(file, 'r');
  try {
    const stats = await handle.stat();
    if (!stats.isFile() || stats.size > maxScenarioBytes) throw new Error('Use a JSON file up to 16 KiB.');
    const { buffer, bytesRead } = await handle.read({ buffer: Buffer.alloc(maxScenarioBytes + 1), position: 0 });
    return decodeScenario(buffer.subarray(0, bytesRead).toString('utf8'));
  } finally {
    await handle.close();
  }
}

async function main() {
  try {
    const args = parseCommand(process.argv.slice(2));
    switch (args.command) {
      case 'help':
        console.log(usage);
        break;
      case 'demo': {
        const report = await runDemo();
        console.log(JSON.stringify(report, null, 2));
        process.exitCode = report.passed ? 0 : 1;
        break;
      }
      case 'run': {
        const report = await runExperiment(await loadScenario(args.file));
        console.log(JSON.stringify(report, null, 2));
        process.exitCode = report.passed ? 0 : 1;
        break;
      }
      case 'serve': {
        const fixture = await startFixture(args.fault, args.delayMs, args.port);
        console.log(fixture.endpoint);
        break;
      }
      case 'serve-scenario': {
        const scenario = await loadScenario(args.file);
        const fixture = await startScheduledFixture(compilePlan(scenario).map(row => row.fault), args.port);
        console.log(fixture.endpoint);
        break;
      }
      case 'studio': {
        const studio = await startStudio(args.port);
        console.log(studio.origin);
        break;
      }
    }
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 2;
  }
}

if (import.meta.main) {
  await main();
}
