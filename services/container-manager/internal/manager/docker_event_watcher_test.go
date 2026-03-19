package manager

import (
	"bytes"
	"context"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/events"
)

// eventMockDockerClient is a mock that supports configurable Events() streams.
type eventMockDockerClient struct {
	mockDockerClient
	eventsCh    chan events.Message
	eventsErrCh chan error
	logOutput   string
	logErr      error
}

func newEventMockDocker() *eventMockDockerClient {
	return &eventMockDockerClient{
		mockDockerClient: *newMockDockerClient(),
		eventsCh:         make(chan events.Message, 100),
		eventsErrCh:      make(chan error, 1),
	}
}

func (m *eventMockDockerClient) Events(_ context.Context, _ events.ListOptions) (<-chan events.Message, <-chan error) {
	return m.eventsCh, m.eventsErrCh
}

func (m *eventMockDockerClient) ContainerLogs(_ context.Context, _ string, _ container.LogsOptions) (io.ReadCloser, error) {
	if m.logErr != nil {
		return nil, m.logErr
	}
	return io.NopCloser(strings.NewReader(m.logOutput)), nil
}

func newTestDockerEventWatcher(docker DockerClient, emitter *LogEmitter) *DockerEventWatcher {
	return NewDockerEventWatcher(docker, emitter, testLogger(), 5*time.Second, 5*time.Second)
}

func TestIsManagedContainer(t *testing.T) {
	tests := []struct {
		name     string
		attrs    map[string]string
		expected bool
	}{
		{"WDS managed", map[string]string{labelManagedBy: "true"}, true},
		{"DCM managed", map[string]string{labelDCMManaged: "true"}, true},
		{"legacy runtime managed", map[string]string{legacyRuntimeManagedLabel: "true"}, true},
		{"not managed", map[string]string{"foo": "bar"}, false},
		{"empty attrs", map[string]string{}, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isManagedContainer(tt.attrs); got != tt.expected {
				t.Errorf("isManagedContainer(%v) = %v, want %v", tt.attrs, got, tt.expected)
			}
		})
	}
}

func TestExtractResourceInfoRuntime(t *testing.T) {
	attrs := map[string]string{
		labelDCMRuntimeID:   "rt-123",
		labelDCMPlaybookID:  "tmpl-456",
		"agirunner.task_id": "task-789",
		"name":              "test-container",
	}

	res := extractResourceInfo(attrs)

	if res.ResourceType != "runtime" {
		t.Errorf("ResourceType = %q, want %q", res.ResourceType, "runtime")
	}
	if res.ResourceID != "rt-123" {
		t.Errorf("ResourceID = %q, want %q", res.ResourceID, "rt-123")
	}
	if res.TaskID != "task-789" {
		t.Errorf("TaskID = %q, want %q", res.TaskID, "task-789")
	}
}

func TestExtractResourceInfoPlaybookOnly(t *testing.T) {
	res := extractResourceInfo(map[string]string{
		labelDCMPlaybookID: "tmpl-456",
		"name":             "test-container",
	})
	if res.ResourceType != "playbook" {
		t.Errorf("ResourceType = %q, want %q", res.ResourceType, "playbook")
	}
	if res.ResourceID != "tmpl-456" {
		t.Errorf("ResourceID = %q, want %q", res.ResourceID, "tmpl-456")
	}
}

func TestExtractResourceInfoEmpty(t *testing.T) {
	res := extractResourceInfo(map[string]string{})
	if res.ResourceType != "" {
		t.Errorf("ResourceType = %q, want empty", res.ResourceType)
	}
}

