package manager

import (
	"context"
	"fmt"
	"strings"
	"time"
)

// reconcileDCM performs the Dynamic Container Management reconciliation cycle.
// It manages runtime containers based on platform-provided runtime targets.
// Heartbeat data is fetched to distinguish idle from executing runtimes during
// image drift handling (rolling update).
func (m *Manager) reconcileDCM(ctx context.Context) error {
	targets, err := m.platform.FetchRuntimeTargets()
	if err != nil {
		return fmt.Errorf("fetch runtime targets: %w", err)
	}

	containers, err := m.listDCMRuntimeContainers(ctx)
	if err != nil {
		return fmt.Errorf("list DCM containers: %w", err)
	}

	heartbeatMap, err := m.fetchHeartbeatMap()
	if err != nil {
		m.logger.Error("failed to fetch heartbeats, drift handling will treat all as idle", "error", err)
	}

	grouped := groupContainersByTemplate(containers)
	drainingCount := countDrainingContainers(containers)
	totalRunning := len(containers)

	sorted := sortTargetsByPriority(targets)
	m.updateStarvationTracking(sorted, grouped)

	unsatisfied := m.processTargetsInPriorityOrder(
		ctx, sorted, grouped, heartbeatMap, &totalRunning, drainingCount,
	)

	if len(unsatisfied) > 0 {
		m.executePreemptions(ctx, unsatisfied, sorted, grouped, heartbeatMap, totalRunning)
	}

	m.reconcileWarmTaskPoolsFromDocker(ctx, sorted)
	m.cleanupOrphanTaskContainers(ctx)
	m.detectHungRuntimes(ctx)

	updatedContainers, listErr := m.listDCMRuntimeContainers(ctx)
	if listErr == nil {
		m.metrics.UpdateRuntimeGauges(updatedContainers, heartbeatMap)
	}

	return nil
}

// processTargetsInPriorityOrder iterates sorted targets grouped by priority
// level. Within each priority group, available capacity is allocated
// proportionally to pending task count so that templates with more pending
// work receive a fair share of slots.
func (m *Manager) processTargetsInPriorityOrder(
	ctx context.Context,
	sorted []RuntimeTarget,
	grouped map[string][]ContainerInfo,
	heartbeats map[string]RuntimeHeartbeat,
	totalRunning *int,
	drainingCount int,
) []RuntimeTarget {
	var unsatisfied []RuntimeTarget

	groups := groupByPriority(sorted)
	for _, group := range groups {
		unsatisfied = append(unsatisfied,
			m.processTargetGroup(ctx, group, grouped, heartbeats, totalRunning, drainingCount)...,
		)
	}

	return unsatisfied
}

// groupByPriority partitions an already-sorted slice of targets into groups
// that share the same priority level. The input order is preserved within
// each group.
func groupByPriority(sorted []RuntimeTarget) [][]RuntimeTarget {
	if len(sorted) == 0 {
		return nil
	}
	var groups [][]RuntimeTarget
	current := []RuntimeTarget{sorted[0]}
	for i := 1; i < len(sorted); i++ {
		if sorted[i].Priority != current[0].Priority {
			groups = append(groups, current)
			current = []RuntimeTarget{sorted[i]}
		} else {
			current = append(current, sorted[i])
		}
	}
	groups = append(groups, current)
	return groups
}

