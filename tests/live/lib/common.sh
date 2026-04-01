#!/usr/bin/env bash

LIVE_TEST_COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIVE_TEST_ROOT_DIR="$(cd "${LIVE_TEST_COMMON_DIR}/.." && pwd)"

log_live_test() {
  echo "[tests/live] $*"
}

default_live_test_artifacts_dir() {
  printf '%s\n' "${LIVE_TEST_ROOT_DIR}/results"
}

live_test_compose_project_name() {
  printf '%s\n' "${LIVE_TEST_COMPOSE_PROJECT_NAME:-${COMPOSE_PROJECT_NAME:-agirunner-platform}}"
}

ensure_live_test_external_network() {
  local network_name="$1"
  if [[ -z "${network_name}" ]]; then
    echo "[tests/live] external network name is required" >&2
    return 1
  fi
  if docker network inspect "${network_name}" >/dev/null 2>&1; then
    return 0
  fi
  docker network create "${network_name}" >/dev/null
}

live_test_compose_service_container_id() {
  local service_name="$1"
  local project_name="${2:-$(live_test_compose_project_name)}"

  docker ps \
    --filter "label=com.docker.compose.project=${project_name}" \
    --filter "label=com.docker.compose.service=${service_name}" \
    --format '{{.ID}}' \
    | head -n 1
}

live_test_platform_api_secrets_match() {
  local project_name="${1:-$(live_test_compose_project_name)}"
  local container_id
  local container_env

  if [[ -z "${DEFAULT_ADMIN_API_KEY:-}" || -z "${JWT_SECRET:-}" || -z "${WEBHOOK_ENCRYPTION_KEY:-}" ]]; then
    return 1
  fi

  container_id="$(live_test_compose_service_container_id "platform-api" "${project_name}")"
  if [[ -z "${container_id}" ]]; then
    return 1
  fi

  container_env="$(docker exec "${container_id}" env 2>/dev/null)" || return 1
  grep -Fqx "DEFAULT_ADMIN_API_KEY=${DEFAULT_ADMIN_API_KEY}" <<<"${container_env}" || return 1
  grep -Fqx "JWT_SECRET=${JWT_SECRET}" <<<"${container_env}" || return 1
  grep -Fqx "WEBHOOK_ENCRYPTION_KEY=${WEBHOOK_ENCRYPTION_KEY}" <<<"${container_env}" || return 1
}

live_test_bootstrap_key_script() {
  printf '%s\n' "${LIVE_TEST_ROOT_DIR}/lib/bootstrap_key.py"
}

compute_live_test_shared_bootstrap_key() {
  local live_root="${1:-${LIVE_TEST_ROOT_DIR}}"
  local repo_root="${2:-$(cd "${LIVE_TEST_ROOT_DIR}/../.." && pwd)}"
  local runtime_repo_root="${3:-${RUNTIME_REPO_PATH:-${repo_root}/../agirunner-runtime}}"
  local key_script
  key_script="$(live_test_bootstrap_key_script)"
  require_live_test_file "${key_script}" "live test bootstrap key helper"

  python3 "${key_script}" compute "${live_root}" "${repo_root}" "${runtime_repo_root}"
}

resolve_live_test_shared_bootstrap_key() {
  local live_root="${1:-${LIVE_TEST_ROOT_DIR}}"
  local repo_root="${2:-$(cd "${LIVE_TEST_ROOT_DIR}/../.." && pwd)}"
  local runtime_repo_root="${3:-${RUNTIME_REPO_PATH:-${repo_root}/../agirunner-runtime}}"

  if [[ -n "${LIVE_TEST_SHARED_BOOTSTRAP_KEY:-}" ]]; then
    printf '%s\n' "${LIVE_TEST_SHARED_BOOTSTRAP_KEY}"
    return 0
  fi

  LIVE_TEST_SHARED_BOOTSTRAP_KEY="$(
    compute_live_test_shared_bootstrap_key "${live_root}" "${repo_root}" "${runtime_repo_root}"
  )"
  export LIVE_TEST_SHARED_BOOTSTRAP_KEY
  printf '%s\n' "${LIVE_TEST_SHARED_BOOTSTRAP_KEY}"
}

shared_live_test_context_has_bootstrap_key() {
  local context_file="$1"
  local expected_key="$2"
  local key_script
  key_script="$(live_test_bootstrap_key_script)"
  require_live_test_file "${key_script}" "live test bootstrap key helper"

  python3 "${key_script}" context-has-key "${context_file}" "${expected_key}"
}

probe_live_test_http() {
  local url="$1"
  if command -v curl >/dev/null 2>&1; then
    curl --fail --silent --show-error "${url}" >/dev/null
    return $?
  fi
  if command -v wget >/dev/null 2>&1; then
    wget -qO- "${url}" >/dev/null
    return $?
  fi
  return 1
}

