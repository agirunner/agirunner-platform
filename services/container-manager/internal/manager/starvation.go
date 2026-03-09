package manager

import "time"

// starvationThreshold is the maximum time a template with pending tasks may
// wait without receiving any runtime before it is flagged as starved.
const starvationThreshold = 60 * time.Second

// updateStarvationTracking records when templates first had pending tasks with
// no running containers, and clears entries once a runtime is assigned.
func (m *Manager) updateStarvationTracking(
	targets []RuntimeTarget,
	grouped map[string][]ContainerInfo,
) {
	now := m.nowFunc()
	activeTemplates := make(map[string]bool, len(targets))

	for _, target := range targets {
		activeTemplates[target.TemplateID] = true
		running := countActiveContainers(grouped[target.TemplateID])

		if target.PendingTasks > 0 && running == 0 {
			if _, tracked := m.starvationTrack[target.TemplateID]; !tracked {
				m.starvationTrack[target.TemplateID] = now
			}
			continue
		}

		delete(m.starvationTrack, target.TemplateID)
	}

	pruneStaleStarvationEntries(m.starvationTrack, activeTemplates)
}

// pruneStaleStarvationEntries removes entries for templates no longer in the
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

// isStarved returns true when a template has been waiting for a runtime longer
// than the starvation threshold.
func (m *Manager) isStarved(templateID string) bool {
	firstPending, ok := m.starvationTrack[templateID]
	if !ok {
		return false
	}
	return m.nowFunc().Sub(firstPending) >= starvationThreshold
}

// boostStarvedTargets adjusts the priority of starved targets so they are
// scheduled ahead of non-starved templates during preemption planning. The
// returned slice is a copy — the original targets are not modified.
func (m *Manager) boostStarvedTargets(targets []RuntimeTarget) []RuntimeTarget {
	boosted := make([]RuntimeTarget, len(targets))
	copy(boosted, targets)

	for i := range boosted {
		if m.isStarved(boosted[i].TemplateID) {
			m.logger.Warn("template starved, boosting priority for preemption",
				"template", boosted[i].TemplateID,
				"original_priority", boosted[i].Priority,
			)
			boosted[i].Priority = maxPriorityIn(targets) + 1
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
