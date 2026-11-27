# Third-party notices

CHAOS SWITCH has no runtime npm dependencies. The release contains original HTML, CSS, TypeScript-derived JavaScript and synthetic data. It uses system fonts and Node.js built-in APIs. Node.js is installed separately, under its [own license and notices](https://github.com/nodejs/node/blob/main/LICENSE).

These packages are installed for compilation and type checking. The lockfile fixes their versions and integrity hashes. They retain the license files in their published tarballs and are excluded from the compiled distribution.

| Package | Version | License and attribution |
| --- | --- | --- |
| TypeScript | 5.9.3 | Apache-2.0 and bundled tool notices. Microsoft. [Published package](https://www.npmjs.com/package/typescript/v/5.9.3), [license](https://github.com/microsoft/TypeScript/blob/v5.9.3/LICENSE.txt). |
| @types/node | 24.10.1 | MIT. Copyright (c) Microsoft Corporation. [Published package](https://www.npmjs.com/package/@types/node/v/24.10.1). |
| undici-types | 7.16.0 | MIT. Copyright (c) Matteo Collina and Undici contributors. [Published package](https://www.npmjs.com/package/undici-types/v/7.16.0). |

GitHub Actions references upstream [checkout](https://github.com/actions/checkout) and [setup-node](https://github.com/actions/setup-node) by full commit hash. These actions run in CI and are not distributed with the application.
