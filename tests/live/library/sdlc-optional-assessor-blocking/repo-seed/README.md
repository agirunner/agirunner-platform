# Workflow CLI

This repository contains a small seeded Python CLI used by the live assessment matrix.

## Current behavior

- `python3 -m workflow_cli status`
  - prints a stable JSON status payload

## Development

- extend the existing Python standard-library stack in place
- keep command output deterministic and machine-readable
- verify changes with `./scripts/verify.sh`
- repository-owned templates live under `templates/`
