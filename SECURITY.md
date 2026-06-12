# Security Policy

Atizar is in beta. We take security seriously and appreciate responsible disclosure.

## Reporting a vulnerability

Please do **not** open a public issue for a security problem. Instead, report it privately via
GitHub's "Report a vulnerability" (Security advisories) on this repository. We'll acknowledge
your report and work with you on a fix and disclosure timeline.

## Scope notes

- Credentials are stored encrypted at rest; API keys live in environment variables, never in the
  database or git.
- The framework's design keeps consequential actions behind human-approved, server-executed gates
  — but beta software carries risk. Do not connect production accounts you cannot afford to expose.
