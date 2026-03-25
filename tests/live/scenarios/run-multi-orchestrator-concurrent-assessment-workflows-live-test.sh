#!/usr/bin/env bash
set -euo pipefail

LIVE_TEST_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "${LIVE_TEST_ROOT}/../.." && pwd)"

# shellcheck disable=SC1091
source "${LIVE_TEST_ROOT}/lib/common.sh"

SCENARIO_NAME="multi-orchestrator-concurrent-assessment-workflows"
LIVE_TEST_ENV_FILE="${LIVE_TEST_ENV_FILE:-${LIVE_TEST_ROOT}/env/local.env}"
load_live_test_env "${LIVE_TEST_ENV_FILE}"

ARTIFACTS_DIR="${LIVE_TEST_ARTIFACTS_DIR:-${REPO_ROOT}/.tmp/live-tests}"
SCENARIO_DIR="${ARTIFACTS_DIR}/${SCENARIO_NAME}"
EVIDENCE_DIR="${SCENARIO_DIR}/evidence"
WORKFLOW_RUN_FILE="${SCENARIO_DIR}/workflow-run.json"
SHARED_CONTEXT_FILE="${LIVE_TEST_SHARED_CONTEXT_FILE:-${ARTIFACTS_DIR}/bootstrap/context.json}"
BATCH_RUNNER="${LIVE_TEST_MULTI_ORCH_BATCH_RUNNER:-${LIVE_TEST_ROOT}/scenarios/run-live-scenario-batch.sh}"
WORKFLOW_COUNT="${LIVE_TEST_MULTI_ORCH_WORKFLOW_COUNT:-6}"
INNER_CONCURRENCY="${LIVE_TEST_MULTI_ORCH_CONCURRENCY:-${WORKFLOW_COUNT}}"

require_live_test_file "${BATCH_RUNNER}" "multi-orchestrator batch runner"

rm -rf "${SCENARIO_DIR}"
mkdir -p "${SCENARIO_DIR}" "${EVIDENCE_DIR}"

tmp_root="$(mktemp -d "${SCENARIO_DIR}/batch.XXXXXX")"
scenario_root="${tmp_root}/scenarios"
mkdir -p "${scenario_root}"

cleanup() {
  rm -rf "${tmp_root}"
}
trap cleanup EXIT

python3 - "${scenario_root}" "${WORKFLOW_COUNT}" <<'PY'
import json
import sys
from pathlib import Path

scenario_root = Path(sys.argv[1])
workflow_count = int(sys.argv[2])

for index in range(1, workflow_count + 1):
    scenario_name = f"multi-orchestrator-concurrent-assessment-workflows-{index:02d}"
    payload = {
        "name": scenario_name,
        "profile": "multi-orchestrator-concurrent-assessment-workflows",
        "workflow": {
            "name": f"Multi Orchestrator Hello Workflow {index:02d}",
            "goal": f"Produce one verified hi-back artifact for hello-{index:02d} and finish cleanly.",
            "parameters": {},
            "metadata": {},
        },
        "workspace": {
            "repo": False,
            "storage": {"type": "workspace_artifacts"},
            "memory": {"workspace_kind": "artifact-only"},
            "spec": {},
        },
        "approvals": [],
        "actions": [
            {
                "type": "create_work_items",
                "dispatch": "serial",
                "count": 1,
                "title_template": f"hello-{index:02d}",
                "request_id_template": f"hello-{index:02d}",
            }
        ],
        "expect": {
            "state": "completed",
            "artifacts": [{"logical_path_pattern": r"deliverables/.+\.txt", "min_count": 1}],
            "outcome_envelope": {
                "allowed_states": ["completed"],
                "require_output_artifacts": True,
                "require_completed_non_orchestrator_tasks": True,
                "require_terminal_work_items": True,
                "require_db_state": True,
                "require_runtime_cleanup": True,
                "require_fatal_log_free": True,
            },
        },
        "coverage": {
            "assessor_cardinality": ["zero"],
            "playbook_shapes": ["single_stage", "direct_stage_flow"],
            "concurrency": ["multiple_workflows_concurrent", "multiple_orchestrators_concurrent"],
            "storage_execution": ["artifact_heavy", "cold_specialists", "warm_orchestrators"],
        },
    }
    (scenario_root / f"{scenario_name}.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")
PY

