import { once } from 'node:events';
import { createServer, get, type Server, type ServerResponse } from 'node:http';

export const faults = ['healthy', 'delay', '503', 'disconnect'] as const;
export type Fault = typeof faults[number];

const host = '127.0.0.1';
const inventoryPath = '/inventory';
const liveQuantity = 7;
const fallbackQuantity = 5;

async function listen(server: Server, port = 0) {
  server.listen({ host, port, exclusive: true });
  await once(server, 'listening');
  const bound = server.address();
  if (!bound || typeof bound === 'string') {
    throw new Error('Не удалось определить локальный порт.');
  }
  return {
    port: bound.port,
    origin: `http://${host}:${bound.port}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections();
    }),
  };
}

function sendJson(response: ServerResponse, status: number, body: object) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

export async function startFixture(fault: Fault, delayMs: number, port = 0) {
  let requests = 0;
  const server = createServer((request, response) => {
    if (request.method !== 'GET' || request.url !== inventoryPath) {
      sendJson(response, 404, { error: 'fixture_route_not_found' });
      return;
    }
    requests++;
    switch (fault) {
      case 'healthy':
        sendJson(response, 200, { quantity: liveQuantity });
        break;
      case 'delay': {
        const timer = setTimeout(() => sendJson(response, 200, { quantity: liveQuantity }), delayMs);
        response.once('close', () => clearTimeout(timer));
        break;
      }
      case '503':
        sendJson(response, 503, { error: 'fixture_unavailable' });
        break;
      case 'disconnect':
        request.socket.destroy();
        break;
    }
  });
  const listener = await listen(server, port);
  return {
    ...listener,
    endpoint: listener.origin + inventoryPath,
    requests: () => requests,
  };
}

export function readLocalJson(port: number, path: string, timeoutMs: number) {
  return new Promise<{ status: number; body: unknown }>((resolve, reject) => {
    const signal = AbortSignal.timeout(timeoutMs);
    const request = get({ hostname: host, port, path, agent: false, signal }, response => {
      response.setEncoding('utf8');
      let text = '';
      response.on('data', chunk => { text += chunk; });
      response.once('error', reject);
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

type Reason = 'timeout' | 'unavailable' | 'disconnect' | 'dependency_error';

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
  return listen(server);
}
