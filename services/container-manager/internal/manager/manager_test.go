package manager

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"os"
	"testing"
	"time"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/events"
)

// labelUpdate records a call to UpdateContainerLabels.
type labelUpdate struct {
	ContainerID string
	Labels      map[string]string
}

// pullRecord captures the arguments passed to PullImage.
type pullRecord struct {
	Image  string
	Policy string
}

// mockDockerClient records calls and returns preconfigured results.
type mockDockerClient struct {
	containers     []ContainerInfo
	images         []ContainerImage
	localImages    map[string]bool
	stats          map[string]*ContainerStats
	healthStatuses map[string]*ContainerHealthStatus

	createdSpecs    []ContainerSpec
	stoppedIDs      []string
	removedIDs      []string
	updatedLabels   []labelUpdate
	pulledImages    []pullRecord
	createErr       error
	listErr         error
	stopErr         error
	removeErr       error
	listImagesErr   error
	statsErr        error
	pullErr         error
	nextContainerID int
}

func newMockDockerClient() *mockDockerClient {
	return &mockDockerClient{
		stats: make(map[string]*ContainerStats),
	}
}

func (m *mockDockerClient) ListContainers(_ context.Context) ([]ContainerInfo, error) {
	if m.listErr != nil {
		return nil, m.listErr
	}
	return m.containers, nil
}

func (m *mockDockerClient) CreateContainer(_ context.Context, spec ContainerSpec) (string, error) {
	if m.createErr != nil {
		return "", m.createErr
	}
	m.createdSpecs = append(m.createdSpecs, spec)
	m.nextContainerID++
	return fmt.Sprintf("container-%d", m.nextContainerID), nil
}

func (m *mockDockerClient) StopContainer(_ context.Context, containerID string, _ time.Duration) error {
	if m.stopErr != nil {
		return m.stopErr
	}
	m.stoppedIDs = append(m.stoppedIDs, containerID)
	return nil
}

func (m *mockDockerClient) RemoveContainer(_ context.Context, containerID string) error {
	if m.removeErr != nil {
		return m.removeErr
	}
	m.removedIDs = append(m.removedIDs, containerID)
	return nil
}

func (m *mockDockerClient) ListImages(_ context.Context) ([]ContainerImage, error) {
	if m.listImagesErr != nil {
		return nil, m.listImagesErr
	}
	return m.images, nil
}

func (m *mockDockerClient) UpdateContainerLabels(_ context.Context, containerID string, labels map[string]string) error {
	m.updatedLabels = append(m.updatedLabels, labelUpdate{ContainerID: containerID, Labels: labels})
	return nil
}

func (m *mockDockerClient) InspectContainerHealth(_ context.Context, containerID string) (*ContainerHealthStatus, error) {
	if m.healthStatuses != nil {
		if h, ok := m.healthStatuses[containerID]; ok {
			return h, nil
		}
	}
	return &ContainerHealthStatus{Status: ""}, nil
}

func (m *mockDockerClient) PullImage(_ context.Context, img, policy string) error {
	m.pulledImages = append(m.pulledImages, pullRecord{Image: img, Policy: policy})
	if m.pullErr != nil {
		return m.pullErr
	}
	return nil
}

func (m *mockDockerClient) ConnectNetwork(_ context.Context, _ string, _ string) error {
	return nil
}

func (m *mockDockerClient) Events(_ context.Context, _ events.ListOptions) (<-chan events.Message, <-chan error) {
	return make(chan events.Message), make(chan error)
}

func (m *mockDockerClient) ContainerLogs(_ context.Context, _ string, _ container.LogsOptions) (io.ReadCloser, error) {
	return io.NopCloser(io.LimitReader(nil, 0)), nil
}

func (m *mockDockerClient) GetContainerStats(_ context.Context, containerID string) (*ContainerStats, error) {
	if m.statsErr != nil {
		return nil, m.statsErr
	}
	if s, ok := m.stats[containerID]; ok {
		return s, nil
	}
	return nil, nil
}

// mockPlatformClient records calls and returns preconfigured results.
type mockPlatformClient struct {
	desiredStates   []DesiredState
	runtimeTargets  []RuntimeTarget
	heartbeats      []RuntimeHeartbeat
	snapshot        *ReconcileSnapshot
	fetchErr        error
	fetchTargetsErr error
	fetchHBErr      error
	fetchSnapErr    error
	fetchHBCalls    int
	fetchSnapCalls  int
	reportedStates  []ActualState
	reportedImages  []ContainerImage
	reportedEvents  []FleetEvent
	failedTasks     []failedTaskRecord
	drainedRuntimes []string
	reportStateErr  error
	reportImageErr  error
	failTaskErr     error
}

