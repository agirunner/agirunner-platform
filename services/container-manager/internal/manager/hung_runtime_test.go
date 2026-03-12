package manager

import (
	"context"
	"testing"
	"time"
)

func TestDetectHungRuntimesStaleHeartbeatStopsContainer(t *testing.T) {
	docker := newMockDockerClient()
	docker.containers = []ContainerInfo{
		makeDCMContainer("c-1", "tmpl-1", "runtime:v1", "rt-1"),
	}
	staleTime := time.Now().UTC().Add(-2 * time.Minute).Format(time.RFC3339)
	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{},
		heartbeats: []RuntimeHeartbeat{
			{RuntimeID: "rt-1", PlaybookID: "tmpl-1", State: "idle", LastHeartbeatAt: staleTime, ActiveTaskID: "task-42"},
		},
	}
	mgr := newDCMTestManager(docker, platform)

	mgr.detectHungRuntimes(context.Background())

	if len(docker.stoppedIDs) != 1 || docker.stoppedIDs[0] != "c-1" {
		t.Errorf("expected container c-1 stopped, got %v", docker.stoppedIDs)
	}
	if len(platform.failedTasks) != 1 {
		t.Fatalf("expected 1 failed task, got %d", len(platform.failedTasks))
	}
	if platform.failedTasks[0].TaskID != "task-42" {
		t.Errorf("expected task-42 failed, got %s", platform.failedTasks[0].TaskID)
	}
}

func TestDetectHungRuntimesDockerUnhealthyStopsContainer(t *testing.T) {
	docker := newMockDockerClient()
	docker.containers = []ContainerInfo{
		makeDCMContainer("c-1", "tmpl-1", "runtime:v1", "rt-1"),
	}
	docker.healthStatuses = map[string]*ContainerHealthStatus{
		"c-1": {Status: "unhealthy"},
	}
	recentTime := time.Now().UTC().Format(time.RFC3339)
	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{},
		heartbeats: []RuntimeHeartbeat{
			{RuntimeID: "rt-1", PlaybookID: "tmpl-1", State: "running", LastHeartbeatAt: recentTime, ActiveTaskID: "task-99"},
		},
	}
	mgr := newDCMTestManager(docker, platform)

	mgr.detectHungRuntimes(context.Background())

	if len(docker.stoppedIDs) != 1 || docker.stoppedIDs[0] != "c-1" {
		t.Errorf("expected container c-1 stopped, got %v", docker.stoppedIDs)
	}
	if len(platform.failedTasks) != 1 || platform.failedTasks[0].TaskID != "task-99" {
		t.Errorf("expected task-99 failed, got %v", platform.failedTasks)
	}
}

func TestDetectHungRuntimesHealthyRuntimeNotStopped(t *testing.T) {
	docker := newMockDockerClient()
	docker.containers = []ContainerInfo{
		makeDCMContainer("c-1", "tmpl-1", "runtime:v1", "rt-1"),
	}
	recentTime := time.Now().UTC().Format(time.RFC3339)
	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{},
		heartbeats: []RuntimeHeartbeat{
			{RuntimeID: "rt-1", PlaybookID: "tmpl-1", State: "idle", LastHeartbeatAt: recentTime},
		},
	}
	mgr := newDCMTestManager(docker, platform)

	mgr.detectHungRuntimes(context.Background())

	if len(docker.stoppedIDs) != 0 {
		t.Errorf("expected no containers stopped, got %v", docker.stoppedIDs)
	}
	if len(platform.failedTasks) != 0 {
		t.Errorf("expected no failed tasks, got %v", platform.failedTasks)
	}
}

func TestDetectHungRuntimesNoHeartbeatNotTreatedAsStale(t *testing.T) {
	docker := newMockDockerClient()
	docker.containers = []ContainerInfo{
		makeDCMContainer("c-1", "tmpl-1", "runtime:v1", "rt-new"),
	}
	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{},
		heartbeats:     []RuntimeHeartbeat{},
	}
	mgr := newDCMTestManager(docker, platform)

	mgr.detectHungRuntimes(context.Background())

	if len(docker.stoppedIDs) != 0 {
		t.Errorf("expected no containers stopped (new runtime, no heartbeat yet), got %v", docker.stoppedIDs)
	}
}

