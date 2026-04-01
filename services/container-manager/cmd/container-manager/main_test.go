package main

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"agirunner-container-manager/internal/manager"
	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/events"
)

type versionSummaryDockerClient struct {
	containers []manager.ApplicationContainerInfo
}

func (d *versionSummaryDockerClient) ListContainers(context.Context) ([]manager.ContainerInfo, error) {
	return nil, nil
}

func (d *versionSummaryDockerClient) ListApplicationContainers(context.Context) ([]manager.ApplicationContainerInfo, error) {
	return d.containers, nil
}

func (d *versionSummaryDockerClient) CreateContainer(context.Context, manager.ContainerSpec) (string, error) {
	return "", nil
}

func (d *versionSummaryDockerClient) StopContainer(context.Context, string, time.Duration) error {
	return nil
}

func (d *versionSummaryDockerClient) RemoveContainer(context.Context, string) error {
	return nil
}

func (d *versionSummaryDockerClient) ListImages(context.Context) ([]manager.ContainerImage, error) {
	return nil, nil
}

func (d *versionSummaryDockerClient) GetContainerStats(context.Context, string) (*manager.ContainerStats, error) {
	return nil, nil
}

func (d *versionSummaryDockerClient) UpdateContainerLabels(context.Context, string, map[string]string) error {
	return nil
}

func (d *versionSummaryDockerClient) InspectContainerHealth(context.Context, string) (*manager.ContainerHealthStatus, error) {
	return nil, nil
}

func (d *versionSummaryDockerClient) PullImage(context.Context, string, string) error {
	return nil
}

func (d *versionSummaryDockerClient) ConnectNetwork(context.Context, string, string) error {
	return nil
}

func (d *versionSummaryDockerClient) Events(context.Context, events.ListOptions) (<-chan events.Message, <-chan error) {
	return make(chan events.Message), make(chan error)
}

func (d *versionSummaryDockerClient) ContainerLogs(context.Context, string, container.LogsOptions) (io.ReadCloser, error) {
	return io.NopCloser(strings.NewReader("")), nil
}

type noopPlatformAPI struct{}

func (noopPlatformAPI) FetchDesiredState() ([]manager.DesiredState, error) { return nil, nil }
func (noopPlatformAPI) FetchReconcileSnapshot() (*manager.ReconcileSnapshot, error) {
	return &manager.ReconcileSnapshot{}, nil
}
func (noopPlatformAPI) ReportActualState(manager.ActualState) error                      { return nil }
func (noopPlatformAPI) ReportLiveContainerInventory([]manager.LiveContainerReport) error { return nil }
func (noopPlatformAPI) PruneActualState(string, []string) error                          { return nil }
func (noopPlatformAPI) ReportImage(manager.ContainerImage) error                         { return nil }
func (noopPlatformAPI) FetchRuntimeTargets() ([]manager.RuntimeTarget, error)            { return nil, nil }
func (noopPlatformAPI) FetchHeartbeats() ([]manager.RuntimeHeartbeat, error)             { return nil, nil }
func (noopPlatformAPI) GetTaskState(string) (string, error)                              { return "", nil }
func (noopPlatformAPI) RecordFleetEvent(manager.FleetEvent) error                        { return nil }
func (noopPlatformAPI) DrainRuntime(string) error                                        { return nil }
func (noopPlatformAPI) AcknowledgeWorkerRestart(string) error                            { return nil }
func (noopPlatformAPI) FailTask(string, string) error                                    { return nil }

func TestRegisterControlRoutesExposesVersionSummary(t *testing.T) {
	mgr := manager.NewWithPlatform(
		manager.Config{StackProjectName: "stack-a"},
		&versionSummaryDockerClient{
			containers: []manager.ApplicationContainerInfo{
				{
					ID:          "platform-api-a",
					Name:        "agirunner-platform-api-1",
					Image:       "ghcr.io/agirunner/agirunner-platform-api:0.1.0-rc.1",
					Status:      "Up 5 minutes",
					StartedAt:   time.Date(2026, 3, 31, 18, 22, 0, 0, time.UTC),
					ImageDigest: "sha256:platform-api",
					Labels: map[string]string{
						"agirunner.stack.project": "stack-a",
						"agirunner.component":     "platform-api",
					},
					ImageLabels: map[string]string{
						"org.opencontainers.image.version":  "0.1.0-rc.1",
						"org.opencontainers.image.revision": "abcdef123456",
					},
				},
			},
		},
		noopPlatformAPI{},
		slog.New(slog.NewTextHandler(io.Discard, nil)),
	)

	mux := http.NewServeMux()
	registerControlRoutes(mux, mgr, "tcp://socket-proxy:2375", "control-token", slog.New(slog.NewTextHandler(io.Discard, nil)))

	request := httptest.NewRequest(http.MethodGet, "/api/v1/version-summary", nil)
	request.Header.Set("Authorization", "Bearer control-token")
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
	}

	var summary manager.ApplicationVersionSummary
	if err := json.NewDecoder(response.Body).Decode(&summary); err != nil {
		t.Fatalf("decode version summary: %v", err)
	}

	if summary.PlatformAPI == nil {
		t.Fatal("expected platform api in version summary")
	}
	if summary.PlatformAPI.Version != "0.1.0-rc.1" {
		t.Fatalf("expected platform api version 0.1.0-rc.1, got %q", summary.PlatformAPI.Version)
	}
}
