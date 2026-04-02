#!/usr/bin/env python3
from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path


SUITE_ROOT = Path(__file__).resolve().parents[1]
LIB_ROOT = SUITE_ROOT / "lib"

if str(LIB_ROOT) not in sys.path:
    sys.path.insert(0, str(LIB_ROOT))

from provider_selection import (
    apply_provider_selection,
    assert_provider_selection_matches,
    resolve_provider_env_overrides,
)


class ProviderSelectionTests(unittest.TestCase):
    def test_resolve_provider_env_overrides_for_anthropic_uses_sonnet_46(self) -> None:
        missing_env_file = SUITE_ROOT / "tests-do-not-read-local.env"
        overrides = resolve_provider_env_overrides(
            "anthropic",
            {
                "LIVE_TEST_ANTHROPIC_API_KEY": "anthropic-key",
            },
            env_file=missing_env_file,
        )

        self.assertEqual("api_key", overrides["LIVE_TEST_PROVIDER_AUTH_MODE"])
        self.assertEqual("anthropic", overrides["LIVE_TEST_PROVIDER_TYPE"])
        self.assertEqual("Anthropic", overrides["LIVE_TEST_PROVIDER_NAME"])
        self.assertEqual("https://api.anthropic.com", overrides["LIVE_TEST_PROVIDER_BASE_URL"])
        self.assertEqual("anthropic-key", overrides["LIVE_TEST_PROVIDER_API_KEY"])
        self.assertEqual("claude-sonnet-4-6", overrides["LIVE_TEST_MODEL_ID"])
        self.assertEqual("messages", overrides["LIVE_TEST_MODEL_ENDPOINT_TYPE"])
        self.assertEqual("low", overrides["LIVE_TEST_SYSTEM_REASONING_EFFORT"])
        self.assertEqual("claude-sonnet-4-6", overrides["LIVE_TEST_ORCHESTRATOR_MODEL_ID"])
        self.assertEqual("claude-sonnet-4-6", overrides["LIVE_TEST_SPECIALIST_MODEL_ID"])
        self.assertEqual("low", overrides["LIVE_TEST_ORCHESTRATOR_REASONING_EFFORT"])
        self.assertEqual("low", overrides["LIVE_TEST_SPECIALIST_REASONING_EFFORT"])

    def test_apply_provider_selection_sets_openai_oauth_defaults(self) -> None:
        environ = {
            "LIVE_TEST_OPENAI_OAUTH_PROFILE_ID": "openai-codex",
            "LIVE_TEST_OPENAI_OAUTH_SESSION_JSON": '{"credentials":{"accessToken":"token","refreshToken":"refresh"}}',
        }

        applied = apply_provider_selection(
            "openai-oauth",
            environ,
            env_file=SUITE_ROOT / "tests-do-not-read-local.env",
        )

        self.assertEqual("oauth", applied["LIVE_TEST_PROVIDER_AUTH_MODE"])
        self.assertEqual("openai", applied["LIVE_TEST_PROVIDER_TYPE"])
        self.assertEqual("OpenAI (Subscription)", applied["LIVE_TEST_PROVIDER_NAME"])
        self.assertEqual("gpt-5.4", applied["LIVE_TEST_MODEL_ID"])
        self.assertEqual("responses", applied["LIVE_TEST_MODEL_ENDPOINT_TYPE"])
        self.assertEqual("low", applied["LIVE_TEST_SYSTEM_REASONING_EFFORT"])
        self.assertEqual("low", applied["LIVE_TEST_ORCHESTRATOR_REASONING_EFFORT"])
        self.assertEqual("low", applied["LIVE_TEST_SPECIALIST_REASONING_EFFORT"])
        self.assertEqual(
            '{"credentials":{"accessToken":"token","refreshToken":"refresh"}}',
            environ["LIVE_TEST_PROVIDER_OAUTH_SESSION_JSON"],
        )

    def test_apply_provider_selection_sets_openai_api_defaults(self) -> None:
        environ = {
            "LIVE_TEST_OPENAI_API_KEY": "openai-key",
        }

        applied = apply_provider_selection(
            "openai-api",
            environ,
            env_file=SUITE_ROOT / "tests-do-not-read-local.env",
        )

        self.assertEqual("api_key", applied["LIVE_TEST_PROVIDER_AUTH_MODE"])
        self.assertEqual("openai", applied["LIVE_TEST_PROVIDER_TYPE"])
        self.assertEqual("OpenAI (API Key)", applied["LIVE_TEST_PROVIDER_NAME"])
        self.assertEqual("gpt-5.4", applied["LIVE_TEST_MODEL_ID"])
        self.assertEqual("responses", applied["LIVE_TEST_MODEL_ENDPOINT_TYPE"])
        self.assertEqual("low", applied["LIVE_TEST_SYSTEM_REASONING_EFFORT"])
        self.assertEqual("low", applied["LIVE_TEST_ORCHESTRATOR_REASONING_EFFORT"])
        self.assertEqual("low", applied["LIVE_TEST_SPECIALIST_REASONING_EFFORT"])

    def test_snapshot_section_satisfies_provider_secret_without_extra_env(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            env_file = Path(tmpdir) / "local.env"
            env_file.write_text(
                "\n".join(
                    [
                        "# BEGIN LOCAL PROVIDER SNAPSHOTS",
                        "# Anthropic API",
                        "# LIVE_TEST_PROVIDER_AUTH_MODE=api_key",
                        "# LIVE_TEST_PROVIDER_TYPE=anthropic",
                        "# LIVE_TEST_PROVIDER_NAME=Anthropic",
                        "# LIVE_TEST_PROVIDER_BASE_URL=https://api.anthropic.com",
                        "# LIVE_TEST_SYSTEM_REASONING_EFFORT=medium",
                        "# LIVE_TEST_MODEL_ID=wrong-snapshot-model",
                        "# LIVE_TEST_MODEL_ENDPOINT_TYPE=wrong-endpoint",
                        "# LIVE_TEST_MODEL_ID=claude-sonnet-4-6",
                        "# LIVE_TEST_MODEL_ENDPOINT_TYPE=messages",
                        "# LIVE_TEST_ORCHESTRATOR_MODEL_ID=claude-sonnet-4-6",
                        "# LIVE_TEST_ORCHESTRATOR_MODEL_ENDPOINT_TYPE=messages",
                        "# LIVE_TEST_ORCHESTRATOR_REASONING_EFFORT=medium",
                        "# LIVE_TEST_SPECIALIST_MODEL_ID=claude-sonnet-4-6",
                        "# LIVE_TEST_SPECIALIST_MODEL_ENDPOINT_TYPE=messages",
                        "# LIVE_TEST_SPECIALIST_REASONING_EFFORT=medium",
                        "# LIVE_TEST_PROVIDER_API_KEY=snapshot-key",
                        "# END LOCAL PROVIDER SNAPSHOTS",
                        "",
                    ]
                ),
                encoding="utf-8",
            )

            overrides = resolve_provider_env_overrides("anthropic", {}, env_file=env_file)

        self.assertEqual("snapshot-key", overrides["LIVE_TEST_PROVIDER_API_KEY"])
        self.assertEqual("claude-sonnet-4-6", overrides["LIVE_TEST_MODEL_ID"])
        self.assertEqual("messages", overrides["LIVE_TEST_MODEL_ENDPOINT_TYPE"])
        self.assertEqual("low", overrides["LIVE_TEST_SYSTEM_REASONING_EFFORT"])
        self.assertEqual("low", overrides["LIVE_TEST_ORCHESTRATOR_REASONING_EFFORT"])
        self.assertEqual("low", overrides["LIVE_TEST_SPECIALIST_REASONING_EFFORT"])

    def test_explicit_provider_secret_overrides_snapshot_secret(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            env_file = Path(tmpdir) / "local.env"
            env_file.write_text(
                "\n".join(
                    [
                        "# BEGIN LOCAL PROVIDER SNAPSHOTS",
                        "# Gemini API",
                        "# LIVE_TEST_PROVIDER_AUTH_MODE=api_key",
                        "# LIVE_TEST_PROVIDER_TYPE=google",
                        "# LIVE_TEST_PROVIDER_NAME=Gemini",
                        "# LIVE_TEST_PROVIDER_BASE_URL=https://generativelanguage.googleapis.com",
                        "# LIVE_TEST_MODEL_ID=gemini-3.1-pro-preview",
                        "# LIVE_TEST_MODEL_ENDPOINT_TYPE=generate-content",
                        "# LIVE_TEST_ORCHESTRATOR_MODEL_ID=gemini-3.1-pro-preview",
                        "# LIVE_TEST_ORCHESTRATOR_MODEL_ENDPOINT_TYPE=generate-content",
                        "# LIVE_TEST_SPECIALIST_MODEL_ID=gemini-3.1-pro-preview",
                        "# LIVE_TEST_SPECIALIST_MODEL_ENDPOINT_TYPE=generate-content",
                        "# LIVE_TEST_PROVIDER_API_KEY=snapshot-key",
                        "# END LOCAL PROVIDER SNAPSHOTS",
                        "",
                    ]
                ),
                encoding="utf-8",
            )

            overrides = resolve_provider_env_overrides(
                "gemini",
                {"LIVE_TEST_GEMINI_API_KEY": "explicit-key"},
                env_file=env_file,
            )

        self.assertEqual("explicit-key", overrides["LIVE_TEST_PROVIDER_API_KEY"])

    def test_resolve_provider_env_overrides_requires_provider_secret(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "LIVE_TEST_GEMINI_API_KEY"):
            resolve_provider_env_overrides(
                "gemini",
                {},
                env_file=SUITE_ROOT / "tests-do-not-read-local.env",
            )

    def test_assert_provider_selection_matches_rejects_mismatch(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "provider_type expected anthropic got openai"):
            assert_provider_selection_matches(
                "anthropic",
                {
                    "provider_auth_mode": "oauth",
                    "provider_type": "openai",
                    "model_name": "gpt-5.4",
                    "orchestrator_model_name": "gpt-5.4",
                    "specialist_model_name": "gpt-5.4",
                },
                {
                    "LIVE_TEST_PROVIDER_AUTH_MODE": "api_key",
                    "LIVE_TEST_PROVIDER_TYPE": "anthropic",
                    "LIVE_TEST_MODEL_ID": "claude-sonnet-4-6",
                    "LIVE_TEST_ORCHESTRATOR_MODEL_ID": "claude-sonnet-4-6",
                    "LIVE_TEST_SPECIALIST_MODEL_ID": "claude-sonnet-4-6",
                },
            )

    def test_assert_provider_selection_matches_rejects_reasoning_mismatch(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "orchestrator reasoning expected low got medium"):
            assert_provider_selection_matches(
                "anthropic",
                {
                    "provider_auth_mode": "api_key",
                    "provider_type": "anthropic",
                    "model_name": "claude-sonnet-4-6",
                    "orchestrator_model_name": "claude-sonnet-4-6",
                    "specialist_model_name": "claude-sonnet-4-6",
                    "system_reasoning": "low",
                    "orchestrator_reasoning": "medium",
                    "specialist_reasoning": "low",
                },
                {
                    "LIVE_TEST_PROVIDER_AUTH_MODE": "api_key",
                    "LIVE_TEST_PROVIDER_TYPE": "anthropic",
                    "LIVE_TEST_MODEL_ID": "claude-sonnet-4-6",
                    "LIVE_TEST_ORCHESTRATOR_MODEL_ID": "claude-sonnet-4-6",
                    "LIVE_TEST_SPECIALIST_MODEL_ID": "claude-sonnet-4-6",
                    "LIVE_TEST_SYSTEM_REASONING_EFFORT": "low",
                    "LIVE_TEST_ORCHESTRATOR_REASONING_EFFORT": "low",
                    "LIVE_TEST_SPECIALIST_REASONING_EFFORT": "low",
                },
            )


if __name__ == "__main__":
    unittest.main()
