package manager

import (
	"context"
	"fmt"
	"strconv"
	"time"

	"github.com/google/uuid"
)

// createRuntimeContainers pulls the runtime image and creates the specified
// number of runtime containers. The image is pulled once before the creation
// loop — if the pull fails, no containers are created.
func (m *Manager) createRuntimeContainers(ctx context.Context, target RuntimeTarget, count int) int {
	if count <= 0 {
		return 0
	}

	pullStart := time.Now()
	pullMeta := map[string]any{"image": target.Image, "policy": target.PullPolicy, "template_id": target.TemplateID, "template_name": target.TemplateName}
	m.emitLog("container", "container.image_pull", "info", "started", pullMeta)

	if err := m.docker.PullImage(ctx, target.Image, target.PullPolicy); err != nil {
		m.logger.Error("failed to pull runtime image", "image", target.Image, "policy", target.PullPolicy, "error", err)
		m.emitLogError("container", "container.image_pull", pullMeta, err.Error())
		return 0
	}
	m.emitLogTimed("container", "container.image_pull", "info", "completed", pullMeta, int(time.Since(pullStart).Milliseconds()))

	created := 0
	for i := 0; i < count; i++ {
		spec := m.buildDCMRuntimeSpec(target)
		containerID, err := m.docker.CreateContainer(ctx, spec)
		if err != nil {
			m.logger.Error("failed to create DCM runtime", "template", target.TemplateID, "error", err)
			continue
		}
		if m.config.RuntimeInternalNetwork != "" {
			if err := m.docker.ConnectNetwork(ctx, containerID, m.config.RuntimeInternalNetwork); err != nil {
				m.logger.Error("failed to connect runtime to internal network",
					"container", containerID, "network", m.config.RuntimeInternalNetwork, "error", err)
			}
		}
		runtimeID := spec.Labels[labelDCMRuntimeID]
		m.logFleetEvent("runtime_created", "info", runtimeID, target.TemplateID, containerID)
		m.logFleetEvent("container.created", "info", runtimeID, target.TemplateID, containerID)
		m.metrics.RecordScalingEvent(target.TemplateID, "created")
		m.emitLog("container", "container.create", "info", "completed", map[string]any{
			"template_id":   target.TemplateID,
			"template_name": target.TemplateName,
			"runtime_id":    runtimeID,
			"image":         target.Image,
			"container_id":  containerID,
			"reason":        "scaling",
		})
		created++
	}
	return created
}

const pullFailCacheTTL = 5 * time.Minute

// prePullWarmImages pulls both the runtime and task container images for warm
// templates so they are cached locally before any container is created.
// Failed pulls are cached to avoid retrying the same image every cycle.
func (m *Manager) prePullWarmImages(ctx context.Context, target RuntimeTarget) {
	m.prePullImageWithCache(ctx, target.Image, target.PullPolicy, target.TemplateID, "runtime")
	if target.TaskImage != "" {
		m.prePullImageWithCache(ctx, target.TaskImage, target.PullPolicy, target.TemplateID, "task")
	}
}

// prePullImageWithCache attempts an image pull, skipping if the same image
// failed recently (within pullFailCacheTTL).
func (m *Manager) prePullImageWithCache(ctx context.Context, image, policy, templateID, imageType string) {
	if failedAt, ok := m.pullFailCache[image]; ok {
		if m.nowFunc().Sub(failedAt) < pullFailCacheTTL {
			return
		}
		delete(m.pullFailCache, image)
	}
	if err := m.docker.PullImage(ctx, image, policy); err != nil {
		m.pullFailCache[image] = m.nowFunc()
		m.logger.Error("failed to pre-pull "+imageType+" image for warm template",
			"image", image, "template", templateID, "error", err)
	}
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
		"AGIRUNNER_RUNTIME_PLATFORM_API_URL":          m.config.PlatformAPIURL,
		"AGIRUNNER_RUNTIME_PLATFORM_ADMIN_API_KEY":    m.config.PlatformAdminAPIKey,
		"AGIRUNNER_RUNTIME_PLATFORM_TEMPLATE_FILTER":  target.TemplateID,
		"AGIRUNNER_RUNTIME_PLATFORM_RUNTIME_ID":       runtimeID,
		"AGIRUNNER_RUNTIME_IMAGE":                     target.Image,
		"DOCKER_HOST":                                 m.config.DockerHost,
	}
}

