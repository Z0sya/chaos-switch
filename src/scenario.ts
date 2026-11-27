export const faultKinds = ['healthy', 'delay', 'timeout', 'http-error', 'disconnect', 'partial'] as const;
export type FaultKind = typeof faultKinds[number];
export const outcomes = ['live', 'timeout', 'unavailable', 'disconnect', 'partial', 'dependency_error'] as const;
export type Outcome = typeof outcomes[number];
export type FaultPlan =
  | { kind: 'healthy' | 'timeout' | 'disconnect' | 'partial' }
  | { kind: 'delay'; ms: number }
  | { kind: 'http-error'; status: number };

export type Phase = {
  label: string;
  count: number;
  every: number;
  fault: FaultPlan;
  expect: Outcome | 'auto';
};

export type Scenario = {
  schemaVersion: 1;
  name: string;
  timeoutMs: number;
  budgetMs: number;
  phases: Phase[];
};

export const maxRequests = 32;
export const maxPhases = 12;
export const maxScenarioBytes = 16_384;
export const maxWaitMs = 5_000;

export const demoScenario: Scenario = {
  schemaVersion: 1,
  name: 'Inventory recovery',
  timeoutMs: 180,
  budgetMs: 950,
  phases: [
    { label: 'Warm up', count: 2, every: 1, fault: { kind: 'healthy' }, expect: 'auto' },
    { label: 'Latency on every second call', count: 4, every: 2, fault: { kind: 'delay', ms: 75 }, expect: 'auto' },
    { label: 'Service unavailable', count: 2, every: 1, fault: { kind: 'http-error', status: 503 }, expect: 'auto' },
    { label: 'Upstream takes too long', count: 1, every: 1, fault: { kind: 'timeout' }, expect: 'auto' },
    { label: 'Connection closes', count: 1, every: 1, fault: { kind: 'disconnect' }, expect: 'auto' },
    { label: 'Truncated body', count: 2, every: 2, fault: { kind: 'partial' }, expect: 'auto' },
    { label: 'Service recovers', count: 2, every: 1, fault: { kind: 'healthy' }, expect: 'auto' },
  ],
};

function record(value: unknown, keys: readonly string[], field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${field} must be an object.`);
  }
  const extra = Object.keys(value).find(key => !keys.includes(key));
  if (extra !== undefined) throw new Error(`${field} contains an unsupported property.`);
  return value as Record<string, unknown>;
}

function boundedText(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x1f\x7f]/.test(value)) {
    throw new Error(`${field} must be printable text from 1 to ${max} characters.`);
  }
  return value.trim();
}

function integer(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${field} must be an integer from ${min} to ${max}.`);
  }
  return value;
}

function validateFault(value: unknown, field: string): FaultPlan {
  const fault = record(value, ['kind', 'ms', 'status'], field);
  switch (fault.kind) {
    case 'delay':
      record(fault, ['kind', 'ms'], field);
      return { kind: fault.kind, ms: integer(fault.ms, `${field}.ms`, 1, 4_000) };
    case 'http-error':
      record(fault, ['kind', 'status'], field);
      return { kind: fault.kind, status: integer(fault.status, `${field}.status`, 400, 599) };
    case 'healthy':
    case 'timeout':
    case 'disconnect':
    case 'partial':
      record(fault, ['kind'], field);
      return { kind: fault.kind };
    default:
      throw new Error(`${field}.kind is unknown.`);
  }
}

export function validateScenario(value: unknown): Scenario {
  const data = record(value, ['schemaVersion', 'name', 'timeoutMs', 'budgetMs', 'phases'], 'Scenario');
  if (data.schemaVersion !== 1) throw new Error('Scenario schemaVersion must be 1.');
  const name = boundedText(data.name, 'Scenario name', 80);
  const timeoutMs = integer(data.timeoutMs, 'Client timeout', 50, 1_000);
  const budgetMs = integer(data.budgetMs, 'Response budget', 1, 4_000);
  if (!Array.isArray(data.phases) || data.phases.length < 1 || data.phases.length > maxPhases) {
    throw new Error(`A scenario needs 1–${maxPhases} phases.`);
  }
  const phases = (data.phases as unknown[]).map((phase, index): Phase => {
    const field = `Phase ${index + 1}`;
    const row = record(phase, ['label', 'count', 'every', 'fault', 'expect'], field);
    const count = integer(row.count, `${field} requests`, 1, maxRequests);
    const expect = row.expect === 'auto' ? 'auto' : outcomes.find(outcome => outcome === row.expect);
    if (!expect) throw new Error(`${field} expectation is unknown.`);
    return {
      label: boundedText(row.label, `${field} label`, 80),
      count,
      every: integer(row.every, `${field} frequency`, 1, count),
      fault: validateFault(row.fault, `${field} fault`),
      expect,
    };
  });
  if (phases.reduce((sum, phase) => sum + phase.count, 0) > maxRequests) {
    throw new Error(`A scenario supports at most ${maxRequests} requests.`);
  }
  return { schemaVersion: 1, name, timeoutMs, budgetMs, phases };
}

export function decodeScenario(text: string): Scenario {
  if (new TextEncoder().encode(text).byteLength > maxScenarioBytes) throw new Error('Scenario JSON is too large.');
  try {
    return validateScenario(JSON.parse(text.replace(/^\uFEFF/, '')));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('Scenario JSON is invalid.');
    throw error;
  }
}

export function inferOutcome(fault: FaultPlan, timeoutMs: number): Outcome {
  switch (fault.kind) {
    case 'healthy': return 'live';
    case 'delay': return fault.ms >= timeoutMs ? 'timeout' : 'live';
    case 'timeout': return 'timeout';
    case 'http-error': return fault.status === 503 ? 'unavailable' : 'dependency_error';
    case 'disconnect': return 'disconnect';
    case 'partial': return 'partial';
  }
}

export function compilePlan(scenario: Scenario) {
  return scenario.phases.flatMap((phase, index) => {
    return Array.from({ length: phase.count }, (_, offset) => {
      const inject = (offset + 1) % phase.every === 0;
      const fault: FaultPlan = inject ? phase.fault : { kind: 'healthy' };
      const expected = inject && phase.expect !== 'auto' ? phase.expect : inferOutcome(fault, scenario.timeoutMs);
      return { phase: index + 1, label: phase.label, fault, expected };
    });
  });
}
