# Scripts

Live workflow tests no longer run from `scripts/`.

Use the canonical path under `tests/live/` instead:

```bash
bash tests/live/scenarios/run-sdlc-baseline-live-test.sh
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

---

## Runtime image strategy helper (`scripts/runtime-image-publish.sh`)

Used in v1.05 S3 to support private-registry publish + tarball fallback flow.

### What it does

- Builds runtime image from a local runtime repository checkout (`../agirunner-runtime` by default)
- Tags runtime image for private registry (`registry.github.com/enterprise-private/agirunner-runtime:<tag>`)
- Exports OCI tarball fallback under `dist/images/`
- Writes JSON manifest with image/tar metadata

### Example

```bash
# Build + tar fallback only (no push)
./scripts/runtime-image-publish.sh

# Build + push + tar fallback
PUSH_IMAGE=true ./scripts/runtime-image-publish.sh
```
