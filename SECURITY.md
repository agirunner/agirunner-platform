# Security Policy

This repository contains the public Agirunner control plane.

If you discover a vulnerability in `agirunner-platform`, please report
it responsibly. **Do not open a public GitHub issue for security
findings.**

## Reporting A Vulnerability

Email **admin@agirunner.dev** with:

- a clear description of the issue
- steps to reproduce or validate it
- the affected platform surface or configuration
- your severity assessment, if you have one
- any suggested fix or mitigation, if available

## What To Expect

We aim to respond within these targets:

| Target | Action |
| --- | --- |
| 24 hours | Acknowledge receipt of your report |
| 72 hours | Provide an initial assessment and severity rating |
| 7 days | Have a fix in progress or a mitigation plan |
| 30 days | Release a fix, or sooner for critical issues |

## Scope

This policy applies to `agirunner-platform`.

For the product-level umbrella policy across the currently public
Agirunner repositories, see
[`agirunner/SECURITY.md`](https://github.com/agirunner/agirunner/blob/main/SECURITY.md).

## Supported Versions

During the initial public rollout:

- until `0.1.0` is released, `main` is the supported pre-release line
  and receives fixes
- after `0.1.0` is released, the latest public platform release line is
  supported
- older release lines are out of scope unless explicitly noted in
  release notes

## Operator Guidance

- Keep the platform API image, dashboard build, Postgres,
  container-manager, and base images updated.
- Use strong admin, JWT, webhook, storage, and provider credentials,
  and rotate them when ownership or exposure changes.
- Put TLS, authentication, and network controls in front of platform
  endpoints.
- Restrict database, socket-proxy, and container-manager access to
  trusted hosts and operators only.
- Review artifact-storage permissions and log-retention settings with
  the same care as other production data surfaces.
