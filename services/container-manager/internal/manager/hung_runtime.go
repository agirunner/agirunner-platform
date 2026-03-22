package manager

import (
	"context"
	"fmt"
	"strings"
	"time"
)

const dockerHealthUnhealthy = "unhealthy"

// detectHungRuntimes identifies and handles runtimes that have stopped
// heartbeating or are reported unhealthy by Docker HEALTHCHECK.
func (m *Manager) detectHungRuntimes(ctx context.Context) {
	heartbeats, err := m.platform.FetchHeartbeats()
	if err != nil {
		m.logger.Error("hung detection: failed to fetch heartbeats", "error", err)
		return
	}
	m.detectHungRuntimesWithHeartbeats(ctx, heartbeats)
}

func (m *Manager) detectHungRuntimesWithHeartbeats(ctx context.Context, heartbeats []RuntimeHeartbeat) {
	containers, err := m.listDCMRuntimeContainers(ctx)
	if err != nil {
		m.logger.Error("hung detection: failed to list containers", "error", err)
		return
	}

	containerByRuntimeID := indexContainersByRuntimeID(containers)
	heartbeatByRuntimeID := indexHeartbeatsByRuntimeID(heartbeats)
	now := time.Now().UTC()

	for _, c := range containers {
		runtimeID := c.Labels[labelDCMRuntimeID]
		if runtimeID == "" {
			continue
		}
		if isDrainingContainer(c) {
			continue
		}

		reason := m.classifyHungRuntime(ctx, c, heartbeatByRuntimeID[runtimeID], now)
		if reason == "" {
			continue
		}

		m.handleHungRuntime(ctx, c, runtimeID, reason, heartbeatByRuntimeID[runtimeID])
	}

	m.handleOrphanHeartbeats(ctx, heartbeats, containerByRuntimeID, now)
}

// classifyHungRuntime returns the hung reason or empty string if the runtime is healthy.
func (m *Manager) classifyHungRuntime(
	ctx context.Context,
	c ContainerInfo,
	hb *RuntimeHeartbeat,
	now time.Time,
) string {
	if hb != nil && isStaleHeartbeat(hb, now, m.config.HungRuntimeStaleAfter) {
		return "stale_heartbeat"
	}

	if isDockerUnhealthy(ctx, m.docker, c.ID) {
		return "docker_unhealthy"
	}

	return ""
}

// isStaleHeartbeat returns true when the heartbeat timestamp is older than the threshold
// or unparseable. A nil heartbeat means the runtime has never heartbeated (possibly new)
// and is NOT considered stale — callers must nil-check before calling.
func isStaleHeartbeat(hb *RuntimeHeartbeat, now time.Time, threshold time.Duration) bool {
	if hb == nil {
		return false
	}
	lastBeat, err := time.Parse(time.RFC3339, hb.LastHeartbeatAt)
	if err != nil {
		return true
	}
	return now.Sub(lastBeat) > threshold
}

// isDockerUnhealthy checks whether Docker reports the container as unhealthy.
func isDockerUnhealthy(ctx context.Context, docker DockerClient, containerID string) bool {
	health, err := docker.InspectContainerHealth(ctx, containerID)
	if err != nil {
		return false
	}
	return health.Status == dockerHealthUnhealthy
}

// handleHungRuntime stops a hung container, fails its active task, and logs the event.
func (m *Manager) handleHungRuntime(
	ctx context.Context,
	c ContainerInfo,
	runtimeID, reason string,
	hb *RuntimeHeartbeat,
) {
	playbookID := c.Labels[labelDCMPlaybookID]
	m.logger.Warn("hung runtime detected",
		"runtime_id", runtimeID,
		"container_id", c.ID,
		"reason", reason,
		"playbook_id", playbookID,
	)

	m.failActiveTask(runtimeID, hb, reason)
	m.stopAndRemove(ctx, c.ID, m.config.HungRuntimeStopGrace)
	m.logFleetEvent("runtime_hung", "error", runtimeID, playbookID, c.Labels[labelDCMPoolKind], c.ID)
	m.emitLogWithResource("container", "container.hung_detected", "warn", "completed", map[string]any{
		"action":         "orphan_clean",
		"runtime_id":     runtimeID,
		"container_id":   c.ID,
		"playbook_id":    playbookID,
		"playbook_name":  c.Labels[labelDCMPlaybookName],
		"image":          c.Image,
		"pool_mode":      c.Labels[labelDCMPoolMode],
		"priority":       c.Labels[labelDCMPriority],
		"active_task_id": activeTaskID(hb),
		"reason":         reason,
	}, logResourceInfo{ResourceType: "runtime", ResourceID: runtimeID, TaskID: activeTaskID(hb)})
}

