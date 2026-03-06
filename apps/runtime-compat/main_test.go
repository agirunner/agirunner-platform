package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
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

func TestLoadConfigReadsSecretFromFileInProd(t *testing.T) {
	secretPath := filepath.Join(t.TempDir(), "runtime-api-key")
	if err := os.WriteFile(secretPath, []byte("runtime-secret-1234567890\n"), 0o600); err != nil {
		t.Fatalf("failed writing temp secret: %v", err)
	}

	t.Setenv("PORT", "18081")
	t.Setenv("RUNTIME_COMPAT_PROFILE", runtimeProfileProd)
	t.Setenv("RUNTIME_API_KEY_FILE", secretPath)
	t.Setenv("AGENT_API_URL", "http://example.invalid/execute")
	t.Setenv("RUNTIME_ENFORCE_SOCKET_PROXY", "false")

	cfg := loadConfig()

	if cfg.RuntimeAPIKey != "runtime-secret-1234567890" {
		t.Fatalf("expected runtime api key from file, got %q", cfg.RuntimeAPIKey)
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

func TestHealthHandlerReportsConfiguredBridgeAndSocketProxyState(t *testing.T) {
	cfg := serverConfig{
		RuntimeProfile:     runtimeProfileProd,
		RequireRuntimeAuth: true,
		AgentAPIURL:        "http://example.invalid/execute",
		DockerHost:         "tcp://socket-proxy:2375",
		EnforceSocketProxy: true,
	}

	request := httptest.NewRequest(http.MethodGet, "/health", nil)
	response := httptest.NewRecorder()

	healthHandler(cfg).ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected health status 200, got %d", response.Code)
	}

	var body map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatalf("failed decoding health response: %v", err)
	}

	checks, ok := body["checks"].(map[string]any)
	if !ok {
		t.Fatalf("expected checks object in health response, got %#v", body)
	}

	bridge, ok := checks["agent_api_bridge"].(map[string]any)
	if !ok || bridge["configured"] != true {
		t.Fatalf("expected configured bridge in health response, got %#v", checks["agent_api_bridge"])
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

func TestTaskActionHandlerSupportsCancelAndLogsContract(t *testing.T) {
	handler := taskActionHandler()

	cancelRequest := httptest.NewRequest(http.MethodPost, "/api/v1/tasks/task-123/cancel", nil)
	cancelResponse := httptest.NewRecorder()
	handler.ServeHTTP(cancelResponse, cancelRequest)
	if cancelResponse.Code != http.StatusOK {
		t.Fatalf("expected cancel response 200, got %d", cancelResponse.Code)
	}

	var cancelBody map[string]any
	if err := json.Unmarshal(cancelResponse.Body.Bytes(), &cancelBody); err != nil {
		t.Fatalf("failed decoding cancel body: %v", err)
	}
	if cancelBody["cancelled"] != true {
		t.Fatalf("expected cancelled=true, got %#v", cancelBody)
	}

	logsRequest := httptest.NewRequest(http.MethodGet, "/api/v1/tasks/task-123/logs", nil)
	logsResponse := httptest.NewRecorder()
	handler.ServeHTTP(logsResponse, logsRequest)
	if logsResponse.Code != http.StatusOK {
		t.Fatalf("expected logs response 200, got %d", logsResponse.Code)
	}

	var logsBody map[string]any
	if err := json.Unmarshal(logsResponse.Body.Bytes(), &logsBody); err != nil {
		t.Fatalf("failed decoding logs body: %v", err)
	}
	logEntries, ok := logsBody["logs"].([]any)
	if !ok || len(logEntries) == 0 {
		t.Fatalf("expected at least one log entry, got %#v", logsBody)
	}
}

func TestResolveHostGatewayFallbackURLRewritesHostDockerInternal(t *testing.T) {
	originalResolver := bridgeGatewayResolver
	bridgeGatewayResolver = func() (string, error) {
		return "192.168.80.1", nil
	}
	t.Cleanup(func() {
		bridgeGatewayResolver = originalResolver
	})

	rewritten, err := resolveHostGatewayFallbackURL("http://host.docker.internal:39000/execute")
	if err != nil {
		t.Fatalf("expected fallback rewrite to succeed: %v", err)
	}

	if rewritten != "http://192.168.80.1:39000/execute" {
		t.Fatalf("unexpected rewritten fallback url: %s", rewritten)
	}
}

func TestForwardToAgentAPIRetriesWithGatewayFallback(t *testing.T) {
	originalResolver := bridgeGatewayResolver
	originalExecutor := agentRequestExecutor
	bridgeGatewayResolver = func() (string, error) {
		return "192.168.80.1", nil
	}
	attemptedURLs := make([]string, 0, 2)
	agentRequestExecutor = func(agentURL, _ string, _ []byte) (int, []byte, error) {
		attemptedURLs = append(attemptedURLs, agentURL)
		switch len(attemptedURLs) {
		case 1:
			return 0, nil, fmt.Errorf("dial tcp: connect: network is unreachable")
		case 2:
			return http.StatusOK, []byte(`{"output":{"status":"ok"}}`), nil
		default:
			return 0, nil, fmt.Errorf("unexpected call")
		}
	}
	t.Cleanup(func() {
		bridgeGatewayResolver = originalResolver
		agentRequestExecutor = originalExecutor
	})

	response, err := forwardToAgentAPI(
		serverConfig{AgentAPIURL: "http://host.docker.internal:39000/execute"},
		runtimeTaskSubmission{TaskID: "task-123", Role: "architect", Input: map[string]any{}},
	)
	if err != nil {
		t.Fatalf("expected fallback request to succeed: %v", err)
	}

	if len(attemptedURLs) != 2 {
		t.Fatalf("expected two attempts (primary + fallback), got %d", len(attemptedURLs))
	}

	if attemptedURLs[0] != "http://host.docker.internal:39000/execute" {
		t.Fatalf("unexpected primary url: %s", attemptedURLs[0])
	}
	if attemptedURLs[1] != "http://192.168.80.1:39000/execute" {
		t.Fatalf("unexpected fallback url: %s", attemptedURLs[1])
	}

	output, ok := response["output"].(map[string]any)
	if !ok {
		t.Fatalf("expected output payload from fallback response, got %#v", response)
	}
	if output["status"] != "ok" {
		t.Fatalf("unexpected fallback response payload: %#v", response)
	}
}
