# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project aims to follow [Semantic Versioning](https://semver.org/).

This file captures the current pre-release capability snapshot for the
open `0.1.0` target.

## [Unreleased]

## [0.1.0-alpha.2] - 2026-04-03

### Added

- Sidebar `Versions` popover with running platform, dashboard, container-manager, and runtime image identity.
- Commit-time CI workflow for platform unit tests and image builds.
- Release workflow gate for deterministic platform integration tests before publish/tag steps.

### Changed

- Fresh stacks now derive the managed runtime image from the running platform version instead of relying on a moving `latest` default.
- Managed runtime-image seeds normalize stored `:latest` and legacy local aliases to the exact matching runtime tag for the running platform release.
- Orchestrators now default to reactive mode while keeping the tenant-wide loop-mode control available for TPAOV.
- Runtime image settings surfaces now show resolved current values instead of hardcoded local placeholders.
- Workflow detail surfaces now show resolved runtime version labels and present deliverables more directly in the main table.

### Fixed

- Recoverable orchestration paths around stale claims, stale close guidance, rework progression, completed-stage task creation, and gate-wait continuation.
- Repo and shell recovery guidance so expected nonzero exits, repo probes, and module-loader checks steer operators and agents more reliably.
- Dashboard workflow realtime refresh so selected work items and live console state stay aligned with current execution state.

## [0.1.0]

### Added

- Playbook-driven workflow orchestration with workflows, work items, tasks, and activations.
- Public platform API for control-plane state, routing, claim contracts, and result ingestion.
- Dashboard operator surfaces for Mission Control, workflows, approvals, configuration, and execution logs.
- Approval, assessment, escalation, rework, and continuity records across workflow execution.
- Role, prompt, tool, and model contracts delivered to connected runtimes at task-claim time.
- Artifact storage, preview, and workflow, work-item, and workspace memory surfaces.
- Execution-log ingest, streaming, filtering, and operator inspection paths.
- Container-manager reconciliation for runtime pools, warm and cold scaling, and worker lifecycle management.
- Deterministic contract, dashboard integration, and live workflow verification lanes.
