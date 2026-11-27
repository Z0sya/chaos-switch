import { isDeepStrictEqual } from 'node:util';
import { faults, readLocalJson, startDemoApp, startFixture, type Fault } from './http.ts';

const dependencyTimeoutMs = 120;
const delayMs = 1600;
const maxAppMs = 1100;

const expected = {
  healthy: { source: 'live', quantity: 7, reason: null },
  delay: { source: 'fallback', quantity: 5, reason: 'timeout' },
  '503': { source: 'fallback', quantity: 5, reason: 'unavailable' },
  disconnect: { source: 'fallback', quantity: 5, reason: 'disconnect' },
};

type Observed = {
  status: number;
  body: unknown;
  elapsedMs: number;
  calls: number;
};

export function checkContract(fault: Fault, actual: Observed) {
  const checks = [
    { name: 'app-status', expected: 200, actual: actual.status, passed: actual.status === 200 },
    { name: 'app-body', expected: expected[fault], actual: actual.body, passed: isDeepStrictEqual(actual.body, expected[fault]) },
    { name: 'dependency-calls', expected: 1, actual: actual.calls, passed: actual.calls === 1 },
    { name: 'max-app-ms', expected: maxAppMs, actual: actual.elapsedMs, passed: actual.elapsedMs <= maxAppMs },
  ];
  return { fault, passed: checks.every(check => check.passed), checks };
}

async function runCase(fault: Fault) {
  const fixture = await startFixture(fault, delayMs);
  try {
    const app = await startDemoApp(fixture.port, dependencyTimeoutMs);
    try {
      const start = performance.now();
      const actual = await readLocalJson(app.port, '/stock', delayMs + 1000);
      const elapsedMs = Math.round((performance.now() - start) * 10) / 10;
      return checkContract(fault, { ...actual, elapsedMs, calls: fixture.requests() });
    } finally {
      await app.close();
    }
  } finally {
    await fixture.close();
  }
}

export async function runDemo() {
  const results = [];
  for (const fault of faults) {
    results.push(await runCase(fault));
  }
  return {
    schemaVersion: 1,
    passed: results.every(result => result.passed),
    dependencyTimeoutMs,
    injectedDelayMs: delayMs,
    results,
  };
}
