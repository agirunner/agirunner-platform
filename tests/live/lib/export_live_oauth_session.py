#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import subprocess
import sys


def env(name: str, default: str | None = None, *, required: bool = False) -> str:
    value = os.environ.get(name, default)
    if required and (value is None or value.strip() == ""):
        raise RuntimeError(f"{name} is required")
    return (value or "").strip()


def sql_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def build_query(profile_id: str) -> str:
    profile = sql_literal(profile_id)
    return f"""
WITH candidate AS (
  SELECT oauth_credentials
  FROM llm_providers
  WHERE auth_mode = 'oauth'
    AND oauth_config->>'profile_id' = {profile}
    AND oauth_credentials IS NOT NULL
  ORDER BY updated_at DESC
  LIMIT 1
)
SELECT jsonb_strip_nulls(
  jsonb_build_object(
    'credentials',
    jsonb_strip_nulls(
      jsonb_build_object(
        'accessToken', oauth_credentials->>'access_token',
        'refreshToken', oauth_credentials->>'refresh_token',
        'expiresAt', CASE
          WHEN oauth_credentials ? 'expires_at'
            AND oauth_credentials->>'expires_at' IS NOT NULL
            AND oauth_credentials->>'expires_at' <> ''
          THEN to_jsonb((oauth_credentials->>'expires_at')::bigint)
          ELSE NULL
        END,
        'accountId', oauth_credentials->>'account_id',
        'email', oauth_credentials->>'email',
        'authorizedAt', oauth_credentials->>'authorized_at',
        'authorizedByUserId', oauth_credentials->>'authorized_by_user_id',
        'needsReauth', COALESCE((oauth_credentials->>'needs_reauth')::boolean, false)
      )
    )
  )
)::text
FROM candidate;
""".strip()


def run_query(*, compose_file: str, compose_project_name: str, postgres_user: str, postgres_db: str, profile_id: str) -> str:
    command = [
        "docker",
        "compose",
        "-p",
        compose_project_name,
        "-f",
        compose_file,
        "exec",
        "-T",
        "postgres",
        "psql",
        "-U",
        postgres_user,
        "-d",
        postgres_db,
        "-At",
        "-c",
        build_query(profile_id),
    ]
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        stderr = (result.stderr or "").strip()
        raise RuntimeError(
            "failed to export OAuth session from current database"
            + (f": {stderr}" if stderr else "")
        )
    return result.stdout.strip()


def validate_session(payload_text: str, profile_id: str) -> dict[str, object]:
    if payload_text == "":
        raise RuntimeError(f"no oauth session found in current database for profile {profile_id}")
    payload = json.loads(payload_text)
    credentials = payload.get("credentials")
    if not isinstance(credentials, dict):
        raise RuntimeError("exported oauth session missing credentials object")
    access_token = credentials.get("accessToken")
    if not isinstance(access_token, str) or access_token.strip() == "":
        raise RuntimeError("exported oauth session missing access token")
    if credentials.get("needsReauth") is True:
        raise RuntimeError(f"oauth session for profile {profile_id} requires reauthorization")
    return payload


def main() -> int:
    try:
        profile_id = env("LIVE_TEST_OAUTH_PROFILE_ID", required=True)
        compose_file = env("LIVE_TEST_COMPOSE_FILE", required=True)
        compose_project_name = env("LIVE_TEST_COMPOSE_PROJECT_NAME", required=True)
        postgres_user = env("POSTGRES_USER", "agirunner", required=True)
        postgres_db = env("POSTGRES_DB", "agirunner", required=True)
        session = validate_session(
            run_query(
                compose_file=compose_file,
                compose_project_name=compose_project_name,
                postgres_user=postgres_user,
                postgres_db=postgres_db,
                profile_id=profile_id,
            ),
            profile_id,
        )
        print(json.dumps(session, separators=(",", ":")))
        return 0
    except Exception as exc:  # pragma: no cover - exercised by CLI tests
        print(f"[tests/live] {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
