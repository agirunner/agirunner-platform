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

func TestDCMColdIdleTeardown(t *testing.T) {
	docker := newMockDockerClient()
	docker.containers = []ContainerInfo{
		makeDCMContainer("c-1", "tmpl-1", "runtime:v1", "rt-1"),
		makeDCMContainer("c-2", "tmpl-1", "runtime:v1", "rt-2"),
	}
	target := makeRuntimeTarget("tmpl-1", "runtime:v1", 5, 0, 10)
	target.PoolMode = "cold"
	target.IdleTimeoutSeconds = 60
	recentTimestamp := time.Now().UTC().Format(time.RFC3339)
	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{target},
		heartbeats: []RuntimeHeartbeat{
			{RuntimeID: "rt-1", PlaybookID: "tmpl-1", State: "idle", LastHeartbeatAt: recentTimestamp},
			{RuntimeID: "rt-2", PlaybookID: "tmpl-1", State: "idle", LastHeartbeatAt: recentTimestamp},
		},
	}
	mgr := newDCMTestManager(docker, platform)
	// Pre-seed idle tracking as if both runtimes entered idle 65s ago.
	idleSince := time.Now().Add(-65 * time.Second)
	mgr.idleSince["rt-1"] = idleSince
	mgr.idleSince["rt-2"] = idleSince

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
	if len(docker.removedIDs) != 1 || docker.removedIDs[0] != "task-1" {
		t.Errorf("expected orphan task-1 removed, got %v", docker.removedIDs)
	}
}

