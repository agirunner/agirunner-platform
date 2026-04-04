# Community Playbooks Live Suite

`tests/community-playbooks/` runs realistic workflows against the imported community catalog on top of the shared live stack.

It exists separately from `tests/live` on purpose:
- `tests/live` stresses hostile edge cases and protocol semantics
- `tests/community-playbooks` runs believable standard workloads for the unmodified community playbooks

Operator surfaces:
- [`env/local.env.example`](./env/local.env.example)
  - optional suite-local overrides loaded after the live-suite env
- [`run.sh`](./run.sh)
  - supported public entrypoint for bootstrap, import, and run selection
- [`catalog/`](./catalog)
  - test-owned community playbook inputs and default batches
- [`fixtures/`](./fixtures)
  - uploaded files, host workspaces, and remote MCP fixture inputs
- [`results/`](./results)
  - suite-local outputs and summaries

Rules:
- community catalog source of truth is `agirunner-playbooks`
- playbooks, specialists, and skills stay untouched
- variation comes only from curated workflow inputs, uploaded files,
  workspace type, steering, and operator decisions
- default batches are `smoke`, `matrix`, and `controls`

Usage:

```bash
bash tests/community-playbooks/run.sh
bash tests/community-playbooks/run.sh --bootstrap-only
bash tests/community-playbooks/run.sh --import-only
bash tests/community-playbooks/run.sh --batch smoke
bash tests/community-playbooks/run.sh --playbook bug-fix
bash tests/community-playbooks/run.sh --playbook bug-fix --variant approval --manual-operator-actions
bash tests/community-playbooks/run.sh --playbook research-analysis --variant mcp
```

Default behavior:
- rebuild and reseed the shared live-test environment
- import the full community catalog through the real platform APIs
- assign the seeded specialist model to imported roles
- register the deterministic community research MCP fixture
- execute the selected `smoke`, `matrix`, and `controls` runs

Environment:
- `tests/live/env/local.env` remains the required base env file
- if present, `tests/community-playbooks/env/local.env` is loaded after the live env and can override suite-local values
- set `COMMUNITY_PLAYBOOKS_ENV_FILE` to point at a different suite override file
- `--provider` may also use the provider-specific alias secrets listed in [`env/local.env.example`](./env/local.env.example)
- the suite reuses the live runtime/container stack
- shared bootstrap prefers a local `agirunner-playbooks` checkout when one is available and clears any inherited `COMMUNITY_CATALOG_REF` override for the stack
- set `PLAYBOOKS_REPO_PATH` if your local `agirunner-playbooks` checkout is not at the default sibling path
- the suite seeds a deterministic research MCP server for the `mcp` variants
- the community suite uses its own result tree under
  `tests/community-playbooks/results`

Result layout:
- `results/bootstrap/context.json`
- `results/import/import-summary.json`
- `results/<batch>/<playbook>/<variant>.json`
- `results/summary.json`