func TestDetectHungRuntimesSkipsDrainingContainers(t *testing.T) {
	docker := newMockDockerClient()
	c := makeDCMContainer("c-1", "tmpl-1", "runtime:v1", "rt-1")
	c.Labels[labelDCMDraining] = "true"
	docker.containers = []ContainerInfo{c}
	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{},
		heartbeats:     []RuntimeHeartbeat{},
	}
	mgr := newDCMTestManager(docker, platform)

	mgr.detectHungRuntimes(context.Background())

	if len(docker.stoppedIDs) != 0 {
		t.Errorf("expected draining container not stopped, got %v", docker.stoppedIDs)
	}
}

func TestDetectHungRuntimesStaleNoActiveTaskSkipsFailTask(t *testing.T) {
	docker := newMockDockerClient()
	docker.containers = []ContainerInfo{
		makeDCMContainer("c-1", "tmpl-1", "runtime:v1", "rt-1"),
	}
	staleTime := time.Now().UTC().Add(-2 * time.Minute).Format(time.RFC3339)
	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{},
		heartbeats: []RuntimeHeartbeat{
			{RuntimeID: "rt-1", PlaybookID: "tmpl-1", State: "idle", LastHeartbeatAt: staleTime},
		},
	}
	mgr := newDCMTestManager(docker, platform)

	mgr.detectHungRuntimes(context.Background())

	if len(docker.stoppedIDs) != 1 {
		t.Errorf("expected container stopped, got %v", docker.stoppedIDs)
	}
	if len(platform.failedTasks) != 0 {
		t.Errorf("expected no failed tasks (no active task), got %v", platform.failedTasks)
	}
}

func TestDetectHungRuntimesLogsFleetEvent(t *testing.T) {
	docker := newMockDockerClient()
	docker.containers = []ContainerInfo{
		makeDCMContainer("c-1", "tmpl-1", "runtime:v1", "rt-1"),
	}
	staleTime := time.Now().UTC().Add(-2 * time.Minute).Format(time.RFC3339)
	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{},
		heartbeats: []RuntimeHeartbeat{
			{RuntimeID: "rt-1", PlaybookID: "tmpl-1", State: "idle", LastHeartbeatAt: staleTime},
		},
	}
	mgr := newDCMTestManager(docker, platform)

	mgr.detectHungRuntimes(context.Background())

	found := false
	for _, ev := range platform.reportedEvents {
		if ev.EventType == "runtime_hung" && ev.RuntimeID == "rt-1" {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("expected runtime_hung fleet event for rt-1, got events: %v", platform.reportedEvents)
	}
}

func TestDetectHungRuntimesMultipleContainersMixed(t *testing.T) {
	docker := newMockDockerClient()
	docker.containers = []ContainerInfo{
		makeDCMContainer("c-1", "tmpl-1", "runtime:v1", "rt-healthy"),
		makeDCMContainer("c-2", "tmpl-1", "runtime:v1", "rt-stale"),
		makeDCMContainer("c-3", "tmpl-2", "runtime:v2", "rt-unhealthy"),
	}
	docker.healthStatuses = map[string]*ContainerHealthStatus{
		"c-3": {Status: "unhealthy"},
	}
	recentTime := time.Now().UTC().Format(time.RFC3339)
	staleTime := time.Now().UTC().Add(-2 * time.Minute).Format(time.RFC3339)
	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{},
		heartbeats: []RuntimeHeartbeat{
			{RuntimeID: "rt-healthy", PlaybookID: "tmpl-1", State: "idle", LastHeartbeatAt: recentTime},
			{RuntimeID: "rt-stale", PlaybookID: "tmpl-1", State: "running", LastHeartbeatAt: staleTime, ActiveTaskID: "task-A"},
			{RuntimeID: "rt-unhealthy", PlaybookID: "tmpl-2", State: "running", LastHeartbeatAt: recentTime, ActiveTaskID: "task-B"},
		},
	}
	mgr := newDCMTestManager(docker, platform)

	mgr.detectHungRuntimes(context.Background())

	if len(docker.stoppedIDs) != 2 {
		t.Fatalf("expected 2 containers stopped (stale + unhealthy), got %d: %v", len(docker.stoppedIDs), docker.stoppedIDs)
	}
	if len(platform.failedTasks) != 2 {
		t.Fatalf("expected 2 failed tasks, got %d", len(platform.failedTasks))
	}
	taskIDs := map[string]bool{}
	for _, ft := range platform.failedTasks {
		taskIDs[ft.TaskID] = true
	}
	if !taskIDs["task-A"] || !taskIDs["task-B"] {
		t.Errorf("expected task-A and task-B failed, got %v", platform.failedTasks)
	}
}

