package manager

import (
	"context"
	"testing"
	"time"
)

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