func TestDCMOrphanTaskCleanupSupportsLegacyParentRuntimeLabels(t *testing.T) {
	docker := newMockDockerClient()
	docker.containers = []ContainerInfo{
		makeLegacyDCMTaskContainer("task-parent-runtime", "agirunner.parent_runtime", "dead-runtime-id-1"),
		makeLegacyDCMTaskContainer("task-instance-id", "agirunner.runtime.instance_id", "dead-runtime-id-2"),
	}
	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{},
	}
	mgr := newDCMTestManager(docker, platform)

	err := mgr.reconcileDCM(context.Background())

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(docker.removedIDs) != 2 {
		t.Fatalf("expected 2 legacy orphan tasks removed, got %v", docker.removedIDs)
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
	spec := docker.createdSpecs[0]
	if env["AGIRUNNER_RUNTIME_PLATFORM_API_URL"] != "http://localhost:8080" {
		t.Errorf("wrong platform URL: %s", env["AGIRUNNER_RUNTIME_PLATFORM_API_URL"])
	}
	if env["AGIRUNNER_RUNTIME_PLATFORM_ROUTING_TAGS"] != "role:developer,role:reviewer" {
		t.Errorf("wrong routing tags: %s", env["AGIRUNNER_RUNTIME_PLATFORM_ROUTING_TAGS"])
	}
	if env["AGIRUNNER_RUNTIME_PLATFORM_ADMIN_API_KEY"] != "test-admin-key" {
		t.Errorf("wrong admin API key: %s", env["AGIRUNNER_RUNTIME_PLATFORM_ADMIN_API_KEY"])
	}
	if filter := env["AGIRUNNER_RUNTIME_PLATFORM_PLAYBOOK_FILTER"]; filter != "" {
		t.Errorf("expected no playbook filter for generic specialist runtimes, got %s", filter)
	}
	if env["AGIRUNNER_RUNTIME_PLATFORM_RUNTIME_ID"] == "" {
		t.Error("expected runtime ID to be set")
	}
	if env[envRuntimeWorkerName] != spec.Name {
		t.Fatalf("expected worker name %q, got %q", spec.Name, env[envRuntimeWorkerName])
	}
	if env["DOCKER_HOST"] == "" {
		t.Error("expected DOCKER_HOST to be set")
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
	if labels[labelDCMPlaybookID] != "tmpl-1" {
		t.Errorf("expected template ID tmpl-1, got %s", labels[labelDCMPlaybookID])
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

// --- Rolling update (drain-and-replace) tests ---

func makeDrainingDCMContainer(id, templateID, image, runtimeID string) ContainerInfo {
	c := makeDCMContainer(id, templateID, image, runtimeID)
	c.Labels[labelDCMDraining] = "true"
	return c
}

func TestDriftIdleRuntimeDestroyedImmediately(t *testing.T) {
	docker := newMockDockerClient()
	docker.containers = []ContainerInfo{
		makeDCMContainer("c-1", "tmpl-1", "runtime:v1", "rt-1"),
	}
	// No heartbeat for rt-1 means idle.
	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{
			makeRuntimeTarget("tmpl-1", "runtime:v2", 5, 0, 10),
		},
	}
	mgr := newDCMTestManager(docker, platform)

	err := mgr.reconcileDCM(context.Background())

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(docker.stoppedIDs) != 1 || docker.stoppedIDs[0] != "c-1" {
		t.Errorf("expected idle drifted container stopped, got %v", docker.stoppedIDs)
	}
	if len(platform.drainedRuntimes) != 0 {
		t.Errorf("expected no drain API calls for idle runtime, got %v", platform.drainedRuntimes)
	}
	// Replacement should be created.
	if len(docker.createdSpecs) != 1 {
		t.Errorf("expected 1 replacement created, got %d", len(docker.createdSpecs))
	}
	if len(docker.createdSpecs) > 0 && docker.createdSpecs[0].Image != "runtime:v2" {
		t.Errorf("expected replacement image runtime:v2, got %s", docker.createdSpecs[0].Image)
	}
}

func TestDriftExecutingRuntimeDrainedNotDestroyed(t *testing.T) {
	docker := newMockDockerClient()
	docker.containers = []ContainerInfo{
		makeDCMContainer("c-1", "tmpl-1", "runtime:v1", "rt-1"),
	}
	recentHeartbeat := time.Now().UTC().Format(time.RFC3339)
	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{
			makeRuntimeTarget("tmpl-1", "runtime:v2", 5, 0, 10),
		},
		heartbeats: []RuntimeHeartbeat{
			{RuntimeID: "rt-1", PlaybookID: "tmpl-1", State: "executing", LastHeartbeatAt: recentHeartbeat},
		},
	}
	mgr := newDCMTestManager(docker, platform)

	err := mgr.reconcileDCM(context.Background())

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(docker.stoppedIDs) != 0 {
		t.Errorf("expected executing container NOT stopped, got %v", docker.stoppedIDs)
	}
	if len(platform.drainedRuntimes) != 1 || platform.drainedRuntimes[0] != "rt-1" {
		t.Errorf("expected drain API called for rt-1, got %v", platform.drainedRuntimes)
	}
	if len(docker.updatedLabels) != 1 {
		t.Fatalf("expected 1 label update, got %d", len(docker.updatedLabels))
	}
	if docker.updatedLabels[0].Labels[labelDCMDraining] != "true" {
		t.Errorf("expected draining label set to true")
	}
}

func TestDriftAlreadyDrainingContainerSkipped(t *testing.T) {
	docker := newMockDockerClient()
	docker.containers = []ContainerInfo{
		makeDrainingDCMContainer("c-1", "tmpl-1", "runtime:v1", "rt-1"),
	}
	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{
			makeRuntimeTarget("tmpl-1", "runtime:v2", 5, 0, 10),
		},
		heartbeats: []RuntimeHeartbeat{
			{RuntimeID: "rt-1", PlaybookID: "tmpl-1", State: "executing"},
		},
	}
	mgr := newDCMTestManager(docker, platform)

	err := mgr.reconcileDCM(context.Background())

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(docker.stoppedIDs) != 0 {
		t.Errorf("expected no stops for already-draining container, got %v", docker.stoppedIDs)
	}
	if len(platform.drainedRuntimes) != 0 {
		t.Errorf("expected no drain calls for already-draining container, got %v", platform.drainedRuntimes)
	}
}

