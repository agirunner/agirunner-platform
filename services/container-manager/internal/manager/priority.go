package manager

import "sort"

// sortTargetsByPriority sorts targets by priority descending, then pending tasks descending.
func sortTargetsByPriority(targets []RuntimeTarget) []RuntimeTarget {
	sorted := make([]RuntimeTarget, len(targets))
	copy(sorted, targets)
	sort.Slice(sorted, func(i, j int) bool {
		if sorted[i].Priority != sorted[j].Priority {
			return sorted[i].Priority > sorted[j].Priority
		}
		return sorted[i].PendingTasks > sorted[j].PendingTasks
	})
	return sorted
}

// preemptionCandidate identifies a lower-priority idle runtime that can be preempted.
type preemptionCandidate struct {
	Container  ContainerInfo
	TemplateID string
	Priority   int
}

// findPreemptionCandidates finds idle runtimes from lower-priority templates.
func findPreemptionCandidates(
	grouped map[string][]ContainerInfo,
	targetMap map[string]RuntimeTarget,
	minPriority int,
) []preemptionCandidate {
	var candidates []preemptionCandidate
	for tmplID, containers := range grouped {
		target, ok := targetMap[tmplID]
		if !ok || target.Priority >= minPriority {
			continue
		}
		for _, c := range containers {
			if isDrainingContainer(c) {
				continue
			}
			candidates = append(candidates, preemptionCandidate{
				Container:  c,
				TemplateID: tmplID,
				Priority:   target.Priority,
			})
		}
	}
	sortCandidatesByPriority(candidates)
	return candidates
}

// sortCandidatesByPriority sorts candidates by priority ascending (lowest first).
func sortCandidatesByPriority(candidates []preemptionCandidate) {
	sort.Slice(candidates, func(i, j int) bool {
		return candidates[i].Priority < candidates[j].Priority
	})
}

// planPreemptions determines which idle runtimes to preempt for higher-priority targets.
func planPreemptions(
	targets []RuntimeTarget,
	grouped map[string][]ContainerInfo,
	globalMax int,
) []preemptionPlan {
	targetMap := make(map[string]RuntimeTarget, len(targets))
	for _, t := range targets {
		targetMap[t.TemplateID] = t
	}

	sorted := sortTargetsByPriority(targets)
	var plans []preemptionPlan

	for _, target := range sorted {
		if target.PendingTasks <= 0 {
			continue
		}
		running := len(grouped[target.TemplateID])
		if running >= target.MaxRuntimes {
			continue
		}
		needed := computeNeeded(target, running)
		if needed <= 0 {
			continue
		}
		candidates := findPreemptionCandidates(grouped, targetMap, target.Priority)
		plans = append(plans, buildPreemptionPlan(target, candidates, needed)...)
	}
	_ = globalMax
	return plans
}

// computeNeeded calculates how many more runtimes a target needs.
func computeNeeded(target RuntimeTarget, running int) int {
	need := target.PendingTasks
	if need > target.MaxRuntimes-running {
		need = target.MaxRuntimes - running
	}
	return need
}

// preemptionPlan describes a single preemption: stop victim, create for beneficiary.
type preemptionPlan struct {
	VictimContainerID    string
	VictimTemplateID     string
	BeneficiaryTemplate  RuntimeTarget
}

// buildPreemptionPlan creates preemption plans for a target from available candidates.
func buildPreemptionPlan(
	target RuntimeTarget,
	candidates []preemptionCandidate,
	needed int,
) []preemptionPlan {
	var plans []preemptionPlan
	for i := 0; i < len(candidates) && len(plans) < needed; i++ {
		plans = append(plans, preemptionPlan{
			VictimContainerID:   candidates[i].Container.ID,
			VictimTemplateID:    candidates[i].TemplateID,
			BeneficiaryTemplate: target,
		})
	}
	return plans
}