func TestLevelForContainerAction(t *testing.T) {
	tests := []struct {
		name     string
		action   events.Action
		attrs    map[string]string
		expected string
	}{
		{"die exit 0", events.ActionDie, map[string]string{"exitCode": "0"}, "debug"},
		{"die exit 1", events.ActionDie, map[string]string{"exitCode": "1"}, "warn"},
		{"die exit 137 SIGKILL", events.ActionDie, map[string]string{"exitCode": "137"}, "warn"},
		{"die exit 143 SIGTERM", events.ActionDie, map[string]string{"exitCode": "143"}, "warn"},
		{"oom", events.ActionOOM, nil, "error"},
		{"kill", events.ActionKill, nil, "debug"},
		{"stop", events.ActionStop, nil, "debug"},
		{"start", events.ActionStart, nil, "debug"},
		{"restart", events.ActionRestart, nil, "debug"},
		{"create", events.ActionCreate, nil, "debug"},
		{"unhealthy", events.ActionHealthStatusUnhealthy, nil, "warn"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := levelForContainerAction(tt.action, tt.attrs); got != tt.expected {
				t.Errorf("levelForContainerAction(%q, %v) = %q, want %q", tt.action, tt.attrs, got, tt.expected)
			}
		})
	}
}

func TestReadLogLines(t *testing.T) {
	lines := readLogLines(strings.NewReader("line one\nline two\n  \nline three\n"))
	if len(lines) != 3 {
		t.Fatalf("expected 3 lines, got %d: %v", len(lines), lines)
	}
	if lines[0] != "line one" {
		t.Errorf("lines[0] = %q, want %q", lines[0], "line one")
	}
}

func TestReadLogLinesWithDockerHeader(t *testing.T) {
	var buf bytes.Buffer
	// Frame 1: stdout (type=1), size=11 "hello line\n"
	buf.Write([]byte{1, 0, 0, 0, 0, 0, 0, 11})
	buf.WriteString("hello line\n")
	// Frame 2: stderr (type=2), size=10 "error msg\n"
	buf.Write([]byte{2, 0, 0, 0, 0, 0, 0, 10})
	buf.WriteString("error msg\n")

	lines := readLogLines(&buf)
	if len(lines) != 2 {
		t.Fatalf("expected 2 lines, got %d: %v", len(lines), lines)
	}
	if lines[0] != "hello line" {
		t.Errorf("lines[0] = %q, want %q", lines[0], "hello line")
	}
	if lines[1] != "error msg" {
		t.Errorf("lines[1] = %q, want %q", lines[1], "error msg")
	}
}

func TestReadLogLinesPlainText(t *testing.T) {
	// Non-multiplexed stream (e.g. TTY mode) — first byte > 2.
	input := "plain output\nanother line\n"
	lines := readLogLines(strings.NewReader(input))
	if len(lines) != 2 {
		t.Fatalf("expected 2 lines, got %d: %v", len(lines), lines)
	}
	if lines[0] != "plain output" {
		t.Errorf("lines[0] = %q, want %q", lines[0], "plain output")
	}
}

func TestShortID(t *testing.T) {
	if got := shortID("abcdef1234567890"); got != "abcdef123456" {
		t.Errorf("shortID = %q, want %q", got, "abcdef123456")
	}
	if got := shortID("short"); got != "short" {
		t.Errorf("shortID = %q, want %q", got, "short")
	}
}

func TestWatcherFiltersUnmanagedContainers(t *testing.T) {
	emitter, getEntries := newTestEmitter(t)
	watcher := newTestDockerEventWatcher(newEventMockDocker(), emitter)

	watcher.handleEvent(context.Background(), events.Message{
		Type:   events.ContainerEventType,
		Action: events.ActionDie,
		Actor: events.Actor{
			ID:         "unmanaged-123",
			Attributes: map[string]string{"name": "random-container"},
		},
	})

	emitter.Close()
	if len(getEntries()) != 0 {
		t.Errorf("expected 0 entries for unmanaged container, got %d", len(getEntries()))
	}
}

