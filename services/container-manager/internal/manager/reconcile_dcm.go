package manager

import (
	"context"
	"fmt"
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

	heartbeats, heartbeatMap, err := m.fetchHeartbeatSnapshot()
	if err != nil {
		m.logger.Warn("heartbeat fetch failed, using fallback idle tracking", "error", err)
		heartbeats = nil
		heartbeatMap = m.buildFallbackHeartbeatMap(containers)
	} else {
		m.clearHeartbeatFallbackTracking(containers)
	}

	return m.reconcileDCMWithResolvedInputs(ctx, targets, heartbeats, containers, heartbeatMap)
}

func (m *Manager) reconcileDCMWithSnapshot(
	ctx context.Context,
	targets []RuntimeTarget,
	heartbeats []RuntimeHeartbeat,
) error {
	containers, err := m.listDCMRuntimeContainers(ctx)
	if err != nil {
		return fmt.Errorf("list DCM containers: %w", err)
	}

	heartbeatMap := buildHeartbeatMap(heartbeats)
	m.clearHeartbeatFallbackTracking(containers)

	return m.reconcileDCMWithResolvedInputs(ctx, targets, heartbeats, containers, heartbeatMap)
}

func (m *Manager) reconcileDCMWithResolvedInputs(
	ctx context.Context,
	targets []RuntimeTarget,
	heartbeats []RuntimeHeartbeat,
	containers []ContainerInfo,
	heartbeatMap map[string]RuntimeHeartbeat,
) error {
	if removed := m.reconcileManagedRuntimeOrphans(ctx, containers, targets); removed > 0 {
		refreshedContainers, err := m.listDCMRuntimeContainers(ctx)
		if err != nil {
			return fmt.Errorf("list DCM containers after orphan cleanup: %w", err)
		}
		containers = refreshedContainers
		heartbeatMap = buildHeartbeatMap(heartbeats)
	}

	if removed := m.cleanupTerminalRuntimeContainers(ctx, containers); removed > 0 {
		refreshedContainers, err := m.listDCMRuntimeContainers(ctx)
		if err != nil {
			return fmt.Errorf("list DCM containers after terminal cleanup: %w", err)
		}
		containers = refreshedContainers
		heartbeatMap = buildHeartbeatMap(heartbeats)
	}

	liveContainers := filterLiveRuntimeContainers(containers)
	grouped := groupContainersByTarget(liveContainers)
	drainingCount := countDrainingContainers(liveContainers)
	totalRunning := len(liveContainers)

	sorted := sortTargetsByPriority(targets)
	m.updateStarvationTracking(sorted, grouped)

	unsatisfied := m.processTargetsInPriorityOrder(
		ctx, sorted, grouped, heartbeatMap, &totalRunning, drainingCount,
	)

	if len(unsatisfied) > 0 {
		m.executePreemptions(ctx, unsatisfied, sorted, grouped, heartbeatMap, totalRunning)
	}

	m.cleanupOrphanTaskContainers(ctx)
	m.detectHungRuntimesWithHeartbeats(ctx, heartbeats)

	updatedContainers, listErr := m.listDCMRuntimeContainers(ctx)
	if listErr == nil {
		m.metrics.UpdateRuntimeGauges(filterLiveRuntimeContainers(updatedContainers), heartbeatMap)
	}

	// Count total pending tasks across all targets for the cycle summary.
	totalPending := 0
	for _, t := range sorted {
		totalPending += t.PendingTasks
	}

	m.logger.Debug("dcm reconcile cycle",
		"targets", len(sorted),
		"containers", totalRunning,
		"draining", drainingCount,
		"pending_tasks", totalPending,
		"unsatisfied", len(unsatisfied),
	)

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
			m.prePullImage(ctx, target)
		}
		running := grouped[target.TargetKey()]
		activeCount := countActiveContainers(running)
		actions := m.planTargetActions(target, running, *totalRunning, heartbeats)
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

// executePreemptions stops idle containers from lower-priority playbooks and
// creates replacements for higher-priority playbooks that need capacity.
func (m *Manager) executePreemptions(
	ctx context.Context,
	unsatisfied []RuntimeTarget,
	allTargets []RuntimeTarget,
	grouped map[string][]ContainerInfo,
	heartbeats map[string]RuntimeHeartbeat,
	totalRunning int,
) {
	boosted := m.boostStarvedTargets(unsatisfied, allTargets)
	plans := planPreemptions(boosted, grouped, allTargets)
	if len(plans) == 0 {
		return
	}

	targetMap := buildTargetMap(allTargets)

	for _, plan := range plans {
		if !isContainerIdleByHeartbeat(plan.VictimContainerID, plan.VictimTargetKey, grouped, heartbeats) {
			m.logger.Info("skipping preemption, victim is executing",
				"victim", plan.VictimContainerID, "playbook_id", plan.VictimPlaybookID)
			m.emitLog("container", "reconcile.preempt_skipped", "debug", "completed", map[string]any{
				"action":                  "preempt",
				"victim_container_id":     plan.VictimContainerID,
				"victim_playbook_id":      plan.VictimPlaybookID,
				"beneficiary_playbook_id": plan.BeneficiaryTemplate.PlaybookID,
				"beneficiary_pool_mode":   plan.BeneficiaryTemplate.PoolMode,
				"beneficiary_priority":    plan.BeneficiaryTemplate.Priority,
				"reason":                  "victim_executing",
			})
			continue
		}

		victimTarget, ok := targetMap[plan.VictimTargetKey]
		gracePeriod := m.config.StopTimeout
		if ok {
			gracePeriod = gracePeriodDuration(victimTarget.GracePeriodSeconds, gracePeriod)
		}

		m.logger.Info("preempting idle runtime",
			"victim", plan.VictimContainerID,
			"victim_playbook_id", plan.VictimPlaybookID,
			"beneficiary_playbook_id", plan.BeneficiaryTemplate.PlaybookID,
		)

		m.stopAndRemove(ctx, plan.VictimContainerID, gracePeriod)
		m.createRuntimeContainers(ctx, plan.BeneficiaryTemplate, 1)

		m.logFleetEvent("runtime_preempted", "info", plan.VictimContainerID,
			plan.BeneficiaryTemplate.PlaybookID, plan.BeneficiaryTemplate.PoolKind, plan.VictimContainerID)
		victimName := ""
		if vt, ok := targetMap[plan.VictimTargetKey]; ok {
			victimName = vt.PlaybookName
		}
		preemptMeta := map[string]any{
			"action":                    "preempt",
			"victim_playbook_id":        plan.VictimPlaybookID,
			"victim_playbook_name":      victimName,
			"victim_container_id":       plan.VictimContainerID,
			"beneficiary_playbook_id":   plan.BeneficiaryTemplate.PlaybookID,
			"beneficiary_playbook_name": plan.BeneficiaryTemplate.PlaybookName,
			"beneficiary_pool_mode":     plan.BeneficiaryTemplate.PoolMode,
			"beneficiary_priority":      plan.BeneficiaryTemplate.Priority,
			"reason":                    "starvation",
		}
		if starvedSince, ok := m.starvationTrack[plan.BeneficiaryTemplate.TargetKey()]; ok {
			preemptMeta["starvation_duration_ms"] = m.nowFunc().Sub(starvedSince).Milliseconds()
		}
			m.emitLogWithResource("container", "reconcile.preempt", "info", "completed", preemptMeta,
				logResourceInfo{ResourceType: "runtime", ResourceID: plan.VictimContainerID})
	}
}
