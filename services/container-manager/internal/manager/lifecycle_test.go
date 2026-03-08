package manager

import (
	"context"
	"testing"
)

func TestDCMStartupSweepAdoptsMatchingRuntimes(t *testing.T) {
	docker := newMockDockerClient()
	docker.containers = []ContainerInfo{
		makeDCMContainer("c-1", "tmpl-1", "runtime:v1", "rt-1"),
	}
	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{
			makeRuntimeTarget("tmpl-1", "runtime:v1", 5, 0, 10),
		},
	}
	mgr := newDCMTestManager(docker, platform)

	err := mgr.startupSweep(context.Background())

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(docker.stoppedIDs) != 0 {
		t.Errorf("expected matching runtime adopted (not stopped), got %d stopped", len(docker.stoppedIDs))
	}
}

func TestDCMStartupSweepRemovesStaleRuntimes(t *testing.T) {
	docker := newMockDockerClient()
	docker.containers = []ContainerInfo{
		makeDCMContainer("c-1", "tmpl-stale", "runtime:v1", "rt-1"),
	}
	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{},
	}
	mgr := newDCMTestManager(docker, platform)

	err := mgr.startupSweep(context.Background())

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(docker.stoppedIDs) != 1 || docker.stoppedIDs[0] != "c-1" {
		t.Errorf("expected stale runtime c-1 stopped, got %v", docker.stoppedIDs)
	}
}

func TestDCMShutdownCascadeStopsAllRuntimes(t *testing.T) {
	docker := newMockDockerClient()
	docker.containers = []ContainerInfo{
		makeDCMContainer("c-1", "tmpl-1", "runtime:v1", "rt-1"),
		makeDCMContainer("c-2", "tmpl-1", "runtime:v1", "rt-2"),
	}
	platform := &mockPlatformClient{}
	mgr := newDCMTestManager(docker, platform)

	mgr.shutdownCascade()

	if len(docker.stoppedIDs) < 2 {
		t.Errorf("expected at least 2 containers stopped during shutdown, got %d", len(docker.stoppedIDs))
	}
}

func TestDCMStartupSweepNoContainers(t *testing.T) {
	docker := newMockDockerClient()
	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{},
	}
	mgr := newDCMTestManager(docker, platform)

	err := mgr.startupSweep(context.Background())

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
}
