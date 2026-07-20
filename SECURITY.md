# Security Policy

## Supported Versions

panelist is pre-1.0 and evolving quickly. Only the latest `0.x` release
published to public npm is supported with security fixes.

| Version | Supported          |
| ------- | ------------------ |
| 0.x     | :white_check_mark: |
| < 0.x   | :x:                |

Once panelist reaches 1.0, this table will be updated to reflect a stable
support window.

## Reporting a Vulnerability

Please report suspected security vulnerabilities privately — **do not** open
a public GitHub issue.

Email **security@kromatic.com** with:

- A description of the vulnerability and its potential impact.
- Steps to reproduce, or a minimal proof of concept if available.
- The panelist version (and, if relevant, Node.js version) affected.

We will acknowledge receipt within **3 business days** and aim to provide an
initial assessment (severity, whether it's confirmed, and expected next
steps) within **10 business days**. We'll keep you updated as a fix is
developed and will credit reporters in the release notes unless you'd
prefer to stay anonymous.

panelist has zero runtime dependencies, which narrows but does not eliminate
its attack surface (e.g. supply-chain risk in dev/build tooling, or misuse
of the API surface itself). We don't currently run a bug-bounty program.
