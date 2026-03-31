package manager

import (
	"context"
	"testing"
	"time"
)

func TestManager_EmitLog_NilEmitterSafe(t *testing.T) {
	docker := newMockDockerClient()
	platform := &mockPlatformClient{}
	mgr := newTestManager(docker, platform)
	// logEmitter is nil in test manager — should not panic
	mgr.emitLog("container", "container.create", "info", "completed", nil)
	mgr.emitLogError("container", "container.create", nil, "boom")
	mgr.emitLogTimed("container", "container.create", "info", "completed", nil, 100)
}

func TestReconcile_ContainerCreate_EmitsLog(t *testing.T) {
	emitter, getEntries := newTestEmitter(t)
	docker := newMockDockerClient()
	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{
			makeRuntimeTarget("tmpl-1", "runtime:v1", 3, 2, 10),
		},
	}
	mgr := newDCMTestManager(docker, platform)
	mgr.logEmitter = emitter

	mgr.createRuntimeContainers(context.Background(), platform.runtimeTargets[0], 1)
	emitter.Close()

	entries := getEntries()
	found := false
	for _, e := range entries {
		if e.Operation == "container.create" && e.Status == "completed" {
			found = true
			if e.Payload["playbook_id"] != "tmpl-1" {
				t.Errorf("expected playbook_id tmpl-1, got %v", e.Payload["playbook_id"])
			}
			break
		}
	}
	if !found {
		t.Error("expected container.create log entry emitted")
	}
}

func TestReconcile_ContainerDestroy_EmitsLog(t *testing.T) {
	emitter, getEntries := newTestEmitter(t)
	docker := newMockDockerClient()
	containers := []ContainerInfo{
		makeDCMContainer("c-1", "tmpl-1", "runtime:v1", "rt-1"),
	}
	platform := &mockPlatformClient{}
	mgr := newDCMTestManager(docker, platform)
	mgr.logEmitter = emitter

	mgr.destroyContainers(context.Background(), containers, 10)
	emitter.Close()

	entries := getEntries()
	found := false
	for _, e := range entries {
		if e.Operation == "container.destroy" && e.Status == "completed" {
			found = true
			if e.Payload["container_id"] != "c-1" {
				t.Errorf("expected container_id c-1, got %v", e.Payload["container_id"])
			}
			break
		}
	}
	if !found {
		t.Error("expected container.destroy log entry emitted")
	}
}

func TestReconcile_OrphanCleanup_EmitsLog(t *testing.T) {
	emitter, getEntries := newTestEmitter(t)
	docker := newMockDockerClient()
	runtime := makeDCMContainer("c-runtime", "tmpl-1", "runtime:v1", "rt-1")
	task := makeDCMTaskContainer("c-task", "rt-gone")
	task.Labels[labelDCMPlaybookID] = "tmpl-1"
	docker.containers = []ContainerInfo{runtime, task}
	platform := &mockPlatformClient{}
	mgr := newDCMTestManager(docker, platform)
	mgr.logEmitter = emitter

	mgr.cleanupOrphanTaskContainers(context.Background())
	emitter.Close()

	entries := getEntries()
	found := false
	for _, e := range entries {
		if e.Operation == "container.orphan_cleanup" {
			found = true
			break
		}
	}
	if !found {
		t.Error("expected container.orphan_cleanup log entry emitted")
	}
}

func TestReconcile_HungDetected_EmitsLog(t *testing.T) {
	emitter, getEntries := newTestEmitter(t)
	docker := newMockDockerClient()
	docker.containers = []ContainerInfo{
		makeDCMContainer("c-1", "tmpl-1", "runtime:v1", "rt-1"),
	}
	staleTime := time.Now().UTC().Add(-2 * time.Minute).Format(time.RFC3339)
	platform := &mockPlatformClient{
		heartbeats: []RuntimeHeartbeat{
			{RuntimeID: "rt-1", PlaybookID: "tmpl-1", State: "idle", LastHeartbeatAt: staleTime},
		},
	}
	mgr := newDCMTestManager(docker, platform)
	mgr.logEmitter = emitter

	mgr.detectHungRuntimes(context.Background())
	emitter.Close()

	entries := getEntries()
	found := false
	for _, e := range entries {
		if e.Operation == "container.hung_detected" && e.Level == "warn" {
			found = true
			if e.Payload["runtime_id"] != "rt-1" {
				t.Errorf("expected runtime_id rt-1, got %v", e.Payload["runtime_id"])
			}
			break
		}
	}
	if !found {
		t.Error("expected container.hung_detected log entry emitted")
	}
}

