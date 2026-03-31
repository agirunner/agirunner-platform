package manager

import (
	"context"
	"errors"
	"testing"
)

func TestReconcile_WDS_ScaleDown_EmitsLog(t *testing.T) {
	emitter, getEntries := newTestEmitter(t)
	docker := newMockDockerClient()
	docker.containers = []ContainerInfo{
		{
			ID: "c-1", Name: "worker-1-0", Image: "img:v1", Status: "Up",
			Labels: map[string]string{labelManagedBy: "true", labelDesiredStateID: "ds-1", labelVersion: "1"},
		},
		{
			ID: "c-2", Name: "worker-1-1", Image: "img:v1", Status: "Up",
			Labels: map[string]string{labelManagedBy: "true", labelDesiredStateID: "ds-1", labelVersion: "1"},
		},
	}
	platform := &mockPlatformClient{
		desiredStates: []DesiredState{
			{ID: "ds-1", WorkerName: "worker-1", RuntimeImage: "img:v1", Version: 1, Replicas: 1},
		},
	}
	mgr := newTestManager(docker, platform)
	mgr.logEmitter = emitter

	_ = mgr.reconcileOnce(context.Background())
	emitter.Close()

	entries := getEntries()
	found := false
	for _, e := range entries {
		if e.Operation == "container.wds_destroy" && e.Status == "completed" {
			found = true
			if e.Payload["reason"] != "scale_down" {
				t.Errorf("expected reason scale_down, got %v", e.Payload["reason"])
			}
			break
		}
	}
	if !found {
		t.Error("expected container.wds_destroy log entry emitted")
	}
}

func TestReconcile_WDS_OrphanCleanup_EmitsLog(t *testing.T) {
	emitter, getEntries := newTestEmitter(t)
	docker := newMockDockerClient()
	docker.containers = []ContainerInfo{
		{
			ID: "c-orphan", Name: "old-worker", Image: "img:v1", Status: "Up",
			Labels: map[string]string{labelManagedBy: "true", labelDesiredStateID: "ds-gone"},
		},
	}
	platform := &mockPlatformClient{
		desiredStates: []DesiredState{}, // no desired states — container is orphan
	}
	mgr := newTestManager(docker, platform)
	mgr.logEmitter = emitter

	_ = mgr.reconcileOnce(context.Background())
	emitter.Close()

	entries := getEntries()
	found := false
	for _, e := range entries {
		if e.Operation == "container.wds_orphan_cleanup" {
			found = true
			if e.Payload["container_id"] != "c-orphan" {
				t.Errorf("expected container_id c-orphan, got %v", e.Payload["container_id"])
			}
			break
		}
	}
	if !found {
		t.Error("expected container.wds_orphan_cleanup log entry emitted")
	}
}

func TestReconcile_WDS_Restart_EmitsLog(t *testing.T) {
	emitter, getEntries := newTestEmitter(t)
	docker := newMockDockerClient()
	docker.containers = []ContainerInfo{
		{
			ID: "c-restart", Name: "worker-1-0", Image: "img:v1", Status: "Up",
			Labels: map[string]string{labelManagedBy: "true", labelDesiredStateID: "ds-1"},
		},
	}
	platform := &mockPlatformClient{
		desiredStates: []DesiredState{
			{ID: "ds-1", WorkerName: "worker-1", RuntimeImage: "img:v1", Replicas: 1, RestartRequested: true},
		},
	}
	mgr := newTestManager(docker, platform)
	mgr.logEmitter = emitter

	_ = mgr.reconcileOnce(context.Background())
	emitter.Close()

	entries := getEntries()
	found := false
	for _, e := range entries {
		if e.Operation == "container.wds_restart" && e.Status == "completed" {
			found = true
			if e.Payload["worker"] != "worker-1" {
				t.Errorf("expected worker worker-1, got %v", e.Payload["worker"])
			}
			break
		}
	}
	if !found {
		t.Error("expected container.wds_restart log entry emitted")
	}
}

