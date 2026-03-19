package manager

import (
	"context"
	"fmt"
	"strconv"
	"strings"
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
	pullMeta := map[string]any{"action": "image_pull", "image": target.Image, "policy": target.PullPolicy, "playbook_id": target.PlaybookID, "playbook_name": target.PlaybookName}
	m.emitLog("container", "container.image_pull", "debug", "started", pullMeta)

	if err := m.docker.PullImage(ctx, target.Image, target.PullPolicy); err != nil {
		m.logger.Error("failed to pull runtime image", "image", target.Image, "policy", target.PullPolicy, "error", err)
		m.emitLogError("container", "container.image_pull", pullMeta, err.Error())
		return 0
	}
	m.emitLogTimed("container", "container.image_pull", "debug", "completed", pullMeta, int(time.Since(pullStart).Milliseconds()))

	created := 0
	for i := 0; i < count; i++ {
		spec := m.buildDCMRuntimeSpec(target)
		containerID, err := m.docker.CreateContainer(ctx, spec)
		if err != nil {
			m.logger.Error("failed to create DCM runtime", "playbook_id", target.PlaybookID, "error", err)
			m.emitLogError("container", "container.create", map[string]any{
				"action":           "create",
				"playbook_id":      target.PlaybookID,
				"playbook_name":    target.PlaybookName,
				"pool_mode":        target.PoolMode,
				"priority":         target.Priority,
				"pending_tasks":    target.PendingTasks,
				"active_workflows": target.ActiveWorkflows,
				"image":            target.Image,
			}, err.Error())
			continue
		}
		if m.config.RuntimeInternalNetwork != "" {
			if err := m.docker.ConnectNetwork(ctx, containerID, m.config.RuntimeInternalNetwork); err != nil {
				m.logger.Error("failed to connect runtime to internal network",
					"container", containerID, "network", m.config.RuntimeInternalNetwork, "error", err)
				m.emitLogError("container", "container.network_connect", map[string]any{
					"action":        "network_connect",
					"container_id":  containerID,
					"network":       m.config.RuntimeInternalNetwork,
					"playbook_id":   target.PlaybookID,
					"playbook_name": target.PlaybookName,
				}, err.Error())
			}
		}
		runtimeID := spec.Labels[labelDCMRuntimeID]
		m.logFleetEvent("runtime_created", "info", runtimeID, target.PlaybookID, target.PoolKind, containerID)
		m.logFleetEvent("container.created", "info", runtimeID, target.PlaybookID, target.PoolKind, containerID)
		m.metrics.RecordScalingEvent(target.PlaybookID, "created")
		m.emitLogWithResource("container", "container.create", "debug", "completed", map[string]any{
			"action":           "create",
			"playbook_id":      target.PlaybookID,
			"playbook_name":    target.PlaybookName,
			"pool_mode":        target.PoolMode,
			"priority":         target.Priority,
			"pending_tasks":    target.PendingTasks,
			"active_workflows": target.ActiveWorkflows,
			"runtime_id":       runtimeID,
			"image":            target.Image,
			"container_id":     containerID,
			"reason":           "scaling",
		}, logResourceInfo{ResourceType: "runtime", ResourceID: runtimeID, ResourceName: spec.Name})
		created++
	}
	return created
}

const pullFailCacheTTL = 5 * time.Minute

// prePullImage pre-pulls the runtime image for warm playbooks so it is
// cached locally before any container is created.
func (m *Manager) prePullImage(ctx context.Context, target RuntimeTarget) {
	m.prePullImageWithCache(ctx, target.Image, target.PullPolicy, target.PlaybookID, "runtime")
}

// prePullImageWithCache attempts an image pull, skipping if the same image
// failed recently (within pullFailCacheTTL).
func (m *Manager) prePullImageWithCache(ctx context.Context, image, policy, playbookID, imageType string) {
	if failedAt, ok := m.pullFailCache[image]; ok {
		if m.nowFunc().Sub(failedAt) < pullFailCacheTTL {
			return
		}
		delete(m.pullFailCache, image)
	}
	if err := m.docker.PullImage(ctx, image, policy); err != nil {
		m.pullFailCache[image] = m.nowFunc()
		m.logger.Warn("failed to pre-pull "+imageType+" image for warm playbook",
			"image", image, "playbook_id", playbookID, "error", err)
		m.emitLog("container", "container.pre_pull", "warn", "failed", map[string]any{
			"action":      "image_pull",
			"image":       image,
			"policy":      policy,
			"playbook_id": playbookID,
			"image_type":  imageType,
			"error":       err.Error(),
		})
	}
}

