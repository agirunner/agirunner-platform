package manager

import (
	"context"
	"fmt"
	"testing"
	"time"
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
	if len(docker.removedIDs) != 1 || docker.removedIDs[0] != "c-1" {
		t.Errorf("expected stale runtime c-1 removed, got %v", docker.removedIDs)
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

func TestDCMStartupSweepRemovesOrphanTasksWithDeadParent(t *testing.T) {
	docker := newMockDockerClient()
	// Task container whose parent runtime (rt-dead) does not exist in the container list.
	docker.containers = []ContainerInfo{
		makeDCMContainer("c-1", "tmpl-1", "runtime:v1", "rt-alive"),
		makeDCMTaskContainer("task-orphan", "rt-dead"),
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
	if len(docker.removedIDs) != 1 || docker.removedIDs[0] != "task-orphan" {
		t.Errorf("expected orphan task task-orphan removed, got %v", docker.removedIDs)
	}
}

func TestDCMShutdownOrphanTasksCleansUpRemainingTasks(t *testing.T) {
	docker := newMockDockerClient()
	docker.containers = []ContainerInfo{
		makeDCMTaskContainer("task-1", "rt-gone"),
		makeDCMTaskContainer("task-2", "rt-gone"),
	}
	platform := &mockPlatformClient{}
	mgr := newDCMTestManager(docker, platform)

	mgr.shutdownOrphanTasks(context.Background())

	if len(docker.stoppedIDs) != 2 {
		t.Errorf("expected 2 task containers stopped, got %d", len(docker.stoppedIDs))
	}
}

func TestDCMShutdownOrphanTasksHandlesListError(t *testing.T) {
	docker := newMockDockerClient()
	docker.listErr = fmt.Errorf("docker socket closed")
	platform := &mockPlatformClient{}
	mgr := newDCMTestManager(docker, platform)

	// Should not panic; logs the error and returns gracefully.
	mgr.shutdownOrphanTasks(context.Background())

	if len(docker.stoppedIDs) != 0 {
		t.Errorf("expected no containers stopped when list fails, got %d", len(docker.stoppedIDs))
	}
}

func TestDCMShutdownRuntimesHandlesListError(t *testing.T) {
	docker := newMockDockerClient()
	docker.listErr = fmt.Errorf("docker daemon unreachable")
	platform := &mockPlatformClient{}
	mgr := newDCMTestManager(docker, platform)

	// Should not panic; logs the error and returns gracefully.
	mgr.shutdownRuntimes(context.Background())

	if len(docker.stoppedIDs) != 0 {
		t.Errorf("expected no containers stopped when list fails, got %d", len(docker.stoppedIDs))
	}
}

func TestDCMStartupSweepKeepsTasksWithLiveParent(t *testing.T) {
	docker := newMockDockerClient()
	// Task container whose parent runtime (rt-alive) is present.
	docker.containers = []ContainerInfo{
		makeDCMContainer("c-1", "tmpl-1", "runtime:v1", "rt-alive"),
		makeDCMTaskContainer("task-ok", "rt-alive"),
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
		t.Errorf("expected no containers stopped when task parent is alive, got %v", docker.stoppedIDs)
	}
}

func TestStopAndRemoveUsesBoundedDockerDeadline(t *testing.T) {
	docker := newMockDockerClient()
	docker.stopWaitForCtx = true
	mgr := newDCMTestManager(docker, &mockPlatformClient{})
	mgr.config.DockerActionBuffer = 10 * time.Millisecond

	start := time.Now()
	mgr.stopAndRemove(context.Background(), "c-1", 20*time.Millisecond)
	elapsed := time.Since(start)

	if elapsed > 500*time.Millisecond {
		t.Fatalf("expected bounded stopAndRemove to finish quickly, took %s", elapsed)
	}
	if !docker.sawStopDeadline {
		t.Fatalf("expected stopAndRemove to apply a deadline to the docker stop call")
	}
	if len(docker.removedIDs) != 1 || docker.removedIDs[0] != "c-1" {
		t.Fatalf("expected container removal after stop timeout, got %v", docker.removedIDs)
	}
}
