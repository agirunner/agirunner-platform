#!/usr/bin/env bash

log_live_test() {
  echo "[tests/live] $*"
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

    if [[ -v "${name}" ]]; then
      continue
    fi

    eval "export ${line}"
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

  tar -cf - -C "${seed_dir}" . | tar -xf - -C "${destination_dir}"
}

refresh_live_test_remote_branch() {
  local fixtures_root="$1"
  local default_branch="$2"
  local remote_ref="refs/remotes/origin/${default_branch}"
  local branch_ref="refs/heads/${default_branch}:${remote_ref}"

  git -C "${fixtures_root}" update-ref -d "${remote_ref}" >/dev/null 2>&1 || true
  git -C "${fixtures_root}" fetch --prune origin "+${branch_ref}"
}

reset_live_test_fixture_repo() {
  local fixtures_root="$1"
  local default_branch="$2"
  local seed_dir="$3"
  local git_user_name="$4"
  local git_user_email="$5"
  local reset_remote="${6:-true}"
  local seed_branch="live-test-seed-reset"

  refresh_live_test_remote_branch "${fixtures_root}" "${default_branch}"
  git -C "${fixtures_root}" checkout "${default_branch}"
  git -C "${fixtures_root}" reset --hard "origin/${default_branch}"
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
    git -C "${fixtures_root}" commit --allow-empty -m "chore: reset repository"
  else
    git -C "${fixtures_root}" commit -m "chore: reset repository"
  fi

  git -C "${fixtures_root}" push --force origin HEAD:"${default_branch}"
  git -C "${fixtures_root}" checkout -B "${default_branch}"
  refresh_live_test_remote_branch "${fixtures_root}" "${default_branch}"
  git -C "${fixtures_root}" reset --hard "origin/${default_branch}"
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
    git -C "${working_root}" commit --allow-empty -m "chore: prepare live test branch"
  else
    git -C "${working_root}" commit -m "chore: prepare live test branch"
  fi

  origin_push_url="$(git -C "${fixtures_root}" remote get-url --push origin)"
  git -C "${working_root}" remote set-url --push origin "${origin_push_url}"
  git -C "${working_root}" push --force origin HEAD:"${run_branch}"
}
