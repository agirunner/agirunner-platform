package manager

import (
	"context"
	"fmt"
	"testing"
)

func makeWarmTarget(templateID, image, taskImage string, warmPoolSize int) RuntimeTarget {
	return RuntimeTarget{
		TemplateID:         templateID,
		TemplateName:       "template-" + templateID,
		PoolMode:           "warm",
		MaxRuntimes:        5,
		Priority:           10,
		IdleTimeoutSeconds: 300,
		GracePeriodSeconds: 30,
		Image:              image,
		TaskImage:          taskImage,
		PullPolicy:         "always",
		CPU:                "1",
		Memory:             "512m",
		WarmPoolSize:       warmPoolSize,
	}
}

func makeWarmTaskContainer(id, templateID string) ContainerInfo {
	return ContainerInfo{
		ID:     id,
		Name:   "warm-task-" + id,
		Image:  "task-image:v1",
		Status: "Up 1 minute",
		Labels: map[string]string{
			labelDCMManaged:    "true",
			labelDCMTier:       tierTask,
			labelDCMTemplateID: templateID,
			labelDCMWarmPool:   "true",
			labelManagedBy:     "true",
		},
	}
}

func TestWarmPoolCreatesCorrectNumberOfContainers(t *testing.T) {
	docker := newMockDockerClient()
	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{
			makeWarmTarget("tmpl-1", "runtime:v1", "task:v1", 3),
		},
	}
	mgr := newDCMTestManager(docker, platform)

	mgr.reconcileWarmTaskPools(context.Background(),
		platform.runtimeTargets, docker.containers)

	warmCreated := countWarmTaskSpecs(docker.createdSpecs)
	if warmCreated != 3 {
		t.Errorf("expected 3 warm task containers created, got %d", warmCreated)
	}

	for _, spec := range docker.createdSpecs {
		assertWarmTaskLabels(t, spec, "tmpl-1")
		if spec.Image != "task:v1" {
			t.Errorf("expected task image task:v1, got %s", spec.Image)
		}
		if spec.CPULimit != "1" {
			t.Errorf("expected CPU limit 1, got %s", spec.CPULimit)
		}
		if spec.MemoryLimit != "512m" {
			t.Errorf("expected memory limit 512m, got %s", spec.MemoryLimit)
		}
	}
}

func TestColdPoolModeCreatesZeroWarmContainers(t *testing.T) {
	docker := newMockDockerClient()
	target := makeWarmTarget("tmpl-1", "runtime:v1", "task:v1", 3)
	target.PoolMode = "cold"

	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{target},
	}
	mgr := newDCMTestManager(docker, platform)

	mgr.reconcileWarmTaskPools(context.Background(),
		platform.runtimeTargets, docker.containers)

	if len(docker.createdSpecs) != 0 {
		t.Errorf("expected 0 warm containers for cold mode, got %d", len(docker.createdSpecs))
	}
}

func TestWarmPoolScalesDownWhenPoolSizeDecreases(t *testing.T) {
	docker := newMockDockerClient()
	docker.containers = []ContainerInfo{
		makeWarmTaskContainer("wt-1", "tmpl-1"),
		makeWarmTaskContainer("wt-2", "tmpl-1"),
		makeWarmTaskContainer("wt-3", "tmpl-1"),
	}
	target := makeWarmTarget("tmpl-1", "runtime:v1", "task:v1", 1)
	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{target},
	}
	mgr := newDCMTestManager(docker, platform)

	mgr.reconcileWarmTaskPools(context.Background(),
		platform.runtimeTargets, docker.containers)

	if len(docker.stoppedIDs) != 2 {
		t.Errorf("expected 2 warm containers stopped (3->1), got %d", len(docker.stoppedIDs))
	}
	if len(docker.createdSpecs) != 0 {
		t.Errorf("expected 0 containers created, got %d", len(docker.createdSpecs))
	}
}

func TestOrphanWarmContainersCleanedUp(t *testing.T) {
	docker := newMockDockerClient()
	docker.containers = []ContainerInfo{
		makeWarmTaskContainer("wt-1", "tmpl-dead"),
		makeWarmTaskContainer("wt-2", "tmpl-dead"),
	}
	// No targets reference tmpl-dead.
	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{
			makeWarmTarget("tmpl-alive", "runtime:v1", "task:v1", 1),
		},
	}
	mgr := newDCMTestManager(docker, platform)

	mgr.reconcileWarmTaskPools(context.Background(),
		platform.runtimeTargets, docker.containers)

	if len(docker.stoppedIDs) != 2 {
		t.Errorf("expected 2 orphan warm containers stopped, got %d", len(docker.stoppedIDs))
	}
}

