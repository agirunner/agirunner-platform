# Workflow CLI

This repository contains a small seeded Python CLI used by the live assessment matrix.

## Current behavior

- `python3 -m workflow_cli status`
  - prints a stable JSON status payload

## Staged revision contract

- the live scenario adds `python3 -m workflow_cli release-plan --change-id <id>`
- the three-revision contract is documented in `docs/staged-revision-contract.md`
- do not simulate future revisions in a single baseline implementation

## Development

- extend the existing Python standard-library stack in place
- keep command output deterministic and machine-readable
- verify changes with `./scripts/verify.sh`
