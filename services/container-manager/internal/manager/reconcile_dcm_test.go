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
		PlatformAPIURL:           "http://localhost:8080",
		PlatformAdminAPIKey:      "test-admin-key",
		DockerHost:               "tcp://localhost:2375",
		ReconcileInterval:        5 * time.Second,
		StopTimeout:              10 * time.Second,
		ShutdownTaskStopTimeout:  2 * time.Second,
		DockerActionBuffer:       1 * time.Second,
		StarvationThreshold:      60 * time.Second,
		HungRuntimeStaleAfter:    90 * time.Second,
		HungRuntimeStopGrace:     30 * time.Second,
		GlobalMaxRuntimes:        10,
		RuntimeLogMaxSizeMB:      10,
		RuntimeLogMaxFiles:       3,
		RuntimeOrphanGraceCycles: 3,
	}
	return NewWithPlatform(cfg, docker, platform, logger)
}

func makeRuntimeTarget(templateID, image string, maxRuntimes, pending, priority int) RuntimeTarget {
	return RuntimeTarget{
		PlaybookID:         templateID,
		PlaybookName:       "template-" + templateID,
		PoolKind:           "specialist",
		RoutingTags:        []string{"role:developer", "role:reviewer"},
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
			labelDCMPlaybookID: templateID,
			labelDCMPoolKind:   "specialist",
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
			labelDCMManaged:   "true",
			labelDCMTier:      tierTask,
			labelDCMRuntimeID: runtimeID,
			labelManagedBy:    "true",
		},
	}
}

func makeLegacyDCMTaskContainer(id, parentLabel, runtimeID string) ContainerInfo {
	container := makeDCMTaskContainer(id, runtimeID)
	delete(container.Labels, labelDCMManaged)
	delete(container.Labels, labelDCMRuntimeID)
	container.Labels["agirunner.runtime.managed"] = "true"
	container.Labels[parentLabel] = runtimeID
	return container
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

func TestDCMReconcileTreatsOrchestratorAndSpecialistPoolsAsDistinctTargets(t *testing.T) {
	docker := newMockDockerClient()
	orchTarget := makeRuntimeTarget("tmpl-1", "runtime:v1", 1, 1, 20)
	orchTarget.PoolKind = "orchestrator"
	specTarget := makeRuntimeTarget("tmpl-1", "runtime:v1", 2, 2, 10)
	specTarget.PoolKind = "specialist"
	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{orchTarget, specTarget},
	}
	mgr := newDCMTestManager(docker, platform)

	err := mgr.reconcileDCM(context.Background())

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(docker.createdSpecs) != 3 {
		t.Fatalf("expected 3 containers across two pools, got %d", len(docker.createdSpecs))
	}

	var orchestratorCreated bool
	var specialistCreated bool
	for _, spec := range docker.createdSpecs {
		switch spec.Labels[labelDCMPoolKind] {
		case "orchestrator":
			orchestratorCreated = true
			if spec.Environment["AGIRUNNER_RUNTIME_PLATFORM_AGENT_EXECUTION_MODE"] != "orchestrator" {
				t.Fatalf("expected orchestrator execution mode, got %q", spec.Environment["AGIRUNNER_RUNTIME_PLATFORM_AGENT_EXECUTION_MODE"])
			}
		case "specialist":
			specialistCreated = true
			if spec.Environment["AGIRUNNER_RUNTIME_PLATFORM_AGENT_EXECUTION_MODE"] != "specialist" {
				t.Fatalf("expected specialist execution mode, got %q", spec.Environment["AGIRUNNER_RUNTIME_PLATFORM_AGENT_EXECUTION_MODE"])
			}
		default:
			t.Fatalf("expected pool kind label on created container, got %q", spec.Labels[labelDCMPoolKind])
		}
	}
	if !orchestratorCreated || !specialistCreated {
		t.Fatalf("expected containers for both orchestrator and specialist pools")
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

func TestDCMScaleCapAtAvailableExecutionSlots(t *testing.T) {
	docker := newMockDockerClient()
	target := makeRuntimeTarget("tmpl-1", "runtime:v1", 5, 4, 10)
	availableSlots := 2
	target.AvailableExecutionSlots = &availableSlots
	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{target},
	}
	mgr := newDCMTestManager(docker, platform)

	err := mgr.reconcileDCM(context.Background())

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(docker.createdSpecs) != 2 {
		t.Errorf("expected 2 containers (capped by execution slots), got %d", len(docker.createdSpecs))
	}
}

func TestDCMColdScaleDoesNotDuplicateBootstrapingRuntime(t *testing.T) {
	docker := newMockDockerClient()
	docker.containers = []ContainerInfo{
		makeDCMContainer("c-1", "tmpl-1", "runtime:v1", "rt-1"),
	}
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
	if len(docker.createdSpecs) != 0 {
		t.Fatalf("expected no extra runtimes while a bootstraping specialist is already available, got %d", len(docker.createdSpecs))
	}
}

func TestDCMColdScaleCreatesWhenAllRunningSpecialistsAreExecuting(t *testing.T) {
	docker := newMockDockerClient()
	docker.containers = []ContainerInfo{
		makeDCMContainer("c-1", "tmpl-1", "runtime:v1", "rt-1"),
	}
	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{
			makeRuntimeTarget("tmpl-1", "runtime:v1", 5, 1, 10),
		},
		heartbeats: []RuntimeHeartbeat{
			{
				RuntimeID:       "rt-1",
				PlaybookID:      "tmpl-1",
				PoolKind:        "specialist",
				State:           "executing",
				LastHeartbeatAt: time.Now().UTC().Format(time.RFC3339),
			},
		},
	}
	mgr := newDCMTestManager(docker, platform)

	err := mgr.reconcileDCM(context.Background())

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(docker.createdSpecs) != 1 {
		t.Fatalf("expected 1 extra runtime when the only running specialist is executing, got %d", len(docker.createdSpecs))
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

func TestDCMRemovesTerminalRuntimeContainersBeforeScaling(t *testing.T) {
	docker := newMockDockerClient()
	stopped := makeDCMContainer("c-stopped", "tmpl-1", "runtime:v1", "rt-stopped")
	stopped.Status = "Exited (0) 5 seconds ago"
	docker.containers = []ContainerInfo{stopped}
	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{
			makeRuntimeTarget("tmpl-1", "runtime:v1", 1, 1, 10),
		},
	}
	mgr := newDCMTestManager(docker, platform)

	err := mgr.reconcileDCM(context.Background())

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(docker.removedIDs) != 1 || docker.removedIDs[0] != "c-stopped" {
		t.Fatalf("expected terminal runtime c-stopped to be removed, got %#v", docker.removedIDs)
	}
	if len(docker.createdSpecs) != 1 {
		t.Fatalf("expected 1 replacement runtime created after terminal cleanup, got %d", len(docker.createdSpecs))
	}
}