func TestDetectHungRuntimesFetchHeartbeatsErrorContinuesSafely(t *testing.T) {
	docker := newMockDockerClient()
	docker.containers = []ContainerInfo{
		makeDCMContainer("c-1", "tmpl-1", "runtime:v1", "rt-1"),
	}
	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{},
		fetchHBErr:     errForTest("heartbeat unavailable"),
	}
	mgr := newDCMTestManager(docker, platform)

	mgr.detectHungRuntimes(context.Background())

	if len(docker.stoppedIDs) != 0 {
		t.Errorf("expected no containers stopped on heartbeat fetch error, got %v", docker.stoppedIDs)
	}
}

func TestIsStaleHeartbeatNilReturnsFalse(t *testing.T) {
	if isStaleHeartbeat(nil, time.Now().UTC()) {
		t.Error("expected nil heartbeat to not be stale (runtime may be new)")
	}
}

func TestIsStaleHeartbeatInvalidTimestampReturnsTrue(t *testing.T) {
	hb := &RuntimeHeartbeat{LastHeartbeatAt: "not-a-timestamp"}
	if !isStaleHeartbeat(hb, time.Now().UTC()) {
		t.Error("expected invalid timestamp to be stale")
	}
}

func TestIsStaleHeartbeatRecentReturnsFalse(t *testing.T) {
	hb := &RuntimeHeartbeat{LastHeartbeatAt: time.Now().UTC().Format(time.RFC3339)}
	if isStaleHeartbeat(hb, time.Now().UTC()) {
		t.Error("expected recent heartbeat to not be stale")
	}
}

func TestIsStaleHeartbeatOldReturnsTrue(t *testing.T) {
	old := time.Now().UTC().Add(-2 * time.Minute).Format(time.RFC3339)
	hb := &RuntimeHeartbeat{LastHeartbeatAt: old}
	if !isStaleHeartbeat(hb, time.Now().UTC()) {
		t.Error("expected old heartbeat to be stale")
	}
}

func TestActiveTaskIDReturnsEmptyForNilHeartbeat(t *testing.T) {
	if id := activeTaskID(nil); id != "" {
		t.Errorf("expected empty, got %s", id)
	}
}

func TestActiveTaskIDReturnsIDWhenPresent(t *testing.T) {
	hb := &RuntimeHeartbeat{ActiveTaskID: "task-123"}
	if id := activeTaskID(hb); id != "task-123" {
		t.Errorf("expected task-123, got %s", id)
	}
}

func TestIndexContainersByRuntimeID(t *testing.T) {
	containers := []ContainerInfo{
		makeDCMContainer("c-1", "tmpl-1", "img:v1", "rt-A"),
		makeDCMContainer("c-2", "tmpl-2", "img:v1", "rt-B"),
	}
	m := indexContainersByRuntimeID(containers)
	if len(m) != 2 {
		t.Fatalf("expected 2 entries, got %d", len(m))
	}
	if m["rt-A"].ID != "c-1" {
		t.Errorf("expected c-1 for rt-A, got %s", m["rt-A"].ID)
	}
}

func TestOrphanHeartbeatWithActiveTaskFailsTask(t *testing.T) {
	docker := newMockDockerClient()
	// No containers — the heartbeat is orphaned.
	staleTime := time.Now().UTC().Add(-2 * time.Minute).Format(time.RFC3339)
	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{},
		heartbeats: []RuntimeHeartbeat{
			{RuntimeID: "rt-orphan", PlaybookID: "tmpl-1", State: "running", LastHeartbeatAt: staleTime, ActiveTaskID: "task-orphan"},
		},
	}
	mgr := newDCMTestManager(docker, platform)

	mgr.detectHungRuntimes(context.Background())

	if len(platform.failedTasks) != 1 || platform.failedTasks[0].TaskID != "task-orphan" {
		t.Errorf("expected task-orphan failed via orphan heartbeat path, got %v", platform.failedTasks)
	}
}

