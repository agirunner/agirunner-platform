# Community Playbooks Live Suite

This suite runs realistic workflows against the imported community catalog.

It exists separately from `tests/live` on purpose:
- `tests/live` stresses hostile edge cases and protocol semantics
- `tests/community-playbooks` runs believable standard workloads for the
  unmodified community playbooks

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
- the runner loads `tests/live/env/local.env`
- the suite reuses the live runtime/container stack
- the suite seeds a deterministic research MCP server for the `mcp` variants
- the community suite uses its own result tree under
  `tests/community-playbooks/results`

Result layout:
- `results/bootstrap/context.json`
- `results/import/import-summary.json`
- `results/<batch>/<playbook>/<variant>.json`
- `results/summary.json`