func TestDriftMixedIdleAndExecuting(t *testing.T) {
	docker := newMockDockerClient()
	docker.containers = []ContainerInfo{
		makeDCMContainer("c-idle", "tmpl-1", "runtime:v1", "rt-idle"),
		makeDCMContainer("c-exec", "tmpl-1", "runtime:v1", "rt-exec"),
	}
	recentHeartbeat := time.Now().UTC().Format(time.RFC3339)
	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{
			makeRuntimeTarget("tmpl-1", "runtime:v2", 5, 0, 10),
		},
		heartbeats: []RuntimeHeartbeat{
			{RuntimeID: "rt-exec", PlaybookID: "tmpl-1", State: "executing", LastHeartbeatAt: recentHeartbeat},
			{RuntimeID: "rt-idle", PlaybookID: "tmpl-1", State: "idle", LastHeartbeatAt: recentHeartbeat},
		},
	}
	mgr := newDCMTestManager(docker, platform)

	err := mgr.reconcileDCM(context.Background())

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	// Idle should be destroyed (drift handling uses heartbeat state, not
	// heartbeat freshness — rt-idle has a recent heartbeat with state "idle").
	if len(docker.stoppedIDs) != 1 || docker.stoppedIDs[0] != "c-idle" {
		t.Errorf("expected only idle container stopped, got %v", docker.stoppedIDs)
	}
	// Executing should be drained.
	if len(platform.drainedRuntimes) != 1 || platform.drainedRuntimes[0] != "rt-exec" {
		t.Errorf("expected drain for rt-exec, got %v", platform.drainedRuntimes)
	}
	// Replacement created only for the destroyed idle one.
	if len(docker.createdSpecs) != 1 {
		t.Errorf("expected 1 replacement for idle, got %d", len(docker.createdSpecs))
	}
}

func TestDrainingContainerCountsTowardGlobalButNotTemplateActive(t *testing.T) {
	// 1 active + 1 draining for tmpl-1. Global max = 4.
	// Target wants max_runtimes=3 with pending_tasks=2.
	// Active count for template is 1 (draining excluded), so scaleUp can add.
	// But draining still counts toward globalMax.
	docker := newMockDockerClient()
	docker.containers = []ContainerInfo{
		makeDCMContainer("c-1", "tmpl-1", "runtime:v2", "rt-1"),
		makeDrainingDCMContainer("c-2", "tmpl-1", "runtime:v1", "rt-2"),
	}
	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{
			makeRuntimeTarget("tmpl-1", "runtime:v2", 3, 2, 10),
		},
	}
	mgr := newDCMTestManager(docker, platform)
	mgr.config.GlobalMaxRuntimes = 4

	err := mgr.reconcileDCM(context.Background())

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	// Should create containers but respect global max.
	// totalRunning=2, capacity=4-2=2, max_runtimes=3, running=2, toCreate=min(3-2,2,2)=1
	if len(docker.createdSpecs) != 1 {
		t.Errorf("expected 1 container created (respecting global max), got %d", len(docker.createdSpecs))
	}
}

func TestBuildHeartbeatMap(t *testing.T) {
	heartbeats := []RuntimeHeartbeat{
		{RuntimeID: "rt-1", State: "idle"},
		{RuntimeID: "rt-2", State: "executing"},
	}

	m := buildHeartbeatMap(heartbeats)

	if len(m) != 2 {
		t.Fatalf("expected 2 entries, got %d", len(m))
	}
	if m["rt-1"].State != "idle" {
		t.Errorf("expected rt-1 state idle, got %s", m["rt-1"].State)
	}
	if m["rt-2"].State != "executing" {
		t.Errorf("expected rt-2 state executing, got %s", m["rt-2"].State)
	}
}

