package manager

import "sort"

// sortTargetsByPriority sorts targets by priority descending, then active
// workflows (templates with active workflows before warm-pool-only), then
// pending tasks descending.
func sortTargetsByPriority(targets []RuntimeTarget) []RuntimeTarget {
	sorted := make([]RuntimeTarget, len(targets))
	copy(sorted, targets)
	sort.Slice(sorted, func(i, j int) bool {
		if sorted[i].Priority != sorted[j].Priority {
			return sorted[i].Priority > sorted[j].Priority
		}
		iHasActive := sorted[i].ActiveWorkflows > 0
		jHasActive := sorted[j].ActiveWorkflows > 0
		if iHasActive != jHasActive {
			return iHasActive
		}
		return sorted[i].PendingTasks > sorted[j].PendingTasks
	})
	return sorted
}

// preemptionCandidate identifies a lower-priority idle runtime that can be preempted.
type preemptionCandidate struct {
	Container  ContainerInfo
	PlaybookID string
	PoolKind   string
	TargetKey  string
	Priority   int
}

// findPreemptionCandidates finds idle runtimes from lower-priority templates.
func findPreemptionCandidates(
	grouped map[string][]ContainerInfo,
	targetMap map[string]RuntimeTarget,
	minPriority int,
) []preemptionCandidate {
	var candidates []preemptionCandidate
	for targetKey, containers := range grouped {
		target, ok := targetMap[targetKey]
		if !ok || target.Priority >= minPriority {
			continue
		}
		for _, c := range containers {
			if isDrainingContainer(c) {
				continue
			}
			candidates = append(candidates, preemptionCandidate{
				Container:  c,
				PlaybookID: target.PlaybookID,
				PoolKind:   target.PoolKind,
				TargetKey:  targetKey,
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

// planPreemptions determines which idle runtimes to preempt for higher-priority
// targets. beneficiaries are the templates that need capacity; allTargets
// provides priority information for potential victim templates.
func planPreemptions(
	beneficiaries []RuntimeTarget,
	grouped map[string][]ContainerInfo,
	allTargets []RuntimeTarget,
) []preemptionPlan {
	fullMap := make(map[string]RuntimeTarget, len(allTargets))
	for _, t := range allTargets {
		fullMap[t.TargetKey()] = t
	}

	sorted := sortTargetsByPriority(beneficiaries)
	var plans []preemptionPlan

	for _, target := range sorted {
		if target.PendingTasks <= 0 {
			continue
		}
		running := len(grouped[target.TargetKey()])
		if running >= target.MaxRuntimes {
			continue
		}
		needed := computeNeeded(target, running)
		if needed <= 0 {
			continue
		}
		candidates := findPreemptionCandidates(grouped, fullMap, target.Priority)
		plans = append(plans, buildPreemptionPlan(target, candidates, needed)...)
	}
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
	VictimContainerID   string
	VictimPlaybookID    string
	VictimPoolKind      string
	VictimTargetKey     string
	BeneficiaryTemplate RuntimeTarget
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
			VictimPlaybookID:    candidates[i].PlaybookID,
			VictimPoolKind:      candidates[i].PoolKind,
			VictimTargetKey:     candidates[i].TargetKey,
			BeneficiaryTemplate: target,
		})
	}
	return plans
}