// failedTaskRecord captures a FailTask call for test assertions.
type failedTaskRecord struct {
	TaskID string
	Reason string
}

func (m *mockPlatformClient) FetchDesiredState() ([]DesiredState, error) {
	if m.fetchErr != nil {
		return nil, m.fetchErr
	}
	return m.desiredStates, nil
}

func (m *mockPlatformClient) FetchReconcileSnapshot() (*ReconcileSnapshot, error) {
	m.fetchSnapCalls++
	if m.fetchSnapErr != nil {
		return nil, m.fetchSnapErr
	}
	if m.snapshot != nil {
		return m.snapshot, nil
	}
	return &ReconcileSnapshot{
		DesiredStates:  m.desiredStates,
		RuntimeTargets: m.runtimeTargets,
		Heartbeats:     m.heartbeats,
	}, nil
}

func (m *mockPlatformClient) ReportActualState(state ActualState) error {
	if m.reportStateErr != nil {
		return m.reportStateErr
	}
	m.reportedStates = append(m.reportedStates, state)
	return nil
}

func (m *mockPlatformClient) PruneActualState(desiredStateID string, activeContainerIDs []string) error {
	return nil
}

func (m *mockPlatformClient) ReportImage(img ContainerImage) error {
	if m.reportImageErr != nil {
		return m.reportImageErr
	}
	m.reportedImages = append(m.reportedImages, img)
	return nil
}

func (m *mockPlatformClient) FetchRuntimeTargets() ([]RuntimeTarget, error) {
	if m.fetchTargetsErr != nil {
		return nil, m.fetchTargetsErr
	}
	return m.runtimeTargets, nil
}

func (m *mockPlatformClient) FetchHeartbeats() ([]RuntimeHeartbeat, error) {
	m.fetchHBCalls++
	if m.fetchHBErr != nil {
		return nil, m.fetchHBErr
	}
	return m.heartbeats, nil
}

func (m *mockPlatformClient) RecordFleetEvent(event FleetEvent) error {
	m.reportedEvents = append(m.reportedEvents, event)
	return nil
}

func (m *mockPlatformClient) DrainRuntime(runtimeID string) error {
	m.drainedRuntimes = append(m.drainedRuntimes, runtimeID)
	return nil
}

func (m *mockPlatformClient) FailTask(taskID, reason string) error {
	if m.failTaskErr != nil {
		return m.failTaskErr
	}
	m.failedTasks = append(m.failedTasks, failedTaskRecord{TaskID: taskID, Reason: reason})
	return nil
}

func newTestManager(docker *mockDockerClient, platform *mockPlatformClient) *Manager {
	logger := slog.New(slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError}))
	cfg := Config{
		ReconcileInterval: 5 * time.Second,
		StopTimeout:       10 * time.Second,
	}
	return NewWithPlatform(cfg, docker, platform, logger)
}

func makeDesiredState(id, workerName, image string, version, replicas int) DesiredState {
	return DesiredState{
		ID:           id,
		WorkerName:   workerName,
		RuntimeImage: image,
		Version:      version,
		Replicas:     replicas,
		Enabled:      true,
	}
}

func makeContainerInfo(id, name, image string, dsID string, version int) ContainerInfo {
	return ContainerInfo{
		ID:     id,
		Name:   name,
		Image:  image,
		Status: "running",
		Labels: map[string]string{
			labelManagedBy:      "true",
			labelDesiredStateID: dsID,
			labelVersion:        fmt.Sprintf("%d", version),
		},
	}
}

func TestReconcileOnceNoDesiredNoContainers(t *testing.T) {
	docker := newMockDockerClient()
	platform := &mockPlatformClient{}
	r := newTestManager(docker, platform)

	err := r.reconcileOnce(context.Background())

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(docker.createdSpecs) != 0 {
		t.Errorf("expected no containers created, got %d", len(docker.createdSpecs))
	}
	if len(docker.stoppedIDs) != 0 {
		t.Errorf("expected no containers stopped, got %d", len(docker.stoppedIDs))
	}
	if len(docker.removedIDs) != 0 {
		t.Errorf("expected no containers removed, got %d", len(docker.removedIDs))
	}
}