// buildDCMRuntimeSpec constructs a ContainerSpec for a DCM-managed runtime.
func (m *Manager) buildDCMRuntimeSpec(target RuntimeTarget) ContainerSpec {
	runtimeID := uuid.New().String()
	name := fmt.Sprintf("runtime-%s-%s", target.PlaybookID[:minLen(target.PlaybookID, 8)], runtimeID[:8])

	return ContainerSpec{
		Name:        name,
		Image:       target.Image,
		CPULimit:    target.CPU,
		MemoryLimit: target.Memory,
		Environment: m.buildDCMEnvironment(target, runtimeID, name),
		Labels:      buildDCMLabels(target, runtimeID),
		NetworkName: m.config.RuntimeNetwork,
	}
}

// buildDCMEnvironment creates environment variables for a DCM runtime container.
func (m *Manager) buildDCMEnvironment(target RuntimeTarget, runtimeID, workerName string) map[string]string {
	environment := map[string]string{
		"AGIRUNNER_RUNTIME_PLATFORM_API_URL":              m.config.PlatformAPIURL,
		"AGIRUNNER_RUNTIME_PLATFORM_ADMIN_API_KEY":        m.config.PlatformAdminAPIKey,
		"AGIRUNNER_RUNTIME_PLATFORM_AGENT_EXECUTION_MODE": targetExecutionMode(target),
		"AGIRUNNER_RUNTIME_PLATFORM_PLAYBOOK_FILTER":      target.PlaybookID,
		"AGIRUNNER_RUNTIME_PLATFORM_RUNTIME_ID":           runtimeID,
		envRuntimeWorkerName:                              workerName,
		"AGIRUNNER_RUNTIME_IMAGE":                         target.Image,
		"DOCKER_HOST":                                     m.config.DockerHost,
	}
	if capabilityTags := joinCapabilityTags(target.CapabilityTags); capabilityTags != "" {
		environment["AGIRUNNER_RUNTIME_PLATFORM_CAPABILITY_TAGS"] = capabilityTags
	}
	return environment
}

func joinCapabilityTags(values []string) string {
	filtered := make([]string, 0, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		filtered = append(filtered, trimmed)
	}
	return strings.Join(filtered, ",")
}

