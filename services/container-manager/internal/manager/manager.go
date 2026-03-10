package manager

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/prometheus/client_golang/prometheus"
)

// DockerClient abstracts Docker operations for the container manager.
// In production this talks to a Docker socket proxy, never the raw socket.
type DockerClient interface {
	ListContainers(ctx context.Context) ([]ContainerInfo, error)
	CreateContainer(ctx context.Context, spec ContainerSpec) (string, error)
	StopContainer(ctx context.Context, containerID string, timeout time.Duration) error
	RemoveContainer(ctx context.Context, containerID string) error
	ListImages(ctx context.Context) ([]ContainerImage, error)
	GetContainerStats(ctx context.Context, containerID string) (*ContainerStats, error)
	UpdateContainerLabels(ctx context.Context, containerID string, labels map[string]string) error
	InspectContainerHealth(ctx context.Context, containerID string) (*ContainerHealthStatus, error)
	PullImage(ctx context.Context, image, policy string) error
	ConnectNetwork(ctx context.Context, containerID, networkName string) error
}

// ContainerInfo represents a running container as reported by Docker.
type ContainerInfo struct {
	ID     string
	Name   string
	Image  string
	Status string
	Labels map[string]string
}

// ContainerSpec describes how to create a new container.
type ContainerSpec struct {
	Name        string
	Image       string
	CPULimit    string
	MemoryLimit string
	Environment map[string]string
	Labels      map[string]string
	NetworkName string
}

// Config holds container manager configuration.
type Config struct {
	PlatformAPIURL      string
	PlatformAPIKey      string
	PlatformAdminAPIKey string
	DockerHost          string
	ReconcileInterval   time.Duration
	StopTimeout         time.Duration
	GlobalMaxRuntimes      int
	RuntimeNetwork         string
	RuntimeInternalNetwork string
}

// PlatformAPI abstracts communication with the platform API.
type PlatformAPI interface {
	FetchDesiredState() ([]DesiredState, error)
	ReportActualState(state ActualState) error
	ReportImage(image ContainerImage) error
	FetchRuntimeTargets() ([]RuntimeTarget, error)
	FetchHeartbeats() ([]RuntimeHeartbeat, error)
	RecordFleetEvent(event FleetEvent) error
	DrainRuntime(runtimeID string) error
	FailTask(taskID, reason string) error
}

// Manager implements the desired-state reconciliation loop.
type Manager struct {
	platform             PlatformAPI
	docker               DockerClient
	config               Config
	logger               *slog.Logger
	metrics              *FleetMetrics
	logEmitter           *LogEmitter
	starvationTrack      map[string]time.Time
	failedHeartbeatSince map[string]time.Time
	pullFailCache        map[string]time.Time // tracks when an image pull last failed, keyed by image ref
	idleSince            map[string]time.Time // tracks when each runtime first became idle
	nowFunc              func() time.Time
	cycleCount           uint64 // monotonic reconcile cycle counter
}

// New creates a new Manager with a real PlatformClient.
func New(cfg Config, docker DockerClient, logger *slog.Logger) *Manager {
	ingestEndpoint := cfg.PlatformAPIURL + "/api/v1/logs/ingest"
	return &Manager{
		platform:             NewPlatformClient(cfg.PlatformAPIURL, cfg.PlatformAPIKey),
		docker:               docker,
		config:               cfg,
		logger:               logger,
		metrics:              NewFleetMetrics(),
		logEmitter:           NewLogEmitter(ingestEndpoint, cfg.PlatformAPIKey, logger),
		starvationTrack:      make(map[string]time.Time),
		failedHeartbeatSince: make(map[string]time.Time),
		pullFailCache:        make(map[string]time.Time),
		idleSince:            make(map[string]time.Time),
		nowFunc:              time.Now,
	}
}

