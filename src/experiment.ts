import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { readLocalJson, startDemoApp, startScheduledFixture } from './http.ts';
import { compilePlan, validateScenario, type FaultPlan, type Outcome, type Scenario } from './scenario.ts';

type Observation = {
  outcome: Outcome | 'invalid';
  status: number | null;
  calls: number;
  elapsedMs: number;
  passed: boolean;
  problems: string[];
};

const healthy: FaultPlan = { kind: 'healthy' };

function expectedBody(expected: Outcome) {
  return expected === 'live'
    ? { source: 'live', quantity: 7, reason: null }
    : { source: 'fallback', quantity: 5, reason: expected };
}

function observedOutcome(status: number | null, body: unknown): Observation['outcome'] {
  if (status !== 200) return 'invalid';
  for (const name of ['live', 'timeout', 'unavailable', 'disconnect', 'partial', 'dependency_error'] as const) {
    if (isDeepStrictEqual(body, expectedBody(name))) return name;
  }
  return 'invalid';
}

async function runPass(scenario: Scenario, plan: ReturnType<typeof compilePlan>, baseline: boolean) {
  const fixture = await startScheduledFixture(plan.map(step => baseline ? healthy : step.fault));
  try {
    const app = await startDemoApp(fixture.port, scenario.timeoutMs);
    try {
      const observations: Observation[] = [];
      for (const step of plan) {
        const expectation = baseline ? 'live' : step.expected;
        const previousCalls = fixture.requests();
        const start = performance.now();
        const result = await readLocalJson(app.port, '/stock', scenario.budgetMs + 1_500).catch(() => null);
        const elapsedMs = Math.round((performance.now() - start) * 10) / 10;
        const status = result?.status ?? null;
        const outcome = observedOutcome(status, result?.body);
        const calls = fixture.requests() - previousCalls;
        const problems: string[] = [];
        if (status !== 200) problems.push('app-status');
        if (outcome !== expectation) problems.push('app-outcome');
        if (calls !== 1) problems.push('dependency-calls');
        if (elapsedMs > scenario.budgetMs) problems.push('response-budget');
        observations.push({ outcome, status, calls, elapsedMs, problems, passed: problems.length === 0 });
      }
      return observations;
    } finally {
      await app.close();
    }
  } finally {
    await fixture.close();
  }
}

function metrics(observations: readonly Observation[]) {
  const latencies = observations.map(row => row.elapsedMs).sort((a, b) => a - b);
  const percentile = (p: number) => latencies[Math.ceil(p * latencies.length) - 1] ?? 0;
  return {
    requests: observations.length,
    passed: observations.filter(row => row.passed).length,
    fallbacks: observations.filter(row => row.outcome !== 'live' && row.outcome !== 'invalid').length,
    nonSuccess: observations.filter(row => row.outcome === 'invalid').length,
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
  };
}

export async function runExperiment(value: unknown) {
  const scenario = validateScenario(value);
  const plan = compilePlan(scenario);
  const baseline = await runPass(scenario, plan, true);
  const replay = await runPass(scenario, plan, false);
  const baselineMetrics = metrics(baseline);
  const replayMetrics = metrics(replay);
  return {
    schemaVersion: 1,
    runId: createHash('sha256').update(JSON.stringify(scenario)).digest('hex'),
    scenario,
    passed: [...baseline, ...replay].every(row => row.passed),
    baseline: baselineMetrics,
    replay: replayMetrics,
    p95DeltaMs: Math.round((replayMetrics.p95Ms - baselineMetrics.p95Ms) * 10) / 10,
    rows: plan.map((step, index) => ({
      request: index + 1,
      ...step,
      baseline: baseline[index]!,
      replay: replay[index]!,
    })),
  };
}

export type ExperimentReport = Awaited<ReturnType<typeof runExperiment>>;
