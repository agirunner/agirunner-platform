#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path


LIVE_ROOT = Path(__file__).resolve().parents[1]
LIVE_LIB = LIVE_ROOT / "lib"
sys.path.insert(0, str(LIVE_LIB))

import remote_mcp_fixture_sync  # noqa: E402


MATRIX_FIXTURE_PATH = LIVE_ROOT / "library" / "remote-mcp-configuration-matrix" / "remote-mcp-servers.json"
EXPECTED_AUTH_MODES = {"none", "parameterized", "oauth"}
EXPECTED_TRANSPORT_PREFERENCES = {"auto", "streamable_http", "http_sse_compat"}
EXPECTED_GRANT_TYPES = {
    "authorization_code",
    "device_authorization",
    "client_credentials",
    "enterprise_managed_authorization",
}
EXPECTED_CLIENT_STRATEGIES = {
    "auto",
    "dynamic_registration",
    "manual_client",
    "client_metadata_document",
}
EXPECTED_CALLBACK_MODES = {"loopback", "hosted_https"}
EXPECTED_TOKEN_ENDPOINT_AUTH_METHODS = {
    "none",
    "client_secret_post",
    "client_secret_basic",
    "private_key_jwt",
}
EXPECTED_PAR_MODES = {"disabled", "enabled", "required"}
EXPECTED_JAR_MODES = {"disabled", "request_parameter", "request_uri"}
EXPECTED_VALUE_KINDS = {"static", "secret"}
EXPECTED_PARAMETER_PLACEMENTS = {
    "path",
    "query",
    "header",
    "cookie",
    "initialize_param",
    "authorize_request_query",
    "device_request_query",
    "device_request_header",
    "device_request_body_form",
    "device_request_body_json",
    "token_request_query",
    "token_request_header",
    "token_request_body_form",
    "token_request_body_json",
}


class RemoteMcpConfigurationMatrixTests(unittest.TestCase):
    def test_matrix_fixture_covers_every_config_surface_dimension(self) -> None:
        entries = json.loads(MATRIX_FIXTURE_PATH.read_text(encoding="utf-8"))
        self.assertIsInstance(entries, list)
        self.assertGreaterEqual(len(entries), 7)

        seen_auth_modes: set[str] = set()
        seen_transport_preferences: set[str] = set()
        seen_grant_types: set[str] = set()
        seen_client_strategies: set[str] = set()
        seen_callback_modes: set[str] = set()
        seen_token_endpoint_auth_methods: set[str] = set()
        seen_par_modes: set[str] = set()
        seen_jar_modes: set[str] = set()
        seen_value_kinds: set[str] = set()
        seen_parameter_placements: set[str] = set()
        seen_default_new_specialists: set[bool] = set()
        seen_grant_existing_specialists: set[bool] = set()

        for entry in entries:
            normalized = remote_mcp_fixture_sync.normalize_remote_mcp_fixture(entry)
            seen_auth_modes.add(str(normalized["authMode"]))
            seen_transport_preferences.add(str(normalized["transportPreference"]))
            seen_default_new_specialists.add(bool(normalized["enabledByDefaultForNewSpecialists"]))
            seen_grant_existing_specialists.add(bool(normalized["grantToAllExistingSpecialists"]))
            for parameter in normalized.get("parameters", []):
                seen_parameter_placements.add(str(parameter["placement"]))
                seen_value_kinds.add(str(parameter["valueKind"]))
            oauth_definition = normalized.get("oauthDefinition")
            if isinstance(oauth_definition, dict):
                grant_type = oauth_definition.get("grantType")
                if isinstance(grant_type, str):
                    seen_grant_types.add(grant_type)
                client_strategy = oauth_definition.get("clientStrategy")
                if isinstance(client_strategy, str):
                    seen_client_strategies.add(client_strategy)
                callback_mode = oauth_definition.get("callbackMode")
                if isinstance(callback_mode, str):
                    seen_callback_modes.add(callback_mode)
                token_endpoint_auth_method = oauth_definition.get("tokenEndpointAuthMethod")
                if isinstance(token_endpoint_auth_method, str):
                    seen_token_endpoint_auth_methods.add(token_endpoint_auth_method)
                par_mode = oauth_definition.get("parMode")
                if isinstance(par_mode, str):
                    seen_par_modes.add(par_mode)
                jar_mode = oauth_definition.get("jarMode")
                if isinstance(jar_mode, str):
                    seen_jar_modes.add(jar_mode)

        self.assertEqual(EXPECTED_AUTH_MODES, seen_auth_modes)
        self.assertEqual(EXPECTED_TRANSPORT_PREFERENCES, seen_transport_preferences)
        self.assertTrue(EXPECTED_GRANT_TYPES.issubset(seen_grant_types))
        self.assertTrue(EXPECTED_CLIENT_STRATEGIES.issubset(seen_client_strategies))
        self.assertEqual(EXPECTED_CALLBACK_MODES, seen_callback_modes)
        self.assertEqual(EXPECTED_TOKEN_ENDPOINT_AUTH_METHODS, seen_token_endpoint_auth_methods)
        self.assertEqual(EXPECTED_PAR_MODES, seen_par_modes)
        self.assertEqual(EXPECTED_JAR_MODES, seen_jar_modes)
        self.assertEqual(EXPECTED_VALUE_KINDS, seen_value_kinds)
        self.assertTrue(EXPECTED_PARAMETER_PLACEMENTS.issubset(seen_parameter_placements))
        self.assertEqual({False, True}, seen_default_new_specialists)
        self.assertEqual({False, True}, seen_grant_existing_specialists)


if __name__ == "__main__":
    unittest.main()
