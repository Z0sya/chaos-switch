# Integration

## CI and exit codes

Use the same exported scenario in Studio and your repository's checks.

```sh
npm ci --ignore-scripts
npm run typecheck
npm run build
npm test
node dist/cli.js run examples/inventory.json > chaos-report.json
```

| Exit code | Meaning |
| --- | --- |
| 0 | The scenario ran and all assertions passed |
| 1 | The report contains an assertion failure |
| 2 | Invalid arguments or scenario, or the local runner failed to start |

Store the JSON as a test artifact to retain observed times and actionable `problems` per row. The check observes the bundled sample application. Use the fixture mode to exercise your own application.

## Point your test client at the fixture

Run `node dist/cli.js serve --scenario examples/inventory.json`, read the printed loopback URL and configure it as the dependency URL in an isolated test process. Restart for each new sequence. After the planned requests, the fixture returns healthy responses. Requests other than exact `GET /inventory` return 404 and leave the schedule position unchanged.

The optional flag `--port 43117` is useful for a manual test. Use dynamic ports for parallel test processes. [check-client.mjs](../examples/check-client.mjs) starts a fresh fixture and checks fallback and recovery for a separate Node.js client.

## Scenario version 1

```json
{
  "schemaVersion": 1,
  "name": "Retry window",
  "timeoutMs": 180,
  "budgetMs": 900,
  "phases": [
    {
      "label": "Every other request fails",
      "count": 4,
      "every": 2,
      "fault": { "kind": "http-error", "status": 503 },
      "expect": "auto"
    },
    {
      "label": "Recovery",
      "count": 1,
      "every": 1,
      "fault": { "kind": "healthy" },
      "expect": "live"
    }
  ]
}
```

The schema allows 1–12 phases, at most 32 requests, a client timeout of 50–1,000 ms and a response budget of 1–4,000 ms. Names are printable text of at most 80 characters and JSON is capped at 16 KiB. `every` must be between 1 and that phase's count. Supported fault kinds are `healthy`, `delay` (requires `ms`, 1–4,000), `timeout`, `http-error` (requires `status`, 400–599), `disconnect` and `partial`.

`expect` applies to the phase's selected requests. Use `auto`, `live`, `timeout`, `unavailable`, `disconnect`, `partial` or `dependency_error`. With `auto`, 503 maps to `unavailable`, other error statuses map to `dependency_error`, and delays at least as long as the consumer timeout map to `timeout`. Leave margin around the timeout because local scheduling can vary.