func TestWarmPoolSkippedWhenTaskImageEmpty(t *testing.T) {
	docker := newMockDockerClient()
	target := makeWarmTarget("tmpl-1", "runtime:v1", "", 3)
	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{target},
	}
	mgr := newDCMTestManager(docker, platform)

	mgr.reconcileWarmTaskPools(context.Background(),
		platform.runtimeTargets, docker.containers)

	if len(docker.createdSpecs) != 0 {
		t.Errorf("expected 0 containers when task image is empty, got %d", len(docker.createdSpecs))
	}
}

func TestWarmPoolAlreadySatisfied(t *testing.T) {
	docker := newMockDockerClient()
	docker.containers = []ContainerInfo{
		makeWarmTaskContainer("wt-1", "tmpl-1"),
		makeWarmTaskContainer("wt-2", "tmpl-1"),
	}
	target := makeWarmTarget("tmpl-1", "runtime:v1", "task:v1", 2)
	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{target},
	}
	mgr := newDCMTestManager(docker, platform)

	mgr.reconcileWarmTaskPools(context.Background(),
		platform.runtimeTargets, docker.containers)

	if len(docker.createdSpecs) != 0 {
		t.Errorf("expected 0 creates when pool already satisfied, got %d", len(docker.createdSpecs))
	}
	if len(docker.stoppedIDs) != 0 {
		t.Errorf("expected 0 stops when pool already satisfied, got %d", len(docker.stoppedIDs))
	}
}

func TestWarmPoolScalesUpPartially(t *testing.T) {
	docker := newMockDockerClient()
	docker.containers = []ContainerInfo{
		makeWarmTaskContainer("wt-1", "tmpl-1"),
	}
	target := makeWarmTarget("tmpl-1", "runtime:v1", "task:v1", 3)
	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{target},
	}
	mgr := newDCMTestManager(docker, platform)

	mgr.reconcileWarmTaskPools(context.Background(),
		platform.runtimeTargets, docker.containers)

	warmCreated := countWarmTaskSpecs(docker.createdSpecs)
	if warmCreated != 2 {
		t.Errorf("expected 2 warm containers created (1 existing, target 3), got %d", warmCreated)
	}
}

func TestWarmPoolZeroSizeRemovesAll(t *testing.T) {
	docker := newMockDockerClient()
	docker.containers = []ContainerInfo{
		makeWarmTaskContainer("wt-1", "tmpl-1"),
		makeWarmTaskContainer("wt-2", "tmpl-1"),
	}
	target := makeWarmTarget("tmpl-1", "runtime:v1", "task:v1", 0)
	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{target},
	}
	mgr := newDCMTestManager(docker, platform)

	mgr.reconcileWarmTaskPools(context.Background(),
		platform.runtimeTargets, docker.containers)

	if len(docker.stoppedIDs) != 2 {
		t.Errorf("expected 2 containers stopped for zero pool size, got %d", len(docker.stoppedIDs))
	}
}

func TestWarmPoolMultipleTemplates(t *testing.T) {
	docker := newMockDockerClient()
	docker.containers = []ContainerInfo{
		makeWarmTaskContainer("wt-1", "tmpl-1"),
	}
	targets := []RuntimeTarget{
		makeWarmTarget("tmpl-1", "runtime:v1", "task:v1", 2),
		makeWarmTarget("tmpl-2", "runtime:v1", "task:v2", 1),
	}
	platform := &mockPlatformClient{runtimeTargets: targets}
	mgr := newDCMTestManager(docker, platform)

	mgr.reconcileWarmTaskPools(context.Background(), targets, docker.containers)

	// tmpl-1: 1 existing, needs 1 more. tmpl-2: 0 existing, needs 1.
	warmCreated := countWarmTaskSpecs(docker.createdSpecs)
	if warmCreated != 2 {
		t.Errorf("expected 2 total warm containers created, got %d", warmCreated)
	}
}

func TestWarmTaskPoolDesiredCountEdgeCases(t *testing.T) {
	tests := []struct {
		name     string
		target   RuntimeTarget
		expected int
	}{
		{
			name:     "cold mode returns zero",
			target:   RuntimeTarget{PoolMode: "cold", TaskImage: "img:v1", WarmPoolSize: 5},
			expected: 0,
		},
		{
			name:     "empty task image returns zero",
			target:   RuntimeTarget{PoolMode: "warm", TaskImage: "", WarmPoolSize: 5},
			expected: 0,
		},
		{
			name:     "negative pool size returns zero",
			target:   RuntimeTarget{PoolMode: "warm", TaskImage: "img:v1", WarmPoolSize: -1},
			expected: 0,
		},
		{
			name:     "zero pool size returns zero",
			target:   RuntimeTarget{PoolMode: "warm", TaskImage: "img:v1", WarmPoolSize: 0},
			expected: 0,
		},
		{
			name:     "valid warm target returns pool size",
			target:   RuntimeTarget{PoolMode: "warm", TaskImage: "img:v1", WarmPoolSize: 3},
			expected: 3,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := warmTaskPoolDesiredCount(tt.target)
			if result != tt.expected {
				t.Errorf("expected %d, got %d", tt.expected, result)
			}
		})
	}
}

