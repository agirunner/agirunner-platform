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

	"agirunner-container-manager/internal/manager"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))

	cfg := manager.Config{
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

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer cancel()

	if err := m.Run(ctx); err != nil && err != context.Canceled {
		logger.Error("container-manager exited with error", "error", err)
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