func TestReconcile_ImagePull_EmitsLog(t *testing.T) {
	emitter, getEntries := newTestEmitter(t)
	docker := newMockDockerClient()
	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{
			makeRuntimeTarget("tmpl-1", "runtime:v1", 3, 1, 10),
		},
	}
	mgr := newDCMTestManager(docker, platform)
	mgr.logEmitter = emitter

	mgr.createRuntimeContainers(context.Background(), platform.runtimeTargets[0], 1)
	emitter.Close()

	entries := getEntries()
	startedFound := false
	completedFound := false
	for _, e := range entries {
		if e.Operation == "container.image_pull" && e.Status == "started" {
			startedFound = true
		}
		if e.Operation == "container.image_pull" && e.Status == "completed" {
			completedFound = true
			if e.DurationMs == nil {
				t.Error("expected duration_ms set on image pull completed")
			}
		}
	}
	if !startedFound {
		t.Error("expected container.image_pull started entry")
	}
	if !completedFound {
		t.Error("expected container.image_pull completed entry")
	}
}

func TestReconcile_DrainRuntime_EmitsLog(t *testing.T) {
	emitter, getEntries := newTestEmitter(t)
	docker := newMockDockerClient()
	platform := &mockPlatformClient{}
	mgr := newDCMTestManager(docker, platform)
	mgr.logEmitter = emitter

	c := makeDCMContainer("c-1", "tmpl-1", "runtime:v1", "rt-1")
	mgr.drainExecutingRuntime(context.Background(), c, "rt-1", "tmpl-1")
	emitter.Close()

	entries := getEntries()
	found := false
	for _, e := range entries {
		if e.Operation == "reconcile.drain" && e.Status == "completed" {
			found = true
			if e.Payload["runtime_id"] != "rt-1" {
				t.Errorf("expected runtime_id rt-1, got %v", e.Payload["runtime_id"])
			}
			if e.Payload["playbook_id"] != "tmpl-1" {
				t.Errorf("expected playbook_id tmpl-1, got %v", e.Payload["playbook_id"])
			}
			break
		}
	}
	if !found {
		t.Error("expected reconcile.drain log entry emitted")
	}
}

func TestLifecycle_StartupSweep_EmitsLog(t *testing.T) {
	emitter, getEntries := newTestEmitter(t)
	docker := newMockDockerClient()
	// One runtime with matching target, one without
	docker.containers = []ContainerInfo{
		makeDCMContainer("c-keep", "tmpl-1", "runtime:v1", "rt-1"),
		makeDCMContainer("c-remove", "tmpl-gone", "runtime:v1", "rt-2"),
	}
	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{
			makeRuntimeTarget("tmpl-1", "runtime:v1", 3, 0, 10),
		},
	}
	mgr := newDCMTestManager(docker, platform)
	mgr.logEmitter = emitter

	_ = mgr.startupSweep(context.Background())
	emitter.Close()

	entries := getEntries()
	sweepFound := false
	removeFound := false
	for _, e := range entries {
		if e.Operation == "lifecycle.startup_sweep" && e.Status == "completed" {
			sweepFound = true
			if e.Payload["adopted"] != float64(1) {
				t.Errorf("expected 1 adopted, got %v", e.Payload["adopted"])
			}
			if e.Payload["removed"] != float64(1) {
				t.Errorf("expected 1 removed, got %v", e.Payload["removed"])
			}
		}
		if e.Operation == "lifecycle.startup_remove" {
			removeFound = true
		}
	}
	if !sweepFound {
		t.Error("expected lifecycle.startup_sweep log entry emitted")
	}
	if !removeFound {
		t.Error("expected lifecycle.startup_remove log entry emitted")
	}
}

