package manager

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"sync"
	"testing"
	"time"
)

func testLogger() *slog.Logger {
	return slog.New(slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError}))
}

func TestLogEmitter_BuffersUntilFlushSize(t *testing.T) {
	var mu sync.Mutex
	var received []logIngestPayload

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload logIngestPayload
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Errorf("failed to decode payload: %v", err)
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		mu.Lock()
		received = append(received, payload)
		mu.Unlock()
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	emitter := &LogEmitter{
		httpClient:    srv.Client(),
		endpoint:      srv.URL,
		apiKey:        "test-key",
		buffer:        make([]logEntry, 0, 5),
		flushSize:     5,
		flushInterval: 10 * time.Minute, // long interval so only size triggers flush
		done:          make(chan struct{}),
		logger:        testLogger(),
	}
	emitter.wg.Add(1)
	go emitter.flushLoop()

	for i := 0; i < 5; i++ {
		emitter.emitOperation("container", "container.create", "info", "completed", nil)
	}

	emitter.Close()

	mu.Lock()
	defer mu.Unlock()

	if len(received) == 0 {
		t.Fatal("expected at least one flush, got none")
	}

	totalEntries := 0
	for _, p := range received {
		totalEntries += len(p.Entries)
	}
	if totalEntries != 5 {
		t.Errorf("expected 5 entries total, got %d", totalEntries)
	}
}

func TestLogEmitter_FlushesOnTimer(t *testing.T) {
	var mu sync.Mutex
	var received []logIngestPayload

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload logIngestPayload
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		mu.Lock()
		received = append(received, payload)
		mu.Unlock()
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	emitter := &LogEmitter{
		httpClient:    srv.Client(),
		endpoint:      srv.URL,
		apiKey:        "test-key",
		buffer:        make([]logEntry, 0, 100),
		flushSize:     100, // high threshold so timer triggers first
		flushInterval: 50 * time.Millisecond,
		done:          make(chan struct{}),
		logger:        testLogger(),
	}
	emitter.wg.Add(1)
	go emitter.flushLoop()

	emitter.emitOperation("container", "container.create", "info", "completed", nil)

	// Wait for timer flush
	time.Sleep(200 * time.Millisecond)

	emitter.Close()

	mu.Lock()
	defer mu.Unlock()

	if len(received) == 0 {
		t.Fatal("expected timer-based flush, got none")
	}
	if len(received[0].Entries) != 1 {
		t.Errorf("expected 1 entry in first flush, got %d", len(received[0].Entries))
	}
}

func TestLogEmitter_CloseFlushesRemaining(t *testing.T) {
	var mu sync.Mutex
	var received []logIngestPayload

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload logIngestPayload
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		mu.Lock()
		received = append(received, payload)
		mu.Unlock()
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	emitter := &LogEmitter{
		httpClient:    srv.Client(),
		endpoint:      srv.URL,
		apiKey:        "test-key",
		buffer:        make([]logEntry, 0, 100),
		flushSize:     100,
		flushInterval: 10 * time.Minute,
		done:          make(chan struct{}),
		logger:        testLogger(),
	}
	emitter.wg.Add(1)
	go emitter.flushLoop()

	emitter.emitOperation("container", "container.create", "info", "completed", nil)
	emitter.emitOperation("container", "container.destroy", "info", "completed", nil)

	emitter.Close()

	mu.Lock()
	defer mu.Unlock()

	totalEntries := 0
	for _, p := range received {
		totalEntries += len(p.Entries)
	}
	if totalEntries != 2 {
		t.Errorf("expected 2 entries flushed on close, got %d", totalEntries)
	}
}

func TestLogEmitter_DropsOnHTTPError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	emitter := &LogEmitter{
		httpClient:    srv.Client(),
		endpoint:      srv.URL,
		apiKey:        "test-key",
		buffer:        make([]logEntry, 0, 2),
		flushSize:     2,
		flushInterval: 10 * time.Minute,
		done:          make(chan struct{}),
		logger:        testLogger(),
	}
	emitter.wg.Add(1)
	go emitter.flushLoop()

	// Emit enough to trigger flush — should not panic or block
	emitter.emitOperation("container", "container.create", "info", "completed", nil)
	emitter.emitOperation("container", "container.create", "info", "completed", nil)

	emitter.Close()

	// Buffer should be empty (entries dropped, not re-queued)
	if len(emitter.buffer) != 0 {
		t.Errorf("expected empty buffer after failed flush, got %d entries", len(emitter.buffer))
	}
}

