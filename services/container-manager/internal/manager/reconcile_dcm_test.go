package manager

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"testing"
	"time"
)

func newDCMTestManager(docker *mockDockerClient, platform *mockPlatformClient) *Manager {
	logger := slog.New(slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError}))
	cfg := Config{
		PlatformAPIURL:      "http://localhost:8080",
		PlatformAdminAPIKey: "test-admin-key",
		DockerHost:          "tcp://localhost:2375",
		ReconcileInterval:   5 * time.Second,
		StopTimeout:         10 * time.Second,
		GlobalMaxRuntimes:   10,
	}
	return NewWithPlatform(cfg, docker, platform, logger)
}

func makeRuntimeTarget(templateID, image string, maxRuntimes, pending, priority int) RuntimeTarget {
	return RuntimeTarget{
		TemplateID:         templateID,
		TemplateName:       "template-" + templateID,
		PoolMode:           "cold",
		MaxRuntimes:        maxRuntimes,
		Priority:           priority,
		IdleTimeoutSeconds: 300,
		GracePeriodSeconds: 30,
		Image:              image,
		PullPolicy:         "always",
		CPU:                "1",
		Memory:             "512m",
		PendingTasks:       pending,
		ActiveWorkflows:    0,
	}
}

func makeDCMContainer(id, templateID, image, runtimeID string) ContainerInfo {
	return ContainerInfo{
		ID:     id,
		Name:   "runtime-" + id,
		Image:  image,
		Status: "Up 5 minutes",
		Labels: map[string]string{
			labelDCMManaged:    "true",
			labelDCMTier:       tierRuntime,
			labelDCMTemplateID: templateID,
			labelDCMRuntimeID:  runtimeID,
			labelDCMImage:      image,
			labelManagedBy:     "true",
		},
	}
}

func makeDCMTaskContainer(id, runtimeID string) ContainerInfo {
	return ContainerInfo{
		ID:     id,
		Name:   "task-" + id,
		Image:  "task-image:v1",
		Status: "Up 1 minute",
		Labels: map[string]string{
			labelDCMManaged:    "true",
			labelDCMTier:       tierTask,
			labelDCMRuntimeID:  runtimeID,
			labelManagedBy:     "true",
		},
	}
}

// makeDCMContainers creates n DCM containers for a template.
func makeDCMContainers(templateID, image string, count int) []ContainerInfo {
	containers := make([]ContainerInfo, count)
	for i := 0; i < count; i++ {
		id := fmt.Sprintf("c-%s-%d", templateID, i)
		rtID := fmt.Sprintf("rt-%s-%d", templateID, i)
		containers[i] = makeDCMContainer(id, templateID, image, rtID)
	}
	return containers
}

func TestDCMScaleUpWhenPendingExceedsRunning(t *testing.T) {
	docker := newMockDockerClient()
	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{
			makeRuntimeTarget("tmpl-1", "runtime:v1", 5, 3, 10),
		},
	}
	mgr := newDCMTestManager(docker, platform)

	err := mgr.reconcileDCM(context.Background())

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(docker.createdSpecs) != 3 {
		t.Errorf("expected 3 containers created, got %d", len(docker.createdSpecs))
	}
}

func TestDCMScaleCapAtMaxRuntimes(t *testing.T) {
	docker := newMockDockerClient()
	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{
			makeRuntimeTarget("tmpl-1", "runtime:v1", 2, 5, 10),
		},
	}
	mgr := newDCMTestManager(docker, platform)

	err := mgr.reconcileDCM(context.Background())

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(docker.createdSpecs) != 2 {
		t.Errorf("expected 2 containers (capped at max), got %d", len(docker.createdSpecs))
	}
}

func TestDCMScaleCapAtGlobalMax(t *testing.T) {
	docker := newMockDockerClient()
	docker.containers = makeDCMContainers("tmpl-0", "other:v1", 8)
	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{
			makeRuntimeTarget("tmpl-1", "runtime:v1", 5, 5, 10),
		},
	}
	mgr := newDCMTestManager(docker, platform)

	err := mgr.reconcileDCM(context.Background())

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(docker.createdSpecs) != 2 {
		t.Errorf("expected 2 containers (global cap 10 - 8 existing = 2), got %d", len(docker.createdSpecs))
	}
}

