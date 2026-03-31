package manager

import (
	"testing"
)

func TestComputeColdScaleUpWithPendingTasks(t *testing.T) {
	target := makeRuntimeTarget("tmpl-1", "runtime:v1", 3, 2, 10)
	got := computeScaleUp(target, 0, 10)
	if got != 2 {
		t.Errorf("expected 2, got %d", got)
	}
}

func TestComputeColdScaleUpNoPendingTasks(t *testing.T) {
	target := makeRuntimeTarget("tmpl-1", "runtime:v1", 3, 0, 10)
	got := computeScaleUp(target, 0, 10)
	if got != 0 {
		t.Errorf("expected 0, got %d", got)
	}
}

func TestComputeColdScaleUpCappedByMaxRuntimes(t *testing.T) {
	target := makeRuntimeTarget("tmpl-1", "runtime:v1", 2, 5, 10)
	got := computeScaleUp(target, 1, 10)
	if got != 1 {
		t.Errorf("expected 1 (max 2 - 1 running), got %d", got)
	}
}

func TestComputeWarmScaleUpWithActiveWorkflows(t *testing.T) {
	target := makeRuntimeTarget("tmpl-1", "runtime:v1", 3, 0, 10)
	target.PoolMode = "warm"
	target.ActiveWorkflows = 2
	got := computeScaleUp(target, 0, 10)
	if got != 2 {
		t.Errorf("expected 2 (one per active workflow), got %d", got)
	}
}

func TestComputeWarmScaleUpNoActiveWorkflows(t *testing.T) {
	target := makeRuntimeTarget("tmpl-1", "runtime:v1", 3, 0, 10)
	target.PoolMode = "warm"
	target.ActiveWorkflows = 0
	got := computeScaleUp(target, 0, 10)
	if got != 0 {
		t.Errorf("expected 0 (no active workflows), got %d", got)
	}
}

func TestComputeWarmScaleUpScalesToPendingTasks(t *testing.T) {
	target := makeRuntimeTarget("tmpl-1", "runtime:v1", 5, 3, 10)
	target.PoolMode = "warm"
	target.ActiveWorkflows = 1
	got := computeScaleUp(target, 0, 10)
	if got != 3 {
		t.Errorf("expected 3 (warm scales to current pending work up to max_runtimes), got %d", got)
	}
}

func TestComputeWarmScaleUpCappedByCapacity(t *testing.T) {
	target := makeRuntimeTarget("tmpl-1", "runtime:v1", 5, 0, 10)
	target.PoolMode = "warm"
	target.ActiveWorkflows = 4
	got := computeScaleUp(target, 0, 2)
	if got != 2 {
		t.Errorf("expected 2 (capped by capacity), got %d", got)
	}
}

func TestComputeWarmScaleUpKeepsWorkflowFloorWhenNoPendingTasks(t *testing.T) {
	target := makeRuntimeTarget("tmpl-1", "runtime:v1", 5, 0, 10)
	target.PoolMode = "warm"
	target.ActiveWorkflows = 2
	got := computeScaleUp(target, 0, 10)
	if got != 2 {
		t.Errorf("expected 2 (warm keeps floor for active workflows), got %d", got)
	}
}

func TestComputeWarmScaleUpAlreadyAtMax(t *testing.T) {
	target := makeRuntimeTarget("tmpl-1", "runtime:v1", 1, 0, 10)
	target.PoolMode = "warm"
	target.ActiveWorkflows = 3
	got := computeScaleUp(target, 1, 10)
	if got != 0 {
		t.Errorf("expected 0 (already at max), got %d", got)
	}
}