func TestLogEmitter_SetsAuthHeader(t *testing.T) {
	var authHeader string

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authHeader = r.Header.Get("Authorization")
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	emitter := &LogEmitter{
		httpClient:    srv.Client(),
		endpoint:      srv.URL,
		apiKey:        "my-secret-key",
		buffer:        make([]logEntry, 0, 1),
		flushSize:     1,
		flushInterval: 10 * time.Minute,
		done:          make(chan struct{}),
		logger:        testLogger(),
	}
	emitter.wg.Add(1)
	go emitter.flushLoop()

	emitter.emitOperation("container", "container.create", "info", "completed", nil)
	emitter.Close()

	expected := "Bearer my-secret-key"
	if authHeader != expected {
		t.Errorf("expected auth header %q, got %q", expected, authHeader)
	}
}

func TestLogEmitter_EntryFieldsPopulated(t *testing.T) {
	var received logIngestPayload

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&received)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	emitter := &LogEmitter{
		httpClient:    srv.Client(),
		endpoint:      srv.URL,
		apiKey:        "test-key",
		buffer:        make([]logEntry, 0, 1),
		flushSize:     1,
		flushInterval: 10 * time.Minute,
		done:          make(chan struct{}),
		logger:        testLogger(),
	}
	emitter.wg.Add(1)
	go emitter.flushLoop()

	meta := map[string]any{"playbook_id": "tmpl-1", "runtime_id": "rt-1"}
	emitter.emitOperation("container", "container.create", "info", "completed", meta)
	emitter.Close()

	if len(received.Entries) != 1 {
		t.Fatalf("expected 1 entry, got %d", len(received.Entries))
	}
	entry := received.Entries[0]

	if entry.Source != "container_manager" {
		t.Errorf("expected source container_manager, got %s", entry.Source)
	}
	if entry.Category != "container" {
		t.Errorf("expected category container, got %s", entry.Category)
	}
	if entry.Operation != "container.create" {
		t.Errorf("expected operation container.create, got %s", entry.Operation)
	}
	if entry.Level != "info" {
		t.Errorf("expected level info, got %s", entry.Level)
	}
	if entry.Status != "completed" {
		t.Errorf("expected status completed, got %s", entry.Status)
	}
	if entry.ActorType != "system" {
		t.Errorf("expected actor_type system, got %s", entry.ActorType)
	}
	if entry.ActorID != "container-manager" {
		t.Errorf("expected actor_id container-manager, got %s", entry.ActorID)
	}
	if entry.TraceID == "" {
		t.Error("expected non-empty trace_id")
	}
	if entry.SpanID == "" {
		t.Error("expected non-empty span_id")
	}
	if entry.CreatedAt.IsZero() {
		t.Error("expected non-zero created_at")
	}
	if entry.Payload["playbook_id"] != "tmpl-1" {
		t.Errorf("expected metadata playbook_id=tmpl-1, got %v", entry.Payload["playbook_id"])
	}
}

func TestLogEmitter_EmitError_IncludesErrorField(t *testing.T) {
	var received logIngestPayload

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&received)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	emitter := &LogEmitter{
		httpClient:    srv.Client(),
		endpoint:      srv.URL,
		apiKey:        "test-key",
		buffer:        make([]logEntry, 0, 1),
		flushSize:     1,
		flushInterval: 10 * time.Minute,
		done:          make(chan struct{}),
		logger:        testLogger(),
	}
	emitter.wg.Add(1)
	go emitter.flushLoop()

	emitter.emitError("container", "container.image_pull", nil, "pull timed out")
	emitter.Close()

	if len(received.Entries) != 1 {
		t.Fatalf("expected 1 entry, got %d", len(received.Entries))
	}
	entry := received.Entries[0]
	if entry.Level != "error" {
		t.Errorf("expected level error, got %s", entry.Level)
	}
	if entry.Status != "failed" {
		t.Errorf("expected status failed, got %s", entry.Status)
	}
	if entry.Error == nil {
		t.Fatal("expected error field to be set")
	}
	if entry.Error.Message != "pull timed out" {
		t.Errorf("expected error message 'pull timed out', got %q", entry.Error.Message)
	}
}

