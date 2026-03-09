package manager

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"testing"
	"time"
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
	fetchErr        error
	fetchTargetsErr error
	fetchHBErr      error
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

func (m *mockPlatformClient) ReportActualState(state ActualState) error {
	if m.reportStateErr != nil {
		return m.reportStateErr
	}
	m.reportedStates = append(m.reportedStates, state)
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

func makeWarmPoolContainer(id, name, image, dsID string, version int) ContainerInfo {
	return ContainerInfo{
		ID:     id,
		Name:   name,
		Image:  image,
		Status: "running",
		Labels: map[string]string{
			labelManagedBy:      "true",
			labelDesiredStateID: dsID,
			labelVersion:        fmt.Sprintf("%d", version),
			labelWarmPool:       "true",
		},
	}
}

func TestReconcileOnceCreatesWarmPoolContainers(t *testing.T) {
	docker := newMockDockerClient()
	ds := makeDesiredState("ds-1", "worker-a", "myimage:v1", 1, 1)
	ds.WarmPoolSize = 2
	platform := &mockPlatformClient{
		desiredStates: []DesiredState{ds},
	}
	r := newTestManager(docker, platform)

	err := r.reconcileOnce(context.Background())

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	// 1 regular + 2 warm pool = 3 total
	if len(docker.createdSpecs) != 3 {
		t.Fatalf("expected 3 containers created (1 regular + 2 warm), got %d", len(docker.createdSpecs))
	}
	warmCount := 0
	for _, spec := range docker.createdSpecs {
		if spec.Labels[labelWarmPool] == "true" {
			warmCount++
		}
	}
	if warmCount != 2 {
		t.Errorf("expected 2 warm pool containers, got %d", warmCount)
	}
}

func TestReconcileOnceWarmPoolAlreadySatisfied(t *testing.T) {
	docker := newMockDockerClient()
	docker.containers = []ContainerInfo{
		makeContainerInfo("c-1", "worker-a", "myimage:v1", "ds-1", 1),
		makeWarmPoolContainer("w-1", "worker-a-warm-0", "myimage:v1", "ds-1", 1),
		makeWarmPoolContainer("w-2", "worker-a-warm-1", "myimage:v1", "ds-1", 1),
	}
	ds := makeDesiredState("ds-1", "worker-a", "myimage:v1", 1, 1)
	ds.WarmPoolSize = 2
	platform := &mockPlatformClient{
		desiredStates: []DesiredState{ds},
	}
	r := newTestManager(docker, platform)

	err := r.reconcileOnce(context.Background())

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(docker.createdSpecs) != 0 {
		t.Errorf("expected no creates when warm pool is satisfied, got %d", len(docker.createdSpecs))
	}
	if len(docker.stoppedIDs) != 0 {
		t.Errorf("expected no stops when warm pool is satisfied, got %d", len(docker.stoppedIDs))
	}
}

func TestReconcileOnceWarmPoolScaleDown(t *testing.T) {
	docker := newMockDockerClient()
	docker.containers = []ContainerInfo{
		makeContainerInfo("c-1", "worker-a", "myimage:v1", "ds-1", 1),
		makeWarmPoolContainer("w-1", "worker-a-warm-0", "myimage:v1", "ds-1", 1),
		makeWarmPoolContainer("w-2", "worker-a-warm-1", "myimage:v1", "ds-1", 1),
		makeWarmPoolContainer("w-3", "worker-a-warm-2", "myimage:v1", "ds-1", 1),
	}
	ds := makeDesiredState("ds-1", "worker-a", "myimage:v1", 1, 1)
	ds.WarmPoolSize = 1
	platform := &mockPlatformClient{
		desiredStates: []DesiredState{ds},
	}
	r := newTestManager(docker, platform)

	err := r.reconcileOnce(context.Background())

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(docker.createdSpecs) != 0 {
		t.Errorf("expected no creates, got %d", len(docker.createdSpecs))
	}
	// Should remove 2 excess warm pool containers (3 -> 1)
	if len(docker.stoppedIDs) != 2 {
		t.Errorf("expected 2 warm pool containers stopped, got %d", len(docker.stoppedIDs))
	}
	if len(docker.removedIDs) != 2 {
		t.Errorf("expected 2 warm pool containers removed, got %d", len(docker.removedIDs))
	}
}

func TestReconcileOnceWarmPoolZeroSizeRemovesAll(t *testing.T) {
	docker := newMockDockerClient()
	docker.containers = []ContainerInfo{
		makeContainerInfo("c-1", "worker-a", "myimage:v1", "ds-1", 1),
		makeWarmPoolContainer("w-1", "worker-a-warm-0", "myimage:v1", "ds-1", 1),
		makeWarmPoolContainer("w-2", "worker-a-warm-1", "myimage:v1", "ds-1", 1),
	}
	ds := makeDesiredState("ds-1", "worker-a", "myimage:v1", 1, 1)
	ds.WarmPoolSize = 0
	platform := &mockPlatformClient{
		desiredStates: []DesiredState{ds},
	}
	r := newTestManager(docker, platform)

	err := r.reconcileOnce(context.Background())

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(docker.stoppedIDs) != 2 {
		t.Errorf("expected 2 warm pool containers stopped, got %d", len(docker.stoppedIDs))
	}
	if len(docker.removedIDs) != 2 {
		t.Errorf("expected 2 warm pool containers removed, got %d", len(docker.removedIDs))
	}
}

func TestReconcileOnceWarmPoolVersionMismatchReplacesContainers(t *testing.T) {
	docker := newMockDockerClient()
	docker.containers = []ContainerInfo{
		makeContainerInfo("c-1", "worker-a", "myimage:v1", "ds-1", 1),
		makeWarmPoolContainer("w-1", "worker-a-warm-0", "myimage:v1", "ds-1", 1),
	}
	ds := makeDesiredState("ds-1", "worker-a", "myimage:v1", 2, 1)
	ds.WarmPoolSize = 1
	platform := &mockPlatformClient{
		desiredStates: []DesiredState{ds},
	}
	r := newTestManager(docker, platform)

	err := r.reconcileOnce(context.Background())

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	// Both the regular and warm pool container should be replaced
	if len(docker.stoppedIDs) != 2 {
		t.Errorf("expected 2 containers stopped (1 regular + 1 warm), got %d", len(docker.stoppedIDs))
	}
	if len(docker.createdSpecs) != 2 {
		t.Errorf("expected 2 containers created (1 regular + 1 warm), got %d", len(docker.createdSpecs))
	}
}

func TestReconcileOnceDrainingRemovesWarmPool(t *testing.T) {
	docker := newMockDockerClient()
	docker.containers = []ContainerInfo{
		makeContainerInfo("c-1", "worker-a", "myimage:v1", "ds-1", 1),
		makeWarmPoolContainer("w-1", "worker-a-warm-0", "myimage:v1", "ds-1", 1),
	}
	ds := makeDesiredState("ds-1", "worker-a", "myimage:v1", 1, 1)
	ds.Draining = true
	ds.WarmPoolSize = 1
	platform := &mockPlatformClient{
		desiredStates: []DesiredState{ds},
	}
	r := newTestManager(docker, platform)

	err := r.reconcileOnce(context.Background())

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	// Both regular and warm pool should be stopped/removed
	if len(docker.stoppedIDs) != 2 {
		t.Errorf("expected 2 containers stopped, got %d", len(docker.stoppedIDs))
	}
	if len(docker.removedIDs) != 2 {
		t.Errorf("expected 2 containers removed, got %d", len(docker.removedIDs))
	}
}

func TestReconcileOnceOrphanedWarmPoolRemoved(t *testing.T) {
	docker := newMockDockerClient()
	docker.containers = []ContainerInfo{
		makeWarmPoolContainer("w-1", "worker-a-warm-0", "myimage:v1", "ds-orphan", 1),
	}
	platform := &mockPlatformClient{}
	r := newTestManager(docker, platform)

	err := r.reconcileOnce(context.Background())

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(docker.stoppedIDs) != 1 || docker.stoppedIDs[0] != "w-1" {
		t.Errorf("expected orphaned warm pool w-1 stopped, got %v", docker.stoppedIDs)
	}
	if len(docker.removedIDs) != 1 || docker.removedIDs[0] != "w-1" {
		t.Errorf("expected orphaned warm pool w-1 removed, got %v", docker.removedIDs)
	}
}

func TestReconcileOnceWarmPoolDoesNotAffectRegularReplicas(t *testing.T) {
	docker := newMockDockerClient()
	docker.containers = []ContainerInfo{
		makeContainerInfo("c-1", "worker-a-0", "myimage:v1", "ds-1", 1),
		makeWarmPoolContainer("w-1", "worker-a-warm-0", "myimage:v1", "ds-1", 1),
		makeWarmPoolContainer("w-2", "worker-a-warm-1", "myimage:v1", "ds-1", 1),
	}
	ds := makeDesiredState("ds-1", "worker-a", "myimage:v1", 1, 2)
	ds.WarmPoolSize = 2
	platform := &mockPlatformClient{
		desiredStates: []DesiredState{ds},
	}
	r := newTestManager(docker, platform)

	err := r.reconcileOnce(context.Background())

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	// Should create 1 more regular replica (1->2), warm pool is already satisfied
	if len(docker.createdSpecs) != 1 {
		t.Fatalf("expected 1 container created (scale up), got %d", len(docker.createdSpecs))
	}
	if docker.createdSpecs[0].Labels[labelWarmPool] == "true" {
		t.Error("expected regular container created, not warm pool")
	}
	if len(docker.stoppedIDs) != 0 {
		t.Errorf("expected no stops, got %d", len(docker.stoppedIDs))
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