func TestLifecycle_Shutdown_EmitsLog(t *testing.T) {
	emitter, getEntries := newTestEmitter(t)
	docker := newMockDockerClient()
	docker.containers = []ContainerInfo{
		makeDCMContainer("c-1", "tmpl-1", "runtime:v1", "rt-1"),
	}
	platform := &mockPlatformClient{}
	mgr := newDCMTestManager(docker, platform)
	mgr.logEmitter = emitter

	mgr.shutdownCascade()
	emitter.Close()

	entries := getEntries()
	startedFound := false
	completedFound := false
	for _, e := range entries {
		if e.Operation == "lifecycle.shutdown" && e.Status == "started" {
			startedFound = true
		}
		if e.Operation == "lifecycle.shutdown" && e.Status == "completed" {
			completedFound = true
			if e.DurationMs == nil {
				t.Error("expected duration_ms on shutdown completed")
			}
		}
	}
	if !startedFound {
		t.Error("expected lifecycle.shutdown started entry")
	}
	if !completedFound {
		t.Error("expected lifecycle.shutdown completed entry")
	}
}

func TestReconcile_WDS_Create_EmitsLog(t *testing.T) {
	emitter, getEntries := newTestEmitter(t)
	docker := newMockDockerClient()
	platform := &mockPlatformClient{
		desiredStates: []DesiredState{
			{ID: "ds-1", WorkerName: "worker-1", RuntimeImage: "img:v1", Replicas: 1},
		},
	}
	mgr := newTestManager(docker, platform)
	mgr.logEmitter = emitter

	_ = mgr.reconcileOnce(context.Background())
	emitter.Close()

	entries := getEntries()
	found := false
	for _, e := range entries {
		if e.Operation == "container.wds_create" && e.Status == "completed" {
			found = true
			if e.Payload["worker"] != "worker-1" {
				t.Errorf("expected worker worker-1, got %v", e.Payload["worker"])
			}
		}
	}
	if !found {
		t.Error("expected container.wds_create log entry emitted")
	}
}

func TestReconcile_WDS_Drain_EmitsLog(t *testing.T) {
	emitter, getEntries := newTestEmitter(t)
	docker := newMockDockerClient()
	docker.containers = []ContainerInfo{
		{
			ID: "c-drain", Name: "worker-1-0", Image: "img:v1", Status: "Up",
			Labels: map[string]string{labelManagedBy: "true", labelDesiredStateID: "ds-1"},
		},
	}
	platform := &mockPlatformClient{
		desiredStates: []DesiredState{
			{ID: "ds-1", WorkerName: "worker-1", RuntimeImage: "img:v1", Draining: true},
		},
	}
	mgr := newTestManager(docker, platform)
	mgr.logEmitter = emitter

	_ = mgr.reconcileOnce(context.Background())
	emitter.Close()

	entries := getEntries()
	found := false
	for _, e := range entries {
		if e.Operation == "container.wds_drain" && e.Status == "completed" {
			found = true
		}
	}
	if !found {
		t.Error("expected container.wds_drain log entry emitted")
	}
}

func TestReconcile_OrphanHeartbeat_EmitsLog(t *testing.T) {
	emitter, getEntries := newTestEmitter(t)
	docker := newMockDockerClient()
	// No containers — heartbeat is orphaned
	staleTime := time.Now().UTC().Add(-2 * time.Minute).Format(time.RFC3339)
	platform := &mockPlatformClient{
		heartbeats: []RuntimeHeartbeat{
			{RuntimeID: "rt-gone", PlaybookID: "tmpl-1", State: "executing",
				LastHeartbeatAt: staleTime, ActiveTaskID: "task-1"},
		},
	}
	mgr := newDCMTestManager(docker, platform)
	mgr.logEmitter = emitter

	mgr.detectHungRuntimes(context.Background())
	emitter.Close()

	entries := getEntries()
	found := false
	for _, e := range entries {
		if e.Operation == "container.orphan_heartbeat" && e.Status == "completed" {
			found = true
			if e.Payload["runtime_id"] != "rt-gone" {
				t.Errorf("expected runtime_id rt-gone, got %v", e.Payload["runtime_id"])
			}
		}
	}
	if !found {
		t.Error("expected container.orphan_heartbeat log entry emitted")
	}
}