func TestReconcile_ReconcileCycle_EmitsHeartbeatLog(t *testing.T) {
	emitter, getEntries := newTestEmitter(t)
	docker := newMockDockerClient()
	platform := &mockPlatformClient{}
	mgr := newTestManager(docker, platform)
	mgr.logEmitter = emitter

	// Set cycle to heartbeatInterval so the heartbeat log fires.
	mgr.cycleCount = heartbeatInterval - 1
	mgr.runReconcileCycle(context.Background())
	emitter.Close()

	entries := getEntries()
	found := false
	for _, e := range entries {
		if e.Operation == "reconcile.cycle" && e.Status == "completed" {
			found = true
			if e.DurationMs == nil {
				t.Error("expected duration_ms set on reconcile cycle heartbeat")
			}
			break
		}
	}
	if !found {
		t.Error("expected reconcile.cycle log entry emitted on heartbeat interval")
	}
}

func TestAllEmissionPoints_UseContainerManagerSource(t *testing.T) {
	emitter, getEntries := newTestEmitter(t)
	docker := newMockDockerClient()
	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{
			makeRuntimeTarget("tmpl-1", "runtime:v1", 5, 1, 10),
		},
	}
	mgr := newDCMTestManager(docker, platform)
	mgr.logEmitter = emitter

	// Trigger multiple emission points.
	mgr.createRuntimeContainers(context.Background(), platform.runtimeTargets[0], 1)
	container := makeDCMContainer("c-1", "tmpl-1", "runtime:v1", "rt-1")
	mgr.destroyContainers(context.Background(), []ContainerInfo{container}, 10)
	emitter.Close()

	entries := getEntries()
	if len(entries) == 0 {
		t.Fatal("expected log entries, got none")
	}
	for _, e := range entries {
		if e.Source != "container_manager" {
			t.Errorf("expected source container_manager, got %q on operation %s", e.Source, e.Operation)
		}
		if e.ActorType != "system" {
			t.Errorf("expected actor_type system, got %q on operation %s", e.ActorType, e.Operation)
		}
		if e.TraceID == "" {
			t.Errorf("expected non-empty trace_id on operation %s", e.Operation)
		}
		if e.CreatedAt.IsZero() {
			t.Errorf("expected non-zero created_at on operation %s", e.Operation)
		}
	}
}

func TestReconcile_DCMError_EmitsErrorLog(t *testing.T) {
	emitter, getEntries := newTestEmitter(t)
	docker := newMockDockerClient()
	docker.listErr = errors.New("docker daemon down")
	platform := &mockPlatformClient{}
	mgr := newTestManager(docker, platform)
	mgr.logEmitter = emitter

	// Force heartbeat interval so cycle log fires.
	mgr.cycleCount = heartbeatInterval - 1
	mgr.runReconcileCycle(context.Background())
	emitter.Close()

	entries := getEntries()
	var foundDCMErr, foundWDSErr bool
	for _, e := range entries {
		if e.Operation == "reconcile.dcm" && e.Status == "failed" {
			foundDCMErr = true
		}
		if e.Operation == "reconcile.wds" && e.Status == "failed" {
			foundWDSErr = true
		}
	}
	if !foundDCMErr {
		t.Error("expected reconcile.dcm error log entry")
	}
	if !foundWDSErr {
		t.Error("expected reconcile.wds error log entry")
	}
}

func TestReconcile_FullCycleCoverage(t *testing.T) {
	// Verifies that a full DCM reconcile emits structured logs for all major
	// operations when there are pending tasks and no existing containers.
	emitter, getEntries := newTestEmitter(t)
	docker := newMockDockerClient()
	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{
			makeRuntimeTarget("tmpl-1", "runtime:v1", 5, 2, 10),
		},
	}
	mgr := newDCMTestManager(docker, platform)
	mgr.logEmitter = emitter

	_ = mgr.reconcileDCM(context.Background())
	emitter.Close()

	entries := getEntries()
	operations := make(map[string]bool)
	for _, e := range entries {
		operations[e.Operation] = true
	}

	// Should have: image_pull started + completed, container.create completed,
	// scale_up started.
	expected := []string{
		"container.image_pull",
		"container.create",
		"reconcile.scale_up",
	}
	for _, op := range expected {
		if !operations[op] {
			t.Errorf("expected operation %q in full cycle, got operations: %v", op, operations)
		}
	}
}
