package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"agirunner-container-manager/internal/manager"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: parseLogLevel()}))

	cfg := manager.Config{
		PlatformAPIURL:      envOrDefault("PLATFORM_API_URL", "http://platform-api:8080"),
		PlatformAPIKey:      envOrFileOrDefault("PLATFORM_API_KEY", "PLATFORM_API_KEY_FILE", ""),
		PlatformAdminAPIKey: envOrFileOrDefault("PLATFORM_ADMIN_API_KEY", "PLATFORM_ADMIN_API_KEY_FILE", ""),
		DockerHost:          envOrDefault("DOCKER_HOST", "tcp://socket-proxy:2375"),
		ReconcileInterval:   parseDuration("RECONCILE_INTERVAL_SECONDS", 5),
		StopTimeout:         parseDuration("STOP_TIMEOUT_SECONDS", 30),
		GlobalMaxRuntimes:      parseIntWithAlias("AGIRUNNER_GLOBAL_MAX_RUNTIMES", "GLOBAL_MAX_RUNTIMES", 10),
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
	metricsServer := startMetricsServer(metricsAddr, m, logger)

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

// envWithAlias returns the value of the primary env var if set, otherwise
// the fallback env var, otherwise the default. This supports the design's
// canonical AGIRUNNER_ prefixed names alongside legacy short names.
func envWithAlias(primary, fallback, defaultValue string) string {
	if v := os.Getenv(primary); v != "" {
		return v
	}
	return envOrDefault(fallback, defaultValue)
}

// parseIntWithAlias reads an integer from the primary env var, falling back
// to the alias env var, then the default value.
func parseIntWithAlias(primary, fallback string, defaultValue int) int {
	if v := os.Getenv(primary); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return parseInt(fallback, defaultValue)
}

func parseLogLevel() slog.Level {
	switch strings.ToLower(os.Getenv("LOG_LEVEL")) {
	case "debug":
		return slog.LevelDebug
	case "warn", "warning":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}

func parseDuration(envKey string, defaultSeconds int) time.Duration {
	v := os.Getenv(envKey)
	if v == "" {
		return time.Duration(defaultSeconds) * time.Second
	}
	seconds, err := strconv.Atoi(v)
	if err != nil {
		return time.Duration(defaultSeconds) * time.Second
	}
	return time.Duration(seconds) * time.Second
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

// startMetricsServer launches an HTTP server serving Prometheus metrics on /metrics.
func startMetricsServer(addr string, m *manager.Manager, logger *slog.Logger) *http.Server {
	mux := http.NewServeMux()
	mux.Handle("/metrics", promhttp.HandlerFor(m.MetricsRegistry(), promhttp.HandlerOpts{}))

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