ensure_live_test_shared_bootstrap() {
  local shared_bootstrap_script="$1"
  local shared_context_file="$2"
  local platform_api_base_url="$3"
  local remote_mcp_fixture_url="$4"
  local live_root="${5:-${LIVE_TEST_ROOT_DIR}}"
  local repo_root="${6:-$(cd "${LIVE_TEST_ROOT_DIR}/../.." && pwd)}"
  local runtime_repo_root="${7:-${RUNTIME_REPO_PATH:-${repo_root}/../agirunner-runtime}}"
  local bootstrap_key

  require_live_test_file "${shared_bootstrap_script}" "shared live test bootstrap script"
  bootstrap_key="$(
    resolve_live_test_shared_bootstrap_key "${live_root}" "${repo_root}" "${runtime_repo_root}"
  )"
  LIVE_TEST_SHARED_BOOTSTRAP_KEY="${bootstrap_key}"
  export LIVE_TEST_SHARED_BOOTSTRAP_KEY

  if [[ ! -f "${shared_context_file}" ]] \
    || ! probe_live_test_http "${platform_api_base_url}/health" \
    || ! probe_live_test_http "${remote_mcp_fixture_url}" \
    || ! live_test_platform_api_secrets_match \
    || ! shared_live_test_context_has_bootstrap_key "${shared_context_file}" "${bootstrap_key}"; then
    LIVE_TEST_SHARED_BOOTSTRAP_KEY="${bootstrap_key}" "${shared_bootstrap_script}"
  fi
}

resolve_live_test_remote_url() {
  local repo_root="$1"
  local remote_name="${2:-origin}"
  local remote_url

  remote_url="$(git -C "${repo_root}" remote get-url --push "${remote_name}" 2>/dev/null || true)"
  if [[ -z "${remote_url}" ]]; then
    echo "[tests/live] git remote ${remote_name} is not configured for ${repo_root}" >&2
    exit 1
  fi

  printf '%s\n' "${remote_url}"
}

list_live_test_supported_scenarios() {
  local scenario_root="$1"
  local tracker_file="${2:-}"
  python3 - "${scenario_root}" "${tracker_file}" <<'PY'
import json
import sys
from pathlib import Path

scenario_root = Path(sys.argv[1])
tracker_file = sys.argv[2].strip()

scenario_files = {path.stem for path in scenario_root.glob("*.json")}
if not tracker_file:
    for name in sorted(scenario_files):
        print(name)
    raise SystemExit(0)

tracker_path = Path(tracker_file)
if not tracker_path.is_file():
    raise SystemExit(f"[tests/live] live test tracker file not found: {tracker_path}")

tracker = json.loads(tracker_path.read_text())
ordered = tracker.get("supported", {}).get("scenarios", [])
if not isinstance(ordered, list):
    raise SystemExit("[tests/live] supported.scenarios must be a list in live test tracker")
explicit_only = tracker.get("explicit_only", {}).get("scenarios", [])
if explicit_only is None:
    explicit_only = []
if not isinstance(explicit_only, list):
    raise SystemExit("[tests/live] explicit_only.scenarios must be a list in live test tracker")

missing = [name for name in ordered if name not in scenario_files]
if missing:
    raise SystemExit(
        "[tests/live] tracker scenarios missing JSON definitions: " + ", ".join(missing)
    )

seen = set()
for name in ordered:
    if name in seen:
      raise SystemExit(f"[tests/live] duplicate scenario in tracker: {name}")
    seen.add(name)
    print(name)

explicit_seen = set()
for name in explicit_only:
    if name not in scenario_files:
        raise SystemExit(
            "[tests/live] explicit-only scenarios missing JSON definitions: " + name
        )
    if name in seen or name in explicit_seen:
        raise SystemExit(f"[tests/live] duplicate scenario in tracker: {name}")
    explicit_seen.add(name)

untracked = sorted(scenario_files - seen - explicit_seen)
if untracked:
    raise SystemExit(
        "[tests/live] scenario JSON files missing from tracker order: " + ", ".join(untracked)
    )
PY
}

count_live_test_matrix_status() {
  local scenario_root="$1"
  local artifacts_root="$2"
  local tracker_file="${3:-}"
  python3 - "${scenario_root}" "${artifacts_root}" "${tracker_file}" <<'PY'
import json
import sys
from pathlib import Path

scenario_root = Path(sys.argv[1])
artifacts_root = Path(sys.argv[2])
tracker_file = sys.argv[3].strip()

if tracker_file:
    tracker = json.loads(Path(tracker_file).read_text())
    scenario_names = tracker.get("supported", {}).get("scenarios", [])
else:
    scenario_names = sorted(path.stem for path in scenario_root.glob("*.json"))

total = len(scenario_names)
passed = 0
for scenario_name in scenario_names:
    result_file = artifacts_root / scenario_name / "workflow-run.json"
    if not result_file.exists():
        continue
    try:
        data = json.loads(result_file.read_text())
    except Exception:
        continue
    if data.get("verification_passed") is True:
        passed += 1

remaining = total - passed
print(f"{passed}\t{remaining}\t{total}")
PY
}

