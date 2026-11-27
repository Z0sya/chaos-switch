import {
  decodeScenario, demoScenario, faultKinds, maxPhases, maxRequests, maxScenarioBytes, outcomes, validateScenario,
  type FaultKind, type FaultPlan, type Phase, type Scenario,
} from '../scenario.ts';
import type { ExperimentReport } from '../experiment.ts';

const storageKey = 'chaos-switch.scenario.v1';

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function byId<T extends HTMLElement>(id: string) {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing Studio control: ${id}`);
  return node as T;
}

const name = byId<HTMLInputElement>('name');
const timeout = byId<HTMLInputElement>('timeout');
const budget = byId<HTMLInputElement>('budget');
const phases = byId<HTMLOListElement>('phases');
const runButton = byId<HTMLButtonElement>('run');
const file = byId<HTMLInputElement>('file');
const reportButton = byId<HTMLButtonElement>('export-report');
const addButton = byId<HTMLButtonElement>('add');
const state = byId('run-state');

let draft = structuredClone(demoScenario);
let report: ExperimentReport | undefined;
let running = false;

const faultLabels: Record<FaultKind, string> = {
  healthy: 'Healthy',
  delay: 'Delay',
  timeout: 'Timeout',
  'http-error': 'HTTP error',
  disconnect: 'Disconnect',
  partial: 'Partial body',
};

function notify(text: string, isError = false) {
  const message = byId('message');
  message.textContent = text;
  message.dataset.error = String(isError);
}

function notifyError(error: unknown) {
  notify(error instanceof Error ? error.message : 'Unexpected error.', true);
}

function download(name: string, value: object) {
  const blob = new Blob([JSON.stringify(value, null, 2) + '\n'], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = element('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function filename(scenario: Scenario) {
  return scenario.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'scenario';
}

function button(text: string, label: string, action: () => void) {
  const node = element('button', text);
  node.type = 'button';
  node.setAttribute('aria-label', label);
  node.title = label;
  node.addEventListener('click', action);
  return node;
}

function label(text: string, control: HTMLElement) {
  const node = element('label', text);
  node.append(control);
  return node;
}

function numberField(value: number, min: number, max: number, action: (value: number) => void) {
  const node = element('input');
  node.type = 'number';
  node.min = String(min);
  node.max = String(max);
  node.value = Number.isFinite(value) ? String(value) : '';
  node.addEventListener('input', () => {
    action(node.valueAsNumber);
    updateSummary();
  });
  return node;
}

function selectField<T extends string>(values: readonly T[], value: T, display: (value: T) => string, action: (value: T) => void) {
  const node = element('select');
  for (const candidate of values) {
    const option = element('option', display(candidate));
    option.value = candidate;
    option.selected = candidate === value;
    node.append(option);
  }
  node.addEventListener('change', () => {
    const selected = values.find(candidate => candidate === node.value);
    if (selected) {
      action(selected);
      updateSummary();
    }
  });
  return node;
}

function updateSummary() {
  const planned = draft.phases.reduce((sum, phase) => sum + phase.count, 0);
  byId('phase-summary').textContent = `${draft.phases.length} phases · ${Number.isFinite(planned) ? planned : '—'} requests`;
  addButton.disabled = draft.phases.length >= maxPhases;
  if (report && !running) {
    const dirty = JSON.stringify(draft) !== JSON.stringify(report.scenario);
    state.textContent = (report.passed ? 'Passed' : 'Failed') + (dirty ? ' · previous draft' : '');
    state.dataset.state = report.passed ? 'pass' : 'fail';
  }
}

function newFault(kind: FaultKind): FaultPlan {
  if (kind === 'delay') return { kind, ms: 75 };
  if (kind === 'http-error') return { kind, status: 503 };
  return { kind };
}

function move(index: number, direction: number) {
  const current = draft.phases[index];
  const target = draft.phases[index + direction];
  if (!current || !target) return;
  draft.phases[index] = target;
  draft.phases[index + direction] = current;
  renderPhases();
  phases.children[index + direction]?.querySelector<HTMLInputElement>('input')?.focus();
}

function renderPhase(phase: Phase, index: number) {
  const row = element('li', undefined, 'phase');
  const name = element('input');
  name.value = phase.label;
  name.maxLength = 80;
  name.setAttribute('aria-label', `Phase ${index + 1} name`);
  name.addEventListener('input', () => {
    phase.label = name.value;
    updateSummary();
  });
  const controls = element('div', undefined, 'phase-buttons');
  const up = button('↑', `Move phase ${index + 1} up`, () => move(index, -1));
  const down = button('↓', `Move phase ${index + 1} down`, () => move(index, 1));
  const remove = button('×', `Remove phase ${index + 1}`, () => {
    draft.phases.splice(index, 1);
    renderPhases();
    phases.children[Math.min(index, draft.phases.length - 1)]?.querySelector<HTMLInputElement>('input')?.focus();
  });
  up.disabled = index === 0;
  down.disabled = index === draft.phases.length - 1;
  remove.disabled = draft.phases.length < 2;
  controls.append(up, down, remove);
  const head = element('div', undefined, 'phase-head');
  head.append(element('span', String(index + 1).padStart(2, '0'), 'phase-number'), name, controls);

  const fields = element('div', undefined, 'phase-fields');
  const buildParameter = () => {
    const current = phase.fault;
    if (current.kind === 'delay') {
      return label('Delay (ms)', numberField(current.ms, 1, 4_000, value => { current.ms = value; }));
    }
    if (current.kind === 'http-error') {
      return label('Status code', numberField(current.status, 400, 599, value => { current.status = value; }));
    }
    return element('span');
  };
  let parameter = buildParameter();
  const effect = selectField(faultKinds, phase.fault.kind, value => faultLabels[value], value => {
    phase.fault = newFault(value);
    const next = buildParameter();
    parameter.replaceWith(next);
    parameter = next;
  });
  const count = numberField(phase.count, 1, maxRequests, value => { phase.count = value; });
  const every = numberField(phase.every, 1, maxRequests, value => { phase.every = value; });
  const expected = selectField(['auto', ...outcomes] as const, phase.expect,
    value => value === 'auto' ? 'From fault' : value.replaceAll('_', ' '),
    value => { phase.expect = value; });
  fields.append(label('Effect', effect), parameter, label('Requests', count), label('Every', every), label('Expect', expected));
  row.append(head, fields);
  return row;
}

function renderPhases() {
  phases.replaceChildren(...draft.phases.map(renderPhase));
  updateSummary();
}

function openScenario(scenario: Scenario) {
  draft = scenario;
  name.value = draft.name;
  timeout.value = String(draft.timeoutMs);
  budget.value = String(draft.budgetMs);
  renderPhases();
}

function renderReport(result: ExperimentReport) {
  const addMetric = (value: string, description: string) => {
    const metric = element('div', undefined, 'metric');
    metric.append(element('strong', value), element('small', description));
    return metric;
  };
  byId('metrics').replaceChildren(
    addMetric(`${result.replay.passed} / ${result.replay.requests}`, 'Replay checks passed'),
    addMetric(`${result.baseline.fallbacks} → ${result.replay.fallbacks}`, 'Fallback responses'),
    addMetric(`${result.p95DeltaMs >= 0 ? '+' : ''}${result.p95DeltaMs} ms`, 'p95 latency change'),
  );
  byId('fingerprint').textContent = `${result.scenario.name} · scenario ${result.runId.slice(0, 12)}`;
  byId('observations').replaceChildren(...result.rows.map(row => {
    const node = element('tr');
    const fault = element('td', faultLabels[row.fault.kind]);
    const detail = row.fault.kind === 'http-error' ? `HTTP ${row.fault.status}`
      : row.fault.kind === 'delay' ? `${row.fault.ms} ms`
      : row.label;
    fault.append(element('small', detail));
    fault.title = row.label;
    const baseline = element('td', `${row.baseline.elapsedMs} ms`);
    baseline.append(element('small', row.baseline.outcome));
    const replay = element('td', `${row.replay.elapsedMs} ms`);
    replay.append(element('small', row.replay.outcome));
    const pass = row.baseline.passed && row.replay.passed;
    const check = element('td', pass ? 'PASS' : 'FAIL', pass ? 'pass' : 'fail');
    if (!pass) {
      check.append(element('small', `Expected ${row.expected}`));
      check.append(element('small', [...row.baseline.problems, ...row.replay.problems].join(', ')));
    }
    node.append(element('td', String(row.request)), fault, baseline, replay, check);
    return node;
  }));
  byId('empty').hidden = true;
  byId('results').hidden = false;
  reportButton.disabled = false;
}

async function launch() {
  let snapshot: Scenario;
  try {
    snapshot = validateScenario(draft);
  } catch (error) {
    notifyError(error);
    return;
  }
  running = true;
  runButton.disabled = true;
  runButton.textContent = 'Comparing…';
  state.textContent = 'Running baseline and replay';
  state.dataset.state = '';
  notify('The run uses a snapshot of this scenario.');
  try {
    const response = await fetch('/api/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(snapshot),
    });
    if (!response.ok) {
      const data = await response.json() as { error?: string };
      throw new Error(data.error ?? 'Studio could not run this experiment.');
    }
    report = await response.json() as ExperimentReport;
    renderReport(report);
    notify(report.passed ? 'Baseline and replay passed.' : 'Some checks failed. Review the comparison.', !report.passed);
  } catch (error) {
    if (!report) state.textContent = 'Run error';
    notifyError(error);
  } finally {
    running = false;
    runButton.disabled = false;
    runButton.textContent = 'Run comparison';
    updateSummary();
  }
}

name.addEventListener('input', () => { draft.name = name.value; updateSummary(); });
timeout.addEventListener('input', () => { draft.timeoutMs = timeout.valueAsNumber; updateSummary(); });
budget.addEventListener('input', () => { draft.budgetMs = budget.valueAsNumber; updateSummary(); });
runButton.addEventListener('click', () => { void launch(); });
addButton.addEventListener('click', () => {
  draft.phases.push({ label: `Phase ${draft.phases.length + 1}`, count: 1, every: 1, fault: { kind: 'healthy' }, expect: 'auto' });
  renderPhases();
  phases.lastElementChild?.querySelector<HTMLInputElement>('input')?.focus();
});
byId('example').addEventListener('click', () => {
  if (JSON.stringify(draft) !== JSON.stringify(demoScenario) && !window.confirm('Replace this draft with the example?')) return;
  openScenario(structuredClone(demoScenario));
  notify('Opened the inventory example.');
});
byId('save').addEventListener('click', () => {
  try {
    localStorage.setItem(storageKey, JSON.stringify(validateScenario(draft)));
    notify('Scenario saved for this browser and port.');
  } catch (error) { notifyError(error); }
});
byId('export').addEventListener('click', () => {
  try {
    const scenario = validateScenario(draft);
    download(filename(scenario) + '.json', scenario);
  } catch (error) { notifyError(error); }
});
reportButton.addEventListener('click', () => {
  if (report) download(filename(report.scenario) + '-report.json', report);
});
byId('import').addEventListener('click', () => file.click());
file.addEventListener('change', async () => {
  const selected = file.files?.[0];
  file.value = '';
  if (!selected) return;
  try {
    if (selected.size > maxScenarioBytes) throw new Error('Scenario JSON is too large.');
    const scenario = decodeScenario(await selected.text());
    openScenario(scenario);
    notify('Imported the scenario. Save locally to keep it after reload.');
  } catch (error) { notifyError(error); }
});

openScenario(draft);
try {
  const saved = localStorage.getItem(storageKey);
  if (saved) {
    openScenario(decodeScenario(saved));
    notify('Restored the scenario saved in this browser.');
  }
} catch (error) { notifyError(error); }
