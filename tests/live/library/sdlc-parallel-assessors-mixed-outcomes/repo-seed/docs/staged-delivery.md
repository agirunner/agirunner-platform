# Staged Delivery Contract

This live-test repository uses a three-revision delivery contract for
`python3 -m workflow_cli release-audit --scenario-name <name>`.

## Revision 1

- add the `release-audit` command
- accept `--scenario-name`
- emit deterministic JSON with:
  - `scenario_name`
  - `audit_status` set to `draft`
  - `rollback_ready` set to `false`
  - `compatibility_notes` set to an empty array
- add unit coverage for the baseline command
- do not add:
  - `rollback_checklist`
  - README usage
  - `permission_boundary`
  - `threat_model_note`
  - `guardrail_validation`

## Revision 2 After Quality Request Changes

- keep revision 1 behavior deterministic
- add a non-empty `rollback_checklist`
- set `rollback_ready` to `true`
- add non-empty `compatibility_notes`
- document `release-audit` in `README.md`
- extend unit coverage for the quality-ready output contract
- do not add:
  - `permission_boundary`
  - `threat_model_note`
  - `guardrail_validation`

## Revision 3 After Security Rejection

- keep revision 2 behavior intact
- add non-empty `permission_boundary`
- add non-empty `threat_model_note`
- set `guardrail_validation` to `true`
- extend unit coverage for the security-ready output contract

Quality should request changes on revision 1 and approve once revision 2
lands. Security should approve revision 1, reject revision 2, and approve
revision 3.
