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
			{RuntimeID: "rt-1", TemplateID: "tmpl-1", State: "executing", LastHeartbeatAt: recentHeartbeat},
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
			{RuntimeID: "rt-1", TemplateID: "tmpl-1", State: "executing"},
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
			{RuntimeID: "rt-exec", TemplateID: "tmpl-1", State: "executing", LastHeartbeatAt: recentHeartbeat},
			{RuntimeID: "rt-idle", TemplateID: "tmpl-1", State: "idle", LastHeartbeatAt: recentHeartbeat},
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