func TestCreateRuntimeContainersSetsDockerLogRotation(t *testing.T) {
	docker := newMockDockerClient()
	mgr := newDCMTestManager(docker, &mockPlatformClient{})

	created := mgr.createRuntimeContainers(context.Background(), makeRuntimeTarget("tmpl-1", "runtime:v1", 1, 0, 10), 1)

	if created != 1 {
		t.Fatalf("expected one runtime created, got %d", created)
	}
	if len(docker.createdSpecs) != 1 {
		t.Fatalf("expected one created spec, got %d", len(docker.createdSpecs))
	}
	if docker.createdSpecs[0].LogMaxSize != "10m" {
		t.Fatalf("expected runtime log max size 10m, got %q", docker.createdSpecs[0].LogMaxSize)
	}
	if docker.createdSpecs[0].LogMaxFiles != "3" {
		t.Fatalf("expected runtime log max files 3, got %q", docker.createdSpecs[0].LogMaxFiles)
	}
}

func TestIsExecutingRuntime(t *testing.T) {
	hbMap := map[string]RuntimeHeartbeat{
		"rt-exec": {RuntimeID: "rt-exec", State: "executing"},
		"rt-idle": {RuntimeID: "rt-idle", State: "idle"},
	}

	if !isExecutingRuntime("rt-exec", hbMap) {
		t.Error("expected rt-exec to be executing")
	}
	if isExecutingRuntime("rt-idle", hbMap) {
		t.Error("expected rt-idle to not be executing")
	}
	if isExecutingRuntime("rt-unknown", hbMap) {
		t.Error("expected unknown runtime to not be executing")
	}
}

func TestCountDrainingContainers(t *testing.T) {
	containers := []ContainerInfo{
		makeDCMContainer("c-1", "tmpl-1", "runtime:v1", "rt-1"),
		makeDrainingDCMContainer("c-2", "tmpl-1", "runtime:v1", "rt-2"),
		makeDrainingDCMContainer("c-3", "tmpl-1", "runtime:v1", "rt-3"),
	}

	if count := countDrainingContainers(containers); count != 2 {
		t.Errorf("expected 2 draining, got %d", count)
	}
}

func TestCountActiveContainers(t *testing.T) {
	containers := []ContainerInfo{
		makeDCMContainer("c-1", "tmpl-1", "runtime:v1", "rt-1"),
		makeDrainingDCMContainer("c-2", "tmpl-1", "runtime:v1", "rt-2"),
		makeDCMContainer("c-3", "tmpl-1", "runtime:v1", "rt-3"),
	}

	if count := countActiveContainers(containers); count != 2 {
		t.Errorf("expected 2 active, got %d", count)
	}
}

func TestHeartbeatFetchErrorDoesNotBlockReconcile(t *testing.T) {
	docker := newMockDockerClient()
	docker.containers = []ContainerInfo{
		makeDCMContainer("c-1", "tmpl-1", "runtime:v1", "rt-1"),
	}
	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{
			makeRuntimeTarget("tmpl-1", "runtime:v2", 5, 0, 10),
		},
		fetchHBErr: fmt.Errorf("heartbeat service down"),
	}
	mgr := newDCMTestManager(docker, platform)

	err := mgr.reconcileDCM(context.Background())

	if err != nil {
		t.Fatalf("expected no error despite heartbeat failure, got %v", err)
	}
	// Without heartbeats, drifted container treated as idle and destroyed.
	if len(docker.stoppedIDs) != 1 {
		t.Errorf("expected 1 container stopped (treated as idle), got %d", len(docker.stoppedIDs))
	}
}

func TestDriftReplacementRespectsGlobalMax(t *testing.T) {
	docker := newMockDockerClient()
	// 9 containers already running, global max is 10.
	// 1 is drifted and idle — destroy + replace should work (9-1+1=9).
	existing := makeDCMContainers("tmpl-0", "other:v1", 8)
	existing = append(existing, makeDCMContainer("c-drift", "tmpl-1", "runtime:v1", "rt-drift"))
	docker.containers = existing

	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{
			makeRuntimeTarget("tmpl-1", "runtime:v2", 5, 0, 10),
		},
	}
	mgr := newDCMTestManager(docker, platform)

	err := mgr.reconcileDCM(context.Background())

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(docker.stoppedIDs) != 1 {
		t.Errorf("expected 1 drifted stopped, got %d", len(docker.stoppedIDs))
	}
	// Should create replacement (global was 9, destroyed 1 → 8, create 1 → 9).
	if len(docker.createdSpecs) != 1 {
		t.Errorf("expected 1 replacement, got %d", len(docker.createdSpecs))
	}
}

