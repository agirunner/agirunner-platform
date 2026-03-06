package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

const (
	runtimeProfileProd = "prod"
	runtimeProfileTest = "test"

	runtimeAPIKeyMinLength = 20
)

var (
	bridgeGatewayResolver = discoverBridgeGatewayIPv4
	agentRequestExecutor  = performAgentRequest
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

	runtimeAPIKey := mustLoadSecretEnv("RUNTIME_API_KEY", secretBindingOptions{
		runtimeProfile:         runtimeProfile,
		required:               runtimeProfile != runtimeProfileTest,
		minLength:              runtimeAPIKeyMinLength,
		requireFileInProd:      true,
	})
	agentAPIKey := mustLoadSecretEnv("AGENT_API_KEY", secretBindingOptions{
		runtimeProfile:    runtimeProfile,
		requireFileInProd: true,
	})

	return serverConfig{
		Port:                        port,
		RuntimeProfile:              runtimeProfile,
		RuntimeAPIKey:               runtimeAPIKey,
		RequireRuntimeAuth:          runtimeProfile != runtimeProfileTest,
		AgentAPIURL:                 strings.TrimSpace(os.Getenv("AGENT_API_URL")),
		AgentAPIKey:                 agentAPIKey,
		EnableDeterministicFallback: parseBoolWithDefault(os.Getenv("RUNTIME_COMPAT_ENABLE_DETERMINISTIC_FALLBACK"), false),
		DockerHost:                  strings.TrimSpace(os.Getenv("DOCKER_HOST")),
		EnforceSocketProxy:          parseBoolWithDefault(os.Getenv("RUNTIME_ENFORCE_SOCKET_PROXY"), true),
	}
}

type secretBindingOptions struct {
	runtimeProfile    string
	required          bool
	minLength         int
	requireFileInProd bool
}

