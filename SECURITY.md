# Security Policy

This repository contains the Agirunner control plane.

If you discover a security vulnerability in `agirunner-platform`, please
report it responsibly. **Do not open a public GitHub issue.**

## Reporting a Vulnerability

Email **admin@agirunner.dev** with:

- Description of the issue
- Steps to reproduce or validate it
- Affected platform surface or configuration
- Severity assessment, if you have one
- Any suggested fix or mitigation, if available

## What to Expect

We aim to respond within these targets:

| Target | Action |
|--------|--------|
| 24 hours | We acknowledge receipt of your report |
| 72 hours | We provide an initial assessment and severity rating |
| 7 days | We have a fix in progress or a mitigation plan |
| 30 days | We release a fix, or sooner for critical issues |

## Scope

This policy applies to `agirunner-platform`.

For the product-level umbrella policy across the currently public
Agirunner repositories, see
[`agirunner/SECURITY.md`](https://github.com/agirunner/agirunner/blob/main/SECURITY.md).

## Supported Versions

During the initial public rollout:

- Until `0.1.0` is released, `main` is the supported pre-release line
  and receives fixes.
- After `0.1.0` is released, the latest public platform release line is
  supported.
- Older release lines are out of scope unless explicitly noted in
  release notes.

## Platform Operator Guidance

- Keep the platform API, dashboard image, Postgres, container manager,
  and base images updated.
- Use strong admin, JWT, webhook, storage, and provider credentials, and
  rotate them when ownership or exposure changes.
- Put TLS, authentication, and network controls in front of platform
  endpoints.
- Restrict database, socket-proxy, and container-manager access to
  trusted hosts and operators only.
- Review artifact-storage permissions and log-retention settings with
  the same care as other production data surfaces.