// --- Idle timeout enforcement tests ---

func TestIsIdlePastTimeoutReturnsTrueAfterContinuousIdle(t *testing.T) {
	mgr := newDCMTestManager(newMockDockerClient(), &mockPlatformClient{})
	heartbeats := map[string]RuntimeHeartbeat{
		"rt-1": {RuntimeID: "rt-1", State: "idle", LastHeartbeatAt: time.Now().Format(time.RFC3339)},
	}

	// First call starts tracking
	t0 := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	mgr.nowFunc = func() time.Time { return t0 }
	if mgr.isIdlePastTimeout("rt-1", heartbeats, 60, t0) {
		t.Error("should NOT be expired on first observation")
	}

	// 59s later: still not expired
	t59 := t0.Add(59 * time.Second)
	if mgr.isIdlePastTimeout("rt-1", heartbeats, 60, t59) {
		t.Error("should NOT be expired at 59s")
	}

	// 60s later: expired
	t60 := t0.Add(60 * time.Second)
	if !mgr.isIdlePastTimeout("rt-1", heartbeats, 60, t60) {
		t.Error("expected idle runtime to be expired after 60s continuous idle")
	}
}

func TestIsIdlePastTimeoutResetsWhenExecuting(t *testing.T) {
	mgr := newDCMTestManager(newMockDockerClient(), &mockPlatformClient{})
	t0 := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)

	idleHB := map[string]RuntimeHeartbeat{
		"rt-1": {RuntimeID: "rt-1", State: "idle", LastHeartbeatAt: t0.Format(time.RFC3339)},
	}
	execHB := map[string]RuntimeHeartbeat{
		"rt-1": {RuntimeID: "rt-1", State: "executing", LastHeartbeatAt: t0.Format(time.RFC3339)},
	}

	// Start idle tracking
	mgr.isIdlePastTimeout("rt-1", idleHB, 60, t0)

	// After 30s, runtime starts executing — resets tracking
	mgr.isIdlePastTimeout("rt-1", execHB, 60, t0.Add(30*time.Second))

	// Back to idle 31s later — tracking restarts from new time
	t61 := t0.Add(61 * time.Second)
	if mgr.isIdlePastTimeout("rt-1", idleHB, 60, t61) {
		t.Error("should NOT be expired — idle tracking was reset when executing")
	}

	// Another 60s of continuous idle — now expired
	t121 := t0.Add(121 * time.Second)
	if !mgr.isIdlePastTimeout("rt-1", idleHB, 60, t121) {
		t.Error("expected idle runtime to expire after 60s from re-entering idle")
	}
}

func TestIsIdlePastTimeoutReturnsFalseWhenNoHeartbeat(t *testing.T) {
	mgr := newDCMTestManager(newMockDockerClient(), &mockPlatformClient{})
	now := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	heartbeats := map[string]RuntimeHeartbeat{}

	if mgr.isIdlePastTimeout("rt-1", heartbeats, 60, now) {
		t.Error("expected runtime without heartbeat to NOT be expired")
	}
}

func TestColdIdleNotDestroyedBeforeTimeout(t *testing.T) {
	docker := newMockDockerClient()
	docker.containers = []ContainerInfo{
		makeDCMContainer("c-1", "tmpl-1", "runtime:v1", "rt-1"),
	}
	target := makeRuntimeTarget("tmpl-1", "runtime:v1", 5, 0, 10)
	target.PoolMode = "cold"
	target.IdleTimeoutSeconds = 300
	// Heartbeat is only 30s old — well within the 300s timeout.
	recentTimestamp := time.Now().Add(-30 * time.Second).UTC().Format(time.RFC3339)
	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{target},
		heartbeats: []RuntimeHeartbeat{
			{RuntimeID: "rt-1", PlaybookID: "tmpl-1", State: "idle", LastHeartbeatAt: recentTimestamp},
		},
	}
	mgr := newDCMTestManager(docker, platform)

	err := mgr.reconcileDCM(context.Background())

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(docker.stoppedIDs) != 0 {
		t.Errorf("expected 0 containers stopped (idle < timeout), got %d", len(docker.stoppedIDs))
	}
}

