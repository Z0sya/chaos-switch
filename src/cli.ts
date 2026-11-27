import { parseArgs } from 'node:util';
import { faults, startFixture, type Fault } from './http.ts';
import { runDemo } from './suite.ts';

const usage = `CHAOS SWITCH
  node src/cli.ts demo
  node src/cli.ts serve [--fault healthy|delay|503|disconnect] [--port 0..65535]
                       [--delay-ms 1..15000]

demo выводит JSON-отчёт проверки демонстрационного приложения.
serve запускает тестовый GET /inventory на 127.0.0.1. Порт 0 выбирается автоматически.`;

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
  if (command !== 'serve') {
    throw new Error('Допустимы команды demo и serve. CLI не принимает адрес цели.');
  }

  const { values } = parseArgs({
    args: options,
    strict: true,
    allowPositionals: false,
    options: {
      fault: { type: 'string', default: 'healthy' },
      port: { type: 'string', default: '0' },
      'delay-ms': { type: 'string' },
    },
  });
  const fault = faults.find(candidate => candidate === values.fault);
  if (!fault) {
    throw new Error(`Неизвестный режим ${values.fault}. Допустимы ${faults.join(', ')}.`);
  }
  if (values['delay-ms'] !== undefined && fault !== 'delay') {
    throw new Error('--delay-ms применяется только с --fault delay.');
  }
  const port = unsigned(values.port, '--port', 0, 65535);
  const delayMs = unsigned(values['delay-ms'] ?? '750', '--delay-ms', 1, 15000);
  return { command, fault, port, delayMs } satisfies { command: 'serve'; fault: Fault; port: number; delayMs: number };
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
      case 'serve': {
        const fixture = await startFixture(args.fault, args.delayMs, args.port);
        console.log(fixture.endpoint);
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