// processTargetGroup handles a group of targets that share the same priority.
// Capacity is distributed proportionally to each target's pending task count.
func (m *Manager) processTargetGroup(
	ctx context.Context,
	group []RuntimeTarget,
	grouped map[string][]ContainerInfo,
	heartbeats map[string]RuntimeHeartbeat,
	totalRunning *int,
	drainingCount int,
) []RuntimeTarget {
	// Pre-pull warm images and plan actions for every target in the group.
	type planned struct {
		target      RuntimeTarget
		actions     targetActions
		activeCount int
	}
	plans := make([]planned, 0, len(group))
	for _, target := range group {
		if target.PoolMode == "warm" {
			m.prePullWarmImages(ctx, target)
		}
		running := grouped[target.TemplateID]
		activeCount := countActiveContainers(running)
		actions := m.planTargetActions(target, running, *totalRunning)
		plans = append(plans, planned{target: target, actions: actions, activeCount: activeCount})
	}

	// Compute fair shares of available capacity. Capacity applies to
	// creation slots; teardown and drift actions are always executed fully.
	capacity := m.config.GlobalMaxRuntimes - *totalRunning
	requested := make([]int, len(plans))
	pendingCounts := make([]int, len(plans))
	for i, p := range plans {
		requested[i] = p.actions.toCreate
		pendingCounts[i] = p.target.PendingTasks
	}
	fairShares := allocateProportionally(requested, pendingCounts, capacity)

	var unsatisfied []RuntimeTarget
	for i, p := range plans {
		capped := p.actions
		capped.toCreate = fairShares[i]

		delta := m.executeTargetActions(ctx, p.target, capped, heartbeats, p.activeCount, drainingCount)
		*totalRunning += delta

		if p.target.PendingTasks > 0 && capped.toCreate <= 0 {
			unsatisfied = append(unsatisfied, p.target)
		}
	}
	return unsatisfied
}

// allocateProportionally distributes capacity across targets proportional to
// each target's requested creation count. When requests exceed capacity,
// slots are divided by the ratio of each request to the total. Remainders
// are assigned one at a time to the target with the largest unfulfilled
// request, breaking ties by pending task count.
func allocateProportionally(requested, pendingCounts []int, capacity int) []int {
	shares := make([]int, len(requested))
	totalRequested := 0
	for _, r := range requested {
		if r > 0 {
			totalRequested += r
		}
	}
	if totalRequested == 0 || capacity <= 0 {
		return shares
	}

	// If there is enough capacity for everyone, give each what it asked for.
	if totalRequested <= capacity {
		for i, r := range requested {
			if r > 0 {
				shares[i] = r
			}
		}
		return shares
	}

	// Proportional allocation with floor.
	allocated := 0
	for i, r := range requested {
		if r > 0 {
			shares[i] = (r * capacity) / totalRequested
			allocated += shares[i]
		}
	}

	// Distribute remainder one slot at a time to targets with the largest
	// unfulfilled request, breaking ties by pending tasks.
	remainder := capacity - allocated
	for remainder > 0 {
		bestIdx := -1
		bestUnfulfilled := 0
		bestPending := 0
		for i, r := range requested {
			unfulfilled := r - shares[i]
			if unfulfilled <= 0 {
				continue
			}
			if unfulfilled > bestUnfulfilled ||
				(unfulfilled == bestUnfulfilled && pendingCounts[i] > bestPending) {
				bestIdx = i
				bestUnfulfilled = unfulfilled
				bestPending = pendingCounts[i]
			}
		}
		if bestIdx < 0 {
			break
		}
		shares[bestIdx]++
		remainder--
	}

	return shares
}

// executePreemptions stops idle containers from lower-priority templates and
// creates replacements for higher-priority templates that need capacity.
func (m *Manager) executePreemptions(
	ctx context.Context,
	unsatisfied []RuntimeTarget,
	allTargets []RuntimeTarget,
	grouped map[string][]ContainerInfo,
	heartbeats map[string]RuntimeHeartbeat,
	totalRunning int,
) {
	boosted := m.boostStarvedTargets(unsatisfied)
	plans := planPreemptions(boosted, grouped, allTargets)
	if len(plans) == 0 {
		return
	}

	targetMap := buildTargetMap(allTargets)

	for _, plan := range plans {
		if !isContainerIdleByHeartbeat(plan.VictimContainerID, plan.VictimTemplateID, grouped, heartbeats) {
			m.logger.Info("skipping preemption, victim is executing",
				"victim", plan.VictimContainerID, "template", plan.VictimTemplateID)
			continue
		}

		victimTarget, ok := targetMap[plan.VictimTemplateID]
		defaultGrace := time.Duration(defaultGracePeriodSeconds) * time.Second
		gracePeriod := defaultGrace
		if ok {
			gracePeriod = gracePeriodDuration(victimTarget.GracePeriodSeconds, defaultGrace)
		}

		m.logger.Info("preempting idle runtime",
			"victim", plan.VictimContainerID,
			"victim_template", plan.VictimTemplateID,
			"beneficiary_template", plan.BeneficiaryTemplate.TemplateID,
		)

		m.stopAndRemove(ctx, plan.VictimContainerID, gracePeriod)
		m.createRuntimeContainers(ctx, plan.BeneficiaryTemplate, 1)

		m.logFleetEvent("runtime_preempted", "info", plan.VictimContainerID,
			plan.BeneficiaryTemplate.TemplateID, plan.VictimContainerID)
	}
}

