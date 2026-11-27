# Architecture

| Module | Responsibility |
| --- | --- |
| `src/scenario.ts` | Versioned validation and deterministic schedule, shared by CLI, Studio server and browser |
| `src/http.ts` | HTTP/1.1 fixture, transport effects and demonstration inventory consumer |
| `src/suite.ts` | The original four independent demo cases |
| `src/experiment.ts` | Healthy baseline, replay, per-request assertions and report |
| `src/studio.ts` | Loopback-only static allowlist and the same-origin experiment endpoint |
| `src/web/ui.ts`, `web/` | Browser controls, local storage, JSON import and download |

Each pass creates its own HTTP fixture and demo consumer on free IPv4 loopback ports. The consumer contacts the fixture once per request, with an abort deadline. The runner observes the parsed response then closes both listeners. It compares HTTP status, typed response, number of fixture requests and end-to-end latency against the scenario contract.

Studio runs one experiment at a time. The browser submits a scenario to the exact origin it was loaded from. The process validates the JSON, accepts at most 16 KiB, serves only known static assets and returns a report. Scenario import in the browser validates independently of saving. Studio has no write-to-filesystem endpoint.

Reports use nearest-rank percentiles. The SHA-256 `runId` identifies the normalized scenario, so multiple runs of the same plan use the same identifier. Request timings are rounded to tenths of a millisecond and measured on the local monotonic clock.