list_live_test_failing_scenarios() {
  local scenario_root="$1"
  local artifacts_root="$2"
  local tracker_file="${3:-}"
  python3 - "${scenario_root}" "${artifacts_root}" "${tracker_file}" <<'PY'
import json
import sys
from pathlib import Path

scenario_root = Path(sys.argv[1])
artifacts_root = Path(sys.argv[2])
tracker_file = sys.argv[3].strip()

scenario_names: list[str]
if tracker_file:
    tracker = json.loads(Path(tracker_file).read_text())
    scenario_names = tracker.get("supported", {}).get("scenarios", [])
else:
    scenario_names = sorted(path.stem for path in scenario_root.glob("*.json"))

for scenario_name in scenario_names:
    result_file = artifacts_root / scenario_name / "workflow-run.json"
    if not result_file.exists():
        continue
    try:
        data = json.loads(result_file.read_text())
    except Exception:
        print(scenario_name)
        continue
    if data.get("verification_passed") is not True:
        print(scenario_name)
PY
}

require_live_test_file() {
  local path="$1"
  local label="$2"
  if [[ ! -f "${path}" ]]; then
    echo "[tests/live] ${label} not found: ${path}" >&2
    exit 1
  fi
}

require_live_test_dir() {
  local path="$1"
  local label="$2"
  if [[ ! -d "${path}" ]]; then
    echo "[tests/live] ${label} not found: ${path}" >&2
    exit 1
  fi
}

require_live_test_value() {
  local name="$1"
  local value="$2"
  if [[ -z "${value}" ]]; then
    echo "[tests/live] ${name} is required" >&2
    exit 1
  fi
}

