package manager

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"slices"
	"strings"
	"time"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/events"
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
	Events(ctx context.Context, options events.ListOptions) (<-chan events.Message, <-chan error)
	ContainerLogs(ctx context.Context, containerID string, options container.LogsOptions) (io.ReadCloser, error)
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
	PlatformAPIURL              string
	PlatformAPIKey              string
	PlatformAdminAPIKey         string
	PlatformAPIRequestTimeout   time.Duration
	PlatformLogIngestTimeout    time.Duration
	DockerHost                  string
	ReconcileInterval           time.Duration
	StopTimeout                 time.Duration
	ShutdownTaskStopTimeout     time.Duration
	DockerActionBuffer          time.Duration
	LogFlushInterval            time.Duration
	DockerEventReconnectBackoff time.Duration
	CrashLogCaptureTimeout      time.Duration
	StarvationThreshold         time.Duration
	HungRuntimeStaleAfter       time.Duration
	HungRuntimeStopGrace        time.Duration
	GlobalMaxRuntimes           int
	RuntimeOrphanGraceCycles    int
	RuntimeNetwork              string
	RuntimeInternalNetwork      string
}

// PlatformAPI abstracts communication with the platform API.
type PlatformAPI interface {
	FetchDesiredState() ([]DesiredState, error)
	FetchReconcileSnapshot() (*ReconcileSnapshot, error)
	ReportActualState(state ActualState) error
	PruneActualState(desiredStateID string, activeContainerIDs []string) error
	ReportImage(image ContainerImage) error
	FetchRuntimeTargets() ([]RuntimeTarget, error)
	FetchHeartbeats() ([]RuntimeHeartbeat, error)
	RecordFleetEvent(event FleetEvent) error
	DrainRuntime(runtimeID string) error
	AcknowledgeWorkerRestart(desiredStateID string) error
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
	dockerEventWatcher   *DockerEventWatcher
	starvationTrack      map[string]time.Time
	failedHeartbeatSince map[string]time.Time
	pullFailCache        map[string]time.Time // tracks when an image pull last failed, keyed by image ref
	idleSince            map[string]time.Time // tracks when each runtime first became idle
	processedOrphans     map[string]struct{}  // runtime IDs already handled as orphans (prevents log spam)
	runtimeOrphans       map[string]runtimeOrphanState
	lastReportedImages   string // canonical image inventory fingerprint last reported to platform
	nowFunc              func() time.Time
	cycleCount           uint64 // monotonic reconcile cycle counter
}