func TestWatcherEmitsManagedContainerStarted(t *testing.T) {
	emitter, getEntries := newTestEmitter(t)
	watcher := newTestDockerEventWatcher(newEventMockDocker(), emitter)

	watcher.handleEvent(context.Background(), events.Message{
		Type:   events.ContainerEventType,
		Action: events.ActionStart,
		Actor: events.Actor{
			ID: "managed-456",
			Attributes: map[string]string{
				"name":             "test-runtime",
				"image":            "agirunner-runtime:local",
				labelDCMManaged:    "true",
				labelDCMRuntimeID:  "rt-001",
				labelDCMPlaybookID: "tmpl-001",
			},
		},
	})

	emitter.Close()
	entries := getEntries()
	if len(entries) != 1 {
		t.Fatalf("expected 1 entry, got %d", len(entries))
	}
	if entries[0].Operation != "docker.container.started" {
		t.Errorf("operation = %q, want %q", entries[0].Operation, "docker.container.started")
	}
	if entries[0].Level != "debug" {
		t.Errorf("level = %q, want %q", entries[0].Level, "debug")
	}
	if entries[0].ResourceType != "runtime" {
		t.Errorf("resource_type = %q, want %q", entries[0].ResourceType, "runtime")
	}
	if entries[0].ResourceID != "rt-001" {
		t.Errorf("resource_id = %q, want %q", entries[0].ResourceID, "rt-001")
	}
}

func TestWatcherSignalKillIsWarnNoCrashLogs(t *testing.T) {
	docker := newEventMockDocker()
	docker.logOutput = "some output\n"
	emitter, getEntries := newTestEmitter(t)
	watcher := newTestDockerEventWatcher(docker, emitter)

	// Exit 137 = SIGKILL from reconciler → warn, no crash logs
	watcher.handleEvent(context.Background(), events.Message{
		Type:   events.ContainerEventType,
		Action: events.ActionDie,
		Actor: events.Actor{
			ID: "killed-789",
			Attributes: map[string]string{
				"name":            "killed-worker",
				"image":           "agirunner-runtime:local",
				"exitCode":        "137",
				labelManagedBy:    "true",
				labelDCMRuntimeID: "rt-kill",
			},
		},
	})

	emitter.Close()
	entries := getEntries()
	if len(entries) != 1 {
		t.Fatalf("expected 1 entry (die only, no crash logs), got %d", len(entries))
	}
	if entries[0].Operation != "docker.container.died" {
		t.Errorf("operation = %q, want %q", entries[0].Operation, "docker.container.died")
	}
	if entries[0].Level != "warn" {
		t.Errorf("level = %q, want %q for exit 137", entries[0].Level, "warn")
	}
}

func TestWatcherEmitsDieWithCrashLogsOnRealCrash(t *testing.T) {
	docker := newEventMockDocker()
	docker.logOutput = "panic: nil pointer\ngoroutine 1 [running]\n"
	emitter, getEntries := newTestEmitter(t)
	watcher := newTestDockerEventWatcher(docker, emitter)

	// Exit code 1 = real crash → error level + crash logs
	watcher.handleEvent(context.Background(), events.Message{
		Type:   events.ContainerEventType,
		Action: events.ActionDie,
		Actor: events.Actor{
			ID: "crashed-real",
			Attributes: map[string]string{
				"name":            "crashed-worker",
				"image":           "agirunner-runtime:local",
				"exitCode":        "1",
				labelManagedBy:    "true",
				labelDCMRuntimeID: "rt-crash",
			},
		},
	})

	emitter.Close()
	entries := getEntries()
	if len(entries) < 2 {
		t.Fatalf("expected at least 2 entries (die + crash_logs), got %d", len(entries))
	}
	if entries[0].Level != "warn" {
		t.Errorf("level = %q, want %q for exit code 1", entries[0].Level, "warn")
	}
	if entries[1].Operation != "docker.container.crash_logs" {
		t.Errorf("expected crash_logs entry, got %q", entries[1].Operation)
	}
}

