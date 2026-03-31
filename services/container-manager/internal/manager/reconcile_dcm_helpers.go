package manager

import (
	"context"
	"fmt"
	"strings"
	"time"
)

// isContainerIdleByHeartbeat checks whether a specific container's runtime is
// idle according to heartbeat data. Containers without a heartbeat are
// considered idle.
func isContainerIdleByHeartbeat(
	containerID string,
	targetKey string,
	grouped map[string][]ContainerInfo,
	heartbeats map[string]RuntimeHeartbeat,
) bool {
	runtimeID := findRuntimeIDForContainer(containerID, targetKey, grouped)
	if runtimeID == "" {
		return true
	}
	return !isExecutingRuntime(runtimeID, heartbeats)
}

// findRuntimeIDForContainer looks up the runtime ID label for a container.
func findRuntimeIDForContainer(
	containerID string,
	targetKey string,
	grouped map[string][]ContainerInfo,
) string {
	for _, c := range grouped[targetKey] {
		if c.ID == containerID {
			return c.Labels[labelDCMRuntimeID]
		}
	}
	return ""
}

// gracePeriodDuration converts a grace period in seconds to a time.Duration,
// falling back to the provided default when the value is non-positive.
func gracePeriodDuration(gracePeriodSec int, fallback time.Duration) time.Duration {
	if gracePeriodSec > 0 {
		return time.Duration(gracePeriodSec) * time.Second
	}
	return fallback
}

// fetchHeartbeatMap retrieves heartbeat data and indexes it by runtime ID.
func (m *Manager) fetchHeartbeatSnapshot() ([]RuntimeHeartbeat, map[string]RuntimeHeartbeat, error) {
	heartbeats, err := m.platform.FetchHeartbeats()
	if err != nil {
		return nil, nil, fmt.Errorf("fetch heartbeats: %w", err)
	}
	return heartbeats, buildHeartbeatMap(heartbeats), nil
}

// buildHeartbeatMap creates a lookup from runtime ID to heartbeat.
func buildHeartbeatMap(heartbeats []RuntimeHeartbeat) map[string]RuntimeHeartbeat {
	m := make(map[string]RuntimeHeartbeat, len(heartbeats))
	for _, hb := range heartbeats {
		m[hb.RuntimeID] = hb
	}
	return m
}

// buildFallbackHeartbeatMap creates synthetic heartbeat entries when the
// platform heartbeat API is unavailable. For each running container, if we
// haven't seen it before, record the current time. If it's been tracked for
// longer than the default grace period, mark it as idle with a timestamp old
// enough to trigger idle timeout cleanup.
func (m *Manager) buildFallbackHeartbeatMap(containers []ContainerInfo) map[string]RuntimeHeartbeat {
	now := m.nowFunc()
	result := make(map[string]RuntimeHeartbeat, len(containers))

	for _, c := range containers {
		if isDrainingContainer(c) {
			continue
		}
		runtimeID := c.Labels[labelDCMRuntimeID]
		if runtimeID == "" {
			continue
		}
		if _, tracked := m.failedHeartbeatSince[runtimeID]; !tracked {
			m.failedHeartbeatSince[runtimeID] = now
		}

		trackedSince := m.failedHeartbeatSince[runtimeID]
		elapsed := now.Sub(trackedSince)

		if elapsed >= gracePeriodForContainer(c, m.config.StopTimeout) {
			result[runtimeID] = RuntimeHeartbeat{
				RuntimeID:       runtimeID,
				PlaybookID:      c.Labels[labelDCMPlaybookID],
				State:           "idle",
				LastHeartbeatAt: trackedSince.Format(time.RFC3339),
			}
		}
	}

	return result
}

// clearHeartbeatFallbackTracking removes fallback tracking entries for
// containers that no longer exist. Called when heartbeat fetch succeeds.
func (m *Manager) clearHeartbeatFallbackTracking(containers []ContainerInfo) {
	activeRuntimes := make(map[string]bool, len(containers))
	for _, c := range containers {
		if rid := c.Labels[labelDCMRuntimeID]; rid != "" {
			activeRuntimes[rid] = true
		}
	}
	for rid := range m.failedHeartbeatSince {
		if !activeRuntimes[rid] {
			delete(m.failedHeartbeatSince, rid)
		}
	}
}

// countDrainingContainers returns how many containers have the draining label.
func countDrainingContainers(containers []ContainerInfo) int {
	count := 0
	for _, c := range containers {
		if isDrainingContainer(c) {
			count++
		}
	}
	return count
}

// countActiveContainers returns how many containers are NOT draining.
func countActiveContainers(containers []ContainerInfo) int {
	count := 0
	for _, c := range containers {
		if !isDrainingContainer(c) && !isTerminalRuntimeContainer(c) {
			count++
		}
	}
	return count
}

// isExecutingRuntime checks heartbeat data to determine if a runtime is
// currently executing a task.
func isExecutingRuntime(runtimeID string, heartbeats map[string]RuntimeHeartbeat) bool {
	hb, ok := heartbeats[runtimeID]
	if !ok {
		return false
	}
	return hb.State == "executing"
}