// isContainerIdleByHeartbeat checks whether a specific container's runtime is
// idle according to heartbeat data. Containers without a heartbeat are
// considered idle.
func isContainerIdleByHeartbeat(
	containerID string,
	templateID string,
	grouped map[string][]ContainerInfo,
	heartbeats map[string]RuntimeHeartbeat,
) bool {
	runtimeID := findRuntimeIDForContainer(containerID, templateID, grouped)
	if runtimeID == "" {
		return true
	}
	return !isExecutingRuntime(runtimeID, heartbeats)
}

// findRuntimeIDForContainer looks up the runtime ID label for a container.
func findRuntimeIDForContainer(
	containerID string,
	templateID string,
	grouped map[string][]ContainerInfo,
) string {
	for _, c := range grouped[templateID] {
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
func (m *Manager) fetchHeartbeatMap() (map[string]RuntimeHeartbeat, error) {
	heartbeats, err := m.platform.FetchHeartbeats()
	if err != nil {
		return nil, fmt.Errorf("fetch heartbeats: %w", err)
	}
	return buildHeartbeatMap(heartbeats), nil
}

// buildHeartbeatMap creates a lookup from runtime ID to heartbeat.
func buildHeartbeatMap(heartbeats []RuntimeHeartbeat) map[string]RuntimeHeartbeat {
	m := make(map[string]RuntimeHeartbeat, len(heartbeats))
	for _, hb := range heartbeats {
		m[hb.RuntimeID] = hb
	}
	return m
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
		if !isDrainingContainer(c) {
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
// Drifted containers are excluded from idle teardown to prevent double
// processing — drift handling takes precedence.
func (m *Manager) planTargetActions(
	target RuntimeTarget,
	running []ContainerInfo,
	totalRunning int,
) targetActions {
	capacity := m.config.GlobalMaxRuntimes - totalRunning
	drifted := findImageDrift(target, running)
	driftIDs := containerIDSet(drifted)
	idle := excludeByID(findIdleForTeardown(target, running), driftIDs)

	return targetActions{
		toCreate:      computeScaleUp(target, len(running), capacity),
		idleToDestroy: idle,
		driftToHandle: drifted,
	}
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
// activeCount is the number of non-draining containers for this template.
// drainingCount is the total number of draining containers across all templates.
func (m *Manager) executeTargetActions(
	ctx context.Context,
	target RuntimeTarget,
	actions targetActions,
	heartbeats map[string]RuntimeHeartbeat,
	activeCount int,
	drainingCount int,
) int {
	delta := 0
	delta -= m.destroyContainers(ctx, actions.idleToDestroy, target.GracePeriodSeconds)

	driftResult := m.handleDriftContainers(ctx, actions.driftToHandle, target, heartbeats)
	delta -= driftResult.destroyed

	// Create replacements for idle-destroyed drifted containers, respecting
	// max_runtimes. Draining containers count toward the global total but NOT
	// toward the template's active count, so replacements can be created.
	replacements := driftResult.destroyed
	globalCapacity := m.config.GlobalMaxRuntimes - (activeCount + drainingCount + delta)
	if replacements > globalCapacity {
		replacements = globalCapacity
	}
	delta += m.createRuntimeContainers(ctx, target, actions.toCreate+replacements)
	return delta
}
