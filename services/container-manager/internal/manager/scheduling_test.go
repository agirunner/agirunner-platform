package manager

import (
	"context"
	"testing"
	"time"
)

func TestPrioritySortingAppliedInReconcileDCM(t *testing.T) {
	docker := newMockDockerClient()
	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{
			makeRuntimeTarget("tmpl-low", "img:v1", 3, 2, 1),
			makeRuntimeTarget("tmpl-high", "img:v1", 3, 2, 100),
		},
	}
	mgr := newDCMTestManager(docker, platform)

	err := mgr.reconcileDCM(context.Background())

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(docker.createdSpecs) != 4 {
		t.Fatalf("expected 4 containers created (2 per template), got %d", len(docker.createdSpecs))
	}
	// High-priority template should be created first (indices 0-1).
	for i := 0; i < 2; i++ {
		tmplID := docker.createdSpecs[i].Labels[labelDCMTemplateID]
		if tmplID != "tmpl-high" {
			t.Errorf("expected createdSpecs[%d] for tmpl-high, got %s", i, tmplID)
		}
	}
}

func TestHighPriorityPreemptsIdleLowPriorityAtCapacity(t *testing.T) {
	docker := newMockDockerClient()
	recentHB := time.Now().UTC().Format(time.RFC3339)
	// Fill to global max (10) with low-priority containers.
	docker.containers = makeDCMContainers("tmpl-low", "img:v1", 10)

	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{
			makeRuntimeTarget("tmpl-high", "img:v1", 3, 2, 100),
			makeRuntimeTarget("tmpl-low", "img:v1", 10, 0, 1),
		},
		heartbeats: recentIdleHeartbeats("tmpl-low", 10, recentHB),
	}
	mgr := newDCMTestManager(docker, platform)

	err := mgr.reconcileDCM(context.Background())

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(docker.stoppedIDs) < 2 {
		t.Errorf("expected at least 2 low-priority containers preempted, got %d", len(docker.stoppedIDs))
	}
	if len(docker.createdSpecs) < 2 {
		t.Errorf("expected at least 2 high-priority containers created, got %d", len(docker.createdSpecs))
	}
	for _, spec := range docker.createdSpecs {
		if spec.Labels[labelDCMTemplateID] != "tmpl-high" {
			t.Errorf("expected all created containers for tmpl-high, got %s", spec.Labels[labelDCMTemplateID])
		}
	}
}

func TestPreemptionSkipsExecutingVictims(t *testing.T) {
	docker := newMockDockerClient()
	recentHB := time.Now().UTC().Format(time.RFC3339)
	docker.containers = makeDCMContainers("tmpl-low", "img:v1", 5)

	// All low-priority containers are executing.
	var heartbeats []RuntimeHeartbeat
	for i := 0; i < 5; i++ {
		heartbeats = append(heartbeats, RuntimeHeartbeat{
			RuntimeID:       docker.containers[i].Labels[labelDCMRuntimeID],
			TemplateID:      "tmpl-low",
			State:           "executing",
			LastHeartbeatAt: recentHB,
		})
	}

	lowTarget := makeRuntimeTarget("tmpl-low", "img:v1", 5, 5, 1)
	lowTarget.IdleTimeoutSeconds = 0
	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{
			makeRuntimeTarget("tmpl-high", "img:v1", 3, 2, 100),
			lowTarget,
		},
		heartbeats: heartbeats,
	}
	mgr := newDCMTestManager(docker, platform)
	mgr.config.GlobalMaxRuntimes = 5

	err := mgr.reconcileDCM(context.Background())

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// No preemptions because all victims are executing.
	if len(docker.stoppedIDs) != 0 {
		t.Errorf("expected no preemptions (all executing), got %d stops", len(docker.stoppedIDs))
	}
}

func TestNoPreemptionBetweenSamePriorityTemplates(t *testing.T) {
	docker := newMockDockerClient()
	recentHB := time.Now().UTC().Format(time.RFC3339)
	docker.containers = makeDCMContainers("tmpl-a", "img:v1", 10)

	tmplATarget := makeRuntimeTarget("tmpl-a", "img:v1", 10, 10, 10)
	tmplATarget.IdleTimeoutSeconds = 0
	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{
			makeRuntimeTarget("tmpl-b", "img:v1", 3, 2, 10),
			tmplATarget,
		},
		heartbeats: recentIdleHeartbeats("tmpl-a", 10, recentHB),
	}
	mgr := newDCMTestManager(docker, platform)

	err := mgr.reconcileDCM(context.Background())

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(docker.stoppedIDs) != 0 {
		t.Errorf("expected no preemptions (same priority), got %d stops", len(docker.stoppedIDs))
	}
}

