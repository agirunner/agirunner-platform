package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestValidateConfigFailsClosedForProdWithoutRuntimeAuthKey(t *testing.T) {
	cfg := serverConfig{
		RuntimeProfile:     runtimeProfileProd,
		RequireRuntimeAuth: true,
		AgentAPIURL:        "http://example.invalid/execute",
		EnforceSocketProxy: false,
	}

	err := validateConfig(cfg)
	if err == nil || !strings.Contains(err.Error(), "RUNTIME_API_KEY") {
		t.Fatalf("expected RUNTIME_API_KEY validation error, got: %v", err)
	}
}

func TestValidateConfigFailsClosedForProdWithoutAgentBridge(t *testing.T) {
	cfg := serverConfig{
		RuntimeProfile:     runtimeProfileProd,
		RuntimeAPIKey:      "runtime-secret-1234567890",
		RequireRuntimeAuth: true,
		EnforceSocketProxy: false,
	}

	err := validateConfig(cfg)
	if err == nil || !strings.Contains(err.Error(), "AGENT_API_URL") {
		t.Fatalf("expected AGENT_API_URL validation error, got: %v", err)
	}
}

func TestValidateConfigRejectsDeterministicFallbackInProd(t *testing.T) {
	cfg := serverConfig{
		RuntimeProfile:              runtimeProfileProd,
		RuntimeAPIKey:               "runtime-secret-1234567890",
		RequireRuntimeAuth:          true,
		AgentAPIURL:                 "http://example.invalid/execute",
		EnableDeterministicFallback: true,
		EnforceSocketProxy:          false,
	}

	err := validateConfig(cfg)
	if err == nil || !strings.Contains(err.Error(), "test-only") {
		t.Fatalf("expected test-only fallback validation error, got: %v", err)
	}
}

func TestValidateConfigFailsClosedForProdShortRuntimeApiKey(t *testing.T) {
	cfg := serverConfig{
		RuntimeProfile:     runtimeProfileProd,
		RuntimeAPIKey:      "short-key",
		RequireRuntimeAuth: true,
		AgentAPIURL:        "http://example.invalid/execute",
		EnforceSocketProxy: false,
	}

	err := validateConfig(cfg)
	if err == nil || !strings.Contains(err.Error(), "at least") {
		t.Fatalf("expected runtime key length validation error, got: %v", err)
	}
}

func TestValidateConfigTestProfileAllowsExplicitDeterministicFallback(t *testing.T) {
	cfg := serverConfig{
		RuntimeProfile:              runtimeProfileTest,
		RequireRuntimeAuth:          false,
		EnableDeterministicFallback: true,
		EnforceSocketProxy:          false,
	}

	if err := validateConfig(cfg); err != nil {
		t.Fatalf("expected test profile fallback config to validate: %v", err)
	}
}

func TestValidateConfigTestProfileRequiresBridgeOrFallback(t *testing.T) {
	cfg := serverConfig{
		RuntimeProfile:     runtimeProfileTest,
		RequireRuntimeAuth: false,
		EnforceSocketProxy: false,
	}

	err := validateConfig(cfg)
	if err == nil || !strings.Contains(err.Error(), "RUNTIME_COMPAT_ENABLE_DETERMINISTIC_FALLBACK") {
		t.Fatalf("expected explicit fallback-or-bridge validation error, got: %v", err)
	}
}

func TestWithConfiguredAuthRequiresBearerTokenWhenEnabled(t *testing.T) {
	cfg := serverConfig{RequireRuntimeAuth: true, RuntimeAPIKey: "runtime-secret"}
	handler := withConfiguredAuth(cfg, func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"status": "ok"})
	})

	request := httptest.NewRequest(http.MethodGet, "/health", nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 when auth header missing, got %d", response.Code)
	}
}

func TestWithConfiguredAuthAllowsRequestsWhenAuthDisabled(t *testing.T) {
	cfg := serverConfig{RequireRuntimeAuth: false}
	handler := withConfiguredAuth(cfg, func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"status": "ok"})
	})

	request := httptest.NewRequest(http.MethodGet, "/health", nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected 200 when auth disabled, got %d", response.Code)
	}
}

func TestSubmitTaskHandlerFailsClosedWithoutBridgeWhenFallbackDisabled(t *testing.T) {
	cfg := serverConfig{}
	handler := submitTaskHandler(cfg)

	payload := []byte(`{"task_id":"task-1","role":"reviewer"}`)
	request := httptest.NewRequest(http.MethodPost, "/api/v1/tasks", bytes.NewReader(payload))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503 when no bridge configured, got %d", response.Code)
	}

	var body map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatalf("failed decoding response body: %v", err)
	}
	if body["error"] != "executor_bridge_not_configured" {
		t.Fatalf("expected executor_bridge_not_configured error, got %#v", body)
	}
}

func TestSubmitTaskHandlerAllowsDeterministicFallbackOnlyWhenExplicitlyEnabled(t *testing.T) {
	cfg := serverConfig{EnableDeterministicFallback: true}
	handler := submitTaskHandler(cfg)

	payload := []byte(`{"task_id":"task-2","role":"qa"}`)
	request := httptest.NewRequest(http.MethodPost, "/api/v1/tasks", bytes.NewReader(payload))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected 200 deterministic fallback response, got %d", response.Code)
	}

	var body map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatalf("failed decoding response body: %v", err)
	}

	output, ok := body["output"].(map[string]any)
	if !ok {
		t.Fatalf("expected output object in fallback response, got %#v", body)
	}
	if output["mode"] != "deterministic-fallback" {
		t.Fatalf("expected deterministic-fallback mode, got %#v", output)
	}
}
