package manager

import (
	"context"
	"strings"
	"testing"
	"time"
)

func TestRunFailsFastWhenInitialSnapshotConfigIsInvalid(t *testing.T) {
	docker := newMockDockerClient()
	platform := &mockPlatformClient{
		snapshot: &ReconcileSnapshot{
			DesiredStates: []DesiredState{
				makeDesiredState("ds-1", "worker-a", "runtime:v1", 1, 1),
			},
			RuntimeTargets: []RuntimeTarget{
				{
					PlaybookID:         "playbook-1",
					PlaybookName:       "Build",
					PoolKind:           "specialist",
					PoolMode:           "warm",
					MaxRuntimes:        1,
					Image:              "runtime:v1",
					PullPolicy:         "if-not-present",
					CPU:                "1",
					Memory:             "512m",
					GracePeriodSeconds: 30,
					IdleTimeoutSeconds: 300,
				},
			},
			Heartbeats: []RuntimeHeartbeat{},
			ContainerManagerConfig: ContainerManagerConfig{
				PlatformAPIRequestTimeoutSeconds: 19,
				PlatformLogIngestTimeoutSeconds:  17,
				ReconcileIntervalSeconds:         0,
				StopTimeoutSeconds:               45,
				ShutdownTaskStopTimeoutSeconds:   3,
				DockerActionBufferSeconds:        20,
				LogFlushIntervalMs:               500,
				DockerEventReconnectBackoffMs:    5000,
				CrashLogCaptureTimeoutSeconds:    5,
				HungRuntimeStaleAfterSeconds:     90,
				HungRuntimeStopGracePeriodSec:    30,
				GlobalMaxRuntimes:                12,
			},
		},
	}

	manager := newTestManager(docker, platform)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)

	go func() {
		done <- manager.Run(ctx)
	}()

	var err error
	select {
	case err = <-done:
	case <-time.After(100 * time.Millisecond):
		cancel()
		t.Fatal("expected invalid initial snapshot config to fail fast")
	}

	if err == nil {
		t.Fatal("expected invalid initial snapshot config error, got nil")
	}
	if !strings.Contains(err.Error(), `container_manager.reconcile_interval_seconds`) {
		t.Fatalf("expected reconcile interval config error, got %v", err)
	}
	if len(docker.createdSpecs) != 0 {
		t.Fatalf("expected no containers created, got %d", len(docker.createdSpecs))
	}
}

func TestRunReconcileCycleSkipsInvalidSnapshotConfig(t *testing.T) {
	docker := newMockDockerClient()
	platform := &mockPlatformClient{
		snapshot: &ReconcileSnapshot{
			DesiredStates: []DesiredState{
				makeDesiredState("ds-1", "worker-a", "runtime:v1", 1, 1),
			},
			RuntimeTargets: []RuntimeTarget{
				{
					PlaybookID:         "playbook-1",
					PlaybookName:       "Build",
					PoolKind:           "specialist",
					PoolMode:           "warm",
					MaxRuntimes:        1,
					Image:              "runtime:v1",
					PullPolicy:         "if-not-present",
					CPU:                "1",
					Memory:             "512m",
					GracePeriodSeconds: 30,
					IdleTimeoutSeconds: 300,
				},
			},
			Heartbeats: []RuntimeHeartbeat{},
			ContainerManagerConfig: ContainerManagerConfig{
				PlatformAPIRequestTimeoutSeconds: 19,
				PlatformLogIngestTimeoutSeconds:  17,
				ReconcileIntervalSeconds:         7,
				StopTimeoutSeconds:               0,
				ShutdownTaskStopTimeoutSeconds:   3,
				DockerActionBufferSeconds:        20,
				LogFlushIntervalMs:               500,
				DockerEventReconnectBackoffMs:    5000,
				CrashLogCaptureTimeoutSeconds:    5,
				HungRuntimeStaleAfterSeconds:     90,
				HungRuntimeStopGracePeriodSec:    30,
				GlobalMaxRuntimes:                12,
			},
		},
	}

	manager := newTestManager(docker, platform)
	initialConfig := manager.config

	manager.runReconcileCycle(context.Background())

	if manager.config != initialConfig {
		t.Fatalf("expected invalid snapshot config to leave manager config unchanged, got %+v", manager.config)
	}
	if len(docker.createdSpecs) != 0 {
		t.Fatalf("expected invalid snapshot config to skip reconcile, created %d containers", len(docker.createdSpecs))
	}
}
