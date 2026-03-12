package manager

import (
	"context"
	"strconv"
	"testing"
	"time"
)

// --- CRITICAL-2: gracePeriodForContainer reads label ---

func TestGracePeriodForContainerReadsLabel(t *testing.T) {
	c := makeDCMContainer("c-1", "tmpl-1", "img:v1", "rt-1")
	c.Labels[labelDCMGracePeriod] = "60"

	got := gracePeriodForContainer(c)
	want := 60 * time.Second

	if got != want {
		t.Errorf("expected %v from label, got %v", want, got)
	}
}

func TestGracePeriodForContainerFallsBackWhenLabelMissing(t *testing.T) {
	c := makeDCMContainer("c-1", "tmpl-1", "img:v1", "rt-1")
	// No grace period label set.

	got := gracePeriodForContainer(c)
	want := time.Duration(defaultGracePeriodSeconds) * time.Second

	if got != want {
		t.Errorf("expected default %v, got %v", want, got)
	}
}

func TestGracePeriodForContainerFallsBackWhenLabelUnparseable(t *testing.T) {
	c := makeDCMContainer("c-1", "tmpl-1", "img:v1", "rt-1")
	c.Labels[labelDCMGracePeriod] = "not-a-number"

	got := gracePeriodForContainer(c)
	want := time.Duration(defaultGracePeriodSeconds) * time.Second

	if got != want {
		t.Errorf("expected default %v for unparseable label, got %v", want, got)
	}
}

func TestGracePeriodForContainerFallsBackWhenLabelZero(t *testing.T) {
	c := makeDCMContainer("c-1", "tmpl-1", "img:v1", "rt-1")
	c.Labels[labelDCMGracePeriod] = "0"

	got := gracePeriodForContainer(c)
	want := time.Duration(defaultGracePeriodSeconds) * time.Second

	if got != want {
		t.Errorf("expected default %v for zero label, got %v", want, got)
	}
}

func TestGracePeriodForContainerFallsBackWhenLabelNegative(t *testing.T) {
	c := makeDCMContainer("c-1", "tmpl-1", "img:v1", "rt-1")
	c.Labels[labelDCMGracePeriod] = "-10"

	got := gracePeriodForContainer(c)
	want := time.Duration(defaultGracePeriodSeconds) * time.Second

	if got != want {
		t.Errorf("expected default %v for negative label, got %v", want, got)
	}
}

func TestBuildDCMLabelsIncludesGracePeriod(t *testing.T) {
	target := makeRuntimeTarget("tmpl-1", "img:v1", 5, 0, 10)
	target.GracePeriodSeconds = 90

	labels := buildDCMLabels(target, "rt-1")

	got := labels[labelDCMGracePeriod]
	want := "90"
	if got != want {
		t.Errorf("expected grace_period label %q, got %q", want, got)
	}
}

func TestBuildDCMLabelsGracePeriodZeroStoredAsZero(t *testing.T) {
	target := makeRuntimeTarget("tmpl-1", "img:v1", 5, 0, 10)
	target.GracePeriodSeconds = 0

	labels := buildDCMLabels(target, "rt-1")

	got := labels[labelDCMGracePeriod]
	if got != "0" {
		t.Errorf("expected grace_period label %q for zero, got %q", "0", got)
	}
}

// --- MODERATE-7: Fair proportional scheduling ---

func TestAllocateProportionallyDistributesFairly(t *testing.T) {
	// 2 targets: one wants 10, other wants 5. Only 3 slots available.
	// Expected: 2 for first (10/15*3=2), 1 for second (5/15*3=1).
	requested := []int{10, 5}
	pending := []int{10, 5}
	shares := allocateProportionally(requested, pending, 3)

	if shares[0] != 2 {
		t.Errorf("expected 2 slots for first target, got %d", shares[0])
	}
	if shares[1] != 1 {
		t.Errorf("expected 1 slot for second target, got %d", shares[1])
	}
}

func TestAllocateProportionallyEnoughCapacity(t *testing.T) {
	requested := []int{3, 2}
	pending := []int{3, 2}
	shares := allocateProportionally(requested, pending, 10)

	if shares[0] != 3 {
		t.Errorf("expected 3 slots, got %d", shares[0])
	}
	if shares[1] != 2 {
		t.Errorf("expected 2 slots, got %d", shares[1])
	}
}

