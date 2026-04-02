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

type networkConnectCall struct {
	ContainerID string
	NetworkName string
}

// mockDockerClient records calls and returns preconfigured results.
type mockDockerClient struct {
	containers     []ContainerInfo
	images         []ContainerImage
	localImages    map[string]bool
	stats          map[string]*ContainerStats
	healthStatuses map[string]*ContainerHealthStatus

	createdSpecs       []ContainerSpec
	networkConnects    []networkConnectCall
	stoppedIDs         []string
	stopTimeouts       []time.Duration
	removedIDs         []string
	updatedLabels      []labelUpdate
	pulledImages       []pullRecord
	createErr          error
	connectErr         error
	listErr            error
	stopErr            error
	removeErr          error
	failOnExistingName bool
	stopWaitForCtx     bool
	sawStopDeadline    bool
	listImagesErr      error
	statsErr           error
	pullErr            error
	nextContainerID    int
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

func (m *mockDockerClient) ListApplicationContainers(_ context.Context) ([]ApplicationContainerInfo, error) {
	if m.listErr != nil {
		return nil, m.listErr
	}
	result := make([]ApplicationContainerInfo, 0, len(m.containers))
	for _, container := range m.containers {
		result = append(result, ApplicationContainerInfo{
			ID:        container.ID,
			Name:      container.Name,
			Image:     container.Image,
			State:     container.State,
			Status:    container.Status,
			StartedAt: container.StartedAt,
			Labels:    container.Labels,
		})
	}
	return result, nil
}

func (m *mockDockerClient) CreateContainer(_ context.Context, spec ContainerSpec) (string, error) {
	if m.createErr != nil {
		return "", m.createErr
	}
	if m.failOnExistingName {
		for _, existing := range m.containers {
			if existing.Name == spec.Name {
				return "", fmt.Errorf("Conflict. The container name %q is already in use", spec.Name)
			}
		}
	}
	m.createdSpecs = append(m.createdSpecs, spec)
	m.nextContainerID++
	return fmt.Sprintf("container-%d", m.nextContainerID), nil
}

func (m *mockDockerClient) StopContainer(ctx context.Context, containerID string, timeout time.Duration) error {
	if _, ok := ctx.Deadline(); ok {
		m.sawStopDeadline = true
	}
	m.stopTimeouts = append(m.stopTimeouts, timeout)
	if m.stopWaitForCtx {
		<-ctx.Done()
		return ctx.Err()
	}
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
	filtered := m.containers[:0]
	for _, existing := range m.containers {
		if existing.ID == containerID {
			continue
		}
		filtered = append(filtered, existing)
	}
	m.containers = filtered
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

func (m *mockDockerClient) ConnectNetwork(_ context.Context, containerID string, networkName string) error {
	m.networkConnects = append(m.networkConnects, networkConnectCall{ContainerID: containerID, NetworkName: networkName})
	if m.connectErr != nil {
		return m.connectErr
	}
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
	desiredStates          []DesiredState
	runtimeTargets         []RuntimeTarget
	heartbeats             []RuntimeHeartbeat
	snapshot               *ReconcileSnapshot
	fetchErr               error
	fetchTargetsErr        error
	fetchHBErr             error
	fetchSnapErr           error
	fetchHBCalls           int
	fetchSnapCalls         int
	reportedStates         []ActualState
	reportedLiveContainers []LiveContainerReport
	reportedImages         []ContainerImage
	reportedEvents         []FleetEvent
	failedTasks            []failedTaskRecord
	taskStates             map[string]string
	drainedRuntimes        []string
	ackedRestarts          []string
	reportStateErr         error
	reportImageErr         error
	failTaskErr            error
	getTaskStateErr        error
	ackRestartErr          error
	workerRegistrations    []WorkerRegistrationRequest
	agentRegistrations     []AgentRegistrationRequest
	deletedWorkerIDs       []string
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
		DesiredStates:          m.desiredStates,
		RuntimeTargets:         m.runtimeTargets,
		Heartbeats:             m.heartbeats,
		ContainerManagerConfig: defaultTestContainerManagerConfig(),
	}, nil
}

func (m *mockPlatformClient) ReportActualState(state ActualState) error {
	if m.reportStateErr != nil {
		return m.reportStateErr
	}
	m.reportedStates = append(m.reportedStates, state)
	return nil
}

func (m *mockPlatformClient) ReportLiveContainerInventory(containers []LiveContainerReport) error {
	m.reportedLiveContainers = append(m.reportedLiveContainers, containers...)
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

func (m *mockPlatformClient) GetTaskState(taskID string) (string, error) {
	if m.getTaskStateErr != nil {
		return "", m.getTaskStateErr
	}
	if m.taskStates == nil {
		return "", nil
	}
	return m.taskStates[taskID], nil
}

func (m *mockPlatformClient) RecordFleetEvent(event FleetEvent) error {
	m.reportedEvents = append(m.reportedEvents, event)
	return nil
}

func (m *mockPlatformClient) DrainRuntime(runtimeID string) error {
	m.drainedRuntimes = append(m.drainedRuntimes, runtimeID)
	return nil
}

func (m *mockPlatformClient) AcknowledgeWorkerRestart(desiredStateID string) error {
	if m.ackRestartErr != nil {
		return m.ackRestartErr
	}
	m.ackedRestarts = append(m.ackedRestarts, desiredStateID)
	return nil
}

func (m *mockPlatformClient) FailTask(taskID, reason string) error {
	if m.failTaskErr != nil {
		return m.failTaskErr
	}
	m.failedTasks = append(m.failedTasks, failedTaskRecord{TaskID: taskID, Reason: reason})
	return nil
}

func (m *mockPlatformClient) RegisterWorker(input WorkerRegistrationRequest) (WorkerRegistrationResult, error) {
	m.workerRegistrations = append(m.workerRegistrations, input)
	return WorkerRegistrationResult{
		WorkerID:                 "worker-1",
		WorkerAPIKey:             "worker-key-1",
		HeartbeatIntervalSeconds: input.HeartbeatIntervalSeconds,
	}, nil
}

func (m *mockPlatformClient) RegisterAgent(input AgentRegistrationRequest) (AgentRegistrationResult, error) {
	m.agentRegistrations = append(m.agentRegistrations, input)
	return AgentRegistrationResult{
		ID:          "agent-1",
		Name:        input.Name,
		RoutingTags: input.RoutingTags,
		APIKey:      "agent-key-1",
	}, nil
}

func (m *mockPlatformClient) DeleteWorker(workerID string) error {
	m.deletedWorkerIDs = append(m.deletedWorkerIDs, workerID)
	return nil
}

func newTestManager(docker *mockDockerClient, platform *mockPlatformClient) *Manager {
	logger := slog.New(slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError}))
	cfg := Config{
		ReconcileInterval:           5 * time.Second,
		StopTimeout:                 10 * time.Second,
		ShutdownTaskStopTimeout:     2 * time.Second,
		DockerActionBuffer:          15 * time.Second,
		LogFlushInterval:            500 * time.Millisecond,
		DockerEventReconnectBackoff: 5 * time.Second,
		CrashLogCaptureTimeout:      5 * time.Second,
		StarvationThreshold:         60 * time.Second,
		HungRuntimeStaleAfter:       90 * time.Second,
		HungRuntimeStopGrace:        30 * time.Second,
		GlobalMaxRuntimes:           10,
		RuntimeLogMaxSizeMB:         10,
		RuntimeLogMaxFiles:          3,
		RuntimeOrphanGraceCycles:    3,
	}
	return NewWithPlatform(cfg, docker, platform, logger)
}

