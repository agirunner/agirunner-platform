package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"agirunner-reconciler/internal/reconciler"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))

	cfg := reconciler.Config{
		PlatformAPIURL:    envOrDefault("PLATFORM_API_URL", "http://platform-api:8080"),
		PlatformAPIKey:    envOrFileOrDefault("PLATFORM_API_KEY", "PLATFORM_API_KEY_FILE", ""),
		DockerHost:        envOrDefault("DOCKER_HOST", "tcp://socket-proxy:2375"),
		ReconcileInterval: parseDuration("RECONCILE_INTERVAL_SECONDS", 5),
		StopTimeout:       parseDuration("STOP_TIMEOUT_SECONDS", 30),
	}

	if cfg.PlatformAPIKey == "" {
		logger.Error("PLATFORM_API_KEY or PLATFORM_API_KEY_FILE is required")
		os.Exit(1)
	}

	// TODO: implement real Docker client via socket proxy
	// For now, the reconciler starts but logs that no Docker client is configured.
	logger.Warn("Docker client not yet implemented — reconciler will fetch desired state but cannot manage containers")

	var docker reconciler.DockerClient = &noopDockerClient{logger: logger}

	r := reconciler.New(cfg, docker, logger)

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer cancel()

	if err := r.Run(ctx); err != nil && err != context.Canceled {
		logger.Error("reconciler exited with error", "error", err)
		os.Exit(1)
	}
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

func (c *noopDockerClient) ListContainers(_ context.Context) ([]reconciler.ContainerInfo, error) {
	return nil, nil
}

func (c *noopDockerClient) CreateContainer(_ context.Context, spec reconciler.ContainerSpec) (string, error) {
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

func (c *noopDockerClient) ListImages(_ context.Context) ([]reconciler.ContainerImage, error) {
	return nil, nil
}

func (c *noopDockerClient) GetContainerStats(_ context.Context, _ string) (*reconciler.ContainerStats, error) {
	return nil, nil
}
