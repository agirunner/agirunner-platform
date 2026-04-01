package manager

import (
	"testing"
	"time"
)

func TestBuildApplicationVersionSummaryUsesProjectScopedImageMetadata(t *testing.T) {
	startedAt := time.Date(2026, 3, 31, 18, 22, 0, 0, time.UTC)

	summary := buildApplicationVersionSummary([]ApplicationContainerInfo{
		{
			ID:          "platform-api-a",
			Name:        "agirunner-platform-api-1",
			Image:       "ghcr.io/agirunner/agirunner-platform-api:0.1.0-rc.1",
			State:       "running",
			Status:      "Up 8 minutes",
			StartedAt:   startedAt,
			ImageDigest: "sha256:platform-api",
			Labels: map[string]string{
				labelStackProject: "stack-a",
				labelComponent:    componentPlatformAPI,
			},
			ImageLabels: map[string]string{
				labelOCIVersion:  "0.1.0-rc.1",
				labelOCIRevision: "2e7df3c98765",
			},
		},
		{
			ID:        "dashboard-a",
			Name:      "agirunner-dashboard-1",
			Image:     "ghcr.io/agirunner/agirunner-platform-dashboard:local",
			State:     "running",
			Status:    "Up 8 minutes",
			StartedAt: startedAt.Add(30 * time.Second),
			Labels: map[string]string{
				labelStackProject: "stack-a",
				labelComponent:    componentDashboard,
			},
			ImageLabels: map[string]string{},
		},
		{
			ID:          "container-manager-a",
			Name:        "agirunner-container-manager-1",
			Image:       "ghcr.io/agirunner/agirunner-platform-container-manager:latest",
			State:       "running",
			Status:      "Up 8 minutes",
			StartedAt:   startedAt.Add(time.Minute),
			ImageDigest: "sha256:container-manager",
			Labels: map[string]string{
				labelStackProject: "stack-a",
				labelComponent:    componentContainerManager,
			},
			ImageLabels: map[string]string{},
		},
		{
			ID:          "runtime-orchestrator-a",
			Name:        "orchestrator-primary",
			Image:       "ghcr.io/agirunner/agirunner-runtime:0.1.0-rc.1",
			State:       "running",
			Status:      "Up 6 minutes",
			StartedAt:   startedAt.Add(2 * time.Minute),
			ImageDigest: "sha256:runtime",
			Labels: map[string]string{
				labelStackProject:   "stack-a",
				labelManagedBy:      "true",
				labelDesiredStateID: "worker-1",
			},
			ImageLabels: map[string]string{
				labelOCIVersion:  "0.1.0-rc.1",
				labelOCIRevision: "abc123456789",
			},
		},
		{
			ID:          "runtime-specialist-a",
			Name:        "runtime-specialist-1",
			Image:       "ghcr.io/agirunner/agirunner-runtime:0.1.0-rc.1",
			State:       "running",
			Status:      "Up 4 minutes",
			StartedAt:   startedAt.Add(3 * time.Minute),
			ImageDigest: "sha256:runtime",
			Labels: map[string]string{
				labelStackProject: "stack-a",
				labelDCMManaged:   "true",
				labelDCMTier:      tierRuntime,
				labelDCMRuntimeID: "runtime-1",
			},
			ImageLabels: map[string]string{
				labelOCIVersion:  "0.1.0-rc.1",
				labelOCIRevision: "abc123456789",
			},
		},
		{
			ID:        "task-a",
			Name:      "task-1",
			Image:     "debian:trixie-slim",
			State:     "running",
			Status:    "Up 90 seconds",
			StartedAt: startedAt.Add(4 * time.Minute),
			Labels: map[string]string{
				labelStackProject: "stack-a",
				labelDCMManaged:   "true",
				labelDCMTier:      tierTask,
			},
			ImageLabels: map[string]string{},
		},
		{
			ID:        "platform-api-b",
			Name:      "other-platform-api",
			Image:     "ghcr.io/agirunner/agirunner-platform-api:9.9.9",
			State:     "running",
			Status:    "Up 2 minutes",
			StartedAt: startedAt.Add(5 * time.Minute),
			Labels: map[string]string{
				labelStackProject: "stack-b",
				labelComponent:    componentPlatformAPI,
			},
			ImageLabels: map[string]string{
				labelOCIVersion: "9.9.9",
			},
		},
	}, "stack-a")

	if summary.PlatformAPI == nil {
		t.Fatal("expected platform api component in summary")
	}
	if summary.PlatformAPI.Version != "0.1.0-rc.1" {
		t.Fatalf("expected platform api version 0.1.0-rc.1, got %q", summary.PlatformAPI.Version)
	}
	if summary.PlatformAPI.Revision != "2e7df3c98765" {
		t.Fatalf("expected platform api revision from OCI label, got %q", summary.PlatformAPI.Revision)
	}

	if summary.Dashboard == nil {
		t.Fatal("expected dashboard component in summary")
	}
	if summary.Dashboard.Version != "local" {
		t.Fatalf("expected dashboard local fallback version, got %q", summary.Dashboard.Version)
	}
	if summary.Dashboard.Revision != "unlabeled" {
		t.Fatalf("expected dashboard unlabeled revision fallback, got %q", summary.Dashboard.Revision)
	}

	if summary.ContainerManager == nil {
		t.Fatal("expected container manager component in summary")
	}
	if summary.ContainerManager.Version != "latest" {
		t.Fatalf("expected container manager tag-derived version latest, got %q", summary.ContainerManager.Version)
	}

	if len(summary.Runtimes) != 1 {
		t.Fatalf("expected one runtime version group, got %d", len(summary.Runtimes))
	}

	runtime := summary.Runtimes[0]
	if runtime.Version != "0.1.0-rc.1" {
		t.Fatalf("expected runtime group version 0.1.0-rc.1, got %q", runtime.Version)
	}
	if runtime.Revision != "abc123456789" {
		t.Fatalf("expected runtime group revision from OCI label, got %q", runtime.Revision)
	}
	if runtime.TotalContainers != 2 {
		t.Fatalf("expected runtime group count 2, got %d", runtime.TotalContainers)
	}
	if runtime.OrchestratorContainers != 1 {
		t.Fatalf("expected one orchestrator runtime, got %d", runtime.OrchestratorContainers)
	}
	if runtime.SpecialistRuntimeContainers != 1 {
		t.Fatalf("expected one specialist runtime, got %d", runtime.SpecialistRuntimeContainers)
	}
}