// NewWithPlatform creates a Manager with a custom PlatformAPI implementation.
// This is primarily useful for testing.
func NewWithPlatform(cfg Config, docker DockerClient, platform PlatformAPI, logger *slog.Logger) *Manager {
	return &Manager{
		platform:             platform,
		docker:               docker,
		config:               cfg,
		logger:               logger,
		metrics:              NewFleetMetrics(),
		starvationTrack:      make(map[string]time.Time),
		failedHeartbeatSince: make(map[string]time.Time),
		pullFailCache:        make(map[string]time.Time),
		idleSince:            make(map[string]time.Time),
		nowFunc:              time.Now,
	}
}

// MetricsRegistry returns the Prometheus registry for exposing fleet metrics.
func (m *Manager) MetricsRegistry() *prometheus.Registry {
	return m.metrics.Registry
}

// Close releases resources held by the Manager, including flushing any
// buffered log entries. It is safe to call Close on a Manager whose
// logEmitter is nil (e.g. in tests).
func (m *Manager) Close() {
	if m.logEmitter != nil {
		m.logEmitter.Close()
	}
}

// Run starts the reconcile loop and blocks until the context is cancelled.
func (m *Manager) Run(ctx context.Context) error {
	m.logger.Info("container-manager started", "interval", m.config.ReconcileInterval)

	if err := m.startupSweep(ctx); err != nil {
		m.logger.Error("startup sweep failed", "error", err)
	}

	ticker := time.NewTicker(m.config.ReconcileInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			m.logger.Info("container-manager stopping, running shutdown cascade")
			m.shutdownCascade()
			m.Close()
			return ctx.Err()
		case <-ticker.C:
			m.runReconcileCycle(ctx)
		}
	}
}

// heartbeatInterval controls how often (in cycles) the reconciler logs an
// INFO-level heartbeat. At a 5-second reconcile interval this is ~60 seconds.
const heartbeatInterval uint64 = 12

func (m *Manager) runReconcileCycle(ctx context.Context) {
	m.cycleCount++
	start := time.Now()

	var wdsErr, dcmErr error
	if wdsErr = m.reconcileOnce(ctx); wdsErr != nil {
		m.logger.Error("WDS reconcile cycle failed", "error", wdsErr)
	}
	if dcmErr = m.reconcileDCM(ctx); dcmErr != nil {
		m.logger.Error("DCM reconcile cycle failed", "error", dcmErr)
	}

	elapsed := time.Since(start)

	if m.cycleCount%heartbeatInterval == 0 {
		m.logger.Info("reconcile heartbeat",
			"cycle", m.cycleCount,
			"elapsed_ms", elapsed.Milliseconds(),
			"wds_ok", wdsErr == nil,
			"dcm_ok", dcmErr == nil,
		)
		m.emitLogTimed("container", "reconcile.cycle", "info", "completed", map[string]any{
			"action":  "heartbeat",
			"cycle":  m.cycleCount,
			"wds_ok": wdsErr == nil,
			"dcm_ok": dcmErr == nil,
		}, int(elapsed.Milliseconds()))
	}

	if wdsErr != nil {
		m.emitLogError("container", "reconcile.wds", map[string]any{"action": "reconcile"}, wdsErr.Error())
	}
	if dcmErr != nil {
		m.emitLogError("container", "reconcile.dcm", map[string]any{"action": "reconcile"}, dcmErr.Error())
	}
}

const labelManagedBy = "agirunner.container-manager"
const labelDesiredStateID = "agirunner.desired_state_id"
const labelVersion = "agirunner.version"
const labelWarmPool = "agirunner.warm-pool"