func mustLoadSecretEnv(envName string, options secretBindingOptions) string {
	fileEnvName := envName + "_FILE"
	inlineValue := strings.TrimSpace(os.Getenv(envName))
	filePath := strings.TrimSpace(os.Getenv(fileEnvName))

	var resolvedValue string
	if filePath != "" {
		fileBytes, err := os.ReadFile(filePath)
		if err != nil {
			log.Fatalf("runtime-compat failed reading %s for %s: %v", fileEnvName, envName, err)
		}

		resolvedValue = strings.TrimSpace(string(fileBytes))
		if resolvedValue == "" {
			log.Fatalf("runtime-compat %s for %s resolved to an empty file", fileEnvName, envName)
		}

		if inlineValue != "" && inlineValue != resolvedValue {
			log.Fatalf("runtime-compat %s and %s must match when both are set", envName, fileEnvName)
		}

		os.Setenv(envName, resolvedValue)
	} else {
		resolvedValue = inlineValue
	}

	if options.requireFileInProd && options.runtimeProfile == runtimeProfileProd && inlineValue != "" && filePath == "" {
		log.Fatalf("runtime-compat %s is required for %s when RUNTIME_COMPAT_PROFILE=prod", fileEnvName, envName)
	}

	if options.required && resolvedValue == "" {
		log.Fatalf("runtime-compat missing required secret %s or %s", envName, fileEnvName)
	}

	if options.minLength > 0 && resolvedValue != "" && len(resolvedValue) < options.minLength {
		log.Fatalf("runtime-compat %s must be at least %d characters long", envName, options.minLength)
	}

	return resolvedValue
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

	statusCode, responseBytes, err := agentRequestExecutor(cfg.AgentAPIURL, cfg.AgentAPIKey, bodyBytes)
	if err != nil {
		fallbackURL, fallbackErr := resolveHostGatewayFallbackURL(cfg.AgentAPIURL)
		if fallbackErr == nil && fallbackURL != "" {
			statusCode, responseBytes, err = agentRequestExecutor(fallbackURL, cfg.AgentAPIKey, bodyBytes)
			if err == nil {
				log.Printf("agent-api bridge fallback succeeded via %s", fallbackURL)
			}
		}
	}
	if err != nil {
		return nil, fmt.Errorf("agent request failed: %w", err)
	}

	if statusCode >= 400 {
		return nil, fmt.Errorf("agent endpoint returned HTTP %d: %s", statusCode, truncateForError(string(responseBytes), 400))
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

func performAgentRequest(agentURL, agentAPIKey string, bodyBytes []byte) (int, []byte, error) {
	request, err := http.NewRequest(http.MethodPost, agentURL, bytes.NewReader(bodyBytes))
	if err != nil {
		return 0, nil, fmt.Errorf("create agent request: %w", err)
	}

	request.Header.Set("Content-Type", "application/json")
	if agentAPIKey != "" {
		request.Header.Set("Authorization", "Bearer "+agentAPIKey)
	}

	client := &http.Client{Timeout: 90 * time.Second}
	response, err := client.Do(request)
	if err != nil {
		return 0, nil, err
	}
	defer response.Body.Close()

	responseBytes, err := io.ReadAll(response.Body)
	if err != nil {
		return 0, nil, fmt.Errorf("read agent response: %w", err)
	}

	return response.StatusCode, responseBytes, nil
}

func resolveHostGatewayFallbackURL(rawURL string) (string, error) {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return "", fmt.Errorf("parse agent api url: %w", err)
	}

	if !strings.EqualFold(parsed.Hostname(), "host.docker.internal") {
		return "", nil
	}

	gatewayIP, err := bridgeGatewayResolver()
	if err != nil {
		return "", err
	}

	if parsed.Port() != "" {
		parsed.Host = net.JoinHostPort(gatewayIP, parsed.Port())
	} else {
		parsed.Host = gatewayIP
	}

	return parsed.String(), nil
}

func discoverBridgeGatewayIPv4() (string, error) {
	if interfaceGateway, err := gatewayFromInterface("eth0"); err == nil {
		return interfaceGateway, nil
	}

	interfaces, err := net.Interfaces()
	if err != nil {
		return "", fmt.Errorf("list interfaces: %w", err)
	}

	for _, iface := range interfaces {
		if (iface.Flags&net.FlagLoopback) != 0 || (iface.Flags&net.FlagUp) == 0 {
			continue
		}

		gatewayIP, err := deriveGatewayFromAddrs(iface.Addrs)
		if err == nil {
			return gatewayIP, nil
		}
	}

	return "", fmt.Errorf("no bridge gateway address discovered")
}

func gatewayFromInterface(interfaceName string) (string, error) {
	iface, err := net.InterfaceByName(interfaceName)
	if err != nil {
		return "", err
	}

	return deriveGatewayFromAddrs(iface.Addrs)
}

func deriveGatewayFromAddrs(loadAddrs func() ([]net.Addr, error)) (string, error) {
	addrs, err := loadAddrs()
	if err != nil {
		return "", err
	}

	for _, address := range addrs {
		ipNet, ok := address.(*net.IPNet)
		if !ok {
			continue
		}

		gateway := deriveGatewayFromIPNet(ipNet)
		if gateway != "" {
			return gateway, nil
		}
	}

	return "", fmt.Errorf("no ipv4 gateway candidate found")
}

func deriveGatewayFromIPNet(ipNet *net.IPNet) string {
	if ipNet == nil || ipNet.Mask == nil {
		return ""
	}

	ipv4 := ipNet.IP.To4()
	if ipv4 == nil || len(ipNet.Mask) != 4 {
		return ""
	}

	ones, bits := ipNet.Mask.Size()
	if bits != 32 || ones >= 31 {
		return ""
	}

	networkBase := ipv4.Mask(ipNet.Mask)
	gateway := incrementIPv4(networkBase)
	if gateway == nil || gateway.Equal(ipv4) {
		return ""
	}

	return gateway.String()
}

func incrementIPv4(ip net.IP) net.IP {
	ipv4 := ip.To4()
	if ipv4 == nil {
		return nil
	}

	incremented := make(net.IP, len(ipv4))
	copy(incremented, ipv4)

	for index := len(incremented) - 1; index >= 0; index-- {
		incremented[index]++
		if incremented[index] != 0 {
			break
		}
	}

	return incremented
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