func TestWatcherCleanShutdownIsInfo(t *testing.T) {
	emitter, getEntries := newTestEmitter(t)
	watcher := newTestDockerEventWatcher(newEventMockDocker(), emitter)

	watcher.handleEvent(context.Background(), events.Message{
		Type:   events.ContainerEventType,
		Action: events.ActionDie,
		Actor: events.Actor{
			ID: "clean-stop",
			Attributes: map[string]string{
				"name":         "stopped-worker",
				"exitCode":     "0",
				labelManagedBy: "true",
			},
		},
	})

	emitter.Close()
	entries := getEntries()
	if len(entries) != 1 {
		t.Fatalf("expected 1 entry, got %d", len(entries))
	}
	if entries[0].Level != "debug" {
		t.Errorf("level = %q, want %q for clean exit", entries[0].Level, "debug")
	}
}

func TestWatcherHandlesImagePull(t *testing.T) {
	emitter, getEntries := newTestEmitter(t)
	watcher := newTestDockerEventWatcher(newEventMockDocker(), emitter)

	watcher.handleEvent(context.Background(), events.Message{
		Type:   events.ImageEventType,
		Action: events.ActionPull,
		Actor: events.Actor{
			ID:         "sha256:abc123",
			Attributes: map[string]string{"name": "agirunner-runtime:local"},
		},
	})

	emitter.Close()
	entries := getEntries()
	if len(entries) != 1 {
		t.Fatalf("expected 1 entry, got %d", len(entries))
	}
	if entries[0].Operation != "docker.image.pulled" {
		t.Errorf("operation = %q, want %q", entries[0].Operation, "docker.image.pulled")
	}
}

func TestWatcherHandlesNetworkDisconnect(t *testing.T) {
	emitter, getEntries := newTestEmitter(t)
	watcher := newTestDockerEventWatcher(newEventMockDocker(), emitter)

	watcher.handleEvent(context.Background(), events.Message{
		Type:   events.NetworkEventType,
		Action: events.ActionDisconnect,
		Actor: events.Actor{
			ID: "net-123",
			Attributes: map[string]string{
				"name":      "agirunner-internal",
				"container": "container-456",
			},
		},
	})

	emitter.Close()
	entries := getEntries()
	if len(entries) != 1 {
		t.Fatalf("expected 1 entry, got %d", len(entries))
	}
	if entries[0].Operation != "docker.network.disconnected" {
		t.Errorf("operation = %q, want %q", entries[0].Operation, "docker.network.disconnected")
	}
}

func TestWatcherIgnoresIrrelevantActions(t *testing.T) {
	emitter, getEntries := newTestEmitter(t)
	watcher := newTestDockerEventWatcher(newEventMockDocker(), emitter)

	watcher.handleEvent(context.Background(), events.Message{
		Type:   events.ContainerEventType,
		Action: events.ActionExecStart,
		Actor: events.Actor{
			ID:         "managed-123",
			Attributes: map[string]string{labelManagedBy: "true"},
		},
	})

	emitter.Close()
	if len(getEntries()) != 0 {
		t.Errorf("expected 0 entries for irrelevant action, got %d", len(getEntries()))
	}
}

func TestWatcherHealthStatusUnhealthy(t *testing.T) {
	emitter, getEntries := newTestEmitter(t)
	watcher := newTestDockerEventWatcher(newEventMockDocker(), emitter)

	watcher.handleEvent(context.Background(), events.Message{
		Type:   events.ContainerEventType,
		Action: events.ActionHealthStatusUnhealthy,
		Actor: events.Actor{
			ID: "unhealthy-123",
			Attributes: map[string]string{
				"name":          "sick-runtime",
				labelDCMManaged: "true",
			},
		},
	})

	emitter.Close()
	entries := getEntries()
	if len(entries) != 1 {
		t.Fatalf("expected 1 entry, got %d", len(entries))
	}
	if entries[0].Operation != "docker.container.unhealthy" {
		t.Errorf("operation = %q, want %q", entries[0].Operation, "docker.container.unhealthy")
	}
	if entries[0].Level != "warn" {
		t.Errorf("level = %q, want %q", entries[0].Level, "warn")
	}
}

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
