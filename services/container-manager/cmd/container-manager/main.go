package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"agirunner-container-manager/internal/manager"
	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/events"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: defaultProcessLogLevel()}))

	cfg := manager.Config{
		PlatformAPIURL:         envOrDefault("PLATFORM_API_URL", "http://platform-api:8080"),
		PlatformAPIKey:         envOrFileOrDefault("PLATFORM_API_KEY", "PLATFORM_API_KEY_FILE", ""),
		PlatformAdminAPIKey:    envOrFileOrDefault("PLATFORM_ADMIN_API_KEY", "PLATFORM_ADMIN_API_KEY_FILE", ""),
		DockerHost:             envOrDefault("DOCKER_HOST", "tcp://socket-proxy:2375"),
		RuntimeNetwork:         envOrDefault("RUNTIME_NETWORK", ""),
		RuntimeInternalNetwork: envOrDefault("RUNTIME_INTERNAL_NETWORK", ""),
	}

	if cfg.PlatformAPIKey == "" {
		logger.Error("PLATFORM_API_KEY or PLATFORM_API_KEY_FILE is required")
		os.Exit(1)
	}

	var docker manager.DockerClient
	if cfg.DockerHost != "" {
		realClient, err := manager.NewRealDockerClient(cfg.DockerHost)
		if err != nil {
			logger.Error("failed to create Docker client", "error", err)
			os.Exit(1)
		}
		logger.Info("using Docker client", "host", cfg.DockerHost)
		docker = realClient
	} else {
		logger.Warn("DOCKER_HOST not set — using noop Docker client for dev/test")
		docker = &noopDockerClient{logger: logger}
	}

	m := manager.New(cfg, docker, logger)

	metricsAddr := envOrDefault("METRICS_ADDR", ":9090")
	controlToken := envOrFileOrDefault("CONTAINER_MANAGER_CONTROL_TOKEN", "CONTAINER_MANAGER_CONTROL_TOKEN_FILE", "")
	metricsServer := startMetricsServer(metricsAddr, m, cfg.DockerHost, controlToken, logger)

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer cancel()

	if err := m.Run(ctx); err != nil && err != context.Canceled {
		logger.Error("container-manager exited with error", "error", err)
		_ = metricsServer.Shutdown(context.Background())
		os.Exit(1)
	}
	_ = metricsServer.Shutdown(context.Background())
}

func envOrDefault(key, defaultValue string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return defaultValue
}

func envOrFileOrDefault(envKey, fileEnvKey, defaultValue string) string {
	if v := os.Getenv(envKey); v != "" {
		return v
	}
	if filePath := os.Getenv(fileEnvKey); filePath != "" {
		data, err := os.ReadFile(filePath)
		if err == nil {
			return strings.TrimSpace(string(data))
		}
	}
	return defaultValue
}

func parseInt(envKey string, defaultValue int) int {
	v := os.Getenv(envKey)
	if v == "" {
		return defaultValue
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return defaultValue
	}
	return n
}

func envWithAlias(primary, fallback, defaultValue string) string {
	if v := os.Getenv(primary); v != "" {
		return v
	}
	return envOrDefault(fallback, defaultValue)
}

func parseIntWithAlias(primary, fallback string, defaultValue int) int {
	if v := os.Getenv(primary); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return parseInt(fallback, defaultValue)
}

func defaultProcessLogLevel() slog.Level {
	return slog.LevelInfo
}

// noopDockerClient is a placeholder until the real Docker client is wired.
type noopDockerClient struct {
	logger *slog.Logger
}

func (c *noopDockerClient) ListContainers(_ context.Context) ([]manager.ContainerInfo, error) {
	return nil, nil
}

func (c *noopDockerClient) CreateContainer(_ context.Context, spec manager.ContainerSpec) (string, error) {
	c.logger.Info("noop: would create container", "name", spec.Name, "image", spec.Image)
	return fmt.Sprintf("noop-%s", spec.Name), nil
}

func (c *noopDockerClient) StopContainer(_ context.Context, containerID string, _ time.Duration) error {
	c.logger.Info("noop: would stop container", "container", containerID)
	return nil
}

func (c *noopDockerClient) RemoveContainer(_ context.Context, containerID string) error {
	c.logger.Info("noop: would remove container", "container", containerID)
	return nil
}

func (c *noopDockerClient) ListImages(_ context.Context) ([]manager.ContainerImage, error) {
	return nil, nil
}

func (c *noopDockerClient) GetContainerStats(_ context.Context, _ string) (*manager.ContainerStats, error) {
	return nil, nil
}

func (c *noopDockerClient) UpdateContainerLabels(_ context.Context, _ string, _ map[string]string) error {
	return nil
}

func (c *noopDockerClient) InspectContainerHealth(_ context.Context, _ string) (*manager.ContainerHealthStatus, error) {
	return nil, nil
}

func (c *noopDockerClient) PullImage(_ context.Context, image, policy string) error {
	c.logger.Info("noop: would pull image", "image", image, "policy", policy)
	return nil
}

func (c *noopDockerClient) ConnectNetwork(_ context.Context, containerID, networkName string) error {
	c.logger.Info("noop: would connect network", "container", containerID, "network", networkName)
	return nil
}

func (c *noopDockerClient) Events(_ context.Context, _ events.ListOptions) (<-chan events.Message, <-chan error) {
	return make(chan events.Message), make(chan error)
}

func (c *noopDockerClient) ContainerLogs(_ context.Context, _ string, _ container.LogsOptions) (io.ReadCloser, error) {
	return io.NopCloser(strings.NewReader("")), nil
}

// startMetricsServer launches an HTTP server serving Prometheus metrics on /metrics.
func startMetricsServer(
	addr string,
	m *manager.Manager,
	dockerHost string,
	controlToken string,
	logger *slog.Logger,
) *http.Server {
	mux := http.NewServeMux()
	mux.Handle("/metrics", promhttp.HandlerFor(m.MetricsRegistry(), promhttp.HandlerOpts{}))
	mux.HandleFunc("/api/v1/execution-environments/verify", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if strings.TrimSpace(controlToken) != "" && bearerToken(r) != strings.TrimSpace(controlToken) {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		var request manager.ExecutionEnvironmentVerifyRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			http.Error(w, fmt.Sprintf("invalid request body: %v", err), http.StatusBadRequest)
			return
		}

		result, err := manager.VerifyExecutionEnvironment(r.Context(), dockerHost, request)
		if err != nil {
			http.Error(w, fmt.Sprintf("verification failed: %v", err), http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(result); err != nil {
			logger.Error("encode verification response failed", "error", err)
		}
	})

	srv := &http.Server{
		Addr:              addr,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		logger.Info("metrics server listening", "addr", addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Error("metrics server failed", "error", err)
		}
	}()

	return srv
}

func bearerToken(r *http.Request) string {
	auth := strings.TrimSpace(r.Header.Get("Authorization"))
	if auth == "" {
		return ""
	}
	const prefix = "Bearer "
	if !strings.HasPrefix(auth, prefix) {
		return ""
	}
	return strings.TrimSpace(strings.TrimPrefix(auth, prefix))
}
