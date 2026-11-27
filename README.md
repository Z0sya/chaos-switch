# CHAOS SWITCH

CHAOS SWITCH compares how a test application behaves against a healthy HTTP dependency and against a repeatable series of faults. Design the series in Scenario Studio, export the JSON and run it again from the CLI or CI.

## Quick start

Requires Node.js 24.12+. Building from source uses npm and a first download of the locked build tools. If you have the compiled distribution, start at the third command. The compiled CLI and Studio run offline.

```sh
npm ci --ignore-scripts
npm run build
node dist/cli.js run examples/inventory.json
node dist/cli.js studio --port 43118
```

Open the address printed by Studio, then select **Run comparison**. The inventory example performs 14 requests against a healthy fixture and 14 against the planned faults. The comparison displays recovery, fallback, response latency and failed checks. Import and export the scenario or report as JSON. **Save locally** restores one scenario per browser and local port. Use the same port between sessions to reopen a saved scenario.

## Supported faults

| Effect | What the fixture does |
| --- | --- |
| Healthy | Returns HTTP 200 with the synthetic inventory quantity |
| Delay | Waits before sending a complete HTTP 200 |
| Timeout | Holds the socket without responding, for at most 5 seconds |
| HTTP error | Returns the configured HTTP 400–599 status |
| Disconnect | Closes the socket before sending headers |
| Partial body | Sends HTTP 200 headers and part of the JSON body, then closes the socket |

Each phase has its own request count and frequency. For example, `every: 2` affects requests 2, 4, 6 and so on within that phase. Requests in between behave normally. Replay starts from the first phase.

The built-in consumer serves a healthy quantity or a fallback with its reason, each with HTTP 200. Each observation checks the complete output, response time and number of calls. Reports include p50/p95 latency, fallback count, response details and a hash of the normalized scenario. The plan and hash repeat across runs. Timing measurements vary with the host.

## Run locally with your client

```sh
node dist/cli.js serve --scenario examples/inventory.json --port 43117
```

Point your isolated test client's inventory dependency at `http://127.0.0.1:43117/inventory`. See [Integration](docs/integration.md) for exit codes, the scenario format and a runnable client example. Original PoC commands remain available with `demo` and `serve --fault healthy|delay|503|disconnect`.

## Verify and build

```sh
npm run typecheck
npm run build
npm test
node examples/check-client.mjs
```

TypeScript checks the Node.js modules, browser UI and tests. `npm test` opens actual listening sockets on `127.0.0.1`. The compiled CLI is in `dist/cli.js`. Keep its neighboring `package.json`, `dist/` and `web/` together when copying a built distribution. The installed npm dependencies are only needed for development and compilation.

## Scope and security

The Alpha runs on IPv4 loopback with one fixed synthetic `GET /inventory` fixture. Consumers explicitly point their local test configuration at the fixture. The CLI and scenario format have no target URL, forwarding, external monitoring, telemetry, authentication, HTTPS or load testing. For concurrent requests, effects follow the order accepted by the fixture. Use one sequential client for deterministic replay. Reports compare the included consumer. Application-specific assertions belong in the consuming application's test suite.

See [Architecture](docs/architecture.md), [Security](SECURITY.md), the [changelog](CHANGELOG.md) and [license](LICENSE).
