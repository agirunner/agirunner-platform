package manager

import "time"

// starvationThreshold is the maximum time a playbook with pending tasks may
// wait without receiving any runtime before it is flagged as starved.
const starvationThreshold = 60 * time.Second

// updateStarvationTracking records when playbooks first had pending tasks with
// no running containers, and clears entries once a runtime is assigned.
func (m *Manager) updateStarvationTracking(
	targets []RuntimeTarget,
	grouped map[string][]ContainerInfo,
) {
	now := m.nowFunc()
	activeTargets := make(map[string]bool, len(targets))

	for _, target := range targets {
		targetKey := target.TargetKey()
		activeTargets[targetKey] = true
		running := countActiveContainers(grouped[targetKey])

		if target.PendingTasks > 0 && running == 0 {
			if _, tracked := m.starvationTrack[targetKey]; !tracked {
				m.starvationTrack[targetKey] = now
			}
			continue
		}

		delete(m.starvationTrack, targetKey)
	}

	pruneStaleStarvationEntries(m.starvationTrack, activeTargets)
}

// pruneStaleStarvationEntries removes entries for playbooks no longer in the
// target list, preventing unbounded map growth.
func pruneStaleStarvationEntries(
	tracking map[string]time.Time,
	active map[string]bool,
) {
	for tmplID := range tracking {
		if !active[tmplID] {
			delete(tracking, tmplID)
		}
	}
}

// isStarved returns true when a playbook has been waiting for a runtime longer
// than the starvation threshold.
func (m *Manager) isStarved(target RuntimeTarget) bool {
	firstPending, ok := m.starvationTrack[target.TargetKey()]
	if !ok {
		return false
	}
	return m.nowFunc().Sub(firstPending) >= starvationThreshold
}

// boostStarvedTargets adjusts the priority of starved targets so they are
// scheduled ahead of non-starved playbooks during preemption planning. The
// boost is computed relative to the highest priority across ALL playbooks
// (not just the unsatisfied ones) so that the starved playbook can preempt
// any lower-priority idle runtime. The returned slice is a copy — the
// original targets are not modified.
func (m *Manager) boostStarvedTargets(unsatisfied []RuntimeTarget, allTargets []RuntimeTarget) []RuntimeTarget {
	boosted := make([]RuntimeTarget, len(unsatisfied))
	copy(boosted, unsatisfied)

	globalMax := maxPriorityIn(allTargets)
	for i := range boosted {
		if m.isStarved(boosted[i]) {
			originalPriority := boosted[i].Priority
			m.logger.Warn("playbook starved, boosting priority for preemption",
				"playbook_id", boosted[i].PlaybookID,
				"pool_kind", normalizePoolKind(boosted[i].PoolKind),
				"original_priority", originalPriority,
			)
			starvationMeta := map[string]any{
				"action":            "starvation_boost",
				"playbook_id":       boosted[i].PlaybookID,
				"playbook_name":     boosted[i].PlaybookName,
				"pool_kind":         normalizePoolKind(boosted[i].PoolKind),
				"original_priority": originalPriority,
				"boosted_priority":  globalMax + 1,
			}
			if starvedSince, ok := m.starvationTrack[boosted[i].TargetKey()]; ok {
				starvationMeta["starvation_duration_ms"] = m.nowFunc().Sub(starvedSince).Milliseconds()
			}
			m.emitLog("container", "reconcile.starvation_boost", "warn", "completed", starvationMeta)
			boosted[i].Priority = globalMax + 1
		}
	}

	return sortTargetsByPriority(boosted)
}

// maxPriorityIn returns the highest priority value across all targets.
func maxPriorityIn(targets []RuntimeTarget) int {
	max := 0
	for _, t := range targets {
		if t.Priority > max {
			max = t.Priority
		}
	}
	return max
}