// buildDCMLabels creates labels for a DCM-managed runtime container.
func buildDCMLabels(target RuntimeTarget, runtimeID string) map[string]string {
	return map[string]string{
		labelDCMManaged:      "true",
		labelDCMTier:         tierRuntime,
		labelDCMTemplateID:   target.TemplateID,
		labelDCMTemplateName: target.TemplateName,
		labelDCMRuntimeID:    runtimeID,
		labelDCMImage:        target.Image,
		labelDCMGracePeriod:  strconv.Itoa(target.GracePeriodSeconds),
		labelManagedBy:       "true",
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
		templateID := c.Labels[labelDCMTemplateID]
		templateName := c.Labels[labelDCMTemplateName]
		runtimeID := c.Labels[labelDCMRuntimeID]
		m.stopAndRemove(ctx, c.ID, timeout)
		m.logFleetEvent("container.destroyed", "info", runtimeID, templateID, c.ID)
		m.metrics.RecordScalingEvent(templateID, "destroyed")
		m.emitLog("container", "container.destroy", "info", "completed", map[string]any{
			"template_id":   templateID,
			"template_name": templateName,
			"runtime_id":    runtimeID,
			"container_id":  c.ID,
			"reason":        "idle_teardown",
		})
		destroyed++
	}
	return destroyed
}

// driftResult holds the outcome of processing drifted containers.
type driftResult struct {
	destroyed int
	drained   int
}

// handleDriftContainers processes containers with image drift using a
// drain-and-replace strategy. Idle runtimes are destroyed immediately so
// replacements can be created. Executing runtimes are drained — the platform
// drain API is called and the container is left running to finish its current
// task. Already-draining containers are skipped.
func (m *Manager) handleDriftContainers(
	ctx context.Context,
	drifted []ContainerInfo,
	target RuntimeTarget,
	heartbeats map[string]RuntimeHeartbeat,
) driftResult {
	var result driftResult
	for _, c := range drifted {
		runtimeID := c.Labels[labelDCMRuntimeID]

		if isDrainingContainer(c) {
			continue
		}

		m.logFleetEvent("image_drift_detected", "warn", runtimeID, target.TemplateID, c.ID)

		if isExecutingRuntime(runtimeID, heartbeats) {
			m.drainExecutingRuntime(ctx, c, runtimeID, target.TemplateID)
			result.drained++
			continue
		}

		m.stopAndRemove(ctx, c.ID, m.config.StopTimeout)
		result.destroyed++
	}
	return result
}

// drainExecutingRuntime marks an executing runtime for drain. It calls the
// platform drain API (authoritative signal to the runtime to stop accepting
// new tasks) and sets the draining label on the container so the reconciler
// skips it on subsequent cycles.
func (m *Manager) drainExecutingRuntime(ctx context.Context, c ContainerInfo, runtimeID, templateID string) {
	if err := m.platform.DrainRuntime(runtimeID); err != nil {
		m.logger.Error("failed to drain runtime via platform API",
			"runtime", runtimeID, "container", c.ID, "error", err)
		return
	}

	drainLabels := map[string]string{labelDCMDraining: "true"}
	if err := m.docker.UpdateContainerLabels(ctx, c.ID, drainLabels); err != nil {
		m.logger.Error("failed to set draining label on container",
			"runtime", runtimeID, "container", c.ID, "error", err)
	}

	m.logFleetEvent("runtime_draining", "info", runtimeID, templateID, c.ID)
	m.metrics.RecordScalingEvent(templateID, "preempted")
	m.emitLog("container", "reconcile.drain", "info", "completed", map[string]any{
		"runtime_id":   runtimeID,
		"template_id":  templateID,
		"container_id": c.ID,
		"reason":       "image_drift",
	})
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
		parentRuntime := orphan.Labels[labelDCMRuntimeID]
		templateID := orphan.Labels[labelDCMTemplateID]
		m.stopAndRemove(ctx, orphan.ID, m.config.StopTimeout)
		m.logFleetEvent("orphan.cleaned", "warn", parentRuntime, templateID, orphan.ID)
		m.metrics.RecordOrphanCleaned()
		m.emitLog("container", "container.orphan_cleanup", "warn", "completed", map[string]any{
			"container_id":  orphan.ID,
			"runtime_id":    parentRuntime,
			"template_id":   templateID,
			"template_name": orphan.Labels[labelDCMTemplateName],
			"reason":        "parent_runtime_gone",
		})
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
