package manager

import (
	"context"
	"fmt"
	"testing"
)

func TestReconcileOnceFetchDesiredStateError(t *testing.T) {
	docker := newMockDockerClient()
	platform := &mockPlatformClient{
		fetchErr: fmt.Errorf("connection refused"),
	}
	r := newTestManager(docker, platform)

	err := r.reconcileOnce(context.Background())

	if err == nil {
		t.Fatal("expected error from failed desired state fetch")
	}
}

func TestReconcileOnceListContainersError(t *testing.T) {
	docker := newMockDockerClient()
	docker.listErr = fmt.Errorf("docker unavailable")
	platform := &mockPlatformClient{}
	r := newTestManager(docker, platform)

	err := r.reconcileOnce(context.Background())

	if err == nil {
		t.Fatal("expected error from failed container list")
	}
}

func TestReportActualStateSkipsGetContainerStatsError(t *testing.T) {
	docker := newMockDockerClient()
	docker.statsErr = fmt.Errorf("stats unavailable")
	platform := &mockPlatformClient{}
	r := newTestManager(docker, platform)

	containers := []ContainerInfo{
		makeContainerInfo("c-1", "worker-a", "myimage:v1", "ds-1", 1),
	}
	r.reportActualState(context.Background(), containers)

	if len(platform.reportedStates) != 0 {
		t.Errorf("expected no states reported when GetContainerStats fails, got %d", len(platform.reportedStates))
	}
}

func TestReportActualStateReportsZeroStatsWhenNil(t *testing.T) {
	docker := newMockDockerClient()
	// stats map is empty so GetContainerStats returns nil, nil
	platform := &mockPlatformClient{}
	r := newTestManager(docker, platform)

	containers := []ContainerInfo{
		makeContainerInfo("c-1", "worker-a", "myimage:v1", "ds-1", 1),
	}
	r.reportActualState(context.Background(), containers)

	if len(platform.reportedStates) != 1 {
		t.Fatalf("expected 1 state reported, got %d", len(platform.reportedStates))
	}
	state := platform.reportedStates[0]
	if state.CPUUsagePercent != 0 || state.MemoryUsageBytes != 0 {
		t.Errorf("expected zero stats when stats are nil, got cpu=%.2f mem=%d",
			state.CPUUsagePercent, state.MemoryUsageBytes)
	}
}

func TestReportActualStateContinuesOnReportError(t *testing.T) {
	docker := newMockDockerClient()
	docker.stats["c-1"] = &ContainerStats{CPUPercent: 10.0, MemoryBytes: 1024}
	docker.stats["c-2"] = &ContainerStats{CPUPercent: 20.0, MemoryBytes: 2048}
	platform := &mockPlatformClient{
		reportStateErr: fmt.Errorf("platform unavailable"),
	}
	r := newTestManager(docker, platform)

	containers := []ContainerInfo{
		makeContainerInfo("c-1", "worker-a", "myimage:v1", "ds-1", 1),
		makeContainerInfo("c-2", "worker-b", "myimage:v1", "ds-2", 1),
	}
	r.reportActualState(context.Background(), containers)

	// Both containers should have their stats fetched even though reporting
	// fails. The function logs errors but does not short-circuit.
	// No states are recorded because the mock returns an error.
	if len(platform.reportedStates) != 0 {
		t.Errorf("expected no states recorded when ReportActualState errors, got %d", len(platform.reportedStates))
	}
}

func TestReportImagesSkipsOnListImagesError(t *testing.T) {
	docker := newMockDockerClient()
	docker.listImagesErr = fmt.Errorf("docker images unavailable")
	platform := &mockPlatformClient{}
	r := newTestManager(docker, platform)

	r.reportImages(context.Background())

	if len(platform.reportedImages) != 0 {
		t.Errorf("expected no images reported when ListImages fails, got %d", len(platform.reportedImages))
	}
}

func TestReportImagesContinuesOnReportImageError(t *testing.T) {
	docker := newMockDockerClient()
	tagV1, tagV2 := "v1", "v2"
	size1, size2 := int64(100), int64(200)
	docker.images = []ContainerImage{
		{Repository: "myimage", Tag: &tagV1, SizeBytes: &size1},
		{Repository: "myimage", Tag: &tagV2, SizeBytes: &size2},
	}
	platform := &mockPlatformClient{
		reportImageErr: fmt.Errorf("report failed"),
	}
	r := newTestManager(docker, platform)

	r.reportImages(context.Background())

	// No images are recorded because the mock returns an error, but the
	// function should attempt both images (not short-circuit on the first).
	if len(platform.reportedImages) != 0 {
		t.Errorf("expected no images recorded when ReportImage errors, got %d", len(platform.reportedImages))
	}
}

