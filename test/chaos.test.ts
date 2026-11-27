import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { parseCommand } from '../src/cli.ts';
import { readLocalJson, startFixture, type Fault } from '../src/http.ts';
import { checkContract, runDemo } from '../src/suite.ts';

const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

test('ручной режим по умолчанию использует свободный локальный порт', () => {
  assert.deepEqual(parseCommand(['serve']), { command: 'serve', fault: 'healthy', port: 0, delayMs: 750 });
});

test('CLI отклоняет внешний адрес до открытия сокета', async () => {
  const exec = promisify(execFile);
  await assert.rejects(
    exec(process.execPath, [cli, 'serve', '--target', 'https://example.invalid']),
    (error: { code: number; stdout: string; stderr: string }) => {
      assert.equal(error.code, 2);
      assert.equal(error.stdout, '');
      assert.match(error.stderr, /--target/);
      return true;
    },
  );
  assert.throws(() => parseCommand(['serve', '--host', '0.0.0.0']), /--host/);
  assert.throws(() => parseCommand(['serve', '--port', '65536']), /--port/);
  assert.throws(() => parseCommand(['serve', '--delay-ms', '10']), /--delay-ms/);
});

const responses = [
  { fault: 'healthy', status: 200, body: { quantity: 7 } },
  { fault: 'delay', status: 200, body: { quantity: 7 } },
  { fault: '503', status: 503, body: { error: 'fixture_unavailable' } },
] as const;

for (const { fault, status, body } of responses) {
  test(`тестовый API отдаёт HTTP ${status}, режим ${fault}`, async () => {
    const delayMs = 90;
    const fixture = await startFixture(fault, delayMs);
    try {
      assert.match(fixture.endpoint, /^http:\/\/127\.0\.0\.1:\d+\/inventory$/);
      const start = performance.now();
      const actual = await readLocalJson(fixture.port, '/inventory', 2000);
      const elapsed = performance.now() - start;
      assert.deepEqual(actual, { status, body });
      if (fault === 'delay') {
        assert.ok(elapsed >= delayMs - 5, `задержка составила ${elapsed} мс`);
      }
      assert.equal(fixture.requests(), 1);
    } finally {
      await fixture.close();
    }
  });
}

test('тестовый API обрывает сокет до HTTP-ответа', async () => {
  const fixture = await startFixture('disconnect', 0);
  try {
    await assert.rejects(readLocalJson(fixture.port, '/inventory', 2000), { code: 'ECONNRESET' });
    assert.equal(fixture.requests(), 1);
  } finally {
    await fixture.close();
  }
});

test('демо проверяет все четыре сценария на живых локальных сокетах', async () => {
  const report = await runDemo();
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.passed, true, JSON.stringify(report));
  assert.deepEqual(report.results.map(result => result.fault), ['healthy', 'delay', '503', 'disconnect'] satisfies Fault[]);
  assert.equal(report.results.flatMap(result => result.checks).length, 16);
});

test('неправильный fallback, повторный запрос и превышение лимита видны в отчёте', () => {
  const result = checkContract('delay', {
    status: 500,
    body: { source: 'live', quantity: 7, reason: null },
    elapsedMs: 1600,
    calls: 2,
  });
  assert.equal(result.passed, false);
  assert.deepEqual(result.checks.filter(check => !check.passed).map(check => check.name), [
    'app-status',
    'app-body',
    'dependency-calls',
    'max-app-ms',
  ]);
});