func TestColdIdleNoHeartbeatNotDestroyed(t *testing.T) {
	docker := newMockDockerClient()
	docker.containers = []ContainerInfo{
		makeDCMContainer("c-1", "tmpl-1", "runtime:v1", "rt-1"),
	}
	target := makeRuntimeTarget("tmpl-1", "runtime:v1", 5, 0, 10)
	target.PoolMode = "cold"
	target.IdleTimeoutSeconds = 60
	// No heartbeats — newly created runtime, should NOT be destroyed.
	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{target},
	}
	mgr := newDCMTestManager(docker, platform)

	err := mgr.reconcileDCM(context.Background())

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(docker.stoppedIDs) != 0 {
		t.Errorf("expected 0 containers stopped (no heartbeat = new runtime), got %d", len(docker.stoppedIDs))
	}
}

// --- Heartbeat fallback tests ---

func TestFallbackHeartbeatNotTriggeredBeforeGracePeriod(t *testing.T) {
	docker := newMockDockerClient()
	docker.containers = []ContainerInfo{
		makeDCMContainer("c-1", "tmpl-1", "runtime:v1", "rt-1"),
	}
	target := makeRuntimeTarget("tmpl-1", "runtime:v1", 5, 0, 10)
	target.PoolMode = "cold"
	target.IdleTimeoutSeconds = 60
	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{target},
		fetchHBErr:     fmt.Errorf("heartbeat API unavailable"),
	}
	mgr := newDCMTestManager(docker, platform)

	// First reconcile — starts tracking, but the configured stop timeout hasn't elapsed.
	err := mgr.reconcileDCM(context.Background())

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(docker.stoppedIDs) != 0 {
		t.Errorf("expected 0 containers stopped (within grace period), got %d", len(docker.stoppedIDs))
	}
}

func TestFallbackHeartbeatDestroysIdleAfterGracePeriod(t *testing.T) {
	docker := newMockDockerClient()
	docker.containers = []ContainerInfo{
		makeDCMContainer("c-1", "tmpl-1", "runtime:v1", "rt-1"),
	}
	target := makeRuntimeTarget("tmpl-1", "runtime:v1", 5, 0, 10)
	target.PoolMode = "cold"
	target.IdleTimeoutSeconds = 60
	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{target},
		fetchHBErr:     fmt.Errorf("heartbeat API unavailable"),
	}
	mgr := newDCMTestManager(docker, platform)

	// Pre-seed fallback tracking as if it started 4 minutes ago.
	fourMinAgo := time.Now().Add(-4 * time.Minute)
	mgr.failedHeartbeatSince["rt-1"] = fourMinAgo
	// Also pre-seed idle tracking since fallback synthesizes idle entries.
	mgr.idleSince["rt-1"] = fourMinAgo

	err := mgr.reconcileDCM(context.Background())

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(docker.stoppedIDs) != 1 {
		t.Errorf("expected 1 container stopped (past grace + idle timeout), got %d", len(docker.stoppedIDs))
	}
}

