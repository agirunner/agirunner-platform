# Staged Revision Contract

This live-test repository uses a three-revision delivery contract for
`python3 -m workflow_cli release-plan --change-id <id>`.

## Revision 1

- add the `release-plan` command
- accept `--change-id`
- emit deterministic JSON with:
  - `change_id`
  - `plan_status` set to `draft`
  - a non-empty `implementation_steps` array
  - `release_readiness` set to `pending`
- add unit coverage for the baseline command
- do not add:
  - `compatibility_checks`
  - `dependency_notes`
  - `rollback_plan`
  - `operational_guardrails`

## Revision 2 After Architect Rework

- keep revision 1 behavior deterministic
- add a non-empty `compatibility_checks` array
- add a non-empty `dependency_notes` array
- document `release-plan` in `README.md`
- extend unit coverage for the architect_rework_scope output
- do not add:
  - a non-empty `rollback_plan`
  - `operational_guardrails`
  - `release_readiness` set to `approved`

## Revision 3 Final Implementation

- keep revision 2 behavior intact
- add a non-empty `rollback_plan`
- add a non-empty `operational_guardrails` array
- set `release_readiness` to `approved`
- extend unit coverage for the final guarded output contract

Quality should request changes on revision 1 and approve once revision 2
lands. Integration should approve revision 1, reject revision 2, and
approve revision 3.
