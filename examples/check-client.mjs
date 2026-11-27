import assert from 'node:assert/strict';
import { startScheduledFixture } from '../dist/http.js';

const fixture = await startScheduledFixture([
  { kind: 'healthy' },
  { kind: 'http-error', status: 503 },
  { kind: 'healthy' },
]);

async function available() {
  const response = await fetch(fixture.endpoint, { signal: AbortSignal.timeout(1000), redirect: 'error' });
  if (response.status === 503) {
    await response.arrayBuffer();
    return { source: 'fallback', quantity: 5 };
  }
  assert.equal(response.status, 200);
  const { quantity } = await response.json();
  return { source: 'live', quantity };
}

try {
  assert.deepEqual(await available(), { source: 'live', quantity: 7 });
  assert.deepEqual(await available(), { source: 'fallback', quantity: 5 });
  assert.deepEqual(await available(), { source: 'live', quantity: 7 });
  assert.equal(fixture.requests(), 3);
  console.log('Local client uses fallback on HTTP 503 and recovers.');
} finally {
  await fixture.close();
}