func TestLogEmitter_EmitTimed_IncludesDuration(t *testing.T) {
	var received logIngestPayload

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&received)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	emitter := &LogEmitter{
		httpClient:    srv.Client(),
		endpoint:      srv.URL,
		apiKey:        "test-key",
		buffer:        make([]logEntry, 0, 1),
		flushSize:     1,
		flushInterval: 10 * time.Minute,
		done:          make(chan struct{}),
		logger:        testLogger(),
	}
	emitter.wg.Add(1)
	go emitter.flushLoop()

	emitter.emitTimed("container", "container.image_pull", "info", "completed", nil, 1234)
	emitter.Close()

	if len(received.Entries) != 1 {
		t.Fatalf("expected 1 entry, got %d", len(received.Entries))
	}
	entry := received.Entries[0]
	if entry.DurationMs == nil {
		t.Fatal("expected duration_ms to be set")
	}
	if *entry.DurationMs != 1234 {
		t.Errorf("expected duration_ms 1234, got %d", *entry.DurationMs)
	}
}

func TestNewUUID_ProducesValidFormat(t *testing.T) {
	id := newUUID()
	if len(id) != 36 {
		t.Errorf("expected UUID length 36, got %d: %s", len(id), id)
	}
	if id[8] != '-' || id[13] != '-' || id[18] != '-' || id[23] != '-' {
		t.Errorf("expected dashes at positions 8,13,18,23, got %s", id)
	}
}

func TestLogEmitter_ConcurrentEmitSafe(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	emitter := &LogEmitter{
		httpClient:    srv.Client(),
		endpoint:      srv.URL,
		apiKey:        "test-key",
		buffer:        make([]logEntry, 0, 10),
		flushSize:     10,
		flushInterval: 50 * time.Millisecond,
		done:          make(chan struct{}),
		logger:        testLogger(),
	}
	emitter.wg.Add(1)
	go emitter.flushLoop()

	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			emitter.emitOperation("container", "container.create", "info", "completed", nil)
		}()
	}
	wg.Wait()
	emitter.Close()
}

func TestLogEmitter_DropsOnConnectionError(t *testing.T) {
	emitter := &LogEmitter{
		httpClient:    &http.Client{Timeout: 100 * time.Millisecond},
		endpoint:      "http://127.0.0.1:1", // nothing listening
		apiKey:        "test-key",
		buffer:        make([]logEntry, 0, 1),
		flushSize:     1,
		flushInterval: 10 * time.Minute,
		done:          make(chan struct{}),
		logger:        testLogger(),
	}
	emitter.wg.Add(1)
	go emitter.flushLoop()

	emitter.emitOperation("container", "container.create", "info", "completed", nil)
	emitter.Close()

	// Should not panic or hang — entries dropped gracefully
	if len(emitter.buffer) != 0 {
		t.Errorf("expected empty buffer after failed flush, got %d", len(emitter.buffer))
	}
}

// newTestEmitter creates a LogEmitter backed by an httptest server that
// collects received entries. Returns the emitter and a function to retrieve
// all entries received so far (thread-safe).
func newTestEmitter(t *testing.T) (*LogEmitter, func() []logEntry) {
	t.Helper()
	var mu sync.Mutex
	var entries []logEntry

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload logIngestPayload
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		mu.Lock()
		entries = append(entries, payload.Entries...)
		mu.Unlock()
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(srv.Close)

	emitter := &LogEmitter{
		httpClient:    srv.Client(),
		endpoint:      srv.URL,
		apiKey:        "test-key",
		buffer:        make([]logEntry, 0, 100),
		flushSize:     100,
		flushInterval: 10 * time.Minute,
		done:          make(chan struct{}),
		logger:        testLogger(),
	}
	emitter.wg.Add(1)
	go emitter.flushLoop()

	return emitter, func() []logEntry {
		mu.Lock()
		defer mu.Unlock()
		out := make([]logEntry, len(entries))
		copy(out, entries)
		return out
	}
}

