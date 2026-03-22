# Staged Delivery Contract

This live-test repository intentionally uses a two-revision delivery contract.

## Revision 1

- add the `workflow_cli assess` command
- accept `--scenario-name`
- emit deterministic JSON with:
  - `scenario_name`
  - `assessment_status` set to `draft`
  - `release_ready` set to `false`
- add unit coverage for the new command

## Revision 2 After Request Changes

- keep revision 1 behavior deterministic
- add `assessment_contract` to the JSON payload
- change `assessment_status` to `approved`
- change `release_ready` to `true`
- add a non-empty `package_reference`
- document the assess command in `README.md`
- extend unit coverage for the release-ready output contract

The acceptance assessor should request changes if revision 1 is delivered without the revision 2 contract.
