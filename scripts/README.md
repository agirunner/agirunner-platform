# Scripts

Live workflow tests no longer run from `scripts/`.

Use the canonical path under `tests/live/` instead:

```bash
bash tests/live/run.sh --scenario sdlc-assessment-approve
```

See [tests/live/README.md](../tests/live/README.md) for the supported live-test flow.

## V2 Contract Runner (`scripts/test-v2-contract.sh`)

This runner replaces the deleted flaky smoke gate for V2 development with a
deterministic contract lane across the platform API, dashboard, and SDK
surfaces.

Run it from the platform repository root:

```bash
pnpm test:v2-contract
```

The lane intentionally targets the playbook/orchestrator/work-item architecture
instead of legacy template-era behavior.