func TestManager_EmitLog_NilEmitterSafe(t *testing.T) {
	docker := newMockDockerClient()
	platform := &mockPlatformClient{}
	mgr := newTestManager(docker, platform)
	// logEmitter is nil in test manager — should not panic
	mgr.emitLog("container", "container.create", "info", "completed", nil)
	mgr.emitLogError("container", "container.create", nil, "boom")
	mgr.emitLogTimed("container", "container.create", "info", "completed", nil, 100)
}

func TestReconcile_ContainerCreate_EmitsLog(t *testing.T) {
	emitter, getEntries := newTestEmitter(t)
	docker := newMockDockerClient()
	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{
			makeRuntimeTarget("tmpl-1", "runtime:v1", 3, 2, 10),
		},
	}
	mgr := newDCMTestManager(docker, platform)
	mgr.logEmitter = emitter

	mgr.createRuntimeContainers(context.Background(), platform.runtimeTargets[0], 1)
	emitter.Close()

	entries := getEntries()
	found := false
	for _, e := range entries {
		if e.Operation == "container.create" && e.Status == "completed" {
			found = true
			if e.Payload["playbook_id"] != "tmpl-1" {
				t.Errorf("expected playbook_id tmpl-1, got %v", e.Payload["playbook_id"])
			}
			break
		}
	}
	if !found {
		t.Error("expected container.create log entry emitted")
	}
}

func TestReconcile_ContainerDestroy_EmitsLog(t *testing.T) {
	emitter, getEntries := newTestEmitter(t)
	docker := newMockDockerClient()
	containers := []ContainerInfo{
		makeDCMContainer("c-1", "tmpl-1", "runtime:v1", "rt-1"),
	}
	platform := &mockPlatformClient{}
	mgr := newDCMTestManager(docker, platform)
	mgr.logEmitter = emitter

	mgr.destroyContainers(context.Background(), containers, 10)
	emitter.Close()

	entries := getEntries()
	found := false
	for _, e := range entries {
		if e.Operation == "container.destroy" && e.Status == "completed" {
			found = true
			if e.Payload["container_id"] != "c-1" {
				t.Errorf("expected container_id c-1, got %v", e.Payload["container_id"])
			}
			break
		}
	}
	if !found {
		t.Error("expected container.destroy log entry emitted")
	}
}

func TestReconcile_OrphanCleanup_EmitsLog(t *testing.T) {
	emitter, getEntries := newTestEmitter(t)
	docker := newMockDockerClient()
	runtime := makeDCMContainer("c-runtime", "tmpl-1", "runtime:v1", "rt-1")
	task := makeDCMTaskContainer("c-task", "rt-gone")
	task.Labels[labelDCMPlaybookID] = "tmpl-1"
	docker.containers = []ContainerInfo{runtime, task}
	platform := &mockPlatformClient{}
	mgr := newDCMTestManager(docker, platform)
	mgr.logEmitter = emitter

	mgr.cleanupOrphanTaskContainers(context.Background())
	emitter.Close()

	entries := getEntries()
	found := false
	for _, e := range entries {
		if e.Operation == "container.orphan_cleanup" {
			found = true
			break
		}
	}
	if !found {
		t.Error("expected container.orphan_cleanup log entry emitted")
	}
}

func TestReconcile_HungDetected_EmitsLog(t *testing.T) {
	emitter, getEntries := newTestEmitter(t)
	docker := newMockDockerClient()
	docker.containers = []ContainerInfo{
		makeDCMContainer("c-1", "tmpl-1", "runtime:v1", "rt-1"),
	}
	staleTime := time.Now().UTC().Add(-2 * time.Minute).Format(time.RFC3339)
	platform := &mockPlatformClient{
		heartbeats: []RuntimeHeartbeat{
			{RuntimeID: "rt-1", PlaybookID: "tmpl-1", State: "idle", LastHeartbeatAt: staleTime},
		},
	}
	mgr := newDCMTestManager(docker, platform)
	mgr.logEmitter = emitter

	mgr.detectHungRuntimes(context.Background())
	emitter.Close()

	entries := getEntries()
	found := false
	for _, e := range entries {
		if e.Operation == "container.hung_detected" && e.Level == "warn" {
			found = true
			if e.Payload["runtime_id"] != "rt-1" {
				t.Errorf("expected runtime_id rt-1, got %v", e.Payload["runtime_id"])
			}
			break
		}
	}
	if !found {
		t.Error("expected container.hung_detected log entry emitted")
	}
}