load_live_test_env() {
  local env_file="$1"
  require_live_test_file "${env_file}" "live test env file"
  while IFS= read -r line || [[ -n "${line}" ]]; do
    [[ -z "${line}" || "${line}" =~ ^[[:space:]]*# ]] && continue
    if [[ "${line}" != *=* ]]; then
      continue
    fi

    local name="${line%%=*}"
    name="${name#"${name%%[![:space:]]*}"}"
    name="${name%"${name##*[![:space:]]}"}"
    [[ -z "${name}" ]] && continue

    if [[ ! "${name}" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
      echo "[tests/live] invalid env key in ${env_file}: ${name}" >&2
      exit 1
    fi

    if [[ -n "${!name:-}" ]]; then
      continue
    fi

    local value="${line#*=}"
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"
    if (( ${#value} >= 2 )); then
      local first_char="${value:0:1}"
      local last_char="${value: -1}"
      if [[ ( "${first_char}" == "'" && "${last_char}" == "'" ) || ( "${first_char}" == "\"" && "${last_char}" == "\"" ) ]]; then
        value="${value:1:${#value}-2}"
      fi
    fi

    export "${name}=${value}"
  done <"${env_file}"
}

derive_live_test_database_url() {
  echo "postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:${POSTGRES_PORT}/${POSTGRES_DB}"
}

wait_for_live_test_http() {
  local url="$1"
  local label="$2"
  local max_attempts="${3:-60}"
  local sleep_seconds="${4:-2}"
  local attempt=1

  if command -v curl >/dev/null 2>&1; then
    while (( attempt <= max_attempts )); do
      if curl --fail --silent --show-error "${url}" >/dev/null; then
        return 0
      fi
      sleep "${sleep_seconds}"
      attempt=$((attempt + 1))
    done
  elif command -v wget >/dev/null 2>&1; then
    while (( attempt <= max_attempts )); do
      if wget -qO- "${url}" >/dev/null; then
        return 0
      fi
      sleep "${sleep_seconds}"
      attempt=$((attempt + 1))
    done
  else
    echo "[tests/live] curl or wget is required to probe ${label}" >&2
    exit 1
  fi

  echo "[tests/live] timed out waiting for ${label}: ${url}" >&2
  exit 1
}

wait_for_live_test_compose_project_down() {
  local project_name="$1"
  local max_attempts="${2:-30}"
  local sleep_seconds="${3:-1}"
  local attempt=1

  while (( attempt <= max_attempts )); do
    local remaining
    remaining="$(docker ps -a --filter "label=com.docker.compose.project=${project_name}" --format '{{.Names}}')"
    if [[ -z "${remaining}" ]]; then
      return 0
    fi
    sleep "${sleep_seconds}"
    attempt=$((attempt + 1))
  done

  echo "[tests/live] timed out waiting for compose project containers to disappear: ${project_name}" >&2
  docker ps -a --filter "label=com.docker.compose.project=${project_name}" --format '{{.ID}} {{.Names}} {{.Status}}' >&2 || true
  exit 1
}

copy_live_test_seed_tree() {
  local seed_dir="$1"
  local destination_dir="$2"
  if [[ ! -d "${seed_dir}" ]]; then
    return 0
  fi

  tar \
    --exclude='__pycache__' \
    --exclude='*.pyc' \
    --exclude='.pytest_cache' \
    --exclude='.venv' \
    -cf - -C "${seed_dir}" . | tar -xf - -C "${destination_dir}"
}

refresh_live_test_remote_branch() {
  local fixtures_root="$1"
  local default_branch="$2"
  local remote_name="${3:-origin}"
  local remote_ref="refs/remotes/${remote_name}/${default_branch}"
  local branch_ref="refs/heads/${default_branch}:${remote_ref}"

  git -C "${fixtures_root}" update-ref -d "${remote_ref}" >/dev/null 2>&1 || true
  git -C "${fixtures_root}" fetch --prune "${remote_name}" "+${branch_ref}"
}

reset_live_test_fixture_repo() {
  local fixtures_root="$1"
  local default_branch="$2"
  local seed_dir="$3"
  local git_user_name="$4"
  local git_user_email="$5"
  local reset_remote="${6:-true}"
  local remote_name="${7:-origin}"
  local reset_commit_message="${8:-chore: reset repository}"
  local seed_branch="live-test-seed-reset"

  refresh_live_test_remote_branch "${fixtures_root}" "${default_branch}" "${remote_name}"
  git -C "${fixtures_root}" checkout "${default_branch}"
  git -C "${fixtures_root}" reset --hard "${remote_name}/${default_branch}"
  git -C "${fixtures_root}" clean -fdx

  if [[ "${reset_remote}" != "true" ]]; then
    return 0
  fi

  git -C "${fixtures_root}" config user.name "${git_user_name}"
  git -C "${fixtures_root}" config user.email "${git_user_email}"
  git -C "${fixtures_root}" checkout --orphan "${seed_branch}"
  find "${fixtures_root}" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
  copy_live_test_seed_tree "${seed_dir}" "${fixtures_root}"
  git -C "${fixtures_root}" add -A

  if git -C "${fixtures_root}" diff --cached --quiet --exit-code; then
    git -C "${fixtures_root}" commit --allow-empty -m "${reset_commit_message}"
  else
    git -C "${fixtures_root}" commit -m "${reset_commit_message}"
  fi

  git -C "${fixtures_root}" push --force "${remote_name}" HEAD:"${default_branch}"
  git -C "${fixtures_root}" checkout -B "${default_branch}"
  refresh_live_test_remote_branch "${fixtures_root}" "${default_branch}" "${remote_name}"
  git -C "${fixtures_root}" reset --hard "${remote_name}/${default_branch}"
  git -C "${fixtures_root}" clean -fdx
  git -C "${fixtures_root}" branch -D "${seed_branch}" >/dev/null 2>&1 || true
}

reset_live_test_host_workspace() {
  local host_root="$1"
  local seed_dir="$2"

  rm -rf "${host_root}"
  mkdir -p "${host_root}"
  copy_live_test_seed_tree "${seed_dir}" "${host_root}"
}

prepare_live_test_fixture_branch() {
  local fixtures_root="$1"
  local working_root="$2"
  local run_branch="$3"
  local default_branch="$4"
  local seed_dir="$5"
  local git_user_name="$6"
  local git_user_email="$7"
  local remote_name="${8:-origin}"
  local prepare_commit_message="${9:-chore: prepare live test branch}"
  local origin_push_url

  rm -rf "${working_root}"
  mkdir -p "$(dirname "${working_root}")"
  git clone "${fixtures_root}" "${working_root}"
  mkdir -p "${working_root}"
  git -C "${working_root}" checkout -B "${run_branch}" "origin/${default_branch}"
  git -C "${working_root}" config user.name "${git_user_name}"
  git -C "${working_root}" config user.email "${git_user_email}"
  find "${working_root}" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
  copy_live_test_seed_tree "${seed_dir}" "${working_root}"
  git -C "${working_root}" add -A

  if git -C "${working_root}" diff --cached --quiet --exit-code; then
    git -C "${working_root}" commit --allow-empty -m "${prepare_commit_message}"
  else
    git -C "${working_root}" commit -m "${prepare_commit_message}"
  fi

  origin_push_url="$(resolve_live_test_remote_url "${fixtures_root}" "${remote_name}")"
  git -C "${working_root}" remote set-url --push origin "${origin_push_url}"
  git -C "${working_root}" push --force origin HEAD:"${run_branch}"
}
