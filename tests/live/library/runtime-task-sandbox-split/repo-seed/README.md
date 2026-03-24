# Workflow CLI

This repository contains a small seeded Python CLI used by the live workflow matrix.

## Current behavior

- `python3 -m workflow_cli status`
  - prints a stable JSON status payload

## Required change for this profile

- add `python3 -m workflow_cli status-report --scenario-name <name>`
- keep the output deterministic and machine-readable
- create one markdown implementation summary under `reports/`
- verify changes with `./scripts/verify.sh`

## Development

- extend the existing Python standard-library stack in place
- keep command output deterministic and machine-readable
- verify changes with `./scripts/verify.sh`
