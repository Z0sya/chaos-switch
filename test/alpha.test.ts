import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { get } from 'node:http';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { parseCommand } from '../src/cli.ts';
import { runExperiment } from '../src/experiment.ts';
import { readLocalJson, startScheduledFixture } from '../src/http.ts';
import { compilePlan, decodeScenario, demoScenario, maxScenarioBytes, validateScenario } from '../src/scenario.ts';
import { startStudio } from '../src/studio.ts';

const example = fileURLToPath(new URL('../examples/inventory.json', import.meta.url));
const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

test('normalizes scenario JSON and selects every second request by phase', () => {
  const copy = decodeScenario('\uFEFF' + JSON.stringify(demoScenario));
  assert.deepEqual(copy, demoScenario);
  assert.deepEqual(compilePlan(copy).map(row => row.fault.kind), [
    'healthy', 'healthy', 'healthy', 'delay', 'healthy', 'delay', 'http-error', 'http-error',
    'timeout', 'disconnect', 'healthy', 'partial', 'healthy', 'healthy',
  ]);
});

test('validates version, unsupported keys, overflow and invalid fault inputs', () => {
  assert.throws(() => validateScenario({ ...demoScenario, schemaVersion: 2 }), /schemaVersion/);
  assert.throws(() => validateScenario({ ...demoScenario, target: 'https://example.invalid' }), /unsupported/);
  assert.throws(() => validateScenario({ ...demoScenario, '': true }), /unsupported/);
  assert.throws(() => validateScenario({ ...demoScenario, phases: [] }), /needs/);
  assert.throws(() => validateScenario({ ...demoScenario, phases: [{ ...demoScenario.phases[0]!, every: 3 }] }), /frequency/);
  assert.throws(() => validateScenario({ ...demoScenario, phases: [{ ...demoScenario.phases[0]!, count: 32 }, ...demoScenario.phases] }), /at most/);
  assert.throws(() => validateScenario({ ...demoScenario, phases: [{ ...demoScenario.phases[0]!, fault: { kind: 'http-error', status: 200 } }] }), /status/);
  assert.throws(() => decodeScenario('x'.repeat(maxScenarioBytes + 1)), /too large/);
  assert.throws(() => decodeScenario('{broken'), /invalid/);
});

test('new CLI entry points reject additional target and incompatible modes', () => {
  assert.equal(parseCommand(['run', 'example.json']).command, 'run');
  assert.equal(parseCommand(['serve', '--scenario', 'example.json']).command, 'serve-scenario');
  assert.throws(() => parseCommand(['run', 'example.json', '--target', 'https://example.invalid']), /target/);
  assert.throws(() => parseCommand(['studio', '--host', '0.0.0.0']), /--host/);
  assert.throws(() => parseCommand(['serve', '--scenario', 'example.json', '--fault', '503']), /without/);
});

test('scheduled fixture consumes only inventory requests and recovers when exhausted', async () => {
  const fixture = await startScheduledFixture([{ kind: 'http-error', status: 429 }, { kind: 'partial' }]);
  try {
    assert.equal((await readLocalJson(fixture.port, '/somewhere-else', 2_000)).status, 404);
    assert.equal(fixture.requests(), 0);
    assert.equal((await readLocalJson(fixture.port, '/inventory', 2_000)).status, 429);
    await assert.rejects(readLocalJson(fixture.port, '/inventory', 2_000), /Incomplete HTTP response/);
    assert.equal((await readLocalJson(fixture.port, '/inventory', 2_000)).status, 200);
    assert.equal(fixture.requests(), 3);
  } finally {
    await fixture.close();
  }
});

test('replays real delays, timeout, HTTP errors, disconnect and incomplete body against healthy baseline', async () => {
  const first = await runExperiment(demoScenario);
  const second = await runExperiment(demoScenario);
  assert.equal(first.passed, true, JSON.stringify(first));
  assert.equal(second.passed, true, JSON.stringify(second));
  assert.equal(first.runId, second.runId);
  assert.equal(first.baseline.fallbacks, 0);
  assert.equal(first.replay.fallbacks, 5);
  assert.equal(first.replay.requests, 14);
  assert.deepEqual(first.rows.map(row => row.replay.outcome), second.rows.map(row => row.replay.outcome));
  assert.equal(first.rows[8]?.replay.outcome, 'timeout');
  assert.equal(first.rows[11]?.replay.outcome, 'partial');
  assert.ok((first.rows[3]?.replay.elapsedMs ?? 0) >= 70);
  assert.equal(first.rows.at(-1)?.replay.outcome, 'live');
});

test('report catches a wrong application expectation and a tight latency budget', async () => {
  const report = await runExperiment({
    ...demoScenario,
    budgetMs: 1,
    phases: [{ label: 'Mismatch', count: 1, every: 1, expect: 'live', fault: { kind: 'timeout' } }],
  });
  assert.equal(report.passed, false);
  assert.deepEqual(report.rows[0]?.replay.problems, ['app-outcome', 'response-budget']);
});

test('CLI loads the saved scenario; rejects remote-like paths without network access', async () => {
  const exec = promisify(execFile);
  const { stdout } = await exec(process.execPath, [cli, 'run', example]);
  const report = JSON.parse(stdout);
  assert.equal(report.passed, true);
  assert.equal(report.rows.length, 14);
  await assert.rejects(exec(process.execPath, [cli, 'run', 'https://example.invalid/scenario.json']), { code: 2 });
});

test('Studio serves the workbench and rejects unsafe origins, hosts, paths and input', async () => {
  const studio = await startStudio();
  try {
    const home = await fetch(studio.origin);
    assert.equal(home.status, 200);
    assert.match(await home.text(), /Scenario Studio/);
    assert.match(home.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
    assert.equal((await fetch(studio.origin + '/package.json')).status, 404);
    const unknownHost = await new Promise<number | undefined>((resolve, reject) => {
      get(studio.origin, { headers: { host: 'example.invalid' } }, response => {
        response.resume();
        resolve(response.statusCode);
      }).once('error', reject);
    });
    assert.equal(unknownHost, 403);
    const run = (body: string, origin: string, type = 'application/json') => fetch(studio.origin + '/api/run', {
      method: 'POST',
      headers: { origin, 'content-type': type },
      body,
    });
    assert.equal((await run('{}', 'https://example.invalid')).status, 403);
    assert.equal((await run('{}', studio.origin, 'text/plain')).status, 415);
    assert.equal((await run('a'.repeat(maxScenarioBytes + 1), studio.origin)).status, 413);
    assert.equal((await run('{"target":"https://example.invalid"}', studio.origin)).status, 400);
    const success = await run(JSON.stringify(demoScenario), studio.origin);
    assert.equal(success.status, 200);
    assert.equal((await success.json()).passed, true);
  } finally {
    await studio.close();
  }
});
