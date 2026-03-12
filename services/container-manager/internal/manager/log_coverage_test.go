package manager

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestReconcile_ScaleUp_EmitsLog(t *testing.T) {
	emitter, getEntries := newTestEmitter(t)
	docker := newMockDockerClient()
	target := makeRuntimeTarget("tmpl-1", "runtime:v1", 5, 2, 10)
	platform := &mockPlatformClient{}
	mgr := newDCMTestManager(docker, platform)
	mgr.logEmitter = emitter

	heartbeats := map[string]RuntimeHeartbeat{}
	activeCount := 0
	actions := targetActions{toCreate: 2}
	mgr.executeTargetActions(context.Background(), target, actions, heartbeats, activeCount, 0)
	emitter.Close()

	entries := getEntries()
	found := false
	for _, e := range entries {
		if e.Operation == "reconcile.scale_up" && e.Status == "started" {
			found = true
			if e.Payload["playbook_id"] != "tmpl-1" {
				t.Errorf("expected playbook_id tmpl-1, got %v", e.Payload["playbook_id"])
			}
			if e.Payload["count"] != float64(2) {
				t.Errorf("expected count 2, got %v", e.Payload["count"])
			}
			break
		}
	}
	if !found {
		t.Error("expected reconcile.scale_up log entry emitted")
	}
}

func TestReconcile_ScaleDown_EmitsLog(t *testing.T) {
	emitter, getEntries := newTestEmitter(t)
	docker := newMockDockerClient()
	target := makeRuntimeTarget("tmpl-1", "runtime:v1", 5, 0, 10)
	platform := &mockPlatformClient{}
	mgr := newDCMTestManager(docker, platform)
	mgr.logEmitter = emitter

	idleContainer := makeDCMContainer("c-idle", "tmpl-1", "runtime:v1", "rt-idle")
	heartbeats := map[string]RuntimeHeartbeat{}
	actions := targetActions{idleToDestroy: []ContainerInfo{idleContainer}}
	mgr.executeTargetActions(context.Background(), target, actions, heartbeats, 1, 0)
	emitter.Close()

	entries := getEntries()
	found := false
	for _, e := range entries {
		if e.Operation == "reconcile.scale_down" && e.Status == "started" {
			found = true
			if e.Payload["playbook_id"] != "tmpl-1" {
				t.Errorf("expected playbook_id tmpl-1, got %v", e.Payload["playbook_id"])
			}
			if e.Payload["reason"] != "idle_timeout" {
				t.Errorf("expected reason idle_timeout, got %v", e.Payload["reason"])
			}
			break
		}
	}
	if !found {
		t.Error("expected reconcile.scale_down log entry emitted")
	}
}

func TestReconcile_Preempt_EmitsLog(t *testing.T) {
	emitter, getEntries := newTestEmitter(t)
	docker := newMockDockerClient()
	platform := &mockPlatformClient{}
	mgr := newDCMTestManager(docker, platform)
	mgr.logEmitter = emitter

	victim := makeDCMContainer("c-victim", "tmpl-low", "runtime:v1", "rt-low")
	beneficiary := makeRuntimeTarget("tmpl-high", "runtime:v1", 5, 3, 100)
	victimTarget := makeRuntimeTarget("tmpl-low", "runtime:v1", 5, 0, 1)

	grouped := map[string][]ContainerInfo{
		victimTarget.TargetKey(): {victim},
	}
	heartbeats := map[string]RuntimeHeartbeat{
		"rt-low": {RuntimeID: "rt-low", PlaybookID: "tmpl-low", State: "idle"},
	}
	allTargets := []RuntimeTarget{
		victimTarget,
		beneficiary,
	}

	unsatisfied := []RuntimeTarget{beneficiary}
	mgr.executePreemptions(context.Background(), unsatisfied, allTargets, grouped, heartbeats, 1)
	emitter.Close()

	entries := getEntries()
	found := false
	for _, e := range entries {
		if e.Operation == "reconcile.preempt" && e.Status == "completed" {
			found = true
			if e.Payload["victim_playbook_id"] != "tmpl-low" {
				t.Errorf("expected victim tmpl-low, got %v", e.Payload["victim_playbook_id"])
			}
			if e.Payload["beneficiary_playbook_id"] != "tmpl-high" {
				t.Errorf("expected beneficiary tmpl-high, got %v", e.Payload["beneficiary_playbook_id"])
			}
			break
		}
	}
	if !found {
		t.Error("expected reconcile.preempt log entry emitted")
	}
}