func TestStarvationTracking(t *testing.T) {
	docker := newMockDockerClient()
	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{
			makeRuntimeTarget("tmpl-starved", "img:v1", 3, 5, 1),
		},
	}
	mgr := newDCMTestManager(docker, platform)
	mgr.config.GlobalMaxRuntimes = 0 // Prevent any scaling.

	frozenNow := time.Now()
	mgr.nowFunc = func() time.Time { return frozenNow }

	// First reconcile should start tracking starvation.
	_ = mgr.reconcileDCM(context.Background())

	firstPending, tracked := mgr.starvationTrack["tmpl-starved"]
	if !tracked {
		t.Fatal("expected tmpl-starved to be tracked for starvation")
	}
	if !firstPending.Equal(frozenNow) {
		t.Errorf("expected firstPending=%v, got %v", frozenNow, firstPending)
	}

	if mgr.isStarved("tmpl-starved") {
		t.Error("should not be starved yet (just started)")
	}
}

func TestStarvationClearedOnNextCycleWhenRuntimeAssigned(t *testing.T) {
	docker := newMockDockerClient()
	recentHB := time.Now().UTC().Format(time.RFC3339)
	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{
			makeRuntimeTarget("tmpl-1", "img:v1", 3, 5, 10),
		},
	}
	mgr := newDCMTestManager(docker, platform)

	// First cycle: template has pending tasks but no running containers.
	_ = mgr.reconcileDCM(context.Background())

	if _, tracked := mgr.starvationTrack["tmpl-1"]; tracked {
		// Runtimes were created in this cycle; starvation was set before
		// processing but the tracking check saw 0 running. Containers now
		// exist in docker.createdSpecs. Next cycle will see them running.
	}

	// Second cycle: containers are now running.
	docker.containers = makeDCMContainers("tmpl-1", "img:v1", 3)
	platform.runtimeTargets = []RuntimeTarget{
		makeRuntimeTarget("tmpl-1", "img:v1", 3, 0, 10),
	}
	platform.heartbeats = recentIdleHeartbeats("tmpl-1", 3, recentHB)
	docker.createdSpecs = nil
	docker.stoppedIDs = nil

	_ = mgr.reconcileDCM(context.Background())

	if _, tracked := mgr.starvationTrack["tmpl-1"]; tracked {
		t.Error("starvation should be cleared after runtimes are running")
	}
}

func TestStarvationBoostRaisesPriority(t *testing.T) {
	mgr := newDCMTestManager(newMockDockerClient(), &mockPlatformClient{})

	pastThreshold := time.Now().Add(-starvationThreshold - time.Second)
	mgr.starvationTrack["tmpl-starved"] = pastThreshold

	targets := []RuntimeTarget{
		makeRuntimeTarget("tmpl-normal", "img:v1", 3, 2, 100),
		makeRuntimeTarget("tmpl-starved", "img:v1", 3, 2, 1),
	}

	boosted := mgr.boostStarvedTargets(targets)

	// Starved template should now have priority > 100.
	if boosted[0].TemplateID != "tmpl-starved" {
		t.Errorf("expected starved template first after boost, got %s", boosted[0].TemplateID)
	}
	if boosted[0].Priority <= 100 {
		t.Errorf("expected boosted priority > 100, got %d", boosted[0].Priority)
	}
}

func TestStarvationBoostDoesNotAffectNonStarvedTargets(t *testing.T) {
	mgr := newDCMTestManager(newMockDockerClient(), &mockPlatformClient{})

	targets := []RuntimeTarget{
		makeRuntimeTarget("tmpl-a", "img:v1", 3, 2, 50),
		makeRuntimeTarget("tmpl-b", "img:v1", 3, 2, 100),
	}

	boosted := mgr.boostStarvedTargets(targets)

	if boosted[0].TemplateID != "tmpl-b" {
		t.Errorf("expected tmpl-b first (highest priority), got %s", boosted[0].TemplateID)
	}
	if boosted[0].Priority != 100 {
		t.Errorf("expected priority unchanged at 100, got %d", boosted[0].Priority)
	}
}