// New creates a new Manager with a real PlatformClient.
func New(cfg Config, docker DockerClient, logger *slog.Logger) *Manager {
	ingestEndpoint := cfg.PlatformAPIURL + "/api/v1/logs/ingest"
	return &Manager{
		platform:             NewPlatformClient(cfg.PlatformAPIURL, cfg.PlatformAPIKey, cfg.PlatformAPIRequestTimeout),
		docker:               docker,
		config:               cfg,
		logger:               logger,
		metrics:              NewFleetMetrics(),
		logEmitter:           NewLogEmitter(ingestEndpoint, cfg.PlatformAPIKey, cfg.PlatformLogIngestTimeout, cfg.LogFlushInterval, logger),
		starvationTrack:      make(map[string]time.Time),
		failedHeartbeatSince: make(map[string]time.Time),
		pullFailCache:        make(map[string]time.Time),
		idleSince:            make(map[string]time.Time),
		processedOrphans:     make(map[string]struct{}),
		runtimeOrphans:       make(map[string]runtimeOrphanState),
		lastReportedImages:   "",
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
		processedOrphans:     make(map[string]struct{}),
		runtimeOrphans:       make(map[string]runtimeOrphanState),
		lastReportedImages:   "",
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
	initialSnapshot, err := m.platform.FetchReconcileSnapshot()
	if err != nil {
		return fmt.Errorf("fetch initial reconcile snapshot: %w", err)
	}
	if _, err := m.applySnapshotConfig(initialSnapshot); err != nil {
		m.logger.Error("invalid initial reconcile snapshot config", "error", err)
		m.emitLogError("container", "config.apply", map[string]any{
			"action": "apply_snapshot_config",
			"phase":  "startup",
		}, err.Error())
		return fmt.Errorf("apply initial reconcile snapshot config: %w", err)
	}
	m.logger.Info("container-manager started", "interval", m.config.ReconcileInterval)

	if err := m.startupSweepWithTargets(ctx, initialSnapshot.RuntimeTargets); err != nil {
		m.logger.Error("startup sweep failed", "error", err)
	}

	// Start Docker event watcher in a background goroutine.
	if m.logEmitter != nil {
		m.dockerEventWatcher = NewDockerEventWatcher(
			m.docker,
			m.logEmitter,
			m.logger,
			m.config.DockerEventReconnectBackoff,
			m.config.CrashLogCaptureTimeout,
		)
		go m.dockerEventWatcher.Run(ctx)
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
			previousInterval := m.config.ReconcileInterval
			m.runReconcileCycle(ctx)
			if m.config.ReconcileInterval > 0 && m.config.ReconcileInterval != previousInterval {
				ticker.Reset(m.config.ReconcileInterval)
			}
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
	snapshot, snapshotErr := m.platform.FetchReconcileSnapshot()
	if snapshotErr != nil {
		wdsErr = fmt.Errorf("fetch reconcile snapshot: %w", snapshotErr)
		dcmErr = wdsErr
		m.logger.Error("WDS reconcile cycle failed", "error", wdsErr)
		m.logger.Error("DCM reconcile cycle failed", "error", dcmErr)
	} else {
		if _, configErr := m.applySnapshotConfig(snapshot); configErr != nil {
			wdsErr = fmt.Errorf("apply reconcile snapshot config: %w", configErr)
			dcmErr = wdsErr
			m.logger.Error("reconcile snapshot config invalid", "error", configErr)
			m.emitLogError("container", "config.apply", map[string]any{
				"action": "apply_snapshot_config",
				"phase":  "reconcile",
				"cycle":  m.cycleCount,
			}, configErr.Error())
		} else {
			if wdsErr = m.reconcileOnceWithDesired(ctx, snapshot.DesiredStates); wdsErr != nil {
				m.logger.Error("WDS reconcile cycle failed", "error", wdsErr)
			}
			if dcmErr = m.reconcileDCMWithSnapshot(ctx, snapshot.RuntimeTargets, snapshot.Heartbeats); dcmErr != nil {
				m.logger.Error("DCM reconcile cycle failed", "error", dcmErr)
			}
		}
	}

	elapsed := time.Since(start)

	if m.cycleCount%heartbeatInterval == 0 {
		m.logger.Info("reconcile heartbeat",
			"cycle", m.cycleCount,
			"elapsed_ms", elapsed.Milliseconds(),
			"wds_ok", wdsErr == nil,
			"dcm_ok", dcmErr == nil,
		)
		m.emitLogTimed("container", "reconcile.cycle", "debug", "completed", map[string]any{
			"action": "heartbeat",
			"cycle":  m.cycleCount,
			"wds_ok": wdsErr == nil,
			"dcm_ok": dcmErr == nil,
		}, int(elapsed.Milliseconds()))
	}

	if wdsErr != nil {
		m.emitLogError("container", "reconcile.wds", map[string]any{"action": "reconcile", "cycle": m.cycleCount}, wdsErr.Error())
	}
	if dcmErr != nil {
		m.emitLogError("container", "reconcile.dcm", map[string]any{"action": "reconcile", "cycle": m.cycleCount}, dcmErr.Error())
	}
}

const labelManagedBy = "agirunner.container-manager"
const labelDesiredStateID = "agirunner.desired_state_id"
const labelVersion = "agirunner.version"

func (m *Manager) reconcileOnce(ctx context.Context) error {
	desired, err := m.platform.FetchDesiredState()
	if err != nil {
		return fmt.Errorf("fetch desired state: %w", err)
	}
	return m.reconcileOnceWithDesired(ctx, desired)
}

func (m *Manager) reconcileOnceWithDesired(ctx context.Context, desired []DesiredState) error {
	actual, err := m.docker.ListContainers(ctx)
	if err != nil {
		return fmt.Errorf("list containers: %w", err)
	}

	byDesiredID := make(map[string][]ContainerInfo)
	for _, c := range actual {
		dsID, ok := c.Labels[labelDesiredStateID]
		if !ok {
			continue
		}
		byDesiredID[dsID] = append(byDesiredID[dsID], c)
	}

	// For each desired state, ensure the right containers exist
	for _, ds := range desired {
		existingContainers := byDesiredID[ds.ID]
		delete(byDesiredID, ds.ID)

		if ds.Draining {
			m.handleDraining(ctx, ds, existingContainers)
			continue
		}

		if ds.RestartRequested {
			m.handleRestart(ctx, ds, existingContainers)
			continue
		}

		m.reconcileDesired(ctx, ds, existingContainers)
	}

	// Remove orphaned containers (actual with no matching desired)
	for _, containers := range byDesiredID {
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

	// Report actual state for all managed containers
	m.reportActualState(ctx, actual)

	// Report images
	m.reportImages(ctx)

	return nil
}

func (m *Manager) reconcileDesired(ctx context.Context, ds DesiredState, existing []ContainerInfo) {
	currentCount := len(existing)
	targetCount := ds.Replicas

	// Check if existing containers need replacement (image, version, or runtime contract mismatch)
	for _, c := range existing {
		if m.needsReplacement(ds, c) {
			if shouldDeferOrchestratorReplacement(ds, c) {
				m.logger.Info(
					"deferring orchestrator replacement while task is active",
					"container", c.ID,
					"worker", ds.WorkerName,
					"task_id", ds.ActiveTaskID,
				)
				m.emitLog("container", "container.wds_replace_deferred", "warn", "completed", map[string]any{
					"action":           "replace_deferred",
					"worker":           ds.WorkerName,
					"container_id":     c.ID,
					"desired_state_id": ds.ID,
					"image":            ds.RuntimeImage,
					"version":          ds.Version,
					"role":             ds.Role,
					"task_id":          ds.ActiveTaskID,
					"reason":           "active_task_in_progress",
				})
				continue
			}
			m.logger.Info("replacing container", "container", c.ID, "reason", "image, version, or contract mismatch")
			_ = m.docker.StopContainer(ctx, c.ID, m.config.StopTimeout)
			_ = m.docker.RemoveContainer(ctx, c.ID)
			m.emitLog("container", "container.wds_replace", "info", "completed", map[string]any{
				"action":           "replace",
				"worker":           ds.WorkerName,
				"container_id":     c.ID,
				"image":            ds.RuntimeImage,
				"desired_state_id": ds.ID,
				"reason":           "image_version_or_contract_mismatch",
			})
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
				"action":           "create",
				"worker":           ds.WorkerName,
				"image":            ds.RuntimeImage,
				"desired_state_id": ds.ID,
				"version":          ds.Version,
				"role":             ds.Role,
			}, err.Error())
			continue
		}
		if err := m.attachDesiredStateInternalNetwork(ctx, ds, containerID); err != nil {
			m.logger.Error("failed to finalize container runtime contract",
				"worker", ds.WorkerName,
				"container", containerID,
				"error", err,
			)
			_ = m.docker.RemoveContainer(ctx, containerID)
			m.emitLogError("container", "container.wds_create", map[string]any{
				"action":           "create",
				"worker":           ds.WorkerName,
				"container_id":     containerID,
				"image":            ds.RuntimeImage,
				"desired_state_id": ds.ID,
				"version":          ds.Version,
				"role":             ds.Role,
				"reason":           "runtime_contract_attach_failed",
			}, err.Error())
			continue
		}
		m.logger.Info("created container", "worker", ds.WorkerName, "container", containerID)
		m.emitLog("container", "container.wds_create", "info", "completed", map[string]any{
			"action":           "create",
			"worker":           ds.WorkerName,
			"container_id":     containerID,
			"image":            ds.RuntimeImage,
			"desired_state_id": ds.ID,
			"version":          ds.Version,
			"role":             ds.Role,
		})
	}

	// Scale down if needed
	if currentCount > targetCount {
		for i := targetCount; i < currentCount && i < len(existing); i++ {
			m.logger.Info("scaling down, removing container", "container", existing[i].ID)
			_ = m.docker.StopContainer(ctx, existing[i].ID, m.config.StopTimeout)
			_ = m.docker.RemoveContainer(ctx, existing[i].ID)
			m.emitLog("container", "container.wds_destroy", "info", "completed", map[string]any{
				"action":           "scale_down",
				"worker":           ds.WorkerName,
				"container_id":     existing[i].ID,
				"desired_state_id": ds.ID,
				"version":          ds.Version,
				"role":             ds.Role,
				"reason":           "scale_down",
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
			"action":           "drain",
			"worker":           ds.WorkerName,
			"container_id":     c.ID,
			"desired_state_id": ds.ID,
			"version":          ds.Version,
			"role":             ds.Role,
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
	created := 0
	for i := 0; i < ds.Replicas; i++ {
		spec := m.buildContainerSpec(ds, i)
		containerID, err := m.docker.CreateContainer(ctx, spec)
		if err != nil {
			m.logger.Error("failed to recreate container after restart", "worker", ds.WorkerName, "error", err)
			continue
		}
		if err := m.attachDesiredStateInternalNetwork(ctx, ds, containerID); err != nil {
			m.logger.Error("failed to finalize restarted container runtime contract",
				"worker", ds.WorkerName,
				"container", containerID,
				"error", err,
			)
			_ = m.docker.RemoveContainer(ctx, containerID)
			continue
		}
		created++
		m.logger.Info("recreated container after restart", "worker", ds.WorkerName, "container", containerID)
	}
	if created == ds.Replicas {
		if err := m.platform.AcknowledgeWorkerRestart(ds.ID); err != nil {
			m.logger.Error("failed to acknowledge worker restart", "worker", ds.WorkerName, "desired_state_id", ds.ID, "error", err)
			m.emitLog("container", "container.wds_restart_ack", "error", "failed", map[string]any{
				"action":           "restart_ack",
				"worker":           ds.WorkerName,
				"desired_state_id": ds.ID,
				"replicas":         ds.Replicas,
				"created":          created,
				"role":             ds.Role,
				"error":            err.Error(),
			})
		} else {
			m.emitLog("container", "container.wds_restart_ack", "info", "completed", map[string]any{
				"action":           "restart_ack",
				"worker":           ds.WorkerName,
				"desired_state_id": ds.ID,
				"replicas":         ds.Replicas,
				"created":          created,
				"role":             ds.Role,
			})
		}
	}
	m.emitLog("container", "container.wds_restart", "info", "completed", map[string]any{
		"action":           "restart",
		"worker":           ds.WorkerName,
		"stopped":          len(existing),
		"created":          created,
		"replicas":         ds.Replicas,
		"desired_state_id": ds.ID,
		"version":          ds.Version,
		"role":             ds.Role,
	})
}

func (m *Manager) needsReplacement(ds DesiredState, c ContainerInfo) bool {
	if !isContainerRunning(c.Status) {
		return true
	}
	if c.Image != ds.RuntimeImage {
		return true
	}
	if needsOrchestratorContractReplacement(ds, c, m.config) {
		return true
	}
	if v, ok := c.Labels[labelVersion]; ok {
		if v != fmt.Sprintf("%d", ds.Version) {
			return true
		}
	}
	return false
}

func shouldDeferOrchestratorReplacement(ds DesiredState, c ContainerInfo) bool {
	if !isOrchestratorDesiredState(ds) {
		return false
	}
	if strings.TrimSpace(ds.ActiveTaskID) == "" {
		return false
	}
	return isContainerRunning(c.Status)
}

func (m *Manager) attachDesiredStateInternalNetwork(ctx context.Context, ds DesiredState, containerID string) error {
	internalNetwork := orchestratorInternalNetwork(m.config, ds)
	if internalNetwork == "" {
		return nil
	}
	if err := m.docker.ConnectNetwork(ctx, containerID, internalNetwork); err != nil {
		m.emitLogError("container", "container.wds_network_connect", map[string]any{
			"action":           "network_connect",
			"worker":           ds.WorkerName,
			"container_id":     containerID,
			"network":          internalNetwork,
			"desired_state_id": ds.ID,
			"version":          ds.Version,
			"role":             ds.Role,
		}, err.Error())
		return fmt.Errorf("connect desired-state container to internal network: %w", err)
	}
	m.emitLog("container", "container.wds_network_connect", "info", "completed", map[string]any{
		"action":           "network_connect",
		"worker":           ds.WorkerName,
		"container_id":     containerID,
		"network":          internalNetwork,
		"desired_state_id": ds.ID,
		"version":          ds.Version,
		"role":             ds.Role,
	})
	return nil
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
	env[envRuntimeWorkerName] = ds.WorkerName
	if ds.LLMProvider != nil {
		env["LLM_PROVIDER"] = *ds.LLMProvider
	}
	if ds.LLMModel != nil {
		env["LLM_MODEL"] = *ds.LLMModel
	}

	spec := ContainerSpec{
		Name:        strings.ReplaceAll(name, " ", "-"),
		Image:       ds.RuntimeImage,
		CPULimit:    ds.CPULimit,
		MemoryLimit: ds.MemoryLimit,
		Environment: env,
		NetworkName: m.config.RuntimeNetwork,
		Labels: map[string]string{
			labelManagedBy:      "true",
			labelDesiredStateID: ds.ID,
			labelVersion:        fmt.Sprintf("%d", ds.Version),
		},
	}
	applyOrchestratorRuntimeContract(&spec, m.config, ds)
	return spec
}

func (m *Manager) reportActualState(ctx context.Context, containers []ContainerInfo) {
	// Track active container IDs per desired state for stale cleanup.
	activeByDS := make(map[string][]string)

	for _, c := range containers {
		dsID, ok := c.Labels[labelDesiredStateID]
		if !ok {
			continue
		}

		activeByDS[dsID] = append(activeByDS[dsID], c.ID)

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

	// Prune actual-state rows for containers that no longer exist.
	for dsID, containerIDs := range activeByDS {
		if err := m.platform.PruneActualState(dsID, containerIDs); err != nil {
			m.logger.Error("failed to prune stale actual state", "desired_state_id", dsID, "error", err)
		}
	}
}

func (m *Manager) reportImages(ctx context.Context) {
	images, err := m.docker.ListImages(ctx)
	if err != nil {
		m.logger.Error("failed to list images", "error", err)
		return
	}
	fingerprint := fingerprintImages(images)
	if fingerprint == m.lastReportedImages {
		return
	}
	allReported := true
	for _, img := range images {
		if err := m.platform.ReportImage(img); err != nil {
			allReported = false
			m.logger.Error("failed to report image", "repository", img.Repository, "error", err)
		}
	}
	if allReported {
		m.lastReportedImages = fingerprint
	}
}

func fingerprintImages(images []ContainerImage) string {
	if len(images) == 0 {
		return ""
	}

	parts := make([]string, 0, len(images))
	for _, img := range images {
		tag := ""
		if img.Tag != nil {
			tag = *img.Tag
		}
		digest := ""
		if img.Digest != nil {
			digest = *img.Digest
		}
		size := ""
		if img.SizeBytes != nil {
			size = fmt.Sprintf("%d", *img.SizeBytes)
		}
		parts = append(parts, fmt.Sprintf("%s|%s|%s|%s", img.Repository, tag, digest, size))
	}
	slices.Sort(parts)
	return strings.Join(parts, "\n")
}