func (m *Manager) reconcileOnce(ctx context.Context) error {
	desired, err := m.platform.FetchDesiredState()
	if err != nil {
		return fmt.Errorf("fetch desired state: %w", err)
	}

	actual, err := m.docker.ListContainers(ctx)
	if err != nil {
		return fmt.Errorf("list containers: %w", err)
	}

	// Separate warm pool containers from regular containers
	regularByDesiredID := make(map[string][]ContainerInfo)
	warmByDesiredID := make(map[string][]ContainerInfo)
	for _, c := range actual {
		dsID, ok := c.Labels[labelDesiredStateID]
		if !ok {
			continue
		}
		if c.Labels[labelWarmPool] == "true" {
			warmByDesiredID[dsID] = append(warmByDesiredID[dsID], c)
		} else {
			regularByDesiredID[dsID] = append(regularByDesiredID[dsID], c)
		}
	}

	// For each desired state, ensure the right containers exist
	for _, ds := range desired {
		existingContainers := regularByDesiredID[ds.ID]
		delete(regularByDesiredID, ds.ID)

		warmContainers := warmByDesiredID[ds.ID]
		delete(warmByDesiredID, ds.ID)

		if ds.Draining {
			m.handleDraining(ctx, ds, existingContainers)
			m.removeAllWarmPool(ctx, warmContainers)
			continue
		}

		if ds.RestartRequested {
			m.handleRestart(ctx, ds, existingContainers)
			m.removeAllWarmPool(ctx, warmContainers)
			continue
		}

		m.reconcileDesired(ctx, ds, existingContainers)
		m.reconcileWarmPool(ctx, ds, warmContainers)
	}

	// Remove orphaned containers (actual with no matching desired)
	for _, containers := range regularByDesiredID {
		for _, c := range containers {
			m.logger.Info("removing orphaned container", "container", c.ID, "name", c.Name)
			if err := m.docker.StopContainer(ctx, c.ID, m.config.StopTimeout); err != nil {
				m.logger.Error("failed to stop orphaned container", "container", c.ID, "error", err)
			}
			if err := m.docker.RemoveContainer(ctx, c.ID); err != nil {
				m.logger.Error("failed to remove orphaned container", "container", c.ID, "error", err)
			}
			m.emitLog("container", "container.wds_orphan_cleanup", "warn", "completed", map[string]any{
				"action":       "orphan_clean",
				"container_id": c.ID,
				"name":         c.Name,
				"reason":       "no_matching_desired_state",
			})
		}
	}

	// Remove orphaned warm pool containers
	for _, containers := range warmByDesiredID {
		m.removeAllWarmPool(ctx, containers)
	}

	// Report actual state for all managed containers
	m.reportActualState(ctx, actual)

	// Report images
	m.reportImages(ctx)

	return nil
}

func (m *Manager) reconcileDesired(ctx context.Context, ds DesiredState, existing []ContainerInfo) {
	currentCount := len(existing)
	targetCount := ds.Replicas

	// Check if existing containers need replacement (version mismatch or wrong image)
	for _, c := range existing {
		if m.needsReplacement(ds, c) {
			m.logger.Info("replacing container", "container", c.ID, "reason", "version or image mismatch")
			_ = m.docker.StopContainer(ctx, c.ID, m.config.StopTimeout)
			_ = m.docker.RemoveContainer(ctx, c.ID)
			currentCount--
		}
	}

	// Scale up if needed
	for i := currentCount; i < targetCount; i++ {
		spec := m.buildContainerSpec(ds, i)
		containerID, err := m.docker.CreateContainer(ctx, spec)
		if err != nil {
			m.logger.Error("failed to create container", "worker", ds.WorkerName, "error", err)
			m.emitLogError("container", "container.wds_create", map[string]any{
				"action": "create",
				"worker": ds.WorkerName, "image": ds.RuntimeImage,
			}, err.Error())
			continue
		}
		m.logger.Info("created container", "worker", ds.WorkerName, "container", containerID)
		m.emitLog("container", "container.wds_create", "info", "completed", map[string]any{
			"action":       "create",
			"worker":       ds.WorkerName,
			"container_id": containerID,
			"image":        ds.RuntimeImage,
		})
	}

	// Scale down if needed
	if currentCount > targetCount {
		for i := targetCount; i < currentCount && i < len(existing); i++ {
			m.logger.Info("scaling down, removing container", "container", existing[i].ID)
			_ = m.docker.StopContainer(ctx, existing[i].ID, m.config.StopTimeout)
			_ = m.docker.RemoveContainer(ctx, existing[i].ID)
			m.emitLog("container", "container.wds_destroy", "info", "completed", map[string]any{
				"action":       "scale_down",
				"worker":       ds.WorkerName,
				"container_id": existing[i].ID,
				"reason":       "scale_down",
			})
		}
	}
}