func TestFallbackHeartbeatClearedOnSuccessfulFetch(t *testing.T) {
	docker := newMockDockerClient()
	docker.containers = []ContainerInfo{
		makeDCMContainer("c-1", "tmpl-1", "runtime:v1", "rt-1"),
	}
	target := makeRuntimeTarget("tmpl-1", "runtime:v1", 5, 0, 10)
	target.PoolMode = "cold"
	target.IdleTimeoutSeconds = 300
	recentTimestamp := time.Now().Add(-10 * time.Second).UTC().Format(time.RFC3339)
	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{target},
		heartbeats: []RuntimeHeartbeat{
			{RuntimeID: "rt-1", PlaybookID: "tmpl-1", State: "idle", LastHeartbeatAt: recentTimestamp},
		},
	}
	mgr := newDCMTestManager(docker, platform)

	// Pre-seed stale fallback tracking.
	mgr.failedHeartbeatSince["rt-1"] = time.Now().Add(-10 * time.Minute)
	mgr.failedHeartbeatSince["rt-gone"] = time.Now().Add(-10 * time.Minute)

	err := mgr.reconcileDCM(context.Background())

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	// rt-gone should be pruned, rt-1 kept (still active container).
	if _, exists := mgr.failedHeartbeatSince["rt-gone"]; exists {
		t.Error("expected stale fallback entry rt-gone to be pruned")
	}
}

func TestFallbackHeartbeatSkipsDrainingContainers(t *testing.T) {
	docker := newMockDockerClient()
	docker.containers = []ContainerInfo{
		makeDrainingDCMContainer("c-1", "tmpl-1", "runtime:v1", "rt-1"),
	}
	target := makeRuntimeTarget("tmpl-1", "runtime:v1", 5, 0, 10)
	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{target},
		fetchHBErr:     fmt.Errorf("heartbeat API unavailable"),
	}
	mgr := newDCMTestManager(docker, platform)
	mgr.failedHeartbeatSince["rt-1"] = time.Now().Add(-10 * time.Minute)

	err := mgr.reconcileDCM(context.Background())

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	// Draining containers should not be affected by fallback.
	if len(docker.stoppedIDs) != 0 {
		t.Errorf("expected 0 containers stopped (draining excluded from fallback), got %d", len(docker.stoppedIDs))
	}
}

// --- Pull fail cache tests ---

func TestPrePullCacheSkipsRecentlyFailedImage(t *testing.T) {
	docker := newMockDockerClient()
	docker.pullErr = fmt.Errorf("pull denied")
	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{},
	}
	mgr := newDCMTestManager(docker, platform)

	target := makeRuntimeTarget("tmpl-1", "runtime:v1", 5, 0, 10)
	target.PoolMode = "warm"

	// First call should attempt and fail.
	mgr.prePullImage(context.Background(), target)
	if len(docker.pulledImages) != 1 {
		t.Fatalf("expected 1 pull attempt, got %d", len(docker.pulledImages))
	}

	// Second call should skip (cached failure).
	mgr.prePullImage(context.Background(), target)
	if len(docker.pulledImages) != 1 {
		t.Errorf("expected still 1 pull attempt (cached), got %d", len(docker.pulledImages))
	}
}

func TestPrePullCacheRetriesAfterTTL(t *testing.T) {
	docker := newMockDockerClient()
	docker.pullErr = fmt.Errorf("pull denied")
	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{},
	}
	mgr := newDCMTestManager(docker, platform)

	target := makeRuntimeTarget("tmpl-1", "runtime:v1", 5, 0, 10)
	target.PoolMode = "warm"

	// First call fails and gets cached.
	mgr.prePullImage(context.Background(), target)
	if len(docker.pulledImages) != 1 {
		t.Fatalf("expected 1 pull attempt, got %d", len(docker.pulledImages))
	}

	// Move time forward past TTL.
	mgr.nowFunc = func() time.Time {
		return time.Now().Add(6 * time.Minute)
	}

	// Should retry after TTL expired.
	mgr.prePullImage(context.Background(), target)
	if len(docker.pulledImages) != 2 {
		t.Errorf("expected 2 pull attempts (retry after TTL), got %d", len(docker.pulledImages))
	}
}