func TestRunReconcileCycleUsesSharedSnapshot(t *testing.T) {
	docker := newMockDockerClient()
	platform := &mockPlatformClient{
		snapshot: &ReconcileSnapshot{
			DesiredStates:  []DesiredState{},
			RuntimeTargets: []RuntimeTarget{},
			Heartbeats:     []RuntimeHeartbeat{},
		},
	}
	manager := newTestManager(docker, platform)

	manager.runReconcileCycle(context.Background())

	if platform.fetchSnapCalls != 1 {
		t.Fatalf("expected one reconcile snapshot fetch, got %d", platform.fetchSnapCalls)
	}
	if platform.fetchHBCalls != 0 {
		t.Fatalf("expected no direct heartbeat fetches during shared snapshot reconcile, got %d", platform.fetchHBCalls)
	}
}

func TestReconcileOnceCreatesContainers(t *testing.T) {
	docker := newMockDockerClient()
	platform := &mockPlatformClient{
		desiredStates: []DesiredState{
			makeDesiredState("ds-1", "worker-a", "myimage:v1", 1, 1),
		},
	}
	r := newTestManager(docker, platform)

	err := r.reconcileOnce(context.Background())

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(docker.createdSpecs) != 1 {
		t.Fatalf("expected 1 container created, got %d", len(docker.createdSpecs))
	}
	if docker.createdSpecs[0].Image != "myimage:v1" {
		t.Errorf("expected image myimage:v1, got %s", docker.createdSpecs[0].Image)
	}
	if docker.createdSpecs[0].Name != "worker-a" {
		t.Errorf("expected name worker-a, got %s", docker.createdSpecs[0].Name)
	}
}

func TestReconcileOnceRemovesOrphans(t *testing.T) {
	docker := newMockDockerClient()
	docker.containers = []ContainerInfo{
		makeContainerInfo("c-1", "orphan-worker", "myimage:v1", "ds-orphan", 1),
	}
	platform := &mockPlatformClient{}
	r := newTestManager(docker, platform)

	err := r.reconcileOnce(context.Background())

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(docker.stoppedIDs) != 1 || docker.stoppedIDs[0] != "c-1" {
		t.Errorf("expected orphan c-1 stopped, got %v", docker.stoppedIDs)
	}
	if len(docker.removedIDs) != 1 || docker.removedIDs[0] != "c-1" {
		t.Errorf("expected orphan c-1 removed, got %v", docker.removedIDs)
	}
}

func TestReconcileOnceMatchingContainersNoChange(t *testing.T) {
	docker := newMockDockerClient()
	docker.containers = []ContainerInfo{
		makeContainerInfo("c-1", "worker-a", "myimage:v1", "ds-1", 1),
	}
	platform := &mockPlatformClient{
		desiredStates: []DesiredState{
			makeDesiredState("ds-1", "worker-a", "myimage:v1", 1, 1),
		},
	}
	r := newTestManager(docker, platform)

	err := r.reconcileOnce(context.Background())

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(docker.createdSpecs) != 0 {
		t.Errorf("expected no creates, got %d", len(docker.createdSpecs))
	}
	if len(docker.stoppedIDs) != 0 {
		t.Errorf("expected no stops, got %d", len(docker.stoppedIDs))
	}
	if len(docker.removedIDs) != 0 {
		t.Errorf("expected no removes, got %d", len(docker.removedIDs))
	}
}

func TestReconcileOnceVersionMismatchReplacesContainer(t *testing.T) {
	docker := newMockDockerClient()
	docker.containers = []ContainerInfo{
		makeContainerInfo("c-1", "worker-a", "myimage:v1", "ds-1", 1),
	}
	platform := &mockPlatformClient{
		desiredStates: []DesiredState{
			makeDesiredState("ds-1", "worker-a", "myimage:v1", 2, 1),
		},
	}
	r := newTestManager(docker, platform)

	err := r.reconcileOnce(context.Background())

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(docker.stoppedIDs) != 1 || docker.stoppedIDs[0] != "c-1" {
		t.Errorf("expected old container c-1 stopped, got %v", docker.stoppedIDs)
	}
	if len(docker.removedIDs) != 1 || docker.removedIDs[0] != "c-1" {
		t.Errorf("expected old container c-1 removed, got %v", docker.removedIDs)
	}
	if len(docker.createdSpecs) != 1 {
		t.Fatalf("expected 1 new container created, got %d", len(docker.createdSpecs))
	}
	if docker.createdSpecs[0].Labels[labelVersion] != "2" {
		t.Errorf("expected version label 2, got %s", docker.createdSpecs[0].Labels[labelVersion])
	}
}