func (m *Manager) handleDraining(ctx context.Context, ds DesiredState, existing []ContainerInfo) {
	for _, c := range existing {
		m.logger.Info("draining container", "container", c.ID, "worker", ds.WorkerName)
		_ = m.docker.StopContainer(ctx, c.ID, m.config.StopTimeout)
		_ = m.docker.RemoveContainer(ctx, c.ID)
		m.emitLog("container", "container.wds_drain", "info", "completed", map[string]any{
			"action":       "drain",
			"worker":       ds.WorkerName,
			"container_id": c.ID,
		})
	}
}

func (m *Manager) handleRestart(ctx context.Context, ds DesiredState, existing []ContainerInfo) {
	for _, c := range existing {
		m.logger.Info("restarting container", "container", c.ID, "worker", ds.WorkerName)
		_ = m.docker.StopContainer(ctx, c.ID, m.config.StopTimeout)
		_ = m.docker.RemoveContainer(ctx, c.ID)
	}

	// Recreate
	for i := 0; i < ds.Replicas; i++ {
		spec := m.buildContainerSpec(ds, i)
		containerID, err := m.docker.CreateContainer(ctx, spec)
		if err != nil {
			m.logger.Error("failed to recreate container after restart", "worker", ds.WorkerName, "error", err)
			continue
		}
		m.logger.Info("recreated container after restart", "worker", ds.WorkerName, "container", containerID)
	}
	m.emitLog("container", "container.wds_restart", "info", "completed", map[string]any{
		"action":   "restart",
		"worker":   ds.WorkerName,
		"stopped":  len(existing),
		"replicas": ds.Replicas,
	})
}

func (m *Manager) needsReplacement(ds DesiredState, c ContainerInfo) bool {
	if c.Image != ds.RuntimeImage {
		return true
	}
	if v, ok := c.Labels[labelVersion]; ok {
		if v != fmt.Sprintf("%d", ds.Version) {
			return true
		}
	}
	return false
}

func (m *Manager) buildContainerSpec(ds DesiredState, replicaIndex int) ContainerSpec {
	name := ds.WorkerName
	if ds.Replicas > 1 {
		name = fmt.Sprintf("%s-%d", ds.WorkerName, replicaIndex)
	}

	env := make(map[string]string)
	for k, v := range ds.Environment {
		env[k] = fmt.Sprintf("%v", v)
	}
	if ds.LLMProvider != nil {
		env["LLM_PROVIDER"] = *ds.LLMProvider
	}
	if ds.LLMModel != nil {
		env["LLM_MODEL"] = *ds.LLMModel
	}

	return ContainerSpec{
		Name:        strings.ReplaceAll(name, " ", "-"),
		Image:       ds.RuntimeImage,
		CPULimit:    ds.CPULimit,
		MemoryLimit: ds.MemoryLimit,
		Environment: env,
		Labels: map[string]string{
			labelManagedBy:      "true",
			labelDesiredStateID: ds.ID,
			labelVersion:        fmt.Sprintf("%d", ds.Version),
		},
	}
}

