package manager

import (
	"context"
	"fmt"
	"strconv"
	"time"
)

const defaultGracePeriodSeconds = 180

// startupSweep adopts or removes DCM-managed containers based on current targets.
func (m *Manager) startupSweep(ctx context.Context) error {
	containers, err := m.listAllDCMContainers(ctx)
	if err != nil {
		return fmt.Errorf("list DCM containers on startup: %w", err)
	}

	if len(containers) == 0 {
		m.logger.Info("startup sweep: no DCM containers found")
		return nil
	}

	targets, err := m.platform.FetchRuntimeTargets()
	if err != nil {
		return fmt.Errorf("fetch runtime targets on startup: %w", err)
	}

	targetMap := buildTargetMap(targets)
	adopted, removed := m.adoptOrRemoveRuntimes(ctx, containers, targetMap)
	orphanCount := m.removeOrphanTasksOnStartup(ctx, containers)
	m.emitLog("container", "lifecycle.startup_sweep", "info", "completed", map[string]any{
		"action":           "startup_sweep",
		"total_containers": len(containers),
		"adopted":          adopted,
		"removed":          removed,
		"orphan_tasks":     orphanCount,
	})
	return nil
}

// listAllDCMContainers returns all containers with the DCM managed label.
func (m *Manager) listAllDCMContainers(ctx context.Context) ([]ContainerInfo, error) {
	all, err := m.docker.ListContainers(ctx)
	if err != nil {
		return nil, fmt.Errorf("docker list containers: %w", err)
	}

	var dcm []ContainerInfo
	for _, c := range all {
		if c.Labels[labelDCMManaged] == "true" {
			dcm = append(dcm, c)
		}
	}
	return dcm, nil
}

// buildTargetMap creates a lookup from template ID to RuntimeTarget.
func buildTargetMap(targets []RuntimeTarget) map[string]RuntimeTarget {
	m := make(map[string]RuntimeTarget, len(targets))
	for _, t := range targets {
		m[t.TemplateID] = t
	}
	return m
}

// adoptOrRemoveRuntimes keeps runtimes with matching targets, removes the rest.
// Returns counts of adopted and removed runtimes.
func (m *Manager) adoptOrRemoveRuntimes(
	ctx context.Context,
	containers []ContainerInfo,
	targetMap map[string]RuntimeTarget,
) (adopted, removed int) {
	for _, c := range containers {
		if c.Labels[labelDCMTier] != tierRuntime {
			continue
		}
		templateID := c.Labels[labelDCMTemplateID]
		if _, hasTarget := targetMap[templateID]; hasTarget {
			m.logger.Info("startup: adopting runtime", "container", c.ID, "template", templateID)
			adopted++
			continue
		}
		gracePeriod := gracePeriodForContainer(c)
		m.logger.Info("startup: removing stale runtime", "container", c.ID, "template", templateID)
		m.stopAndRemove(ctx, c.ID, gracePeriod)
		m.emitLog("container", "lifecycle.startup_remove", "info", "completed", map[string]any{
			"action":       "orphan_clean",
			"container_id": c.ID,
			"template_id":  templateID,
			"reason":       "no_matching_target",
		})
		removed++
	}
	return adopted, removed
}

// gracePeriodForContainer returns a stop timeout based on the container's
// grace_period label. Falls back to defaultGracePeriodSeconds when the label
// is missing or cannot be parsed.
func gracePeriodForContainer(c ContainerInfo) time.Duration {
	raw, ok := c.Labels[labelDCMGracePeriod]
	if !ok || raw == "" {
		return time.Duration(defaultGracePeriodSeconds) * time.Second
	}
	seconds, err := strconv.Atoi(raw)
	if err != nil || seconds <= 0 {
		return time.Duration(defaultGracePeriodSeconds) * time.Second
	}
	return time.Duration(seconds) * time.Second
}

// removeOrphanTasksOnStartup destroys task containers with dead parent runtimes.
func (m *Manager) removeOrphanTasksOnStartup(ctx context.Context, containers []ContainerInfo) int {
	runtimeIDs := collectRuntimeIDs(containers)
	orphans := findOrphanTasks(containers, runtimeIDs)

	for _, orphan := range orphans {
		m.logger.Info("startup: removing orphan task", "container", orphan.ID)
		m.stopAndRemove(ctx, orphan.ID, m.config.StopTimeout)
	}
	return len(orphans)
}

// shutdownCascade gracefully stops all DCM-managed containers on manager shutdown.
func (m *Manager) shutdownCascade() {
	start := time.Now()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	m.emitLog("container", "lifecycle.shutdown", "info", "started", map[string]any{"action": "shutdown"})

	m.logger.Info("shutdown cascade: stopping runtime containers")
	runtimeCount := m.shutdownRuntimes(ctx)

	m.logger.Info("shutdown cascade: cleaning up orphan task containers")
	taskCount := m.shutdownOrphanTasks(ctx)

	m.emitLogTimed("container", "lifecycle.shutdown", "info", "completed", map[string]any{
		"action":           "shutdown",
		"runtimes_stopped": runtimeCount,
		"tasks_cleaned":    taskCount,
	}, int(time.Since(start).Milliseconds()))

	m.logger.Info("shutdown cascade: complete")
}

// shutdownRuntimes stops all DCM runtime containers with appropriate grace periods.
func (m *Manager) shutdownRuntimes(ctx context.Context) int {
	containers, err := m.listDCMRuntimeContainers(ctx)
	if err != nil {
		m.logger.Error("shutdown: failed to list runtime containers", "error", err)
		return 0
	}

	for _, c := range containers {
		gracePeriod := gracePeriodForContainer(c)
		m.logger.Info("shutdown: stopping runtime", "container", c.ID)
		m.stopAndRemove(ctx, c.ID, gracePeriod)
	}
	return len(containers)
}

// shutdownOrphanTasks removes any remaining task containers after runtimes are stopped.
func (m *Manager) shutdownOrphanTasks(ctx context.Context) int {
	all, err := m.docker.ListContainers(ctx)
	if err != nil {
		m.logger.Error("shutdown: failed to list containers for task cleanup", "error", err)
		return 0
	}

	tasks := filterByLabels(all, labelDCMManaged, "true", labelDCMTier, tierTask)
	for _, t := range tasks {
		m.logger.Info("shutdown: removing task container", "container", t.ID)
		m.stopAndRemove(ctx, t.ID, m.config.StopTimeout)
	}
	return len(tasks)
}