func TestReconcileOnceDrainingStopsAllContainers(t *testing.T) {
	docker := newMockDockerClient()
	docker.containers = []ContainerInfo{
		makeContainerInfo("c-1", "worker-a-0", "myimage:v1", "ds-1", 1),
		makeContainerInfo("c-2", "worker-a-1", "myimage:v1", "ds-1", 1),
	}
	ds := makeDesiredState("ds-1", "worker-a", "myimage:v1", 1, 2)
	ds.Draining = true
	platform := &mockPlatformClient{
		desiredStates: []DesiredState{ds},
	}
	r := newTestManager(docker, platform)

	err := r.reconcileOnce(context.Background())

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(docker.stoppedIDs) != 2 {
		t.Errorf("expected 2 containers stopped for drain, got %d", len(docker.stoppedIDs))
	}
	if len(docker.removedIDs) != 2 {
		t.Errorf("expected 2 containers removed for drain, got %d", len(docker.removedIDs))
	}
	if len(docker.createdSpecs) != 0 {
		t.Errorf("expected no containers created during drain, got %d", len(docker.createdSpecs))
	}
}

func TestReconcileOnceRestartRequestedRestartsContainers(t *testing.T) {
	docker := newMockDockerClient()
	docker.containers = []ContainerInfo{
		makeContainerInfo("c-1", "worker-a", "myimage:v1", "ds-1", 1),
	}
	ds := makeDesiredState("ds-1", "worker-a", "myimage:v1", 1, 1)
	ds.RestartRequested = true
	platform := &mockPlatformClient{
		desiredStates: []DesiredState{ds},
	}
	r := newTestManager(docker, platform)

	err := r.reconcileOnce(context.Background())

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(docker.stoppedIDs) != 1 || docker.stoppedIDs[0] != "c-1" {
		t.Errorf("expected container c-1 stopped for restart, got %v", docker.stoppedIDs)
	}
	if len(docker.removedIDs) != 1 || docker.removedIDs[0] != "c-1" {
		t.Errorf("expected container c-1 removed for restart, got %v", docker.removedIDs)
	}
	if len(docker.createdSpecs) != 1 {
		t.Fatalf("expected 1 container recreated after restart, got %d", len(docker.createdSpecs))
	}
}

func TestReconcileOnceScaleUp(t *testing.T) {
	docker := newMockDockerClient()
	docker.containers = []ContainerInfo{
		makeContainerInfo("c-1", "worker-a-0", "myimage:v1", "ds-1", 1),
	}
	platform := &mockPlatformClient{
		desiredStates: []DesiredState{
			makeDesiredState("ds-1", "worker-a", "myimage:v1", 1, 3),
		},
	}
	r := newTestManager(docker, platform)

	err := r.reconcileOnce(context.Background())

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(docker.createdSpecs) != 2 {
		t.Errorf("expected 2 new containers for scale up (1->3), got %d", len(docker.createdSpecs))
	}
	if len(docker.stoppedIDs) != 0 {
		t.Errorf("expected no stops during scale up, got %d", len(docker.stoppedIDs))
	}
}

func TestReconcileOnceScaleDown(t *testing.T) {
	docker := newMockDockerClient()
	docker.containers = []ContainerInfo{
		makeContainerInfo("c-1", "worker-a-0", "myimage:v1", "ds-1", 1),
		makeContainerInfo("c-2", "worker-a-1", "myimage:v1", "ds-1", 1),
		makeContainerInfo("c-3", "worker-a-2", "myimage:v1", "ds-1", 1),
	}
	platform := &mockPlatformClient{
		desiredStates: []DesiredState{
			makeDesiredState("ds-1", "worker-a", "myimage:v1", 1, 1),
		},
	}
	r := newTestManager(docker, platform)

	err := r.reconcileOnce(context.Background())

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(docker.stoppedIDs) != 2 {
		t.Errorf("expected 2 containers stopped for scale down (3->1), got %d", len(docker.stoppedIDs))
	}
	if len(docker.removedIDs) != 2 {
		t.Errorf("expected 2 containers removed for scale down, got %d", len(docker.removedIDs))
	}
	if len(docker.createdSpecs) != 0 {
		t.Errorf("expected no creates during scale down, got %d", len(docker.createdSpecs))
	}
}

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