func (m *Manager) reconcileWarmPool(ctx context.Context, ds DesiredState, warmContainers []ContainerInfo) {
	targetSize := ds.WarmPoolSize
	currentSize := len(warmContainers)

	// Replace warm pool containers with wrong image or version
	for _, c := range warmContainers {
		if m.needsReplacement(ds, c) {
			m.logger.Info("replacing warm pool container", "container", c.ID, "reason", "version or image mismatch")
			_ = m.docker.StopContainer(ctx, c.ID, m.config.StopTimeout)
			_ = m.docker.RemoveContainer(ctx, c.ID)
			currentSize--
		}
	}

	// Scale up warm pool
	for i := currentSize; i < targetSize; i++ {
		spec := m.buildWarmPoolSpec(ds, i)
		containerID, err := m.docker.CreateContainer(ctx, spec)
		if err != nil {
			m.logger.Error("failed to create warm pool container", "worker", ds.WorkerName, "error", err)
			continue
		}
		m.logger.Info("created warm pool container", "worker", ds.WorkerName, "container", containerID)
	}

	// Scale down warm pool
	if currentSize > targetSize {
		for i := targetSize; i < currentSize && i < len(warmContainers); i++ {
			m.logger.Info("removing excess warm pool container", "container", warmContainers[i].ID)
			_ = m.docker.StopContainer(ctx, warmContainers[i].ID, m.config.StopTimeout)
			_ = m.docker.RemoveContainer(ctx, warmContainers[i].ID)
		}
	}
}

func (m *Manager) removeAllWarmPool(ctx context.Context, warmContainers []ContainerInfo) {
	for _, c := range warmContainers {
		m.logger.Info("removing warm pool container", "container", c.ID)
		_ = m.docker.StopContainer(ctx, c.ID, m.config.StopTimeout)
		_ = m.docker.RemoveContainer(ctx, c.ID)
	}
}

func (m *Manager) buildWarmPoolSpec(ds DesiredState, index int) ContainerSpec {
	name := fmt.Sprintf("%s-warm-%d", ds.WorkerName, index)

	env := make(map[string]string)
	for k, v := range ds.Environment {
		env[k] = fmt.Sprintf("%v", v)
	}
	if ds.LLMProvider != nil {
		env["LLM_PROVIDER"] = *ds.LLMProvider
	}
	if ds.LLMModel != nil {
		env["LLM_MODEL"] = *ds.LLMModel
	}

	return ContainerSpec{
		Name:        strings.ReplaceAll(name, " ", "-"),
		Image:       ds.RuntimeImage,
		CPULimit:    ds.CPULimit,
		MemoryLimit: ds.MemoryLimit,
		Environment: env,
		Labels: map[string]string{
			labelManagedBy:      "true",
			labelDesiredStateID: ds.ID,
			labelVersion:        fmt.Sprintf("%d", ds.Version),
			labelWarmPool:       "true",
		},
	}
}

func (m *Manager) reportActualState(ctx context.Context, containers []ContainerInfo) {
	for _, c := range containers {
		dsID, ok := c.Labels[labelDesiredStateID]
		if !ok {
			continue
		}

		stats, err := m.docker.GetContainerStats(ctx, c.ID)
		if err != nil {
			m.logger.Error("failed to get container stats", "container", c.ID, "error", err)
			continue
		}

		state := ActualState{
			DesiredStateID:  dsID,
			ContainerID:     c.ID,
			ContainerStatus: c.Status,
		}
		if stats != nil {
			state.CPUUsagePercent = float32(stats.CPUPercent)
			state.MemoryUsageBytes = int64(stats.MemoryBytes)
			state.NetworkRxBytes = int64(stats.RxBytes)
			state.NetworkTxBytes = int64(stats.TxBytes)
		}

		if err := m.platform.ReportActualState(state); err != nil {
			m.logger.Error("failed to report actual state", "container", c.ID, "error", err)
		}
	}
}

func (m *Manager) reportImages(ctx context.Context) {
	images, err := m.docker.ListImages(ctx)
	if err != nil {
		m.logger.Error("failed to list images", "error", err)
		return
	}
	for _, img := range images {
		if err := m.platform.ReportImage(img); err != nil {
			m.logger.Error("failed to report image", "repository", img.Repository, "error", err)
		}
	}
}
