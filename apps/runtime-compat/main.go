package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
)

const (
	runtimeProfileProd = "prod"
	runtimeProfileTest = "test"

	runtimeAPIKeyMinLength = 20
)

type runtimeTaskSubmission struct {
	TaskID       string         `json:"task_id"`
	Role         string         `json:"role"`
	Input        map[string]any `json:"input"`
	ContextStack map[string]any `json:"context_stack"`
	Environment  map[string]any `json:"environment"`
}

type serverConfig struct {
	Port                        string
	RuntimeProfile              string
	RuntimeAPIKey               string
	RequireRuntimeAuth          bool
	AgentAPIURL                 string
	AgentAPIKey                 string
	EnableDeterministicFallback bool
	DockerHost                  string
	EnforceSocketProxy          bool
}

func main() {
	cfg := loadConfig()
	if err := validateConfig(cfg); err != nil {
		log.Fatalf("runtime-compat config validation failed: %v", err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", withConfiguredAuth(cfg, healthHandler(cfg)))
	mux.HandleFunc("/api/v1/tasks", withConfiguredAuth(cfg, submitTaskHandler(cfg)))
	mux.HandleFunc("/api/v1/tasks/", withConfiguredAuth(cfg, taskActionHandler()))

	server := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           loggingMiddleware(mux),
		ReadHeaderTimeout: 5 * time.Second,
	}

	log.Printf(
		"runtime-compat listening on :%s (profile=%s, auth=%s, fallback=%t, agent_api=%s, docker_host=%s)",
		cfg.Port,
		cfg.RuntimeProfile,
		ternary(cfg.RequireRuntimeAuth, "required", "optional"),
		cfg.EnableDeterministicFallback,
		valueOrUnset(cfg.AgentAPIURL),
		valueOrUnset(cfg.DockerHost),
	)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("runtime-compat server failure: %v", err)
	}
}

func loadConfig() serverConfig {
	port := strings.TrimSpace(os.Getenv("PORT"))
	if port == "" {
		port = "8081"
	}

	runtimeProfile := strings.ToLower(strings.TrimSpace(os.Getenv("RUNTIME_COMPAT_PROFILE")))
	if runtimeProfile == "" {
		runtimeProfile = runtimeProfileProd
	}

	return serverConfig{
		Port:                        port,
		RuntimeProfile:              runtimeProfile,
		RuntimeAPIKey:               strings.TrimSpace(os.Getenv("RUNTIME_API_KEY")),
		RequireRuntimeAuth:          runtimeProfile != runtimeProfileTest,
		AgentAPIURL:                 strings.TrimSpace(os.Getenv("AGENT_API_URL")),
		AgentAPIKey:                 strings.TrimSpace(os.Getenv("AGENT_API_KEY")),
		EnableDeterministicFallback: parseBoolWithDefault(os.Getenv("RUNTIME_COMPAT_ENABLE_DETERMINISTIC_FALLBACK"), false),
		DockerHost:                  strings.TrimSpace(os.Getenv("DOCKER_HOST")),
		EnforceSocketProxy:          parseBoolWithDefault(os.Getenv("RUNTIME_ENFORCE_SOCKET_PROXY"), true),
	}
}

func validateConfig(cfg serverConfig) error {
	switch cfg.RuntimeProfile {
	case runtimeProfileProd:
		if cfg.EnableDeterministicFallback {
			return fmt.Errorf("RUNTIME_COMPAT_ENABLE_DETERMINISTIC_FALLBACK is test-only and not allowed in prod profile")
		}
	case runtimeProfileTest:
		// test profile can enable deterministic fallback explicitly for deterministic harness paths
	default:
		return fmt.Errorf("RUNTIME_COMPAT_PROFILE must be one of [prod,test] (received %q)", cfg.RuntimeProfile)
	}

	if cfg.RequireRuntimeAuth {
		if cfg.RuntimeAPIKey == "" {
			return fmt.Errorf("RUNTIME_API_KEY is required when runtime auth is enforced (profile=%s)", cfg.RuntimeProfile)
		}

		if len(cfg.RuntimeAPIKey) < runtimeAPIKeyMinLength {
			return fmt.Errorf("RUNTIME_API_KEY must be at least %d characters when runtime auth is enforced", runtimeAPIKeyMinLength)
		}
	}

	if cfg.AgentAPIURL == "" && !cfg.EnableDeterministicFallback {
		if cfg.RuntimeProfile == runtimeProfileProd {
			return fmt.Errorf("AGENT_API_URL is required in prod profile; deterministic fallback is disabled")
		}
		return fmt.Errorf("AGENT_API_URL is required unless RUNTIME_COMPAT_ENABLE_DETERMINISTIC_FALLBACK=true in test profile")
	}

	if cfg.EnforceSocketProxy {
		dockerHost := strings.ToLower(cfg.DockerHost)
		if dockerHost == "" {
			return fmt.Errorf("DOCKER_HOST is required when RUNTIME_ENFORCE_SOCKET_PROXY=true")
		}

		if strings.Contains(dockerHost, "docker.sock") {
			return fmt.Errorf("DOCKER_HOST must not reference docker.sock directly (%s)", cfg.DockerHost)
		}

		if !strings.Contains(dockerHost, "socket-proxy") {
			return fmt.Errorf("DOCKER_HOST must route through socket-proxy (got %s)", cfg.DockerHost)
		}
	}

	return nil
}