func TestOrphanHeartbeatNotStaleIsSkipped(t *testing.T) {
	docker := newMockDockerClient()
	// No containers — heartbeat is orphaned but recent, so should be skipped.
	recentTime := time.Now().UTC().Format(time.RFC3339)
	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{},
		heartbeats: []RuntimeHeartbeat{
			{RuntimeID: "rt-recent-orphan", PlaybookID: "tmpl-1", State: "running", LastHeartbeatAt: recentTime, ActiveTaskID: "task-skip"},
		},
	}
	mgr := newDCMTestManager(docker, platform)

	mgr.detectHungRuntimes(context.Background())

	if len(platform.failedTasks) != 0 {
		t.Errorf("expected no failed tasks for non-stale orphan heartbeat, got %v", platform.failedTasks)
	}
}

func TestOrphanHeartbeatMixedWithContainerBacked(t *testing.T) {
	docker := newMockDockerClient()
	docker.containers = []ContainerInfo{
		makeDCMContainer("c-1", "tmpl-1", "runtime:v1", "rt-has-container"),
	}
	staleTime := time.Now().UTC().Add(-2 * time.Minute).Format(time.RFC3339)
	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{},
		heartbeats: []RuntimeHeartbeat{
			// This heartbeat has a matching container — not an orphan.
			{RuntimeID: "rt-has-container", PlaybookID: "tmpl-1", State: "idle", LastHeartbeatAt: staleTime, ActiveTaskID: "task-container"},
			// This heartbeat has no container — orphan and stale.
			{RuntimeID: "rt-no-container", PlaybookID: "tmpl-1", State: "running", LastHeartbeatAt: staleTime, ActiveTaskID: "task-orphan"},
		},
	}
	mgr := newDCMTestManager(docker, platform)

	mgr.detectHungRuntimes(context.Background())

	// The orphan path should only fail the orphan's task, not the container-backed one
	// (the container-backed one gets handled by handleHungRuntime instead).
	orphanFailed := false
	for _, ft := range platform.failedTasks {
		if ft.TaskID == "task-orphan" {
			orphanFailed = true
		}
	}
	if !orphanFailed {
		t.Errorf("expected task-orphan failed via orphan heartbeat path, got %v", platform.failedTasks)
	}
}

func TestFailActiveTaskLogsErrorOnFailTaskFailure(t *testing.T) {
	docker := newMockDockerClient()
	docker.containers = []ContainerInfo{
		makeDCMContainer("c-1", "tmpl-1", "runtime:v1", "rt-1"),
	}
	staleTime := time.Now().UTC().Add(-2 * time.Minute).Format(time.RFC3339)
	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{},
		heartbeats: []RuntimeHeartbeat{
			{RuntimeID: "rt-1", PlaybookID: "tmpl-1", State: "running", LastHeartbeatAt: staleTime, ActiveTaskID: "task-fail"},
		},
		failTaskErr: errForTest("platform unavailable"),
	}
	mgr := newDCMTestManager(docker, platform)

	mgr.detectHungRuntimes(context.Background())

	// FailTask returned an error, so no tasks should be recorded as failed.
	if len(platform.failedTasks) != 0 {
		t.Errorf("expected no recorded failed tasks when FailTask errors, got %v", platform.failedTasks)
	}
	// Container should still be stopped despite the FailTask error.
	if len(docker.stoppedIDs) != 1 || docker.stoppedIDs[0] != "c-1" {
		t.Errorf("expected container c-1 still stopped despite FailTask error, got %v", docker.stoppedIDs)
	}
}

func TestIndexHeartbeatsByRuntimeID(t *testing.T) {
	hbs := []RuntimeHeartbeat{
		{RuntimeID: "rt-1"},
		{RuntimeID: "rt-2"},
	}
	m := indexHeartbeatsByRuntimeID(hbs)
	if len(m) != 2 {
		t.Fatalf("expected 2 entries, got %d", len(m))
	}
	if m["rt-1"].RuntimeID != "rt-1" {
		t.Errorf("expected rt-1, got %s", m["rt-1"].RuntimeID)
	}
}

func errForTest(msg string) error {
	return &testError{msg: msg}
}

type testError struct {
	msg string
}

func (e *testError) Error() string {
	return e.msg
}