// buildDCMLabels creates labels for a DCM-managed runtime container.
func buildDCMLabels(target RuntimeTarget, runtimeID string) map[string]string {
	return map[string]string{
		labelDCMManaged:      "true",
		labelDCMTier:         tierRuntime,
		labelDCMPlaybookID:   target.PlaybookID,
		labelDCMPlaybookName: target.PlaybookName,
		labelDCMPoolKind:     normalizePoolKind(target.PoolKind),
		labelDCMRuntimeID:    runtimeID,
		labelDCMImage:        target.Image,
		labelDCMGracePeriod:  strconv.Itoa(target.GracePeriodSeconds),
		labelDCMPoolMode:     target.PoolMode,
		labelDCMPriority:     strconv.Itoa(target.Priority),
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
		playbookID := c.Labels[labelDCMPlaybookID]
		playbookName := c.Labels[labelDCMPlaybookName]
		runtimeID := c.Labels[labelDCMRuntimeID]
		m.stopAndRemove(ctx, c.ID, timeout)
		m.logFleetEvent("container.destroyed", "info", runtimeID, playbookID, c.Labels[labelDCMPoolKind], c.ID)
		m.metrics.RecordScalingEvent(playbookID, "destroyed")
		destroyMeta := map[string]any{
			"action":        "scale_down",
			"playbook_id":   playbookID,
			"playbook_name": playbookName,
			"pool_mode":     c.Labels[labelDCMPoolMode],
			"priority":      c.Labels[labelDCMPriority],
			"runtime_id":    runtimeID,
			"image":         c.Image,
			"container_id":  c.ID,
			"reason":        "idle_teardown",
		}
		if idleStart, ok := m.idleSince[runtimeID]; ok {
			destroyMeta["idle_duration_ms"] = m.nowFunc().Sub(idleStart).Milliseconds()
		}
		m.emitLogWithResource("container", "container.destroy", "info", "completed", destroyMeta,
			logResourceInfo{ResourceType: "runtime", ResourceID: runtimeID})
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

		m.logFleetEvent("image_drift_detected", "warn", runtimeID, target.PlaybookID, target.PoolKind, c.ID)

		if isExecutingRuntime(runtimeID, heartbeats) {
			m.drainExecutingRuntime(ctx, c, runtimeID, target.PlaybookID)
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
func (m *Manager) drainExecutingRuntime(ctx context.Context, c ContainerInfo, runtimeID, playbookID string) {
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

	m.logFleetEvent("runtime_draining", "info", runtimeID, playbookID, c.Labels[labelDCMPoolKind], c.ID)
	m.metrics.RecordScalingEvent(playbookID, "preempted")
	m.emitLogWithResource("container", "reconcile.drain", "info", "completed", map[string]any{
		"action":       "drain",
		"runtime_id":   runtimeID,
		"playbook_id":  playbookID,
		"container_id": c.ID,
		"image":        c.Image,
		"pool_mode":    c.Labels[labelDCMPoolMode],
		"priority":     c.Labels[labelDCMPriority],
		"reason":       "image_drift",
	}, logResourceInfo{ResourceType: "runtime", ResourceID: runtimeID})
}

// stopAndRemove stops then removes a container, logging errors without failing.
func (m *Manager) stopAndRemove(ctx context.Context, containerID string, timeout time.Duration) {
	_ = ctx
	stopCtx, stopCancel := context.WithTimeout(context.Background(), timeout+m.dockerActionBuffer())
	defer stopCancel()
	if err := m.docker.StopContainer(stopCtx, containerID, timeout); err != nil {
		m.logger.Error("failed to stop container", "container", containerID, "error", err)
	}
	removeCtx, removeCancel := context.WithTimeout(context.Background(), m.dockerActionBuffer())
	defer removeCancel()
	if err := m.docker.RemoveContainer(removeCtx, containerID); err != nil {
		m.logger.Error("failed to remove container", "container", containerID, "error", err)
	}
}

func (m *Manager) forceRemoveContainer(ctx context.Context, containerID string) {
	_ = ctx
	removeCtx, removeCancel := context.WithTimeout(context.Background(), m.dockerActionBuffer())
	defer removeCancel()
	if err := m.docker.RemoveContainer(removeCtx, containerID); err != nil {
		m.logger.Error("failed to force remove container", "container", containerID, "error", err)
	}
}

func (m *Manager) dockerActionBuffer() time.Duration {
	return m.config.DockerActionBuffer
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
		playbookID := orphan.Labels[labelDCMPlaybookID]
		m.forceRemoveContainer(ctx, orphan.ID)
		m.logFleetEvent("orphan.cleaned", "warn", parentRuntime, playbookID, orphan.Labels[labelDCMPoolKind], orphan.ID)
		m.metrics.RecordOrphanCleaned()
		m.emitLogWithResource("container", "container.orphan_cleanup", "warn", "completed", map[string]any{
			"action":        "orphan_clean",
			"container_id":  orphan.ID,
			"runtime_id":    parentRuntime,
			"playbook_id":   playbookID,
			"playbook_name": orphan.Labels[labelDCMPlaybookName],
			"image":         orphan.Image,
			"pool_mode":     orphan.Labels[labelDCMPoolMode],
			"priority":      orphan.Labels[labelDCMPriority],
			"reason":        "parent_runtime_gone",
		}, logResourceInfo{ResourceType: "task_container", ResourceName: orphan.ID})
	}
}

// collectRuntimeIDs builds a set of active runtime IDs from containers.
func collectRuntimeIDs(containers []ContainerInfo) map[string]bool {
	return liveParentIdentifiers(containers)
}

// findOrphanTasks returns task containers whose parent runtime no longer exists.
func findOrphanTasks(containers []ContainerInfo, runtimeIDs map[string]bool) []ContainerInfo {
	var orphans []ContainerInfo
	for _, c := range containers {
		if c.Labels[labelDCMTier] != tierTask {
			continue
		}
		if !isManagedTaskContainer(c.Labels) {
			continue
		}
		parentID := taskParentRuntimeID(c.Labels)
		if parentID != "" && !runtimeIDs[parentID] {
			orphans = append(orphans, c)
		}
	}
	return orphans
}

func isManagedTaskContainer(labels map[string]string) bool {
	return hasManagedLabel(labels, labelDCMManaged) || hasManagedLabel(labels, legacyRuntimeManagedLabel)
}

func taskParentRuntimeID(labels map[string]string) string {
	for _, key := range []string{
		labelDCMRuntimeID,
		legacyParentRuntimeLabel,
		legacyRuntimeInstanceIDLabel,
	} {
		if value := strings.TrimSpace(labels[key]); value != "" {
			return value
		}
	}
	return ""
}

// logFleetEvent records a fleet event via the platform client and logs it.
func (m *Manager) logFleetEvent(eventType, level, runtimeID, playbookID, poolKind, containerID string) {
	event := FleetEvent{
		EventType:   eventType,
		Level:       level,
		RuntimeID:   runtimeID,
		PlaybookID:  playbookID,
		PoolKind:    normalizePoolKind(poolKind),
		ContainerID: containerID,
	}
	_ = m.platform.RecordFleetEvent(event)
	m.logger.Info("fleet event", "event", eventType, "runtime", runtimeID, "playbook_id", playbookID, "pool_kind", normalizePoolKind(poolKind))
}

// minLen returns the shorter of the string length and n.
func minLen(s string, n int) int {
	if len(s) < n {
		return len(s)
	}
	return n
}

func targetExecutionMode(target RuntimeTarget) string {
	if normalizePoolKind(target.PoolKind) == "orchestrator" {
		return "orchestrator"
	}
	return "specialist"
}
