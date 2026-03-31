package manager

import (
	"context"
	"errors"
	"testing"
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
