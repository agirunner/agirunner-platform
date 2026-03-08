package manager

import (
	"context"
	"fmt"
	"strings"
)

// reconcileDCM performs the Dynamic Container Management reconciliation cycle.
// It manages runtime containers based on platform-provided runtime targets.
func (m *Manager) reconcileDCM(ctx context.Context) error {
	targets, err := m.platform.FetchRuntimeTargets()
	if err != nil {
		return fmt.Errorf("fetch runtime targets: %w", err)
	}

	containers, err := m.listDCMRuntimeContainers(ctx)
	if err != nil {
		return fmt.Errorf("list DCM containers: %w", err)
	}

	grouped := groupContainersByTemplate(containers)
	totalRunning := len(containers)

	for _, target := range targets {
		running := grouped[target.TemplateID]
		actions := m.planTargetActions(target, running, totalRunning)
		totalRunning += m.executeTargetActions(ctx, target, running, actions)
	}

	m.cleanupOrphanTaskContainers(ctx)
	return nil
}

// listDCMRuntimeContainers returns containers with DCM managed + runtime tier.
func (m *Manager) listDCMRuntimeContainers(ctx context.Context) ([]ContainerInfo, error) {
	all, err := m.docker.ListContainers(ctx)
	if err != nil {
		return nil, fmt.Errorf("docker list containers: %w", err)
	}
	return filterByLabels(all, labelDCMManaged, "true", labelDCMTier, tierRuntime), nil
}

// groupContainersByTemplate organizes containers by template ID.
func groupContainersByTemplate(containers []ContainerInfo) map[string][]ContainerInfo {
	grouped := make(map[string][]ContainerInfo)
	for _, c := range containers {
		tmplID := c.Labels[labelDCMTemplateID]
		grouped[tmplID] = append(grouped[tmplID], c)
	}
	return grouped
}

// filterByLabels returns containers matching all key-value label pairs.
func filterByLabels(containers []ContainerInfo, pairs ...string) []ContainerInfo {
	var result []ContainerInfo
	for _, c := range containers {
		if matchesAllLabels(c.Labels, pairs) {
			result = append(result, c)
		}
	}
	return result
}

// matchesAllLabels checks whether a label map contains all key-value pairs.
func matchesAllLabels(labels map[string]string, pairs []string) bool {
	for i := 0; i+1 < len(pairs); i += 2 {
		if labels[pairs[i]] != pairs[i+1] {
			return false
		}
	}
	return true
}

// targetActions describes changes needed for a single runtime target.
type targetActions struct {
	toCreate      int
	idleToDestroy []ContainerInfo
	driftToHandle []ContainerInfo
}

// planTargetActions determines scaling and lifecycle actions for a target.
func (m *Manager) planTargetActions(
	target RuntimeTarget,
	running []ContainerInfo,
	totalRunning int,
) targetActions {
	capacity := m.config.GlobalMaxRuntimes - totalRunning
	return targetActions{
		toCreate:      computeScaleUp(target, len(running), capacity),
		idleToDestroy: findIdleForTeardown(target, running),
		driftToHandle: findImageDrift(target, running),
	}
}

// computeScaleUp calculates how many runtimes to create for a target.
func computeScaleUp(target RuntimeTarget, runningCount, capacity int) int {
	if target.PendingTasks <= 0 {
		return 0
	}
	maxAllowed := target.MaxRuntimes
	if runningCount+capacity < maxAllowed {
		maxAllowed = runningCount + capacity
	}
	toCreate := maxAllowed - runningCount
	if toCreate > target.PendingTasks {
		toCreate = target.PendingTasks
	}
	if toCreate < 0 {
		return 0
	}
	return toCreate
}

// findIdleForTeardown identifies idle containers that should be destroyed.
func findIdleForTeardown(target RuntimeTarget, running []ContainerInfo) []ContainerInfo {
	switch target.PoolMode {
	case "cold":
		return findColdIdleExpired(target, running)
	case "warm":
		return findWarmNoWorkflows(target, running)
	default:
		return nil
	}
}

// findColdIdleExpired returns containers idle past the timeout.
func findColdIdleExpired(target RuntimeTarget, running []ContainerInfo) []ContainerInfo {
	if target.IdleTimeoutSeconds <= 0 {
		return nil
	}
	var expired []ContainerInfo
	for _, c := range running {
		if !isDrainingContainer(c) && isIdlePastTimeout(c, target.IdleTimeoutSeconds) {
			expired = append(expired, c)
		}
	}
	return expired
}

// findWarmNoWorkflows returns all runtimes when no active workflows remain.
func findWarmNoWorkflows(target RuntimeTarget, running []ContainerInfo) []ContainerInfo {
	if target.ActiveWorkflows > 0 {
		return nil
	}
	return running
}

// isIdlePastTimeout checks if a container is idle beyond the timeout threshold.
func isIdlePastTimeout(c ContainerInfo, _ int) bool {
	status := strings.ToLower(c.Status)
	return strings.HasPrefix(status, "up") && !isDrainingContainer(c)
}

// isDrainingContainer checks whether a container has the draining label.
func isDrainingContainer(c ContainerInfo) bool {
	return c.Labels[labelDCMDraining] == "true"
}

// findImageDrift returns containers with an image different from the target.
func findImageDrift(target RuntimeTarget, running []ContainerInfo) []ContainerInfo {
	var drifted []ContainerInfo
	for _, c := range running {
		if c.Labels[labelDCMImage] != target.Image {
			drifted = append(drifted, c)
		}
	}
	return drifted
}

// executeTargetActions carries out planned actions, returning net container delta.
func (m *Manager) executeTargetActions(
	ctx context.Context,
	target RuntimeTarget,
	_ []ContainerInfo,
	actions targetActions,
) int {
	delta := 0
	delta -= m.destroyContainers(ctx, actions.idleToDestroy, target.GracePeriodSeconds)
	delta -= m.handleDriftContainers(ctx, actions.driftToHandle, target)
	delta += m.createRuntimeContainers(ctx, target, actions.toCreate)
	return delta
}
