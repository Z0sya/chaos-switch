import { once } from 'node:events';
import { createServer, get, type Server, type ServerResponse } from 'node:http';
import { maxWaitMs, type FaultPlan } from './scenario.ts';

export const faults = ['healthy', 'delay', '503', 'disconnect'] as const;
export type Fault = typeof faults[number];

export const localHost = '127.0.0.1';
const inventoryPath = '/inventory';
const liveQuantity = 7;
const fallbackQuantity = 5;

export async function listenLocal(server: Server, port = 0) {
  server.listen({ host: localHost, port, exclusive: true });
  await once(server, 'listening');
  const bound = server.address();
  if (!bound || typeof bound === 'string') {
    throw new Error('Не удалось определить локальный порт.');
  }
  return {
    port: bound.port,
    origin: `http://${localHost}:${bound.port}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections();
    }),
  };
}

export function sendJson(response: ServerResponse, status: number, body: object) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(body));
}

function startFixtureWithPlan(selectFault: (index: number) => FaultPlan, port: number) {
  let requests = 0;
  const server = createServer((request, response) => {
    if (request.method !== 'GET' || request.url !== inventoryPath) {
      sendJson(response, 404, { error: 'fixture_route_not_found' });
      return;
    }
    const fault = selectFault(requests++);
    switch (fault.kind) {
      case 'healthy':
        sendJson(response, 200, { quantity: liveQuantity });
        break;
      case 'delay': {
        const timer = setTimeout(() => sendJson(response, 200, { quantity: liveQuantity }), fault.ms);
        response.once('close', () => clearTimeout(timer));
        break;
      }
      case 'timeout': {
        const timer = setTimeout(() => request.socket.destroy(), maxWaitMs);
        response.once('close', () => clearTimeout(timer));
        break;
      }
      case 'http-error':
        sendJson(response, fault.status, { error: 'fixture_unavailable' });
        break;
      case 'disconnect':
        request.socket.destroy();
        break;
      case 'partial':
        response.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'content-length': Buffer.byteLength(JSON.stringify({ quantity: liveQuantity })),
          connection: 'close',
        });
        response.write('{"quantity":', () => request.socket.end());
        break;
    }
  });
  return listenLocal(server, port).then(listener => ({
    ...listener,
    endpoint: listener.origin + inventoryPath,
    requests: () => requests,
  }));
}

export function startFixture(fault: Fault, delayMs: number, port = 0) {
  if (fault === '503') return startFixtureWithPlan(() => ({ kind: 'http-error', status: 503 }), port);
  if (fault === 'delay') return startFixtureWithPlan(() => ({ kind: 'delay', ms: delayMs }), port);
  return startFixtureWithPlan(() => ({ kind: fault }), port);
}

export function startScheduledFixture(plan: readonly FaultPlan[], port = 0) {
  return startFixtureWithPlan(index => plan[index] ?? { kind: 'healthy' }, port);
}

class PartialResponseError extends Error {}

export function readLocalJson(port: number, path: string, timeoutMs: number) {
  return new Promise<{ status: number; body: unknown }>((resolve, reject) => {
    const signal = AbortSignal.timeout(timeoutMs);
    const request = get({ hostname: localHost, port, path, agent: false, signal }, response => {
      response.setEncoding('utf8');
      let text = '';
      response.on('data', chunk => { text += chunk; });
      response.once('error', (error: Error) => {
        reject(!response.complete && !signal.aborted ? new PartialResponseError('Incomplete HTTP response.') : error);
      });
      response.once('end', () => {
        try {
          resolve({ status: response.statusCode ?? 0, body: JSON.parse(text) });
        } catch (error) {
          reject(error);
        }
      });
    });
    request.once('error', reject);
  });
}

type Reason = 'timeout' | 'unavailable' | 'disconnect' | 'partial' | 'dependency_error';

function fallback(response: ServerResponse, reason: Reason) {
  sendJson(response, 200, { source: 'fallback', quantity: fallbackQuantity, reason });
}

export function startDemoApp(fixturePort: number, timeoutMs: number) {
  const server = createServer(async (request, response) => {
    if (request.method !== 'GET' || request.url !== '/stock') {
      sendJson(response, 404, { error: 'app_route_not_found' });
      return;
    }

    try {
      const upstream = await readLocalJson(fixturePort, inventoryPath, timeoutMs);
      if (upstream.status === 503) {
        fallback(response, 'unavailable');
        return;
      }
      if (upstream.status !== 200
          || typeof upstream.body !== 'object'
          || upstream.body === null
          || !('quantity' in upstream.body)
          || typeof upstream.body.quantity !== 'number') {
        fallback(response, 'dependency_error');
        return;
      }
      sendJson(response, 200, { source: 'live', quantity: upstream.body.quantity, reason: null });
    } catch (error) {
      if (error instanceof PartialResponseError) {
        fallback(response, 'partial');
        return;
      }
      switch ((error as NodeJS.ErrnoException).code) {
        case 'ABORT_ERR':
          fallback(response, 'timeout');
          break;
        case 'ECONNRESET':
          fallback(response, 'disconnect');
          break;
        default:
          fallback(response, 'dependency_error');
      }
    }
  });
  return listenLocal(server);
}