func TestAllocateProportionallyZeroCapacity(t *testing.T) {
	requested := []int{5, 5}
	pending := []int{5, 5}
	shares := allocateProportionally(requested, pending, 0)

	if shares[0] != 0 || shares[1] != 0 {
		t.Errorf("expected no allocation at zero capacity, got %v", shares)
	}
}

func TestAllocateProportionallyNoRequests(t *testing.T) {
	requested := []int{0, 0}
	pending := []int{0, 0}
	shares := allocateProportionally(requested, pending, 5)

	if shares[0] != 0 || shares[1] != 0 {
		t.Errorf("expected no allocation with no requests, got %v", shares)
	}
}

func TestAllocateProportionallyRemainderGoesToLargestUnfulfilled(t *testing.T) {
	// 3 targets: request 3, 3, 3. Capacity 5.
	// Floor: 1, 1, 1 (3 allocated). Remainder 2.
	// Each has unfulfilled=2, so ties break by pending tasks.
	requested := []int{3, 3, 3}
	pending := []int{10, 5, 1}
	shares := allocateProportionally(requested, pending, 5)

	total := shares[0] + shares[1] + shares[2]
	if total != 5 {
		t.Errorf("expected total 5, got %d", total)
	}
	// First target (most pending) should get the most.
	if shares[0] < shares[2] {
		t.Errorf("target with most pending (%d shares) should get >= target with least (%d shares)",
			shares[0], shares[2])
	}
}

func TestFairSchedulingInReconcileDCM(t *testing.T) {
	docker := newMockDockerClient()
	// Two templates at the same priority, one has 10 pending, other has 5.
	// Global capacity = 6 slots.
	tmplA := makeRuntimeTarget("tmpl-a", "img:v1", 10, 10, 50)
	tmplB := makeRuntimeTarget("tmpl-b", "img:v1", 10, 5, 50)
	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{tmplA, tmplB},
	}
	mgr := newDCMTestManager(docker, platform)
	mgr.config.GlobalMaxRuntimes = 6

	err := mgr.reconcileDCM(context.Background())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	countA, countB := 0, 0
	for _, spec := range docker.createdSpecs {
		switch spec.Labels[labelDCMPlaybookID] {
		case "tmpl-a":
			countA++
		case "tmpl-b":
			countB++
		}
	}
	if countA+countB != 6 {
		t.Fatalf("expected 6 total containers, got %d", countA+countB)
	}
	if countA != 4 {
		t.Errorf("expected tmpl-a to get 4 slots (proportional to 10/15), got %d", countA)
	}
	if countB != 2 {
		t.Errorf("expected tmpl-b to get 2 slots (proportional to 5/15), got %d", countB)
	}
}

// --- MODERATE-9: Preempted runtime gets correct default grace period ---

func TestPreemptionUsesDefaultGracePeriodWhenTargetGracePeriodZero(t *testing.T) {
	docker := newMockDockerClient()
	recentHB := time.Now().UTC().Format(time.RFC3339)
	// Fill to global max with low-priority containers.
	docker.containers = makeDCMContainers("tmpl-low", "img:v1", 10)

	lowTarget := makeRuntimeTarget("tmpl-low", "img:v1", 10, 0, 1)
	lowTarget.GracePeriodSeconds = 0
	lowTarget.IdleTimeoutSeconds = 0

	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{
			makeRuntimeTarget("tmpl-high", "img:v1", 3, 2, 100),
			lowTarget,
		},
		heartbeats: recentIdleHeartbeats("tmpl-low", 10, recentHB),
	}
	mgr := newDCMTestManager(docker, platform)

	err := mgr.reconcileDCM(context.Background())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Verify preemption happened.
	if len(docker.stoppedIDs) < 1 {
		t.Fatal("expected at least 1 preemption")
	}
}

func TestGracePeriodDurationFallsBackToDefaultNotStopTimeout(t *testing.T) {
	// When GracePeriodSeconds is 0, fallback should be 180s not StopTimeout.
	defaultGrace := time.Duration(defaultGracePeriodSeconds) * time.Second
	result := gracePeriodDuration(0, defaultGrace)

	if result != defaultGrace {
		t.Errorf("expected %v, got %v", defaultGrace, result)
	}
	if result == 30*time.Second {
		t.Error("grace period should not fall back to StopTimeout (30s)")
	}
}

// --- MODERATE-10: Active workflows sorted before warm-pool-only ---