mapfile -t scenario_names < <(python3 - "${scenario_root}" <<'PY'
import json
import sys
from pathlib import Path

for path in sorted(Path(sys.argv[1]).glob("*.json")):
    payload = json.loads(path.read_text(encoding="utf-8"))
    print(payload["name"])
PY
)

mapfile -t scenario_paths < <(python3 - "${scenario_root}" <<'PY'
import sys
from pathlib import Path

for path in sorted(Path(sys.argv[1]).glob("*.json")):
    print(str(path))
PY
)

set +e
env \
  LIVE_TEST_ENV_FILE="${LIVE_TEST_ENV_FILE}" \
  LIVE_TEST_SHARED_CONTEXT_FILE="${SHARED_CONTEXT_FILE}" \
  LIVE_TEST_ARTIFACTS_DIR="${ARTIFACTS_DIR}" \
  LIVE_TEST_SCENARIO_ROOT="${scenario_root}" \
  "${BATCH_RUNNER}" "${INNER_CONCURRENCY}" "${scenario_paths[@]}"
batch_status=$?
set -e

python3 - "${SCENARIO_DIR}" "${WORKFLOW_RUN_FILE}" "${batch_status}" "${WORKFLOW_COUNT}" "${scenario_names[@]}" <<'PY'
import json
import sys
from pathlib import Path

scenario_dir = Path(sys.argv[1])
workflow_run_file = Path(sys.argv[2])
batch_status = int(sys.argv[3])
expected_count = int(sys.argv[4])
scenario_names = sys.argv[5:]

def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))

child_results = []
runtime_actors = set()
http_counts = {}
http_rows = []
log_rows = []
runtime_cleanup_rows = []
workflow_summaries = []
failures = []
advisories = []
total_input_tokens = 0
total_output_tokens = 0
total_tokens = 0
total_loops = 0
total_orchestrator_loops = 0
total_specialist_loops = 0

for scenario_name in scenario_names:
    child_run_path = scenario_dir.parent / scenario_name / "workflow-run.json"
    if not child_run_path.exists():
        failures.append(f"missing child workflow-run.json for {scenario_name}")
        continue
    child = read_json(child_run_path)
    child_results.append({
        "scenario_name": scenario_name,
        "workflow_id": child.get("workflow_id"),
        "runner_exit_code": child.get("runner_exit_code"),
        "verification_passed": child.get("verification_passed"),
        "workflow_state": child.get("workflow_state"),
    })
    if not child.get("verification_passed"):
        failures.append(f"{scenario_name} did not pass its own live verdict")
    child_metrics = child.get("outcome_metrics") or {}
    distribution = child_metrics.get("orchestrator_distribution") or {}
    for actor in distribution.get("runtime_actors") or []:
        if isinstance(actor, str) and actor.strip():
            runtime_actors.add(actor.strip())
    effort = child_metrics.get("agentic_effort") or {}
    total_input_tokens += int(effort.get("input_token_count") or 0)
    total_output_tokens += int(effort.get("output_token_count") or 0)
    total_tokens += int(effort.get("total_token_count") or 0)
    total_loops += int(effort.get("total_loop_count") or 0)
    total_orchestrator_loops += int(effort.get("orchestrator_loop_count") or 0)
    total_specialist_loops += int(effort.get("specialist_loop_count") or 0)

    evidence = child.get("evidence") or {}
    http_summary = evidence.get("http_status_summary") or {}
    for status, count in (http_summary.get("status_counts") or {}).items():
        http_counts[status] = http_counts.get(status, 0) + int(count)
    for row in http_summary.get("rows") or []:
        http_rows.append(row)
    for row in (evidence.get("log_anomalies") or {}).get("rows") or []:
        log_rows.append(row)
    runtime_cleanup = evidence.get("runtime_cleanup") or {}
    runtime_cleanup_rows.extend(runtime_cleanup.get("runtime_containers") or [])
    db_state = evidence.get("db_state") or {}
    workflow_summaries.append({
        "scenario_name": scenario_name,
        "workflow_id": child.get("workflow_id"),
        "workflow_state": child.get("workflow_state"),
        "tasks_total": len(db_state.get("tasks") or []),
        "work_items_total": len(db_state.get("work_items") or []),
    })
    if (child.get("verification") or {}).get("advisories"):
        advisories.extend(child["verification"]["advisories"])

