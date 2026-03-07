package reconciler

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"
)

// DockerClient abstracts Docker operations for the reconciler.
// In production this talks to a Docker socket proxy, never the raw socket.
type DockerClient interface {
	ListContainers(ctx context.Context) ([]ContainerInfo, error)
	CreateContainer(ctx context.Context, spec ContainerSpec) (string, error)
	StopContainer(ctx context.Context, containerID string, timeout time.Duration) error
	RemoveContainer(ctx context.Context, containerID string) error
	ListImages(ctx context.Context) ([]ContainerImage, error)
	GetContainerStats(ctx context.Context, containerID string) (*ContainerStats, error)
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
}

// Config holds reconciler configuration.
type Config struct {
	PlatformAPIURL  string
	PlatformAPIKey  string
	DockerHost      string
	ReconcileInterval time.Duration
	StopTimeout     time.Duration
}

// Reconciler implements the desired-state reconciliation loop.
type Reconciler struct {
	platform *PlatformClient
	docker   DockerClient
	config   Config
	logger   *slog.Logger
}

// New creates a new Reconciler.
func New(cfg Config, docker DockerClient, logger *slog.Logger) *Reconciler {
	return &Reconciler{
		platform: NewPlatformClient(cfg.PlatformAPIURL, cfg.PlatformAPIKey),
		docker:   docker,
		config:   cfg,
		logger:   logger,
	}
}

// Run starts the reconcile loop and blocks until the context is cancelled.
func (r *Reconciler) Run(ctx context.Context) error {
	r.logger.Info("reconciler started", "interval", r.config.ReconcileInterval)

	ticker := time.NewTicker(r.config.ReconcileInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			r.logger.Info("reconciler stopped")
			return ctx.Err()
		case <-ticker.C:
			if err := r.reconcileOnce(ctx); err != nil {
				r.logger.Error("reconcile cycle failed", "error", err)
			}
		}
	}
}

const labelManagedBy = "agirunner.reconciler"
const labelDesiredStateID = "agirunner.desired_state_id"
const labelVersion = "agirunner.version"

func (r *Reconciler) reconcileOnce(ctx context.Context) error {
	desired, err := r.platform.FetchDesiredState()
	if err != nil {
		return fmt.Errorf("fetch desired state: %w", err)
	}

	actual, err := r.docker.ListContainers(ctx)
	if err != nil {
		return fmt.Errorf("list containers: %w", err)
	}

	// Index actual containers by desired_state_id
	actualByDesiredID := make(map[string][]ContainerInfo)
	for _, c := range actual {
		if dsID, ok := c.Labels[labelDesiredStateID]; ok {
			actualByDesiredID[dsID] = append(actualByDesiredID[dsID], c)
		}
	}

	// For each desired state, ensure the right containers exist
	for _, ds := range desired {
		existingContainers := actualByDesiredID[ds.ID]
		delete(actualByDesiredID, ds.ID)

		if ds.Draining {
			r.handleDraining(ctx, ds, existingContainers)
			continue
		}

		if ds.RestartRequested {
			r.handleRestart(ctx, ds, existingContainers)
			continue
		}

		r.reconcileDesired(ctx, ds, existingContainers)
	}

	// Remove orphaned containers (actual with no matching desired)
	for _, containers := range actualByDesiredID {
		for _, c := range containers {
			r.logger.Info("removing orphaned container", "container", c.ID, "name", c.Name)
			if err := r.docker.StopContainer(ctx, c.ID, r.config.StopTimeout); err != nil {
				r.logger.Error("failed to stop orphaned container", "container", c.ID, "error", err)
			}
			if err := r.docker.RemoveContainer(ctx, c.ID); err != nil {
				r.logger.Error("failed to remove orphaned container", "container", c.ID, "error", err)
			}
		}
	}

	// Report actual state for all managed containers
	r.reportActualState(ctx, actual)

	// Report images
	r.reportImages(ctx)

	return nil
}

func (r *Reconciler) reconcileDesired(ctx context.Context, ds DesiredState, existing []ContainerInfo) {
	currentCount := len(existing)
	targetCount := ds.Replicas

	// Check if existing containers need replacement (version mismatch or wrong image)
	for _, c := range existing {
		if r.needsReplacement(ds, c) {
			r.logger.Info("replacing container", "container", c.ID, "reason", "version or image mismatch")
			_ = r.docker.StopContainer(ctx, c.ID, r.config.StopTimeout)
			_ = r.docker.RemoveContainer(ctx, c.ID)
			currentCount--
		}
	}

	// Scale up if needed
	for i := currentCount; i < targetCount; i++ {
		spec := r.buildContainerSpec(ds, i)
		containerID, err := r.docker.CreateContainer(ctx, spec)
		if err != nil {
			r.logger.Error("failed to create container", "worker", ds.WorkerName, "error", err)
			continue
		}
		r.logger.Info("created container", "worker", ds.WorkerName, "container", containerID)
	}

	// Scale down if needed
	if currentCount > targetCount {
		for i := targetCount; i < currentCount && i < len(existing); i++ {
			r.logger.Info("scaling down, removing container", "container", existing[i].ID)
			_ = r.docker.StopContainer(ctx, existing[i].ID, r.config.StopTimeout)
			_ = r.docker.RemoveContainer(ctx, existing[i].ID)
		}
	}
}

func (r *Reconciler) handleDraining(ctx context.Context, ds DesiredState, existing []ContainerInfo) {
	for _, c := range existing {
		r.logger.Info("draining container", "container", c.ID, "worker", ds.WorkerName)
		_ = r.docker.StopContainer(ctx, c.ID, r.config.StopTimeout)
		_ = r.docker.RemoveContainer(ctx, c.ID)
	}
}

func (r *Reconciler) handleRestart(ctx context.Context, ds DesiredState, existing []ContainerInfo) {
	for _, c := range existing {
		r.logger.Info("restarting container", "container", c.ID, "worker", ds.WorkerName)
		_ = r.docker.StopContainer(ctx, c.ID, r.config.StopTimeout)
		_ = r.docker.RemoveContainer(ctx, c.ID)
	}

	// Recreate
	for i := 0; i < ds.Replicas; i++ {
		spec := r.buildContainerSpec(ds, i)
		containerID, err := r.docker.CreateContainer(ctx, spec)
		if err != nil {
			r.logger.Error("failed to recreate container after restart", "worker", ds.WorkerName, "error", err)
			continue
		}
		r.logger.Info("recreated container after restart", "worker", ds.WorkerName, "container", containerID)
	}
}

func (r *Reconciler) needsReplacement(ds DesiredState, c ContainerInfo) bool {
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

func (r *Reconciler) buildContainerSpec(ds DesiredState, replicaIndex int) ContainerSpec {
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

func (r *Reconciler) reportActualState(ctx context.Context, containers []ContainerInfo) {
	for _, c := range containers {
		dsID, ok := c.Labels[labelDesiredStateID]
		if !ok {
			continue
		}

		stats, err := r.docker.GetContainerStats(ctx, c.ID)
		if err != nil {
			r.logger.Error("failed to get container stats", "container", c.ID, "error", err)
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

		if err := r.platform.ReportActualState(state); err != nil {
			r.logger.Error("failed to report actual state", "container", c.ID, "error", err)
		}
	}
}

func (r *Reconciler) reportImages(ctx context.Context) {
	images, err := r.docker.ListImages(ctx)
	if err != nil {
		r.logger.Error("failed to list images", "error", err)
		return
	}
	for _, img := range images {
		if err := r.platform.ReportImage(img); err != nil {
			r.logger.Error("failed to report image", "repository", img.Repository, "error", err)
		}
	}
}