// failActiveTask marks the in-progress task as failed if one exists.
func (m *Manager) failActiveTask(runtimeID string, hb *RuntimeHeartbeat, reason string) {
	taskID := activeTaskID(hb)
	if taskID == "" {
		return
	}
	shouldFail, taskState := m.shouldFailActiveTask(taskID)
	if !shouldFail {
		m.logger.Info("hung detection: skipping fail callback for terminal task",
			"task_id", taskID,
			"runtime_id", runtimeID,
			"task_state", taskState,
			"reason", reason,
		)
		return
	}
	failReason := fmt.Sprintf("runtime_hung: %s (runtime %s)", reason, runtimeID)
	if err := m.platform.FailTask(taskID, failReason); err != nil {
		m.logger.Error("hung detection: failed to mark task as failed",
			"task_id", taskID,
			"runtime_id", runtimeID,
			"error", err,
		)
	}
}

func (m *Manager) shouldFailActiveTask(taskID string) (bool, string) {
	state, err := m.platform.GetTaskState(taskID)
	if err != nil {
		m.logger.Warn("hung detection: failed to fetch task state before fail callback",
			"task_id", taskID,
			"error", err,
		)
		return true, ""
	}
	return isHungRuntimeFailureEligibleTaskState(state), state
}

func isHungRuntimeFailureEligibleTaskState(state string) bool {
	switch strings.ToLower(strings.TrimSpace(state)) {
	case "completed", "failed", "cancelled", "escalated", "output_pending_assessment", "awaiting_approval":
		return false
	default:
		return true
	}
}

// activeTaskID extracts the task ID from a heartbeat, if present.
func activeTaskID(hb *RuntimeHeartbeat) string {
	if hb == nil {
		return ""
	}
	return hb.ActiveTaskID
}

// handleOrphanHeartbeats detects stale heartbeats with no matching container.
// These represent runtimes that disappeared without cleanup.
func (m *Manager) handleOrphanHeartbeats(
	ctx context.Context,
	heartbeats []RuntimeHeartbeat,
	containerByRuntimeID map[string]ContainerInfo,
	now time.Time,
) {
	_ = ctx
	for i := range heartbeats {
		hb := &heartbeats[i]
		if _, hasContainer := containerByRuntimeID[hb.RuntimeID]; hasContainer {
			delete(m.processedOrphans, hb.RuntimeID)
			continue
		}
		if !isStaleHeartbeat(hb, now, m.config.HungRuntimeStaleAfter) {
			continue
		}
		if _, alreadyHandled := m.processedOrphans[hb.RuntimeID]; alreadyHandled {
			continue
		}
		m.failActiveTask(hb.RuntimeID, hb, "orphan_heartbeat")
		m.emitLogWithResource("container", "container.orphan_heartbeat", "warn", "completed", map[string]any{
			"action":         "orphan_clean",
			"runtime_id":     hb.RuntimeID,
			"playbook_id":    hb.PlaybookID,
			"active_task_id": hb.ActiveTaskID,
			"reason":         "container_gone",
		}, logResourceInfo{ResourceType: "runtime", ResourceID: hb.RuntimeID, TaskID: hb.ActiveTaskID})
		m.processedOrphans[hb.RuntimeID] = struct{}{}
	}
}

// indexContainersByRuntimeID builds a lookup from runtime ID to container.
func indexContainersByRuntimeID(containers []ContainerInfo) map[string]ContainerInfo {
	m := make(map[string]ContainerInfo, len(containers))
	for _, c := range containers {
		rid := c.Labels[labelDCMRuntimeID]
		if rid != "" {
			m[rid] = c
		}
	}
	return m
}

// indexHeartbeatsByRuntimeID builds a lookup from runtime ID to heartbeat pointer.
func indexHeartbeatsByRuntimeID(heartbeats []RuntimeHeartbeat) map[string]*RuntimeHeartbeat {
	m := make(map[string]*RuntimeHeartbeat, len(heartbeats))
	for i := range heartbeats {
		m[heartbeats[i].RuntimeID] = &heartbeats[i]
	}
	return m
}