func TestPrePullCacheDoesNotCacheSuccessfulPulls(t *testing.T) {
	docker := newMockDockerClient()
	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{},
	}
	mgr := newDCMTestManager(docker, platform)

	target := makeRuntimeTarget("tmpl-1", "runtime:v1", 5, 0, 10)
	target.PoolMode = "warm"

	// Successful pull — should not be cached.
	mgr.prePullImage(context.Background(), target)
	mgr.prePullImage(context.Background(), target)

	if len(docker.pulledImages) != 2 {
		t.Errorf("expected 2 pull attempts (success not cached), got %d", len(docker.pulledImages))
	}
	if len(mgr.pullFailCache) != 0 {
		t.Errorf("expected empty pull fail cache after success, got %d entries", len(mgr.pullFailCache))
	}
}

func TestComputeColdScaleUpWithPendingTasks(t *testing.T) {
	target := makeRuntimeTarget("tmpl-1", "runtime:v1", 3, 2, 10)
	got := computeScaleUp(target, 0, 10)
	if got != 2 {
		t.Errorf("expected 2, got %d", got)
	}
}

func TestComputeColdScaleUpNoPendingTasks(t *testing.T) {
	target := makeRuntimeTarget("tmpl-1", "runtime:v1", 3, 0, 10)
	got := computeScaleUp(target, 0, 10)
	if got != 0 {
		t.Errorf("expected 0, got %d", got)
	}
}

func TestComputeColdScaleUpCappedByMaxRuntimes(t *testing.T) {
	target := makeRuntimeTarget("tmpl-1", "runtime:v1", 2, 5, 10)
	got := computeScaleUp(target, 1, 10)
	if got != 1 {
		t.Errorf("expected 1 (max 2 - 1 running), got %d", got)
	}
}

func TestComputeWarmScaleUpWithActiveWorkflows(t *testing.T) {
	target := makeRuntimeTarget("tmpl-1", "runtime:v1", 3, 0, 10)
	target.PoolMode = "warm"
	target.ActiveWorkflows = 2
	got := computeScaleUp(target, 0, 10)
	if got != 2 {
		t.Errorf("expected 2 (one per active workflow), got %d", got)
	}
}

func TestComputeWarmScaleUpNoActiveWorkflows(t *testing.T) {
	target := makeRuntimeTarget("tmpl-1", "runtime:v1", 3, 0, 10)
	target.PoolMode = "warm"
	target.ActiveWorkflows = 0
	got := computeScaleUp(target, 0, 10)
	if got != 0 {
		t.Errorf("expected 0 (no active workflows), got %d", got)
	}
}

func TestComputeWarmScaleUpScalesToPendingTasks(t *testing.T) {
	target := makeRuntimeTarget("tmpl-1", "runtime:v1", 5, 3, 10)
	target.PoolMode = "warm"
	target.ActiveWorkflows = 1
	got := computeScaleUp(target, 0, 10)
	if got != 3 {
		t.Errorf("expected 3 (warm scales to current pending work up to max_runtimes), got %d", got)
	}
}

func TestComputeWarmScaleUpCappedByCapacity(t *testing.T) {
	target := makeRuntimeTarget("tmpl-1", "runtime:v1", 5, 0, 10)
	target.PoolMode = "warm"
	target.ActiveWorkflows = 4
	got := computeScaleUp(target, 0, 2)
	if got != 2 {
		t.Errorf("expected 2 (capped by capacity), got %d", got)
	}
}

func TestComputeWarmScaleUpKeepsWorkflowFloorWhenNoPendingTasks(t *testing.T) {
	target := makeRuntimeTarget("tmpl-1", "runtime:v1", 5, 0, 10)
	target.PoolMode = "warm"
	target.ActiveWorkflows = 2
	got := computeScaleUp(target, 0, 10)
	if got != 2 {
		t.Errorf("expected 2 (warm keeps floor for active workflows), got %d", got)
	}
}

func TestComputeWarmScaleUpAlreadyAtMax(t *testing.T) {
	target := makeRuntimeTarget("tmpl-1", "runtime:v1", 1, 0, 10)
	target.PoolMode = "warm"
	target.ActiveWorkflows = 3
	got := computeScaleUp(target, 1, 10)
	if got != 0 {
		t.Errorf("expected 0 (already at max), got %d", got)
	}
}