func defaultTestContainerManagerConfig() ContainerManagerConfig {
	return ContainerManagerConfig{
		PlatformAPIRequestTimeoutSeconds: 19,
		PlatformLogIngestTimeoutSeconds:  17,
		ReconcileIntervalSeconds:         5,
		StopTimeoutSeconds:               10,
		ShutdownTaskStopTimeoutSeconds:   2,
		DockerActionBufferSeconds:        15,
		LogFlushIntervalMs:               500,
		DockerEventReconnectBackoffMs:    5000,
		CrashLogCaptureTimeoutSeconds:    5,
		StarvationThresholdSeconds:       60,
		RuntimeOrphanGraceCycles:         3,
		HungRuntimeStaleAfterSeconds:     90,
		HungRuntimeStopGracePeriodSec:    30,
		GlobalMaxRuntimes:                10,
		RuntimeLogMaxSizeMB:              10,
		RuntimeLogMaxFiles:               3,
	}
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

func TestBuildContainerSpec_SetsDockerLogRotation(t *testing.T) {
	mgr := newTestManager(newMockDockerClient(), &mockPlatformClient{})
	ds := makeDesiredState("worker-1", "orchestrator-primary", "agirunner-runtime:local", 1, 1)

	spec := mgr.buildContainerSpec(ds, ds.WorkerName, connectedRuntimeIdentity{})

	if spec.LogMaxSize != "10m" {
		t.Fatalf("expected desired-state log max size 10m, got %q", spec.LogMaxSize)
	}
	if spec.LogMaxFiles != "3" {
		t.Fatalf("expected desired-state log max files 3, got %q", spec.LogMaxFiles)
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
			ContainerManagerConfig: ContainerManagerConfig{
				PlatformAPIRequestTimeoutSeconds: 19,
				PlatformLogIngestTimeoutSeconds:  17,
				ReconcileIntervalSeconds:         7,
				StopTimeoutSeconds:               45,
				ShutdownTaskStopTimeoutSeconds:   3,
				DockerActionBufferSeconds:        20,
				LogFlushIntervalMs:               500,
				DockerEventReconnectBackoffMs:    5000,
				CrashLogCaptureTimeoutSeconds:    5,
				StarvationThresholdSeconds:       60,
				RuntimeOrphanGraceCycles:         3,
				HungRuntimeStaleAfterSeconds:     90,
				HungRuntimeStopGracePeriodSec:    30,
				GlobalMaxRuntimes:                12,
				RuntimeLogMaxSizeMB:              10,
				RuntimeLogMaxFiles:               3,
			},
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
	if manager.config.ReconcileInterval != 7*time.Second {
		t.Fatalf("expected reconcile interval from snapshot, got %s", manager.config.ReconcileInterval)
	}
	if manager.config.GlobalMaxRuntimes != 12 {
		t.Fatalf("expected global max runtimes from snapshot, got %d", manager.config.GlobalMaxRuntimes)
	}
	if manager.config.PlatformAPIRequestTimeout != 19*time.Second {
		t.Fatalf("expected platform API timeout from snapshot, got %s", manager.config.PlatformAPIRequestTimeout)
	}
	if manager.config.PlatformLogIngestTimeout != 17*time.Second {
		t.Fatalf("expected platform log ingest timeout from snapshot, got %s", manager.config.PlatformLogIngestTimeout)
	}
	if manager.config.LogFlushInterval != 500*time.Millisecond {
		t.Fatalf("expected log flush interval from snapshot, got %s", manager.config.LogFlushInterval)
	}
	if manager.config.DockerEventReconnectBackoff != 5*time.Second {
		t.Fatalf("expected docker event reconnect backoff from snapshot, got %s", manager.config.DockerEventReconnectBackoff)
	}
	if manager.config.CrashLogCaptureTimeout != 5*time.Second {
		t.Fatalf("expected crash log capture timeout from snapshot, got %s", manager.config.CrashLogCaptureTimeout)
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
