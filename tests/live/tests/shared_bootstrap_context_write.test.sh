#!/usr/bin/env bash
set -euo pipefail

PLATFORM_ROOT="/home/mark/codex/agirunner-platform"
SCRIPT_UNDER_TEST="${PLATFORM_ROOT}/tests/live/scripts/prepare-live-test-shared-environment.sh"

make_fake_bin() {
  local root="$1"
  mkdir -p "${root}/bin"

  cat >"${root}/bin/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "build" ]]; then
  exit 0
fi

if [[ "${1:-}" == "ps" ]]; then
  exit 0
fi

if [[ "${1:-}" == "compose" ]]; then
  shift
  if [[ "$*" == *" exec -T platform-api env"* ]]; then
    printf 'JWT_SECRET=%s\n' "${JWT_SECRET}"
    printf 'WEBHOOK_ENCRYPTION_KEY=%s\n' "${WEBHOOK_ENCRYPTION_KEY}"
    printf 'DEFAULT_ADMIN_API_KEY=%s\n' "${DEFAULT_ADMIN_API_KEY}"
    exit 0
  fi
  exit 0
fi

exit 0
EOF
  chmod +x "${root}/bin/docker"

  cat >"${root}/bin/git" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
exit 0
EOF
  chmod +x "${root}/bin/git"

  cat >"${root}/bin/curl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
exit 0
EOF
  chmod +x "${root}/bin/curl"
}

make_fake_roots() {
  local root="$1"

  mkdir -p \
    "${root}/env" \
    "${root}/library/demo-profile" \
    "${root}/platform/apps/platform-api" \
    "${root}/platform/tests/live" \
    "${root}/runtime" \
    "${root}/fixtures" \
    "${root}/results/bootstrap"

  cat >"${root}/env/local.env" <<'EOF'
DEFAULT_ADMIN_API_KEY=test-admin-key
JWT_SECRET=test-jwt
WEBHOOK_ENCRYPTION_KEY=test-webhook
EOF

  cat >"${root}/platform/docker-compose.yml" <<'EOF'
services: {}
EOF

  cat >"${root}/platform/tests/live/docker-compose.live-test.yml" <<'EOF'
services: {}
EOF

  cat >"${root}/library/demo-profile/playbook.json" <<'EOF'
{"name":"demo"}
EOF
}

test_shared_bootstrap_preserves_previous_context_when_seed_fails() {
  local temp_root
  temp_root="$(mktemp -d)"
  trap 'rm -rf "${temp_root}"' RETURN

  make_fake_bin "${temp_root}"
  make_fake_roots "${temp_root}"

  local context_file="${temp_root}/results/bootstrap/context.json"
  printf '%s' '{"shared_bootstrap_key":"keep-me","ok":true}' >"${context_file}"

  local fail_script="${temp_root}/fail_seed.py"
  cat >"${fail_script}" <<'EOF'
#!/usr/bin/env python3
raise SystemExit(1)
EOF
  chmod +x "${fail_script}"

  set +e
  PATH="${temp_root}/bin:${PATH}" \
    LIVE_TEST_ENV_FILE="${temp_root}/env/local.env" \
    LIVE_TEST_PLATFORM_ROOT="${temp_root}/platform" \
    RUNTIME_REPO_PATH="${temp_root}/runtime" \
    FIXTURES_REPO_PATH="${temp_root}/fixtures" \
    LIVE_TEST_LIBRARY_ROOT="${temp_root}/library" \
    LIVE_TEST_COMPOSE_FILE="${temp_root}/platform/docker-compose.yml" \
    LIVE_TEST_COMPOSE_LIVE_TEST_FILE="${temp_root}/platform/tests/live/docker-compose.live-test.yml" \
    LIVE_TEST_RUN_SCRIPT="${fail_script}" \
    LIVE_TEST_ARTIFACTS_DIR="${temp_root}/results" \
    LIVE_TEST_BOOTSTRAP_DIR="${temp_root}/results/bootstrap" \
    LIVE_TEST_SHARED_CONTEXT_FILE="${context_file}" \
    LIVE_TEST_TRACE_DIR="${temp_root}/results/bootstrap/api-trace" \
    "${SCRIPT_UNDER_TEST}"
  status=$?
  set -e

  if [[ "${status}" -eq 0 ]]; then
    echo "expected shared bootstrap failure" >&2
    exit 1
  fi

  python3 - "${context_file}" <<'PY'
import json
import sys
from pathlib import Path

payload = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
assert payload["shared_bootstrap_key"] == "keep-me", payload
assert payload["ok"] is True, payload
PY
}

test_shared_bootstrap_replaces_context_after_successful_seed() {
  local temp_root
  temp_root="$(mktemp -d)"
  trap 'rm -rf "${temp_root}"' RETURN

  make_fake_bin "${temp_root}"
  make_fake_roots "${temp_root}"

  local context_file="${temp_root}/results/bootstrap/context.json"
  printf '%s' '{"shared_bootstrap_key":"old-key","ok":false}' >"${context_file}"

  local success_script="${temp_root}/seed_ok.py"
  cat >"${success_script}" <<'EOF'
#!/usr/bin/env python3
from pathlib import Path
import json
import os

Path(os.environ["LIVE_TEST_SHARED_CONTEXT_FILE"]).write_text(
    json.dumps({"shared_bootstrap_key": os.environ["LIVE_TEST_SHARED_BOOTSTRAP_KEY"], "ok": True}),
    encoding="utf-8",
)
EOF
  chmod +x "${success_script}"

  PATH="${temp_root}/bin:${PATH}" \
    LIVE_TEST_ENV_FILE="${temp_root}/env/local.env" \
    LIVE_TEST_PLATFORM_ROOT="${temp_root}/platform" \
    RUNTIME_REPO_PATH="${temp_root}/runtime" \
    FIXTURES_REPO_PATH="${temp_root}/fixtures" \
    LIVE_TEST_LIBRARY_ROOT="${temp_root}/library" \
    LIVE_TEST_COMPOSE_FILE="${temp_root}/platform/docker-compose.yml" \
    LIVE_TEST_COMPOSE_LIVE_TEST_FILE="${temp_root}/platform/tests/live/docker-compose.live-test.yml" \
    LIVE_TEST_RUN_SCRIPT="${success_script}" \
    LIVE_TEST_ARTIFACTS_DIR="${temp_root}/results" \
    LIVE_TEST_BOOTSTRAP_DIR="${temp_root}/results/bootstrap" \
    LIVE_TEST_SHARED_CONTEXT_FILE="${context_file}" \
    LIVE_TEST_TRACE_DIR="${temp_root}/results/bootstrap/api-trace" \
    "${SCRIPT_UNDER_TEST}"

  python3 - "${context_file}" <<'PY'
import json
import sys
from pathlib import Path

payload = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
assert payload["ok"] is True, payload
assert payload["shared_bootstrap_key"] != "old-key", payload
PY
}

test_shared_bootstrap_preserves_previous_context_when_seed_fails
test_shared_bootstrap_replaces_context_after_successful_seed