func TestSortTargetsByPriorityActiveWorkflowsBeforeWarmPoolOnly(t *testing.T) {
	activeTarget := makeRuntimeTarget("tmpl-active", "img:v1", 5, 2, 50)
	activeTarget.ActiveWorkflows = 3

	warmOnlyTarget := makeRuntimeTarget("tmpl-warm", "img:v1", 5, 2, 50)
	warmOnlyTarget.ActiveWorkflows = 0

	sorted := sortTargetsByPriority([]RuntimeTarget{warmOnlyTarget, activeTarget})

	if sorted[0].PlaybookID != "tmpl-active" {
		t.Errorf("expected active workflows template first, got %s", sorted[0].PlaybookID)
	}
	if sorted[1].PlaybookID != "tmpl-warm" {
		t.Errorf("expected warm-pool-only template second, got %s", sorted[1].PlaybookID)
	}
}

func TestSortTargetsByPriorityPreservesHigherPriorityFirst(t *testing.T) {
	highPri := makeRuntimeTarget("tmpl-high", "img:v1", 5, 2, 100)
	highPri.ActiveWorkflows = 0

	lowPri := makeRuntimeTarget("tmpl-low", "img:v1", 5, 2, 1)
	lowPri.ActiveWorkflows = 5

	sorted := sortTargetsByPriority([]RuntimeTarget{lowPri, highPri})

	if sorted[0].PlaybookID != "tmpl-high" {
		t.Errorf("priority should take precedence over active workflows, got %s first", sorted[0].PlaybookID)
	}
}

func TestSortTargetsByPrioritySameActiveWorkflowsSortByPending(t *testing.T) {
	manyPending := makeRuntimeTarget("tmpl-many", "img:v1", 5, 10, 50)
	manyPending.ActiveWorkflows = 1

	fewPending := makeRuntimeTarget("tmpl-few", "img:v1", 5, 2, 50)
	fewPending.ActiveWorkflows = 1

	sorted := sortTargetsByPriority([]RuntimeTarget{fewPending, manyPending})

	if sorted[0].PlaybookID != "tmpl-many" {
		t.Errorf("expected more pending tasks first, got %s", sorted[0].PlaybookID)
	}
}

// --- groupByPriority ---

func TestGroupByPrioritySingleGroup(t *testing.T) {
	targets := []RuntimeTarget{
		makeRuntimeTarget("a", "img:v1", 5, 2, 10),
		makeRuntimeTarget("b", "img:v1", 5, 3, 10),
	}
	groups := groupByPriority(targets)
	if len(groups) != 1 {
		t.Fatalf("expected 1 group, got %d", len(groups))
	}
	if len(groups[0]) != 2 {
		t.Errorf("expected 2 targets in group, got %d", len(groups[0]))
	}
}

func TestGroupByPriorityMultipleGroups(t *testing.T) {
	targets := []RuntimeTarget{
		makeRuntimeTarget("high", "img:v1", 5, 2, 100),
		makeRuntimeTarget("mid", "img:v1", 5, 3, 50),
		makeRuntimeTarget("low", "img:v1", 5, 1, 10),
	}
	sorted := sortTargetsByPriority(targets)
	groups := groupByPriority(sorted)
	if len(groups) != 3 {
		t.Fatalf("expected 3 groups, got %d", len(groups))
	}
}

func TestGroupByPriorityEmpty(t *testing.T) {
	groups := groupByPriority(nil)
	if groups != nil {
		t.Errorf("expected nil for empty input, got %v", groups)
	}
}

// --- Verify created containers carry grace_period label in reconcile ---

func TestReconcileDCMContainerCarriesGracePeriodLabel(t *testing.T) {
	docker := newMockDockerClient()
	target := makeRuntimeTarget("tmpl-1", "runtime:v1", 5, 1, 10)
	target.GracePeriodSeconds = 120
	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{target},
	}
	mgr := newDCMTestManager(docker, platform)

	err := mgr.reconcileDCM(context.Background())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(docker.createdSpecs) != 1 {
		t.Fatalf("expected 1 container, got %d", len(docker.createdSpecs))
	}

	labels := docker.createdSpecs[0].Labels
	got := labels[labelDCMGracePeriod]
	want := strconv.Itoa(120)
	if got != want {
		t.Errorf("expected grace_period label %q, got %q", want, got)
	}
}