// listDCMRuntimeContainers returns containers with DCM managed + runtime tier.
func (m *Manager) listDCMRuntimeContainers(ctx context.Context) ([]ContainerInfo, error) {
	all, err := m.docker.ListContainers(ctx)
	if err != nil {
		return nil, fmt.Errorf("docker list containers: %w", err)
	}
	return filterByLabels(all, labelDCMManaged, "true", labelDCMTier, tierRuntime), nil
}

// groupContainersByTarget organizes containers by playbook/pool target key.
func groupContainersByTarget(containers []ContainerInfo) map[string][]ContainerInfo {
	grouped := make(map[string][]ContainerInfo)
	for _, c := range containers {
		grouped[containerTargetKey(c)] = append(grouped[containerTargetKey(c)], c)
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
// Drifted containers are excluded from idle teardown to prevent double
// processing — drift handling takes precedence.
func (m *Manager) planTargetActions(
	target RuntimeTarget,
	running []ContainerInfo,
	totalRunning int,
	heartbeats map[string]RuntimeHeartbeat,
) targetActions {
	capacity := m.config.GlobalMaxRuntimes - totalRunning
	drifted := findImageDrift(target, running)
	driftIDs := containerIDSet(drifted)
	idle := excludeByID(m.findIdleForTeardown(target, running, heartbeats), driftIDs)
	scaleTarget := target
	if target.PoolMode == "cold" {
		claimableRuntimes := countClaimableColdRuntimes(running, heartbeats)
		scaleTarget.PendingTasks = max(target.PendingTasks-claimableRuntimes, 0)
	}
	toCreate := computeScaleUp(scaleTarget, len(running), capacity)
	if normalizePoolKind(target.PoolKind) == "specialist" && target.AvailableExecutionSlots != nil && toCreate > *target.AvailableExecutionSlots {
		toCreate = *target.AvailableExecutionSlots
	}

	return targetActions{
		toCreate:      toCreate,
		idleToDestroy: idle,
		driftToHandle: drifted,
	}
}

func countClaimableColdRuntimes(
	running []ContainerInfo,
	heartbeats map[string]RuntimeHeartbeat,
) int {
	claimable := 0
	for _, container := range running {
		if isDrainingContainer(container) || isTerminalRuntimeContainer(container) {
			continue
		}
		runtimeID := container.Labels[labelDCMRuntimeID]
		heartbeat, ok := heartbeats[runtimeID]
		if !ok || heartbeat.State == "" || heartbeat.State == "idle" {
			claimable++
			continue
		}
		if heartbeat.State == "executing" || heartbeat.State == "draining" {
			continue
		}
		claimable++
	}
	return claimable
}

// containerIDSet builds a set of container IDs for fast lookup.
func containerIDSet(containers []ContainerInfo) map[string]bool {
	ids := make(map[string]bool, len(containers))
	for _, c := range containers {
		ids[c.ID] = true
	}
	return ids
}

// excludeByID returns containers whose ID is not in the exclusion set.
func excludeByID(containers []ContainerInfo, exclude map[string]bool) []ContainerInfo {
	var result []ContainerInfo
	for _, c := range containers {
		if !exclude[c.ID] {
			result = append(result, c)
		}
	}
	return result
}

// computeScaleUp calculates how many runtimes to create for a target.
// Cold mode: creates runtimes proportional to pending tasks.
// Warm mode: maintains runtimes as long as there are active workflows,
// regardless of pending task count.
func computeScaleUp(target RuntimeTarget, runningCount, capacity int) int {
	if target.PoolMode == "warm" {
		return computeWarmScaleUp(target, runningCount, capacity)
	}
	return computeColdScaleUp(target, runningCount, capacity)
}

// computeColdScaleUp creates runtimes proportional to pending tasks.
func computeColdScaleUp(target RuntimeTarget, runningCount, capacity int) int {
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

// computeWarmScaleUp maintains a warm floor while active workflows exist,
// but still scales out to meet the current pending workload. This keeps a
// reusable runtime alive for active workflows without collapsing parallel
// bursts down to a single runtime.
func computeWarmScaleUp(target RuntimeTarget, runningCount, capacity int) int {
	if target.ActiveWorkflows <= 0 && target.PendingTasks <= 0 {
		return 0
	}
	desired := target.ActiveWorkflows
	if target.PendingTasks > desired {
		desired = target.PendingTasks
	}
	if desired > target.MaxRuntimes {
		desired = target.MaxRuntimes
	}
	if runningCount+capacity < desired {
		desired = runningCount + capacity
	}
	toCreate := desired - runningCount
	if toCreate < 0 {
		return 0
	}
	return toCreate
}

func filterLiveRuntimeContainers(containers []ContainerInfo) []ContainerInfo {
	live := make([]ContainerInfo, 0, len(containers))
	for _, container := range containers {
		if isTerminalRuntimeContainer(container) {
			continue
		}
		live = append(live, container)
	}
	return live
}

func findTerminalRuntimeContainers(containers []ContainerInfo) []ContainerInfo {
	terminal := make([]ContainerInfo, 0)
	for _, container := range containers {
		if !isTerminalRuntimeContainer(container) {
			continue
		}
		terminal = append(terminal, container)
	}
	return terminal
}

func isTerminalRuntimeContainer(container ContainerInfo) bool {
	status := strings.ToLower(strings.TrimSpace(container.Status))
	return strings.HasPrefix(status, "exited") || strings.HasPrefix(status, "dead")
}

// findIdleForTeardown identifies idle containers that should be destroyed.
func (m *Manager) findIdleForTeardown(target RuntimeTarget, running []ContainerInfo, heartbeats map[string]RuntimeHeartbeat) []ContainerInfo {
	switch target.PoolMode {
	case "cold":
		return m.findColdIdleExpired(target, running, heartbeats)
	case "warm":
		return findWarmNoWorkflows(target, running)
	default:
		return nil
	}
}

// findColdIdleExpired returns containers idle past the configured timeout.
// Tracks when each runtime enters idle state and expires after IdleTimeoutSeconds.
func (m *Manager) findColdIdleExpired(target RuntimeTarget, running []ContainerInfo, heartbeats map[string]RuntimeHeartbeat) []ContainerInfo {
	if target.IdleTimeoutSeconds <= 0 {
		return nil
	}
	now := m.nowFunc()
	var expired []ContainerInfo
	for _, c := range running {
		if isDrainingContainer(c) {
			continue
		}
		runtimeID := c.Labels[labelDCMRuntimeID]
		if m.isIdlePastTimeout(runtimeID, heartbeats, target.IdleTimeoutSeconds, now) {
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

// isIdlePastTimeout tracks when a runtime first enters idle state and returns
// true once it has been continuously idle for longer than timeoutSeconds.
// Runtimes without heartbeat data (newly created) are NOT considered expired.
// When a runtime leaves idle state, its tracking entry is removed.
func (m *Manager) isIdlePastTimeout(runtimeID string, heartbeats map[string]RuntimeHeartbeat, timeoutSeconds int, now time.Time) bool {
	hb, ok := heartbeats[runtimeID]
	if !ok {
		delete(m.idleSince, runtimeID)
		return false
	}
	if hb.State != "idle" {
		delete(m.idleSince, runtimeID)
		return false
	}
	if _, tracked := m.idleSince[runtimeID]; !tracked {
		m.idleSince[runtimeID] = now
	}
	return now.Sub(m.idleSince[runtimeID]) >= time.Duration(timeoutSeconds)*time.Second
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
// activeCount is the number of non-draining containers for this playbook.
// drainingCount is the total number of draining containers across all playbooks.
func (m *Manager) executeTargetActions(
	ctx context.Context,
	target RuntimeTarget,
	actions targetActions,
	heartbeats map[string]RuntimeHeartbeat,
	activeCount int,
	drainingCount int,
) int {
	delta := 0

	if len(actions.idleToDestroy) > 0 {
		m.emitLog("container", "reconcile.scale_down", "debug", "started", map[string]any{
			"action":              "scale_down",
			"playbook_id":         target.PlaybookID,
			"playbook_name":       target.PlaybookName,
			"pool_mode":           target.PoolMode,
			"priority":            target.Priority,
			"pending_tasks":       target.PendingTasks,
			"active_workflows":    target.ActiveWorkflows,
			"count":               len(actions.idleToDestroy),
			"actual_count":        activeCount,
			"desired_count":       activeCount - len(actions.idleToDestroy),
			"max_runtimes":        target.MaxRuntimes,
			"global_max_runtimes": m.config.GlobalMaxRuntimes,
			"reason":              "idle_timeout",
		})
	}
	delta -= m.destroyContainers(ctx, actions.idleToDestroy, target.GracePeriodSeconds)

	driftResult := m.handleDriftContainers(ctx, actions.driftToHandle, target, heartbeats)
	delta -= driftResult.destroyed

	replacements := driftResult.destroyed
	globalCapacity := m.config.GlobalMaxRuntimes - (activeCount + drainingCount + delta)
	if replacements > globalCapacity {
		replacements = globalCapacity
	}

	toCreate := actions.toCreate + replacements
	if toCreate > 0 {
		m.emitLog("container", "reconcile.scale_up", "debug", "started", map[string]any{
			"action":              "scale_up",
			"playbook_id":         target.PlaybookID,
			"playbook_name":       target.PlaybookName,
			"pool_mode":           target.PoolMode,
			"priority":            target.Priority,
			"pending_tasks":       target.PendingTasks,
			"active_workflows":    target.ActiveWorkflows,
			"count":               toCreate,
			"actual_count":        activeCount,
			"desired_count":       activeCount + toCreate,
			"max_runtimes":        target.MaxRuntimes,
			"global_max_runtimes": m.config.GlobalMaxRuntimes,
			"reason":              "pending_tasks",
		})
	}
	delta += m.createRuntimeContainers(ctx, target, toCreate)
	return delta
}