func TestStarvedTemplatePreemptsHigherOriginalPriority(t *testing.T) {
	docker := newMockDockerClient()
	recentHB := time.Now().UTC().Format(time.RFC3339)
	docker.containers = makeDCMContainers("tmpl-normal", "img:v1", 10)

	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{
			makeRuntimeTarget("tmpl-normal", "img:v1", 10, 0, 100),
			makeRuntimeTarget("tmpl-starved", "img:v1", 3, 2, 1),
		},
		heartbeats: recentIdleHeartbeats("tmpl-normal", 10, recentHB),
	}
	mgr := newDCMTestManager(docker, platform)

	// Mark tmpl-starved as starved past threshold.
	pastThreshold := time.Now().Add(-starvationThreshold - time.Second)
	mgr.starvationTrack["tmpl-starved"] = pastThreshold

	err := mgr.reconcileDCM(context.Background())

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(docker.stoppedIDs) < 1 {
		t.Error("expected at least 1 preemption for starved template")
	}
	for _, spec := range docker.createdSpecs {
		if spec.Labels[labelDCMTemplateID] != "tmpl-starved" {
			t.Errorf("expected preemption beneficiary tmpl-starved, got %s", spec.Labels[labelDCMTemplateID])
		}
	}
}

func TestPruneStaleStarvationEntries(t *testing.T) {
	tracking := map[string]time.Time{
		"active":  time.Now(),
		"removed": time.Now(),
	}
	active := map[string]bool{"active": true}

	pruneStaleStarvationEntries(tracking, active)

	if _, ok := tracking["removed"]; ok {
		t.Error("expected removed template pruned from starvation tracking")
	}
	if _, ok := tracking["active"]; !ok {
		t.Error("expected active template retained in starvation tracking")
	}
}

func TestIsContainerIdleByHeartbeat(t *testing.T) {
	grouped := map[string][]ContainerInfo{
		"tmpl-1": {makeDCMContainer("c-1", "tmpl-1", "img:v1", "rt-1")},
	}

	t.Run("idleWhenNoHeartbeat", func(t *testing.T) {
		heartbeats := map[string]RuntimeHeartbeat{}
		if !isContainerIdleByHeartbeat("c-1", "tmpl-1", grouped, heartbeats) {
			t.Error("expected idle when no heartbeat exists")
		}
	})

	t.Run("idleWhenHeartbeatStateIdle", func(t *testing.T) {
		heartbeats := map[string]RuntimeHeartbeat{
			"rt-1": {RuntimeID: "rt-1", State: "idle"},
		}
		if !isContainerIdleByHeartbeat("c-1", "tmpl-1", grouped, heartbeats) {
			t.Error("expected idle when heartbeat state is idle")
		}
	})

	t.Run("notIdleWhenExecuting", func(t *testing.T) {
		heartbeats := map[string]RuntimeHeartbeat{
			"rt-1": {RuntimeID: "rt-1", State: "executing"},
		}
		if isContainerIdleByHeartbeat("c-1", "tmpl-1", grouped, heartbeats) {
			t.Error("expected not idle when heartbeat state is executing")
		}
	})

	t.Run("idleWhenContainerNotFound", func(t *testing.T) {
		heartbeats := map[string]RuntimeHeartbeat{}
		if !isContainerIdleByHeartbeat("c-unknown", "tmpl-1", grouped, heartbeats) {
			t.Error("expected idle when container not found in grouped")
		}
	})
}

func TestGracePeriodDuration(t *testing.T) {
	fallback := 30 * time.Second

	t.Run("usesGracePeriodWhenPositive", func(t *testing.T) {
		result := gracePeriodDuration(60, fallback)
		if result != 60*time.Second {
			t.Errorf("expected 60s, got %v", result)
		}
	})

	t.Run("usesFallbackWhenZero", func(t *testing.T) {
		result := gracePeriodDuration(0, fallback)
		if result != fallback {
			t.Errorf("expected fallback %v, got %v", fallback, result)
		}
	})

	t.Run("usesFallbackWhenNegative", func(t *testing.T) {
		result := gracePeriodDuration(-1, fallback)
		if result != fallback {
			t.Errorf("expected fallback %v, got %v", fallback, result)
		}
	})
}

// recentIdleHeartbeats creates heartbeats for containers produced by makeDCMContainers.
func recentIdleHeartbeats(templateID string, count int, timestamp string) []RuntimeHeartbeat {
	containers := makeDCMContainers(templateID, "img:v1", count)
	heartbeats := make([]RuntimeHeartbeat, count)
	for i, c := range containers {
		heartbeats[i] = RuntimeHeartbeat{
			RuntimeID:       c.Labels[labelDCMRuntimeID],
			TemplateID:      templateID,
			State:           "idle",
			LastHeartbeatAt: timestamp,
		}
	}
	return heartbeats
}
