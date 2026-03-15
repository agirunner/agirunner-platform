package manager

import (
	"context"
	"testing"
)

func TestClassifyManagedRuntimeOrphanMissingTarget(t *testing.T) {
	container := makeDCMContainer("c-1", "tmpl-missing", "runtime:v1", "rt-1")

	reason := classifyManagedRuntimeOrphan(container, map[string]RuntimeTarget{})

	if reason != orphanReasonMissingTarget {
		t.Fatalf("expected %q, got %q", orphanReasonMissingTarget, reason)
	}
}

func TestClassifyManagedRuntimeOrphanInvalidLabels(t *testing.T) {
	container := makeDCMContainer("c-1", "tmpl-1", "runtime:v1", "rt-1")
	delete(container.Labels, labelDCMPlaybookID)

	reason := classifyManagedRuntimeOrphan(container, map[string]RuntimeTarget{})

	if reason != orphanReasonInvalidLabels {
		t.Fatalf("expected %q, got %q", orphanReasonInvalidLabels, reason)
	}
}

func TestTrackedRuntimeOrphanRequiresGraceCycles(t *testing.T) {
	docker := newMockDockerClient()
	container := makeDCMContainer("c-1", "tmpl-missing", "runtime:v1", "rt-1")
	docker.containers = []ContainerInfo{container}

	platform := &mockPlatformClient{}
	mgr := newDCMTestManager(docker, platform)
	mgr.config.RuntimeOrphanGraceCycles = 3

	targets := []RuntimeTarget{}

	for cycle := 0; cycle < 2; cycle++ {
		if err := mgr.reconcileDCMWithSnapshot(context.Background(), targets, nil); err != nil {
			t.Fatalf("reconcile cycle %d: %v", cycle, err)
		}
		if len(docker.removedIDs) != 0 {
			t.Fatalf("expected no cleanup before grace threshold, got %v", docker.removedIDs)
		}
	}

	if err := mgr.reconcileDCMWithSnapshot(context.Background(), targets, nil); err != nil {
		t.Fatalf("reconcile cycle 2: %v", err)
	}

	if len(docker.removedIDs) != 1 || docker.removedIDs[0] != "c-1" {
		t.Fatalf("expected container cleaned on grace threshold, got %v", docker.removedIDs)
	}
}

func TestTrackedRuntimeHealthyContainerClearsOrphanState(t *testing.T) {
	docker := newMockDockerClient()
	container := makeDCMContainer("c-1", "tmpl-1", "runtime:v1", "rt-1")
	docker.containers = []ContainerInfo{container}

	target := makeRuntimeTarget("tmpl-1", "runtime:v1", 1, 0, 10)
	platform := &mockPlatformClient{}
	mgr := newDCMTestManager(docker, platform)
	mgr.config.RuntimeOrphanGraceCycles = 3

	if err := mgr.reconcileDCMWithSnapshot(context.Background(), nil, nil); err != nil {
		t.Fatalf("first reconcile: %v", err)
	}

	if len(mgr.runtimeOrphans) != 1 {
		t.Fatalf("expected orphan tracked after missing target, got %d entries", len(mgr.runtimeOrphans))
	}

	if err := mgr.reconcileDCMWithSnapshot(context.Background(), []RuntimeTarget{target}, nil); err != nil {
		t.Fatalf("second reconcile: %v", err)
	}

	if len(mgr.runtimeOrphans) != 0 {
		t.Fatalf("expected orphan state cleared after target recovery, got %d entries", len(mgr.runtimeOrphans))
	}
	if len(docker.removedIDs) != 0 {
		t.Fatalf("expected no cleanup after target recovery, got %v", docker.removedIDs)
	}
}