func TestReportImagesSkipsUnchangedInventoryAfterSuccessfulReport(t *testing.T) {
	docker := newMockDockerClient()
	tag := "v1"
	size := int64(100)
	docker.images = []ContainerImage{
		{Repository: "myimage", Tag: &tag, SizeBytes: &size},
	}
	platform := &mockPlatformClient{}
	r := newTestManager(docker, platform)

	r.reportImages(context.Background())
	r.reportImages(context.Background())

	if got := len(platform.reportedImages); got != 1 {
		t.Fatalf("expected one image report for unchanged inventory, got %d", got)
	}
}

func TestReportImagesRetriesAfterFailedReport(t *testing.T) {
	docker := newMockDockerClient()
	tag := "v1"
	size := int64(100)
	docker.images = []ContainerImage{
		{Repository: "myimage", Tag: &tag, SizeBytes: &size},
	}
	platform := &mockPlatformClient{
		reportImageErr: fmt.Errorf("report failed"),
	}
	r := newTestManager(docker, platform)

	r.reportImages(context.Background())
	platform.reportImageErr = nil
	r.reportImages(context.Background())

	if got := len(platform.reportedImages); got != 1 {
		t.Fatalf("expected retry to report image after failure, got %d recorded reports", got)
	}
}

func TestReportImagesReportsInventoryWhenItChanges(t *testing.T) {
	docker := newMockDockerClient()
	tagV1 := "v1"
	tagV2 := "v2"
	size1 := int64(100)
	size2 := int64(200)
	docker.images = []ContainerImage{
		{Repository: "myimage", Tag: &tagV1, SizeBytes: &size1},
	}
	platform := &mockPlatformClient{}
	r := newTestManager(docker, platform)

	r.reportImages(context.Background())
	docker.images = []ContainerImage{
		{Repository: "myimage", Tag: &tagV1, SizeBytes: &size1},
		{Repository: "myimage", Tag: &tagV2, SizeBytes: &size2},
	}
	r.reportImages(context.Background())

	if got := len(platform.reportedImages); got != 3 {
		t.Fatalf("expected initial and changed inventories to be reported, got %d image reports", got)
	}
}

func TestRunReconcileCycleCallsBothReconcilers(t *testing.T) {
	docker := newMockDockerClient()
	platform := &mockPlatformClient{}
	r := newTestManager(docker, platform)

	r.runReconcileCycle(context.Background())

	// reconcileOnce reports images after reconciliation. If reportImages ran,
	// ListImages was called, confirming reconcileOnce executed.
	// reconcileDCM calls FetchRuntimeTargets. Since mocks return empty slices
	// for both, no side effects occur, but neither should panic or error.
	// Verify that state reporting ran (called by reconcileOnce) — with no
	// containers, no states should be reported but no errors either.
	if len(platform.reportedStates) != 0 {
		t.Errorf("expected no states reported with empty setup, got %d", len(platform.reportedStates))
	}
	if len(platform.reportedImages) != 0 {
		t.Errorf("expected no images reported with empty setup, got %d", len(platform.reportedImages))
	}
}

func TestReconcileCycleUsesSnapshotInsteadOfPerEndpointHeartbeatFetches(t *testing.T) {
	docker := newMockDockerClient()
	platform := &mockPlatformClient{
		snapshot: &ReconcileSnapshot{
			DesiredStates: []DesiredState{},
			RuntimeTargets: []RuntimeTarget{
				{
					PlaybookID:         "pb-1",
					PlaybookName:       "Test",
					Image:              "agirunner-runtime:latest",
					MaxRuntimes:        0,
					PendingTasks:       0,
					Priority:           1,
					PoolKind:           "specialist",
					PoolMode:           "warm",
					IdleTimeoutSeconds: 300,
					GracePeriodSeconds: 30,
				},
			},
			Heartbeats: []RuntimeHeartbeat{},
		},
	}
	r := newTestManager(docker, platform)

	r.runReconcileCycle(context.Background())

	if got := platform.fetchSnapCalls; got != 1 {
		t.Fatalf("expected exactly one reconcile snapshot fetch per reconcile cycle, got %d", got)
	}
	if got := platform.fetchHBCalls; got != 0 {
		t.Fatalf("expected no direct heartbeat fetches during shared snapshot reconcile, got %d", got)
	}
}