func TestDCMColdIdleTeardown(t *testing.T) {
	docker := newMockDockerClient()
	docker.containers = []ContainerInfo{
		makeDCMContainer("c-1", "tmpl-1", "runtime:v1", "rt-1"),
		makeDCMContainer("c-2", "tmpl-1", "runtime:v1", "rt-2"),
	}
	target := makeRuntimeTarget("tmpl-1", "runtime:v1", 5, 0, 10)
	target.PoolMode = "cold"
	target.IdleTimeoutSeconds = 60
	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{target},
	}
	mgr := newDCMTestManager(docker, platform)

	err := mgr.reconcileDCM(context.Background())

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(docker.stoppedIDs) != 2 {
		t.Errorf("expected 2 idle containers stopped, got %d", len(docker.stoppedIDs))
	}
}

func TestDCMWarmPersistenceWithActiveWorkflows(t *testing.T) {
	docker := newMockDockerClient()
	docker.containers = []ContainerInfo{
		makeDCMContainer("c-1", "tmpl-1", "runtime:v1", "rt-1"),
	}
	target := makeRuntimeTarget("tmpl-1", "runtime:v1", 5, 0, 10)
	target.PoolMode = "warm"
	target.ActiveWorkflows = 3
	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{target},
	}
	mgr := newDCMTestManager(docker, platform)

	err := mgr.reconcileDCM(context.Background())

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(docker.stoppedIDs) != 0 {
		t.Errorf("expected no containers stopped (active workflows), got %d", len(docker.stoppedIDs))
	}
}

func TestDCMWarmTeardownNoActiveWorkflows(t *testing.T) {
	docker := newMockDockerClient()
	docker.containers = []ContainerInfo{
		makeDCMContainer("c-1", "tmpl-1", "runtime:v1", "rt-1"),
		makeDCMContainer("c-2", "tmpl-1", "runtime:v1", "rt-2"),
	}
	target := makeRuntimeTarget("tmpl-1", "runtime:v1", 5, 0, 10)
	target.PoolMode = "warm"
	target.ActiveWorkflows = 0
	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{target},
	}
	mgr := newDCMTestManager(docker, platform)

	err := mgr.reconcileDCM(context.Background())

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(docker.stoppedIDs) != 2 {
		t.Errorf("expected 2 containers stopped (warm, no workflows), got %d", len(docker.stoppedIDs))
	}
}

func TestDCMImageDriftDetection(t *testing.T) {
	docker := newMockDockerClient()
	docker.containers = []ContainerInfo{
		makeDCMContainer("c-1", "tmpl-1", "runtime:v1", "rt-1"),
	}
	target := makeRuntimeTarget("tmpl-1", "runtime:v2", 5, 0, 10)
	target.PoolMode = "warm"
	target.ActiveWorkflows = 1
	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{target},
	}
	mgr := newDCMTestManager(docker, platform)

	err := mgr.reconcileDCM(context.Background())

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(docker.stoppedIDs) != 1 {
		t.Errorf("expected 1 drifted container stopped, got %d", len(docker.stoppedIDs))
	}
}

func TestDCMOrphanTaskCleanup(t *testing.T) {
	docker := newMockDockerClient()
	docker.containers = []ContainerInfo{
		makeDCMTaskContainer("task-1", "dead-runtime-id"),
	}
	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{},
	}
	mgr := newDCMTestManager(docker, platform)

	err := mgr.reconcileDCM(context.Background())

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(docker.stoppedIDs) != 1 || docker.stoppedIDs[0] != "task-1" {
		t.Errorf("expected orphan task-1 stopped, got %v", docker.stoppedIDs)
	}
}

