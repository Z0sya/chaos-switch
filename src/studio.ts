import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { runExperiment } from './experiment.ts';
import { listenLocal, localHost, sendJson } from './http.ts';
import { decodeScenario, maxScenarioBytes } from './scenario.ts';

function secure(response: ServerResponse) {
  response.setHeader('Content-Security-Policy',
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; " +
    "img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Cache-Control', 'no-store');
}

async function readInput(request: IncomingMessage) {
  let length = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request.iterator({ destroyOnReturn: false }) as AsyncIterable<Buffer>) {
    length += chunk.byteLength;
    if (length > maxScenarioBytes) throw new Error('Scenario JSON is too large.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, length).toString('utf8');
}

async function loadAssets() {
  const assets = [
    ['/', '../web/index.html', 'text/html; charset=utf-8'],
    ['/ui.css', '../web/ui.css', 'text/css; charset=utf-8'],
    ['/ui.js', '../dist/web/ui.js', 'text/javascript; charset=utf-8'],
    ['/scenario.js', '../dist/scenario.js', 'text/javascript; charset=utf-8'],
  ] as const;
  return new Map(await Promise.all(assets.map(async ([path, file, type]) => {
    const body = await readFile(new URL(file, import.meta.url));
    return [path, { body, type }] as const;
  })));
}

export async function startStudio(port = 0) {
  const assets = await loadAssets().catch(() => {
    throw new Error('Studio assets are missing. Run npm run build from the project directory.');
  });
  let origin: string;
  let host: string;
  let running = false;
  const server = createServer({ requestTimeout: 10_000, headersTimeout: 5_000 }, async (request, response) => {
    secure(response);
    if (request.headers.host !== host) {
      sendJson(response, 403, { error: 'Use the exact local address printed by Studio.' });
      return;
    }

    const asset = request.method === 'GET' && assets.get(request.url as '/');
    if (asset) {
      response.writeHead(200, { 'Content-Type': asset.type, 'Content-Length': asset.body.byteLength });
      response.end(asset.body);
      return;
    }
    if (request.method !== 'POST' || request.url !== '/api/run') {
      sendJson(response, 404, { error: 'Route not found.' });
      return;
    }
    if (request.headers.origin !== origin) {
      sendJson(response, 403, { error: 'Run requests must come from this Studio tab.' });
      return;
    }
    if (request.headers['content-type']?.split(';', 1)[0]?.trim() !== 'application/json') {
      sendJson(response, 415, { error: 'Use JSON.' });
      return;
    }
    if (Number(request.headers['content-length']) > maxScenarioBytes) {
      response.setHeader('Connection', 'close');
      sendJson(response, 413, { error: 'Scenario JSON is too large.' });
      return;
    }
    if (running) {
      sendJson(response, 409, { error: 'Studio already has an experiment in progress.' });
      return;
    }

    running = true;
    try {
      let scenario;
      try {
        scenario = decodeScenario(await readInput(request));
      } catch (error) {
        response.setHeader('Connection', 'close');
        sendJson(response, 400, { error: error instanceof Error ? error.message : 'Invalid scenario.' });
        return;
      }
      try {
        sendJson(response, 200, await runExperiment(scenario));
      } catch {
        sendJson(response, 500, { error: 'Could not run the loopback experiment. Check local TCP access.' });
      }
    } finally {
      running = false;
    }
  });
  server.maxConnections = 32;
  const listener = await listenLocal(server, port);
  origin = listener.origin;
  host = `${localHost}:${listener.port}`;
  return listener;
}
