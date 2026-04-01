package manager

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"time"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/events"
	"github.com/prometheus/client_golang/prometheus"
)

// DockerClient abstracts Docker operations for the container manager.
// In production this talks to a Docker socket proxy, never the raw socket.
type DockerClient interface {
	ListContainers(ctx context.Context) ([]ContainerInfo, error)
	ListApplicationContainers(ctx context.Context) ([]ApplicationContainerInfo, error)
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
	ID          string
	Name        string
	Image       string
	State       string
	Status      string
	CPULimit    string
	MemoryLimit string
	StartedAt   time.Time
	Labels      map[string]string
}

// ContainerSpec describes how to create a new container.
type ContainerSpec struct {
	Name        string
	Image       string
	CPULimit    string
	MemoryLimit string
	LogMaxSize  string
	LogMaxFiles string
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
	RuntimeLogMaxSizeMB         int
	RuntimeLogMaxFiles          int
	RuntimeOrphanGraceCycles    int
	RuntimeNetwork              string
	RuntimeInternalNetwork      string
	StackProjectName            string
}

// PlatformAPI abstracts communication with the platform API.
type PlatformAPI interface {
	FetchDesiredState() ([]DesiredState, error)
	FetchReconcileSnapshot() (*ReconcileSnapshot, error)
	ReportActualState(state ActualState) error
	ReportLiveContainerInventory(containers []LiveContainerReport) error
	PruneActualState(desiredStateID string, activeContainerIDs []string) error
	ReportImage(image ContainerImage) error
	FetchRuntimeTargets() ([]RuntimeTarget, error)
	FetchHeartbeats() ([]RuntimeHeartbeat, error)
	GetTaskState(taskID string) (string, error)
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
	if inventoryErr := m.reportLiveContainerInventory(ctx); inventoryErr != nil {
		m.logger.Error("live container inventory report failed", "error", inventoryErr)
		m.emitLogError("container", "inventory.report", map[string]any{
			"action": "report_live_inventory",
			"cycle":  m.cycleCount,
		}, inventoryErr.Error())
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
