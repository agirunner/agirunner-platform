package manager

import (
	"context"
	"fmt"
	"strings"
)

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

	desiredByID := make(map[string]DesiredState, len(desired))
	for _, ds := range desired {
		desiredByID[ds.ID] = ds
	}

	byDesiredID := make(map[string][]ContainerInfo)
	orphanedContainers := make([]ContainerInfo, 0)
	for _, c := range actual {
		dsID, ok := c.Labels[labelDesiredStateID]
		if !ok {
			continue
		}
		if _, exists := desiredByID[dsID]; !exists {
			orphanedContainers = append(orphanedContainers, c)
			continue
		}
		byDesiredID[dsID] = append(byDesiredID[dsID], c)
	}

	cleanedOrphans := make(map[string]struct{}, len(orphanedContainers))
	for _, c := range orphanedContainers {
		cleanedOrphans[c.ID] = struct{}{}
		m.removeWDSOrphanContainer(ctx, c)
	}

	for _, ds := range desired {
		existingContainers := byDesiredID[ds.ID]

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

	m.reportActualState(ctx, filterContainersByID(actual, cleanedOrphans))
	m.reportImages(ctx)

	return nil
}

func filterContainersByID(containers []ContainerInfo, excluded map[string]struct{}) []ContainerInfo {
	if len(excluded) == 0 {
		return containers
	}
	filtered := make([]ContainerInfo, 0, len(containers))
	for _, container := range containers {
		if _, skip := excluded[container.ID]; skip {
			continue
		}
		filtered = append(filtered, container)
	}
	return filtered
}

func (m *Manager) removeWDSOrphanContainer(ctx context.Context, c ContainerInfo) {
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

func (m *Manager) reconcileDesired(ctx context.Context, ds DesiredState, existing []ContainerInfo) {
	currentCount := len(existing)
	targetCount := ds.Replicas

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
		LogMaxSize:  fmt.Sprintf("%dm", m.config.RuntimeLogMaxSizeMB),
		LogMaxFiles: fmt.Sprintf("%d", m.config.RuntimeLogMaxFiles),
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