if len(child_results) != expected_count:
    failures.append(
        f"expected {expected_count} child workflow results, found {len(child_results)}"
    )

distinct_runtime_count = len(runtime_actors)
if distinct_runtime_count < 2:
    failures.append(
        "expected at least 2 distinct orchestrator runtime actors across child workflows"
    )

all_clean = batch_status == 0 and len(failures) == 0

http_server_error_count = sum(
    count for status, count in http_counts.items() if str(status).startswith("5")
)
http_client_error_count = sum(
    count for status, count in http_counts.items() if str(status).startswith("4")
)

scenario_outcome_metrics = {
    "status": "passed" if all_clean else "failed",
    "workflow_state": "completed" if all_clean else "failed",
    "success": {
        "child_workflow_count": len(child_results),
    },
    "verification": {
        "failure_count": len(failures),
        "advisory_count": len(advisories),
    },
    "agentic_effort": {
        "input_token_count": total_input_tokens,
        "output_token_count": total_output_tokens,
        "total_token_count": total_tokens,
        "total_loop_count": total_loops,
        "orchestrator_loop_count": total_orchestrator_loops,
        "specialist_loop_count": total_specialist_loops,
    },
    "orchestrator_distribution": {
        "distinct_runtime_count": distinct_runtime_count,
        "runtime_actors": sorted(runtime_actors),
    },
    "anomalies": {
        "http_status_counts": http_counts,
        "http_client_error_count": http_client_error_count,
        "http_server_error_count": http_server_error_count,
        "error_count": len(log_rows),
        "warning_count": 0,
    },
    "hygiene": {
        "runtime_cleanup_passed": all_clean,
        "runtime_container_count": len(runtime_cleanup_rows),
    },
}

evidence_dir = scenario_dir / "evidence"
evidence_dir.mkdir(parents=True, exist_ok=True)
(evidence_dir / "batch-child-results.json").write_text(
    json.dumps({"children": child_results}, indent=2),
    encoding="utf-8",
)
(evidence_dir / "db-state.json").write_text(
    json.dumps({"workflow_summaries": workflow_summaries}, indent=2),
    encoding="utf-8",
)
(evidence_dir / "http-status-summary.json").write_text(
    json.dumps(
        {
            "count": len(http_rows),
            "rows": http_rows,
            "status_counts": http_counts,
            "client_error_count": http_client_error_count,
            "server_error_count": http_server_error_count,
        },
        indent=2,
    ),
    encoding="utf-8",
)
(evidence_dir / "log-anomalies.json").write_text(
    json.dumps({"count": len(log_rows), "rows": log_rows}, indent=2),
    encoding="utf-8",
)
(evidence_dir / "runtime-cleanup.json").write_text(
    json.dumps(
        {
            "all_clean": all_clean,
            "runtime_containers": runtime_cleanup_rows,
        },
        indent=2,
    ),
    encoding="utf-8",
)
(evidence_dir / "scenario-outcome-metrics.json").write_text(
    json.dumps(scenario_outcome_metrics, indent=2),
    encoding="utf-8",
)

payload = {
    "scenario_name": "multi-orchestrator-concurrent-assessment-workflows",
    "runner_exit_code": 0 if all_clean else 1,
    "workflow_state": "completed" if all_clean else "failed",
    "state": "completed" if all_clean else "failed",
    "verification_passed": all_clean,
    "verification": {
        "passed": all_clean,
        "failures": failures,
        "advisories": advisories,
    },
    "harness_failure": False,
    "workflow_ids": [item["workflow_id"] for item in child_results if item.get("workflow_id")],
    "evidence": {
        "db_state": {"workflow_summaries": workflow_summaries},
        "http_status_summary": {
            "count": len(http_rows),
            "rows": http_rows,
            "status_counts": http_counts,
            "client_error_count": http_client_error_count,
            "server_error_count": http_server_error_count,
        },
        "log_anomalies": {"count": len(log_rows), "rows": log_rows},
        "runtime_cleanup": {
            "all_clean": all_clean,
            "runtime_containers": runtime_cleanup_rows,
        },
        "scenario_outcome_metrics": scenario_outcome_metrics,
        "batch_child_results": child_results,
    },
    "outcome_metrics": scenario_outcome_metrics,
}

workflow_run_file.write_text(json.dumps(payload, indent=2), encoding="utf-8")
sys.exit(0 if all_clean else 1)
PY