func TestIsWarmTaskContainer(t *testing.T) {
	warm := makeWarmTaskContainer("wt-1", "tmpl-1")
	if !isWarmTaskContainer(warm) {
		t.Error("expected warm task container to be identified")
	}

	runtime := makeDCMContainer("c-1", "tmpl-1", "runtime:v1", "rt-1")
	if isWarmTaskContainer(runtime) {
		t.Error("expected runtime container to NOT be identified as warm task")
	}

	regularTask := makeDCMTaskContainer("t-1", "rt-1")
	if isWarmTaskContainer(regularTask) {
		t.Error("expected regular task container to NOT be identified as warm task")
	}
}

func TestWarmPoolIntegrationWithDCMReconcile(t *testing.T) {
	docker := newMockDockerClient()
	target := makeWarmTarget("tmpl-1", "runtime:v1", "task:v1", 2)
	target.PendingTasks = 1
	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{target},
	}
	mgr := newDCMTestManager(docker, platform)

	err := mgr.reconcileDCM(context.Background())
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	runtimeCount := 0
	warmTaskCount := 0
	for _, spec := range docker.createdSpecs {
		if spec.Labels[labelDCMTier] == tierRuntime {
			runtimeCount++
		}
		if spec.Labels[labelDCMTier] == tierTask && spec.Labels[labelDCMWarmPool] == "true" {
			warmTaskCount++
		}
	}
	if runtimeCount != 1 {
		t.Errorf("expected 1 runtime container, got %d", runtimeCount)
	}
	if warmTaskCount != 2 {
		t.Errorf("expected 2 warm task containers, got %d", warmTaskCount)
	}
}

func TestReconcileWarmTaskPoolsFromDockerListError(t *testing.T) {
	docker := newMockDockerClient()
	docker.listErr = fmt.Errorf("docker socket closed")
	target := makeWarmTarget("tmpl-1", "runtime:v1", "task:v1", 3)
	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{target},
	}
	mgr := newDCMTestManager(docker, platform)

	mgr.reconcileWarmTaskPoolsFromDocker(context.Background(), platform.runtimeTargets)

	if len(docker.createdSpecs) != 0 {
		t.Errorf("expected 0 containers created when ListContainers fails, got %d", len(docker.createdSpecs))
	}
}

func TestReconcileWarmTaskPoolsFromDockerDelegatesToReconcile(t *testing.T) {
	docker := newMockDockerClient()
	docker.containers = []ContainerInfo{
		makeWarmTaskContainer("wt-1", "tmpl-1"),
	}
	target := makeWarmTarget("tmpl-1", "runtime:v1", "task:v1", 3)
	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{target},
	}
	mgr := newDCMTestManager(docker, platform)

	mgr.reconcileWarmTaskPoolsFromDocker(context.Background(), platform.runtimeTargets)

	warmCreated := countWarmTaskSpecs(docker.createdSpecs)
	if warmCreated != 2 {
		t.Errorf("expected 2 warm containers created (1 existing, target 3), got %d", warmCreated)
	}
}

// --- helpers ---

func countWarmTaskSpecs(specs []ContainerSpec) int {
	count := 0
	for _, s := range specs {
		if s.Labels[labelDCMTier] == tierTask && s.Labels[labelDCMWarmPool] == "true" {
			count++
		}
	}
	return count
}

func assertWarmTaskLabels(t *testing.T, spec ContainerSpec, templateID string) {
	t.Helper()
	if spec.Labels[labelDCMManaged] != "true" {
		t.Errorf("expected managed label true, got %s", spec.Labels[labelDCMManaged])
	}
	if spec.Labels[labelDCMTier] != tierTask {
		t.Errorf("expected tier task, got %s", spec.Labels[labelDCMTier])
	}
	if spec.Labels[labelDCMTemplateID] != templateID {
		t.Errorf("expected template ID %s, got %s", templateID, spec.Labels[labelDCMTemplateID])
	}
	if spec.Labels[labelDCMWarmPool] != "true" {
		t.Errorf("expected warm_pool label true, got %s", spec.Labels[labelDCMWarmPool])
	}
}
