package manager

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// createRuntimeContainers creates the specified number of runtime containers.
func (m *Manager) createRuntimeContainers(ctx context.Context, target RuntimeTarget, count int) int {
	created := 0
	for i := 0; i < count; i++ {
		spec := m.buildDCMRuntimeSpec(target)
		containerID, err := m.docker.CreateContainer(ctx, spec)
		if err != nil {
			m.logger.Error("failed to create DCM runtime", "template", target.TemplateID, "error", err)
			continue
		}
		m.logFleetEvent("runtime_created", "info", spec.Labels[labelDCMRuntimeID], target.TemplateID, containerID)
		created++
	}
	return created
}

// buildDCMRuntimeSpec constructs a ContainerSpec for a DCM-managed runtime.
func (m *Manager) buildDCMRuntimeSpec(target RuntimeTarget) ContainerSpec {
	runtimeID := uuid.New().String()
	name := fmt.Sprintf("runtime-%s-%s", target.TemplateID[:minLen(target.TemplateID, 8)], runtimeID[:8])

	return ContainerSpec{
		Name:        name,
		Image:       target.Image,
		CPULimit:    target.CPU,
		MemoryLimit: target.Memory,
		Environment: m.buildDCMEnvironment(target, runtimeID),
		Labels:      buildDCMLabels(target, runtimeID),
		NetworkName: m.config.RuntimeNetwork,
	}
}

// buildDCMEnvironment creates environment variables for a DCM runtime container.
func (m *Manager) buildDCMEnvironment(target RuntimeTarget, runtimeID string) map[string]string {
	return map[string]string{
		"AGIRUNNER_RUNTIME_PLATFORM_API_URL":       m.config.PlatformAPIURL,
		"AGIRUNNER_RUNTIME_PLATFORM_ADMIN_API_KEY": m.config.PlatformAdminAPIKey,
		"AGIRUNNER_RUNTIME_TEMPLATE_FILTER":        target.TemplateID,
		"AGIRUNNER_RUNTIME_ID":                     runtimeID,
		"DOCKER_HOST":                              m.config.DockerHost,
	}
}

// buildDCMLabels creates labels for a DCM-managed runtime container.
func buildDCMLabels(target RuntimeTarget, runtimeID string) map[string]string {
	return map[string]string{
		labelDCMManaged:    "true",
		labelDCMTier:       tierRuntime,
		labelDCMTemplateID: target.TemplateID,
		labelDCMRuntimeID:  runtimeID,
		labelDCMImage:      target.Image,
		labelManagedBy:     "true",
	}
}

// destroyContainers stops and removes containers with the given grace period.
func (m *Manager) destroyContainers(ctx context.Context, containers []ContainerInfo, gracePeriodSec int) int {
	timeout := time.Duration(gracePeriodSec) * time.Second
	if timeout <= 0 {
		timeout = m.config.StopTimeout
	}
	destroyed := 0
	for _, c := range containers {
		m.stopAndRemove(ctx, c.ID, timeout)
		destroyed++
	}
	return destroyed
}

// handleDriftContainers processes containers with image drift.
func (m *Manager) handleDriftContainers(ctx context.Context, drifted []ContainerInfo, target RuntimeTarget) int {
	destroyed := 0
	for _, c := range drifted {
		if isDrainingContainer(c) {
			continue
		}
		m.logFleetEvent("image_drift_detected", "warn", c.Labels[labelDCMRuntimeID], target.TemplateID, c.ID)
		m.stopAndRemove(ctx, c.ID, m.config.StopTimeout)
		destroyed++
	}
	return destroyed
}

// stopAndRemove stops then removes a container, logging errors without failing.
func (m *Manager) stopAndRemove(ctx context.Context, containerID string, timeout time.Duration) {
	if err := m.docker.StopContainer(ctx, containerID, timeout); err != nil {
		m.logger.Error("failed to stop container", "container", containerID, "error", err)
	}
	if err := m.docker.RemoveContainer(ctx, containerID); err != nil {
		m.logger.Error("failed to remove container", "container", containerID, "error", err)
	}
}

// cleanupOrphanTaskContainers removes task containers whose parent runtimes are gone.
func (m *Manager) cleanupOrphanTaskContainers(ctx context.Context) {
	all, err := m.docker.ListContainers(ctx)
	if err != nil {
		m.logger.Error("failed to list containers for orphan cleanup", "error", err)
		return
	}

	runtimeIDs := collectRuntimeIDs(all)
	orphans := findOrphanTasks(all, runtimeIDs)

	for _, orphan := range orphans {
		m.logger.Info("removing orphan task container", "container", orphan.ID)
		m.stopAndRemove(ctx, orphan.ID, m.config.StopTimeout)
	}
}

// collectRuntimeIDs builds a set of active runtime IDs from containers.
func collectRuntimeIDs(containers []ContainerInfo) map[string]bool {
	ids := make(map[string]bool)
	for _, c := range containers {
		if c.Labels[labelDCMTier] == tierRuntime {
			if rid := c.Labels[labelDCMRuntimeID]; rid != "" {
				ids[rid] = true
			}
		}
	}
	return ids
}

// findOrphanTasks returns task containers whose parent runtime no longer exists.
func findOrphanTasks(containers []ContainerInfo, runtimeIDs map[string]bool) []ContainerInfo {
	var orphans []ContainerInfo
	for _, c := range containers {
		if c.Labels[labelDCMTier] != tierTask {
			continue
		}
		if c.Labels[labelDCMManaged] != "true" {
			continue
		}
		parentID := c.Labels[labelDCMRuntimeID]
		if parentID != "" && !runtimeIDs[parentID] {
			orphans = append(orphans, c)
		}
	}
	return orphans
}

// logFleetEvent records a fleet event via the platform client and logs it.
func (m *Manager) logFleetEvent(eventType, level, runtimeID, templateID, containerID string) {
	event := FleetEvent{
		EventType:   eventType,
		Level:       level,
		RuntimeID:   runtimeID,
		TemplateID:  templateID,
		ContainerID: containerID,
	}
	_ = m.platform.RecordFleetEvent(event)
	m.logger.Info("fleet event", "event", eventType, "runtime", runtimeID, "template", templateID)
}

// minLen returns the shorter of the string length and n.
func minLen(s string, n int) int {
	if len(s) < n {
		return len(s)
	}
	return n
}
