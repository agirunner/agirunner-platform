package manager

import (
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
