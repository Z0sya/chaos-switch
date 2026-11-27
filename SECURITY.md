# Security

## Supported versions

Please reproduce reports on the current Alpha source and include the Node.js version and operating system.

## Private reporting

Use **Report a vulnerability** in the repository's Security tab when private reporting is available. If it is unavailable, open an issue asking for a private contact with no vulnerability details. Share a minimal synthetic test case and redact credentials, private URLs and personal data.

## Local operation

The fixture, demo application and Studio bind specifically to `127.0.0.1`. They implement no request forwarding, DNS target resolution or user-supplied target addresses. Studio serves a fixed asset allowlist, verifies the Host and exact Origin, accepts JSON only up to 16 KiB and limits execution to one comparison at a time. The scenario schema blocks unexpected properties and caps the schedule. This local service has no authentication. Run it only on a workstation or in an isolated CI job you control.