func TestReconcile_PreemptSkipped_EmitsLog(t *testing.T) {
	emitter, getEntries := newTestEmitter(t)
	docker := newMockDockerClient()
	platform := &mockPlatformClient{}
	mgr := newDCMTestManager(docker, platform)
	mgr.logEmitter = emitter

	victim := makeDCMContainer("c-victim", "tmpl-low", "runtime:v1", "rt-low")
	beneficiary := makeRuntimeTarget("tmpl-high", "runtime:v1", 5, 3, 100)
	victimTarget := makeRuntimeTarget("tmpl-low", "runtime:v1", 5, 0, 1)

	grouped := map[string][]ContainerInfo{
		victimTarget.TargetKey(): {victim},
	}
	// Victim is executing — preemption should be skipped.
	heartbeats := map[string]RuntimeHeartbeat{
		"rt-low": {RuntimeID: "rt-low", PlaybookID: "tmpl-low", State: "executing"},
	}
	allTargets := []RuntimeTarget{
		victimTarget,
		beneficiary,
	}

	unsatisfied := []RuntimeTarget{beneficiary}
	mgr.executePreemptions(context.Background(), unsatisfied, allTargets, grouped, heartbeats, 1)
	emitter.Close()

	entries := getEntries()
	found := false
	for _, e := range entries {
		if e.Operation == "reconcile.preempt_skipped" {
			found = true
			if e.Payload["reason"] != "victim_executing" {
				t.Errorf("expected reason victim_executing, got %v", e.Payload["reason"])
			}
			break
		}
	}
	if !found {
		t.Error("expected reconcile.preempt_skipped log entry emitted")
	}
}

func TestReconcile_ContainerCreateFailed_EmitsErrorLog(t *testing.T) {
	emitter, getEntries := newTestEmitter(t)
	docker := newMockDockerClient()
	docker.createErr = errors.New("disk full")
	platform := &mockPlatformClient{}
	mgr := newDCMTestManager(docker, platform)
	mgr.logEmitter = emitter

	target := makeRuntimeTarget("tmpl-fail", "runtime:v1", 5, 1, 10)
	mgr.createRuntimeContainers(context.Background(), target, 1)
	emitter.Close()

	entries := getEntries()
	found := false
	for _, e := range entries {
		if e.Operation == "container.create" && e.Status == "failed" {
			found = true
			if e.Level != "error" {
				t.Errorf("expected level error, got %s", e.Level)
			}
			if e.Error == nil || e.Error.Message != "disk full" {
				t.Errorf("expected error message 'disk full', got %v", e.Error)
			}
			break
		}
	}
	if !found {
		t.Error("expected container.create error log entry emitted")
	}
}

func TestReconcile_PrePullFailed_EmitsErrorLog(t *testing.T) {
	emitter, getEntries := newTestEmitter(t)
	docker := newMockDockerClient()
	docker.pullErr = errors.New("registry unavailable")
	platform := &mockPlatformClient{}
	mgr := newDCMTestManager(docker, platform)
	mgr.logEmitter = emitter

	target := makeRuntimeTarget("tmpl-pull", "runtime:v1", 5, 1, 10)
	target.PoolMode = "warm"
	mgr.prePullImage(context.Background(), target)
	emitter.Close()

	entries := getEntries()
	found := false
	for _, e := range entries {
		if e.Operation == "container.pre_pull" && e.Status == "failed" {
			found = true
			if e.Level != "warn" {
				t.Errorf("expected level warn, got %s", e.Level)
			}
			if e.Payload["error"] != "registry unavailable" {
				t.Errorf("expected error 'registry unavailable' in payload, got %v", e.Payload["error"])
			}
			break
		}
	}
	if !found {
		t.Error("expected container.pre_pull warn log entry emitted")
	}
}

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

func TestContainerCreate_SetsResourceFields(t *testing.T) {
	emitter, getEntries := newTestEmitter(t)
	docker := newMockDockerClient()
	platform := &mockPlatformClient{}
	mgr := newDCMTestManager(docker, platform)
	mgr.logEmitter = emitter

	target := makeRuntimeTarget("tmpl-1", "runtime:v1", 3, 2, 10)
	mgr.createRuntimeContainers(context.Background(), target, 1)
	emitter.Close()

	entries := getEntries()
	for _, e := range entries {
		if e.Operation == "container.create" && e.Status == "completed" {
			if e.ResourceType != "runtime" {
				t.Errorf("expected resource_type runtime, got %q", e.ResourceType)
			}
			if e.ResourceID == "" {
				t.Error("expected non-empty resource_id on container.create")
			}
			if e.ResourceName == "" {
				t.Error("expected non-empty resource_name on container.create")
			}
			return
		}
	}
	t.Error("expected container.create log entry with resource fields")
}