func TestReconcile_ImagePull_EmitsLog(t *testing.T) {
	emitter, getEntries := newTestEmitter(t)
	docker := newMockDockerClient()
	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{
			makeRuntimeTarget("tmpl-1", "runtime:v1", 3, 1, 10),
		},
	}
	mgr := newDCMTestManager(docker, platform)
	mgr.logEmitter = emitter

	mgr.createRuntimeContainers(context.Background(), platform.runtimeTargets[0], 1)
	emitter.Close()

	entries := getEntries()
	startedFound := false
	completedFound := false
	for _, e := range entries {
		if e.Operation == "container.image_pull" && e.Status == "started" {
			startedFound = true
		}
		if e.Operation == "container.image_pull" && e.Status == "completed" {
			completedFound = true
			if e.DurationMs == nil {
				t.Error("expected duration_ms set on image pull completed")
			}
		}
	}
	if !startedFound {
		t.Error("expected container.image_pull started entry")
	}
	if !completedFound {
		t.Error("expected container.image_pull completed entry")
	}
}

func TestReconcile_DrainRuntime_EmitsLog(t *testing.T) {
	emitter, getEntries := newTestEmitter(t)
	docker := newMockDockerClient()
	platform := &mockPlatformClient{}
	mgr := newDCMTestManager(docker, platform)
	mgr.logEmitter = emitter

	c := makeDCMContainer("c-1", "tmpl-1", "runtime:v1", "rt-1")
	mgr.drainExecutingRuntime(context.Background(), c, "rt-1", "tmpl-1")
	emitter.Close()

	entries := getEntries()
	found := false
	for _, e := range entries {
		if e.Operation == "reconcile.drain" && e.Status == "completed" {
			found = true
			if e.Payload["runtime_id"] != "rt-1" {
				t.Errorf("expected runtime_id rt-1, got %v", e.Payload["runtime_id"])
			}
			if e.Payload["playbook_id"] != "tmpl-1" {
				t.Errorf("expected playbook_id tmpl-1, got %v", e.Payload["playbook_id"])
			}
			break
		}
	}
	if !found {
		t.Error("expected reconcile.drain log entry emitted")
	}
}

func TestLifecycle_StartupSweep_EmitsLog(t *testing.T) {
	emitter, getEntries := newTestEmitter(t)
	docker := newMockDockerClient()
	// One runtime with matching target, one without
	docker.containers = []ContainerInfo{
		makeDCMContainer("c-keep", "tmpl-1", "runtime:v1", "rt-1"),
		makeDCMContainer("c-remove", "tmpl-gone", "runtime:v1", "rt-2"),
	}
	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{
			makeRuntimeTarget("tmpl-1", "runtime:v1", 3, 0, 10),
		},
	}
	mgr := newDCMTestManager(docker, platform)
	mgr.logEmitter = emitter

	_ = mgr.startupSweep(context.Background())
	emitter.Close()

	entries := getEntries()
	sweepFound := false
	removeFound := false
	for _, e := range entries {
		if e.Operation == "lifecycle.startup_sweep" && e.Status == "completed" {
			sweepFound = true
			if e.Payload["adopted"] != float64(1) {
				t.Errorf("expected 1 adopted, got %v", e.Payload["adopted"])
			}
			if e.Payload["removed"] != float64(1) {
				t.Errorf("expected 1 removed, got %v", e.Payload["removed"])
			}
		}
		if e.Operation == "lifecycle.startup_remove" {
			removeFound = true
		}
	}
	if !sweepFound {
		t.Error("expected lifecycle.startup_sweep log entry emitted")
	}
	if !removeFound {
		t.Error("expected lifecycle.startup_remove log entry emitted")
	}
}