func withConfiguredAuth(cfg serverConfig, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if cfg.RequireRuntimeAuth {
			authorization := strings.TrimSpace(r.Header.Get("Authorization"))
			if !strings.HasPrefix(authorization, "Bearer ") {
				writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "missing bearer authorization"})
				return
			}

			provided := strings.TrimSpace(strings.TrimPrefix(authorization, "Bearer "))
			if provided != cfg.RuntimeAPIKey {
				writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "invalid runtime api key"})
				return
			}
		}

		next(w, r)
	}
}

func healthHandler(cfg serverConfig) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"error": "method_not_allowed"})
			return
		}

		writeJSON(w, http.StatusOK, map[string]any{
			"status": "ok",
			"checks": map[string]any{
				"runtime_profile": map[string]any{
					"profile":                        cfg.RuntimeProfile,
					"runtime_auth":                   ternary(cfg.RequireRuntimeAuth, "required", "optional"),
					"deterministic_fallback_enabled": cfg.EnableDeterministicFallback,
				},
				"socket_proxy": map[string]any{
					"status":      ternary(cfg.EnforceSocketProxy, "enforced", "optional"),
					"docker_host": valueOrUnset(cfg.DockerHost),
				},
				"agent_api_bridge": map[string]any{
					"configured": cfg.AgentAPIURL != "",
					"url":        valueOrUnset(cfg.AgentAPIURL),
				},
			},
		})
	}
}

func submitTaskHandler(cfg serverConfig) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"error": "method_not_allowed"})
			return
		}

		var submission runtimeTaskSubmission
		if err := json.NewDecoder(r.Body).Decode(&submission); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid_json", "message": err.Error()})
			return
		}

		submission.TaskID = strings.TrimSpace(submission.TaskID)
		if submission.TaskID == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "task_id_required"})
			return
		}

		if submission.Input == nil {
			submission.Input = map[string]any{}
		}
		if submission.ContextStack == nil {
			submission.ContextStack = map[string]any{}
		}

		if cfg.AgentAPIURL != "" {
			forwardedOutput, err := forwardToAgentAPI(cfg, submission)
			if err != nil {
				writeJSON(w, http.StatusBadGateway, map[string]any{"error": "agent_api_forward_failed", "message": err.Error()})
				return
			}

			writeJSON(w, http.StatusOK, forwardedOutput)
			return
		}

		if cfg.EnableDeterministicFallback {
			writeJSON(w, http.StatusOK, deterministicFallbackOutput(submission))
			return
		}

		writeJSON(w, http.StatusServiceUnavailable, map[string]any{
			"error":   "executor_bridge_not_configured",
			"message": "AGENT_API_URL is required for runtime-compat task submission when deterministic fallback is disabled",
		})
	}
}

func taskActionHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/api/v1/tasks/")
		if path == r.URL.Path || path == "" {
			writeJSON(w, http.StatusNotFound, map[string]any{"error": "not_found"})
			return
		}

		parts := strings.Split(path, "/")
		taskID := strings.TrimSpace(parts[0])
		if taskID == "" {
			writeJSON(w, http.StatusNotFound, map[string]any{"error": "not_found"})
			return
		}

		if len(parts) == 1 {
			if r.Method == http.MethodDelete {
				writeJSON(w, http.StatusOK, map[string]any{"task_id": taskID, "cancelled": true, "method": "delete-legacy"})
				return
			}

			writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"error": "method_not_allowed"})
			return
		}

		action := parts[1]
		switch {
		case action == "cancel" && r.Method == http.MethodPost:
			writeJSON(w, http.StatusOK, map[string]any{"task_id": taskID, "cancelled": true, "method": "post-cancel"})
		case action == "logs" && r.Method == http.MethodGet:
			writeJSON(w, http.StatusOK, map[string]any{
				"task_id": taskID,
				"logs": []map[string]any{
					{"ts": time.Now().UTC().Format(time.RFC3339), "level": "info", "message": "runtime-compat bridge active"},
				},
			})
		default:
			writeJSON(w, http.StatusNotFound, map[string]any{"error": "not_found"})
		}
	}
}

func forwardToAgentAPI(cfg serverConfig, submission runtimeTaskSubmission) (map[string]any, error) {
	legacyPayload := map[string]any{
		"task_id": submission.TaskID,
		"title":   fmt.Sprintf("runtime-compat task %s", submission.TaskID),
		"type":    nonEmptyOrFallback(submission.Role, "runtime-task"),
		"input":   submission.Input,
		"context": submission.ContextStack,
	}

	bodyBytes, err := json.Marshal(legacyPayload)
	if err != nil {
		return nil, fmt.Errorf("marshal agent payload: %w", err)
	}

	request, err := http.NewRequest(http.MethodPost, cfg.AgentAPIURL, bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, fmt.Errorf("create agent request: %w", err)
	}

	request.Header.Set("Content-Type", "application/json")
	if cfg.AgentAPIKey != "" {
		request.Header.Set("Authorization", "Bearer "+cfg.AgentAPIKey)
	}

	client := &http.Client{Timeout: 90 * time.Second}
	response, err := client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("agent request failed: %w", err)
	}
	defer response.Body.Close()

	responseBytes, err := io.ReadAll(response.Body)
	if err != nil {
		return nil, fmt.Errorf("read agent response: %w", err)
	}

	if response.StatusCode >= 400 {
		return nil, fmt.Errorf("agent endpoint returned HTTP %d: %s", response.StatusCode, truncateForError(string(responseBytes), 400))
	}

	var parsed map[string]any
	if len(strings.TrimSpace(string(responseBytes))) == 0 {
		return map[string]any{}, nil
	}

	if err := json.Unmarshal(responseBytes, &parsed); err != nil {
		return map[string]any{"raw": string(responseBytes)}, nil
	}

	return parsed, nil
}

func deterministicFallbackOutput(submission runtimeTaskSubmission) map[string]any {
	return map[string]any{
		"task_id": submission.TaskID,
		"summary": fmt.Sprintf("runtime-compat fallback executed task %s for role %s", submission.TaskID, nonEmptyOrFallback(submission.Role, "unknown")),
		"output": map[string]any{
			"handled_by": "runtime-compat-go",
			"mode":       "deterministic-fallback",
			"input":      submission.Input,
			"context":    submission.ContextStack,
		},
	}
}

func parseBoolWithDefault(value string, defaultValue bool) bool {
	trimmed := strings.TrimSpace(strings.ToLower(value))
	if trimmed == "" {
		return defaultValue
	}

	switch trimmed {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	default:
		return defaultValue
	}
}

func loggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		next.ServeHTTP(w, r)
		log.Printf("%s %s (%s)", r.Method, r.URL.Path, time.Since(started).Round(time.Millisecond))
	})
}

func writeJSON(w http.ResponseWriter, statusCode int, payload map[string]any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	if payload == nil {
		payload = map[string]any{}
	}
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		log.Printf("encode response failed: %v", err)
	}
}

func truncateForError(value string, maxLen int) string {
	if len(value) <= maxLen {
		return value
	}
	return value[:maxLen] + "…"
}

func nonEmptyOrFallback(value, fallback string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return fallback
	}
	return trimmed
}

func valueOrUnset(value string) string {
	if strings.TrimSpace(value) == "" {
		return "unset"
	}
	return value
}

func ternary(condition bool, whenTrue, whenFalse string) string {
	if condition {
		return whenTrue
	}
	return whenFalse
}