func TestContainerDestroy_SetsResourceFieldsAndImage(t *testing.T) {
	emitter, getEntries := newTestEmitter(t)
	docker := newMockDockerClient()
	platform := &mockPlatformClient{}
	mgr := newDCMTestManager(docker, platform)
	mgr.logEmitter = emitter

	container := makeDCMContainer("c-1", "tmpl-1", "runtime:v1", "rt-1")
	container.Image = "runtime:v1"
	mgr.destroyContainers(context.Background(), []ContainerInfo{container}, 10)
	emitter.Close()

	entries := getEntries()
	for _, e := range entries {
		if e.Operation == "container.destroy" && e.Status == "completed" {
			if e.ResourceType != "runtime" {
				t.Errorf("expected resource_type runtime, got %q", e.ResourceType)
			}
			if e.ResourceID != "rt-1" {
				t.Errorf("expected resource_id rt-1, got %q", e.ResourceID)
			}
			if e.Payload["image"] != "runtime:v1" {
				t.Errorf("expected image runtime:v1 in payload, got %v", e.Payload["image"])
			}
			return
		}
	}
	t.Error("expected container.destroy log entry with resource fields and image")
}

func TestHungDetected_SetsResourceFieldsAndTaskID(t *testing.T) {
	emitter, getEntries := newTestEmitter(t)
	docker := newMockDockerClient()
	docker.containers = []ContainerInfo{
		makeDCMContainer("c-1", "tmpl-1", "runtime:v1", "rt-1"),
	}
	staleTime := time.Now().UTC().Add(-2 * time.Minute).Format(time.RFC3339)
	platform := &mockPlatformClient{
		heartbeats: []RuntimeHeartbeat{
			{RuntimeID: "rt-1", PlaybookID: "tmpl-1", State: "executing",
				LastHeartbeatAt: staleTime, ActiveTaskID: "task-42"},
		},
	}
	mgr := newDCMTestManager(docker, platform)
	mgr.logEmitter = emitter

	mgr.detectHungRuntimes(context.Background())
	emitter.Close()

	entries := getEntries()
	for _, e := range entries {
		if e.Operation == "container.hung_detected" {
			if e.ResourceType != "runtime" {
				t.Errorf("expected resource_type runtime, got %q", e.ResourceType)
			}
			if e.ResourceID != "rt-1" {
				t.Errorf("expected resource_id rt-1, got %q", e.ResourceID)
			}
			if e.TaskID != "task-42" {
				t.Errorf("expected task_id task-42, got %q", e.TaskID)
			}
			if e.Payload["image"] == nil || e.Payload["image"] == "" {
				t.Error("expected image field in hung_detected payload")
			}
			return
		}
	}
	t.Error("expected container.hung_detected log entry with resource fields and task_id")
}

func TestOrphanHeartbeat_SetsResourceFieldsAndTaskID(t *testing.T) {
	emitter, getEntries := newTestEmitter(t)
	docker := newMockDockerClient()
	staleTime := time.Now().UTC().Add(-2 * time.Minute).Format(time.RFC3339)
	platform := &mockPlatformClient{
		heartbeats: []RuntimeHeartbeat{
			{RuntimeID: "rt-gone", PlaybookID: "tmpl-1", State: "executing",
				LastHeartbeatAt: staleTime, ActiveTaskID: "task-99"},
		},
	}
	mgr := newDCMTestManager(docker, platform)
	mgr.logEmitter = emitter

	mgr.detectHungRuntimes(context.Background())
	emitter.Close()

	entries := getEntries()
	for _, e := range entries {
		if e.Operation == "container.orphan_heartbeat" {
			if e.ResourceType != "runtime" {
				t.Errorf("expected resource_type runtime, got %q", e.ResourceType)
			}
			if e.ResourceID != "rt-gone" {
				t.Errorf("expected resource_id rt-gone, got %q", e.ResourceID)
			}
			if e.TaskID != "task-99" {
				t.Errorf("expected task_id task-99, got %q", e.TaskID)
			}
			return
		}
	}
	t.Error("expected container.orphan_heartbeat log entry with resource fields and task_id")
}

func TestScaleUp_IncludesMaxRuntimes(t *testing.T) {
	emitter, getEntries := newTestEmitter(t)
	docker := newMockDockerClient()
	target := makeRuntimeTarget("tmpl-1", "runtime:v1", 5, 2, 10)
	platform := &mockPlatformClient{}
	mgr := newDCMTestManager(docker, platform)
	mgr.logEmitter = emitter
	mgr.config.GlobalMaxRuntimes = 20

	actions := targetActions{toCreate: 2}
	mgr.executeTargetActions(context.Background(), target, actions, map[string]RuntimeHeartbeat{}, 0, 0)
	emitter.Close()

	entries := getEntries()
	for _, e := range entries {
		if e.Operation == "reconcile.scale_up" && e.Status == "started" {
			if e.Payload["max_runtimes"] != float64(5) {
				t.Errorf("expected max_runtimes 5, got %v", e.Payload["max_runtimes"])
			}
			if e.Payload["global_max_runtimes"] != float64(20) {
				t.Errorf("expected global_max_runtimes 20, got %v", e.Payload["global_max_runtimes"])
			}
			return
		}
	}
	t.Error("expected reconcile.scale_up entry with max_runtimes fields")
}

