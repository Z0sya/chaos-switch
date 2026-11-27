# Contributing

Set up Node.js 24.12+ and install the build tooling with `npm ci --ignore-scripts`. Before opening a pull request, run:

```sh
npm run typecheck
npm run build
npm test
node examples/check-client.mjs
```

Use a synthetic dependency on loopback and small reproducible scenarios. Preserve CLI exit codes and test existing scenario files when changing the schema. Add tests for observable behavior and update integration documentation. Bring up security issues privately as described in [SECURITY.md](SECURITY.md).

Contributions are accepted under [Apache-2.0](LICENSE). Submit only material you have rights to contribute and disclose relevant third-party sources.