func TestDCMNoScaleWhenNoPendingTasks(t *testing.T) {
	docker := newMockDockerClient()
	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{
			makeRuntimeTarget("tmpl-1", "runtime:v1", 5, 0, 10),
		},
	}
	mgr := newDCMTestManager(docker, platform)

	err := mgr.reconcileDCM(context.Background())

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(docker.createdSpecs) != 0 {
		t.Errorf("expected 0 containers created (no pending), got %d", len(docker.createdSpecs))
	}
}

func TestDCMRuntimeContainerHasCorrectEnvVars(t *testing.T) {
	docker := newMockDockerClient()
	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{
			makeRuntimeTarget("tmpl-1", "runtime:v1", 5, 1, 10),
		},
	}
	mgr := newDCMTestManager(docker, platform)

	err := mgr.reconcileDCM(context.Background())

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(docker.createdSpecs) != 1 {
		t.Fatalf("expected 1 container, got %d", len(docker.createdSpecs))
	}
	env := docker.createdSpecs[0].Environment
	if env["AGIRUNNER_RUNTIME_PLATFORM_API_URL"] != "http://localhost:8080" {
		t.Errorf("wrong platform URL: %s", env["AGIRUNNER_RUNTIME_PLATFORM_API_URL"])
	}
	if env["AGIRUNNER_RUNTIME_PLATFORM_ADMIN_API_KEY"] != "test-admin-key" {
		t.Errorf("wrong admin API key: %s", env["AGIRUNNER_RUNTIME_PLATFORM_ADMIN_API_KEY"])
	}
	if env["AGIRUNNER_RUNTIME_TEMPLATE_FILTER"] != "tmpl-1" {
		t.Errorf("wrong template filter: %s", env["AGIRUNNER_RUNTIME_TEMPLATE_FILTER"])
	}
	if env["AGIRUNNER_RUNTIME_ID"] == "" {
		t.Error("expected runtime ID to be set")
	}
}

func TestDCMRuntimeContainerHasCorrectLabels(t *testing.T) {
	docker := newMockDockerClient()
	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{
			makeRuntimeTarget("tmpl-1", "runtime:v1", 5, 1, 10),
		},
	}
	mgr := newDCMTestManager(docker, platform)

	err := mgr.reconcileDCM(context.Background())

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(docker.createdSpecs) != 1 {
		t.Fatalf("expected 1 container, got %d", len(docker.createdSpecs))
	}
	labels := docker.createdSpecs[0].Labels
	if labels[labelDCMManaged] != "true" {
		t.Errorf("expected managed label true, got %s", labels[labelDCMManaged])
	}
	if labels[labelDCMTier] != tierRuntime {
		t.Errorf("expected tier runtime, got %s", labels[labelDCMTier])
	}
	if labels[labelDCMTemplateID] != "tmpl-1" {
		t.Errorf("expected template ID tmpl-1, got %s", labels[labelDCMTemplateID])
	}
	if labels[labelDCMImage] != "runtime:v1" {
		t.Errorf("expected image label runtime:v1, got %s", labels[labelDCMImage])
	}
}

func TestDCMFetchTargetsError(t *testing.T) {
	docker := newMockDockerClient()
	platform := &mockPlatformClient{
		fetchTargetsErr: fmt.Errorf("connection refused"),
	}
	mgr := newDCMTestManager(docker, platform)

	err := mgr.reconcileDCM(context.Background())

	if err == nil {
		t.Fatal("expected error from failed runtime targets fetch")
	}
}

func TestDCMComputeScaleUpRespectsAllLimits(t *testing.T) {
	result := computeScaleUp(RuntimeTarget{PendingTasks: 10, MaxRuntimes: 3}, 1, 5)

	if result != 2 {
		t.Errorf("expected 2 (max 3 - 1 running), got %d", result)
	}
}

func TestDCMComputeScaleUpZeroWhenNoPending(t *testing.T) {
	result := computeScaleUp(RuntimeTarget{PendingTasks: 0, MaxRuntimes: 5}, 0, 10)

	if result != 0 {
		t.Errorf("expected 0 (no pending), got %d", result)
	}
}