func TestScaleDown_IncludesMaxRuntimes(t *testing.T) {
	emitter, getEntries := newTestEmitter(t)
	docker := newMockDockerClient()
	target := makeRuntimeTarget("tmpl-1", "runtime:v1", 5, 0, 10)
	platform := &mockPlatformClient{}
	mgr := newDCMTestManager(docker, platform)
	mgr.logEmitter = emitter
	mgr.config.GlobalMaxRuntimes = 15

	idleContainer := makeDCMContainer("c-idle", "tmpl-1", "runtime:v1", "rt-idle")
	actions := targetActions{idleToDestroy: []ContainerInfo{idleContainer}}
	mgr.executeTargetActions(context.Background(), target, actions, map[string]RuntimeHeartbeat{}, 1, 0)
	emitter.Close()

	entries := getEntries()
	for _, e := range entries {
		if e.Operation == "reconcile.scale_down" && e.Status == "started" {
			if e.Payload["max_runtimes"] != float64(5) {
				t.Errorf("expected max_runtimes 5, got %v", e.Payload["max_runtimes"])
			}
			if e.Payload["global_max_runtimes"] != float64(15) {
				t.Errorf("expected global_max_runtimes 15, got %v", e.Payload["global_max_runtimes"])
			}
			return
		}
	}
	t.Error("expected reconcile.scale_down entry with max_runtimes fields")
}

func TestDrain_SetsResourceFieldsAndImage(t *testing.T) {
	emitter, getEntries := newTestEmitter(t)
	docker := newMockDockerClient()
	platform := &mockPlatformClient{}
	mgr := newDCMTestManager(docker, platform)
	mgr.logEmitter = emitter

	c := makeDCMContainer("c-1", "tmpl-1", "runtime:v1", "rt-1")
	c.Image = "runtime:v1"
	mgr.drainExecutingRuntime(context.Background(), c, "rt-1", "tmpl-1")
	emitter.Close()

	entries := getEntries()
	for _, e := range entries {
		if e.Operation == "reconcile.drain" && e.Status == "completed" {
			if e.ResourceType != "runtime" {
				t.Errorf("expected resource_type runtime, got %q", e.ResourceType)
			}
			if e.ResourceID != "rt-1" {
				t.Errorf("expected resource_id rt-1, got %q", e.ResourceID)
			}
			if e.Payload["image"] != "runtime:v1" {
				t.Errorf("expected image runtime:v1 in payload, got %v", e.Payload["image"])
			}
			return
		}
	}
	t.Error("expected reconcile.drain log entry with resource fields and image")
}

func TestPreempt_SetsResourceFields(t *testing.T) {
	emitter, getEntries := newTestEmitter(t)
	docker := newMockDockerClient()
	platform := &mockPlatformClient{}
	mgr := newDCMTestManager(docker, platform)
	mgr.logEmitter = emitter

	victim := makeDCMContainer("c-victim", "tmpl-low", "runtime:v1", "rt-low")
	beneficiary := makeRuntimeTarget("tmpl-high", "runtime:v1", 5, 3, 100)
	victimTarget := makeRuntimeTarget("tmpl-low", "runtime:v1", 5, 0, 1)

	grouped := map[string][]ContainerInfo{
		victimTarget.TargetKey(): {victim},
	}
	heartbeats := map[string]RuntimeHeartbeat{
		"rt-low": {RuntimeID: "rt-low", PlaybookID: "tmpl-low", State: "idle"},
	}
	allTargets := []RuntimeTarget{
		victimTarget,
		beneficiary,
	}

	unsatisfied := []RuntimeTarget{beneficiary}
	mgr.executePreemptions(context.Background(), unsatisfied, allTargets, grouped, heartbeats, 1)
	emitter.Close()

	entries := getEntries()
	for _, e := range entries {
		if e.Operation == "reconcile.preempt" && e.Status == "completed" {
			if e.ResourceType != "runtime" {
				t.Errorf("expected resource_type runtime, got %q", e.ResourceType)
			}
			if e.ResourceID != "c-victim" {
				t.Errorf("expected resource_id c-victim, got %q", e.ResourceID)
			}
			return
		}
	}
	t.Error("expected reconcile.preempt log entry with resource fields")
}

// Dummy import to prevent "unused import" for time in some configurations.
var _ = time.Now
