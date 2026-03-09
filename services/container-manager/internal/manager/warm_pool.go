package manager

import (
	"context"
	"fmt"

	"github.com/google/uuid"
)

// reconcileWarmTaskPoolsFromDocker fetches the current container list and
// delegates to reconcileWarmTaskPools. This is the entry point called from
// the DCM reconcile cycle.
func (m *Manager) reconcileWarmTaskPoolsFromDocker(ctx context.Context, targets []RuntimeTarget) {
	allContainers, err := m.docker.ListContainers(ctx)
	if err != nil {
		m.logger.Error("failed to list containers for warm task pool reconciliation", "error", err)
		return
	}
	m.reconcileWarmTaskPools(ctx, targets, allContainers)
}

// reconcileWarmTaskPools manages pre-created task containers for warm-mode
// templates. For each target with pool_mode="warm" and warm_pool_size > 0,
// it scales the warm task container count to match the desired pool size.
func (m *Manager) reconcileWarmTaskPools(
	ctx context.Context,
	targets []RuntimeTarget,
	allContainers []ContainerInfo,
) {
	warmByTemplate := groupWarmTaskContainers(allContainers)
	activeTemplates := make(map[string]bool, len(targets))

	for _, target := range targets {
		activeTemplates[target.TemplateID] = true
		m.reconcileWarmTaskPool(ctx, target, warmByTemplate[target.TemplateID])
	}

	m.cleanupOrphanWarmTaskContainers(ctx, warmByTemplate, activeTemplates)
}

// reconcileWarmTaskPool scales a single template's warm task pool to its
// desired size. It validates that the target is eligible (warm mode, has a
// task image) before creating or removing containers.
func (m *Manager) reconcileWarmTaskPool(
	ctx context.Context,
	target RuntimeTarget,
	existing []ContainerInfo,
) {
	desired := warmTaskPoolDesiredCount(target)
	current := len(existing)

	if current < desired {
		m.createWarmTaskContainers(ctx, target, desired-current)
		return
	}

	if current > desired {
		m.removeExcessWarmTaskContainers(ctx, existing, current-desired)
	}
}

// warmTaskPoolDesiredCount returns 0 when the target is ineligible for warm
// task pooling (cold mode, missing task image, or zero pool size).
func warmTaskPoolDesiredCount(target RuntimeTarget) int {
	if target.PoolMode != "warm" {
		return 0
	}
	if target.TaskImage == "" {
		return 0
	}
	if target.WarmPoolSize <= 0 {
		return 0
	}
	return target.WarmPoolSize
}

// createWarmTaskContainers pulls the task image and creates the specified
// number of warm task containers. The image is pulled once before the loop.
func (m *Manager) createWarmTaskContainers(ctx context.Context, target RuntimeTarget, count int) {
	if count <= 0 {
		return
	}

	if err := m.docker.PullImage(ctx, target.TaskImage, target.PullPolicy); err != nil {
		m.logger.Error("failed to pull task image for warm pool",
			"image", target.TaskImage, "template", target.TemplateID, "error", err)
		return
	}

	for i := 0; i < count; i++ {
		spec := buildWarmTaskSpec(target, m.config.RuntimeNetwork)
		containerID, err := m.docker.CreateContainer(ctx, spec)
		if err != nil {
			m.logger.Error("failed to create warm task container",
				"template", target.TemplateID, "error", err)
			continue
		}
		m.logger.Info("created warm task container",
			"template", target.TemplateID, "container", containerID)
		m.logFleetEvent("warm_task_created", "info", "", target.TemplateID, containerID)
	}
}

// buildWarmTaskSpec constructs a ContainerSpec for a warm-pool task container.
func buildWarmTaskSpec(target RuntimeTarget, networkName string) ContainerSpec {
	poolID := uuid.New().String()
	name := fmt.Sprintf("warm-task-%s-%s",
		target.TemplateID[:minLen(target.TemplateID, 8)], poolID[:8])

	return ContainerSpec{
		Name:        name,
		Image:       target.TaskImage,
		CPULimit:    target.CPU,
		MemoryLimit: target.Memory,
		Labels:      buildWarmTaskLabels(target),
		NetworkName: networkName,
	}
}

// buildWarmTaskLabels creates labels identifying a warm-pool task container.
func buildWarmTaskLabels(target RuntimeTarget) map[string]string {
	return map[string]string{
		labelDCMManaged:    "true",
		labelDCMTier:       tierTask,
		labelDCMTemplateID: target.TemplateID,
		labelDCMWarmPool:   "true",
		labelManagedBy:     "true",
	}
}

// removeExcessWarmTaskContainers removes containers from the tail of the
// slice until the desired count is reached.
func (m *Manager) removeExcessWarmTaskContainers(
	ctx context.Context,
	containers []ContainerInfo,
	toRemove int,
) {
	for i := len(containers) - 1; i >= 0 && toRemove > 0; i-- {
		m.logger.Info("removing excess warm task container",
			"container", containers[i].ID,
			"template", containers[i].Labels[labelDCMTemplateID])
		m.stopAndRemove(ctx, containers[i].ID, m.config.StopTimeout)
		toRemove--
	}
}

// groupWarmTaskContainers returns warm task containers indexed by template ID.
func groupWarmTaskContainers(containers []ContainerInfo) map[string][]ContainerInfo {
	grouped := make(map[string][]ContainerInfo)
	for _, c := range containers {
		if !isWarmTaskContainer(c) {
			continue
		}
		tmplID := c.Labels[labelDCMTemplateID]
		grouped[tmplID] = append(grouped[tmplID], c)
	}
	return grouped
}

// isWarmTaskContainer returns true for DCM-managed task containers in the warm pool.
func isWarmTaskContainer(c ContainerInfo) bool {
	return c.Labels[labelDCMManaged] == "true" &&
		c.Labels[labelDCMTier] == tierTask &&
		c.Labels[labelDCMWarmPool] == "true"
}

// cleanupOrphanWarmTaskContainers removes warm task containers whose template
// no longer exists in the active target set.
func (m *Manager) cleanupOrphanWarmTaskContainers(
	ctx context.Context,
	warmByTemplate map[string][]ContainerInfo,
	activeTemplates map[string]bool,
) {
	for tmplID, containers := range warmByTemplate {
		if activeTemplates[tmplID] {
			continue
		}
		for _, c := range containers {
			m.logger.Info("removing orphan warm task container",
				"container", c.ID, "template", tmplID)
			m.stopAndRemove(ctx, c.ID, m.config.StopTimeout)
			m.metrics.RecordOrphanCleaned()
		}
	}
}
