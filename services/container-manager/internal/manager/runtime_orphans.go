package manager

import (
	"context"
	"log/slog"
)

const (
	orphanReasonMissingTarget = "missing_target"
	orphanReasonInvalidLabels = "invalid_labels"
)

type runtimeOrphanState struct {
	Reason          string
	FirstCycle      uint64
	LastCycle       uint64
	DetectionCount  int
	DetectionLogged bool
}

func classifyManagedRuntimeOrphan(
	container ContainerInfo,
	targets map[string]RuntimeTarget,
) string {
	if !hasRequiredRuntimeIdentity(container) {
		return orphanReasonInvalidLabels
	}

	if _, ok := targets[containerTargetKey(container)]; !ok {
		return orphanReasonMissingTarget
	}

	return ""
}

func hasRequiredRuntimeIdentity(container ContainerInfo) bool {
	return container.Labels[labelDCMRuntimeID] != "" &&
		container.Labels[labelDCMPlaybookID] != "" &&
		container.Labels[labelDCMPoolKind] != ""
}

func managedRuntimeTrackerKey(container ContainerInfo) string {
	if runtimeID := container.Labels[labelDCMRuntimeID]; runtimeID != "" {
		return runtimeID
	}
	return "container:" + container.ID
}

func (m *Manager) runtimeOrphanGraceCycles() int {
	return m.config.RuntimeOrphanGraceCycles
}

func (m *Manager) reconcileManagedRuntimeOrphans(
	ctx context.Context,
	containers []ContainerInfo,
	targets []RuntimeTarget,
) int {
	targetMap := buildTargetMap(targets)
	activeKeys := make(map[string]struct{}, len(containers))
	removed := 0

	for _, container := range containers {
		key := managedRuntimeTrackerKey(container)
		activeKeys[key] = struct{}{}

		reason := classifyManagedRuntimeOrphan(container, targetMap)
		if reason == "" {
			delete(m.runtimeOrphans, key)
			continue
		}

		state := m.runtimeOrphans[key]
		if state.Reason != reason {
			state = runtimeOrphanState{}
		}
		if state.FirstCycle == 0 {
			state.FirstCycle = m.cycleCount
		}
		state.LastCycle = m.cycleCount
		state.Reason = reason
		state.DetectionCount++
		m.runtimeOrphans[key] = state

		if !state.DetectionLogged {
			m.logRuntimeOrphanDetected(container, reason)
			state.DetectionLogged = true
			m.runtimeOrphans[key] = state
		}

		if state.DetectionCount < m.runtimeOrphanGraceCycles() {
			continue
		}

		m.removeManagedRuntimeOrphan(ctx, container, reason)
		removed++
		delete(m.runtimeOrphans, key)
	}

	m.pruneRuntimeOrphanTracking(activeKeys)
	return removed
}

func (m *Manager) pruneRuntimeOrphanTracking(activeKeys map[string]struct{}) {
	for key := range m.runtimeOrphans {
		if _, ok := activeKeys[key]; !ok {
			delete(m.runtimeOrphans, key)
		}
	}
}

func (m *Manager) logRuntimeOrphanDetected(container ContainerInfo, reason string) {
	runtimeID := container.Labels[labelDCMRuntimeID]
	playbookID := container.Labels[labelDCMPlaybookID]
	m.logger.Warn(
		"managed runtime orphan detected",
		slog.String("container", container.ID),
		slog.String("runtime_id", runtimeID),
		slog.String("playbook_id", playbookID),
		slog.String("pool_kind", container.Labels[labelDCMPoolKind]),
		slog.String("reason", reason),
	)
	m.metrics.RecordRuntimeOrphanDetected()
	m.emitLogWithResource("container", "container.runtime_orphan_detected", "warn", "completed", map[string]any{
		"action":        "orphan_detect",
		"container_id":  container.ID,
		"playbook_id":   playbookID,
		"playbook_name": container.Labels[labelDCMPlaybookName],
		"pool_kind":     container.Labels[labelDCMPoolKind],
		"pool_mode":     container.Labels[labelDCMPoolMode],
		"priority":      container.Labels[labelDCMPriority],
		"image":         container.Image,
		"reason":        reason,
	}, logResourceInfo{ResourceType: "runtime", ResourceID: runtimeID})
}

func (m *Manager) removeManagedRuntimeOrphan(
	ctx context.Context,
	container ContainerInfo,
	reason string,
) {
	runtimeID := container.Labels[labelDCMRuntimeID]
	playbookID := container.Labels[labelDCMPlaybookID]
	m.logger.Info(
		"removing managed runtime orphan",
		slog.String("container", container.ID),
		slog.String("runtime_id", runtimeID),
		slog.String("playbook_id", playbookID),
		slog.String("pool_kind", container.Labels[labelDCMPoolKind]),
		slog.String("reason", reason),
	)

	m.forceRemoveContainer(ctx, container.ID)
	m.metrics.RecordRuntimeOrphanCleaned()
	m.logFleetEvent("runtime_orphan_cleaned", "warn", runtimeID, playbookID, container.Labels[labelDCMPoolKind], container.ID)
	m.emitLogWithResource("container", "container.runtime_orphan_cleaned", "warn", "completed", map[string]any{
		"action":        "orphan_clean",
		"container_id":  container.ID,
		"playbook_id":   playbookID,
		"playbook_name": container.Labels[labelDCMPlaybookName],
		"pool_kind":     container.Labels[labelDCMPoolKind],
		"pool_mode":     container.Labels[labelDCMPoolMode],
		"priority":      container.Labels[labelDCMPriority],
		"image":         container.Image,
		"reason":        reason,
	}, logResourceInfo{ResourceType: "runtime", ResourceID: runtimeID})
}
