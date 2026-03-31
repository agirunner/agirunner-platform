package manager

import (
	"context"
	"github.com/docker/docker/api/types/events"
	"io"
	"testing"
	"time"
)

func TestFormatEventSummary(t *testing.T) {
	msg := events.Message{
		Type:   events.ContainerEventType,
		Action: events.ActionDie,
		Actor: events.Actor{
			ID:         "abc123456789def",
			Attributes: map[string]string{"name": "test-worker"},
		},
	}
	if got := formatEventSummary(msg); got != "container die test-worker" {
		t.Errorf("formatEventSummary = %q, want %q", got, "container die test-worker")
	}
}

func TestFormatEventSummaryNoName(t *testing.T) {
	msg := events.Message{
		Type:   events.ContainerEventType,
		Action: events.ActionStart,
		Actor: events.Actor{
			ID:         "abc123456789def",
			Attributes: map[string]string{},
		},
	}
	if got := formatEventSummary(msg); got != "container start abc123456789" {
		t.Errorf("formatEventSummary = %q, want %q", got, "container start abc123456789")
	}
}

func TestWatchOnceReturnsOnStreamClose(t *testing.T) {
	docker := newEventMockDocker()
	emitter, _ := newTestEmitter(t)
	watcher := newTestDockerEventWatcher(docker, emitter)

	close(docker.eventsCh)
	watcher.watchOnce(context.Background())
	emitter.Close()
}

func TestWatchOnceReturnsOnError(t *testing.T) {
	docker := newEventMockDocker()
	emitter, _ := newTestEmitter(t)
	watcher := newTestDockerEventWatcher(docker, emitter)

	docker.eventsErrCh <- io.ErrUnexpectedEOF

	done := make(chan struct{})
	go func() {
		watcher.watchOnce(context.Background())
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("watchOnce did not return on error")
	}
	emitter.Close()
}

func TestWatcherOOMEvent(t *testing.T) {
	emitter, getEntries := newTestEmitter(t)
	watcher := newTestDockerEventWatcher(newEventMockDocker(), emitter)

	watcher.handleEvent(context.Background(), events.Message{
		Type:   events.ContainerEventType,
		Action: events.ActionOOM,
		Actor: events.Actor{
			ID: "oom-container",
			Attributes: map[string]string{
				"name":            "oom-worker",
				labelManagedBy:    "true",
				labelDCMRuntimeID: "rt-oom",
			},
		},
	})

	emitter.Close()
	entries := getEntries()
	if len(entries) != 1 {
		t.Fatalf("expected 1 entry, got %d", len(entries))
	}
	if entries[0].Operation != "docker.container.oom_killed" {
		t.Errorf("operation = %q, want %q", entries[0].Operation, "docker.container.oom_killed")
	}
	if entries[0].Level != "error" {
		t.Errorf("level = %q, want %q", entries[0].Level, "error")
	}
}

func TestWatcherKillEventWithSignal(t *testing.T) {
	emitter, getEntries := newTestEmitter(t)
	watcher := newTestDockerEventWatcher(newEventMockDocker(), emitter)

	watcher.handleEvent(context.Background(), events.Message{
		Type:   events.ContainerEventType,
		Action: events.ActionKill,
		Actor: events.Actor{
			ID: "killed-container",
			Attributes: map[string]string{
				"name":         "killed-worker",
				"signal":       "SIGKILL",
				labelManagedBy: "true",
			},
		},
	})

	emitter.Close()
	entries := getEntries()
	if len(entries) != 1 {
		t.Fatalf("expected 1 entry, got %d", len(entries))
	}
	if entries[0].Payload["signal"] != "SIGKILL" {
		t.Errorf("signal = %v, want SIGKILL", entries[0].Payload["signal"])
	}
}

func TestWatcherAppliesUpdatedTimeoutConfig(t *testing.T) {
	watcher := newTestDockerEventWatcher(newEventMockDocker(), nil)

	watcher.SetReconnectBackoff(3 * time.Second)
	watcher.SetCrashLogCaptureTimeout(9 * time.Second)

	if watcher.currentReconnectBackoff() != 3*time.Second {
		t.Fatalf("expected reconnect backoff 3s, got %s", watcher.currentReconnectBackoff())
	}
	if watcher.currentCrashLogCaptureTimeout() != 9*time.Second {
		t.Fatalf("expected crash log capture timeout 9s, got %s", watcher.currentCrashLogCaptureTimeout())
	}
}

func TestWatcherSettersIgnoreNilReceiver(t *testing.T) {
	var watcher *DockerEventWatcher

	watcher.SetReconnectBackoff(3 * time.Second)
	watcher.SetCrashLogCaptureTimeout(9 * time.Second)
}