func TestLifecycle_Shutdown_EmitsLog(t *testing.T) {
	emitter, getEntries := newTestEmitter(t)
	docker := newMockDockerClient()
	docker.containers = []ContainerInfo{
		makeDCMContainer("c-1", "tmpl-1", "runtime:v1", "rt-1"),
	}
	platform := &mockPlatformClient{}
	mgr := newDCMTestManager(docker, platform)
	mgr.logEmitter = emitter

	mgr.shutdownCascade()
	emitter.Close()

	entries := getEntries()
	startedFound := false
	completedFound := false
	for _, e := range entries {
		if e.Operation == "lifecycle.shutdown" && e.Status == "started" {
			startedFound = true
		}
		if e.Operation == "lifecycle.shutdown" && e.Status == "completed" {
			completedFound = true
			if e.DurationMs == nil {
				t.Error("expected duration_ms on shutdown completed")
			}
		}
	}
	if !startedFound {
		t.Error("expected lifecycle.shutdown started entry")
	}
	if !completedFound {
		t.Error("expected lifecycle.shutdown completed entry")
	}
}

func TestReconcile_WDS_Create_EmitsLog(t *testing.T) {
	emitter, getEntries := newTestEmitter(t)
	docker := newMockDockerClient()
	platform := &mockPlatformClient{
		desiredStates: []DesiredState{
			{ID: "ds-1", WorkerName: "worker-1", RuntimeImage: "img:v1", Replicas: 1},
		},
	}
	mgr := newTestManager(docker, platform)
	mgr.logEmitter = emitter

	_ = mgr.reconcileOnce(context.Background())
	emitter.Close()

	entries := getEntries()
	found := false
	for _, e := range entries {
		if e.Operation == "container.wds_create" && e.Status == "completed" {
			found = true
			if e.Payload["worker"] != "worker-1" {
				t.Errorf("expected worker worker-1, got %v", e.Payload["worker"])
			}
		}
	}
	if !found {
		t.Error("expected container.wds_create log entry emitted")
	}
}

func TestReconcile_WDS_Drain_EmitsLog(t *testing.T) {
	emitter, getEntries := newTestEmitter(t)
	docker := newMockDockerClient()
	docker.containers = []ContainerInfo{
		{
			ID: "c-drain", Name: "worker-1-0", Image: "img:v1", Status: "Up",
			Labels: map[string]string{labelManagedBy: "true", labelDesiredStateID: "ds-1"},
		},
	}
	platform := &mockPlatformClient{
		desiredStates: []DesiredState{
			{ID: "ds-1", WorkerName: "worker-1", RuntimeImage: "img:v1", Draining: true},
		},
	}
	mgr := newTestManager(docker, platform)
	mgr.logEmitter = emitter

	_ = mgr.reconcileOnce(context.Background())
	emitter.Close()

	entries := getEntries()
	found := false
	for _, e := range entries {
		if e.Operation == "container.wds_drain" && e.Status == "completed" {
			found = true
		}
	}
	if !found {
		t.Error("expected container.wds_drain log entry emitted")
	}
}

func TestReconcile_OrphanHeartbeat_EmitsLog(t *testing.T) {
	emitter, getEntries := newTestEmitter(t)
	docker := newMockDockerClient()
	// No containers — heartbeat is orphaned
	staleTime := time.Now().UTC().Add(-2 * time.Minute).Format(time.RFC3339)
	platform := &mockPlatformClient{
		heartbeats: []RuntimeHeartbeat{
			{RuntimeID: "rt-gone", PlaybookID: "tmpl-1", State: "executing",
				LastHeartbeatAt: staleTime, ActiveTaskID: "task-1"},
		},
	}
	mgr := newDCMTestManager(docker, platform)
	mgr.logEmitter = emitter

	mgr.detectHungRuntimes(context.Background())
	emitter.Close()

	entries := getEntries()
	found := false
	for _, e := range entries {
		if e.Operation == "container.orphan_heartbeat" && e.Status == "completed" {
			found = true
			if e.Payload["runtime_id"] != "rt-gone" {
				t.Errorf("expected runtime_id rt-gone, got %v", e.Payload["runtime_id"])
			}
		}
	}
	if !found {
		t.Error("expected container.orphan_heartbeat log entry emitted")
	}
}
