package manager

import (
	"context"
	"fmt"
	"testing"
	"time"
)

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
