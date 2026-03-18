package manager

import (
	"bytes"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"sync"
	"time"
)

const (
	defaultFlushSize     = 50
	defaultFlushInterval = 500 * time.Millisecond
	logSource            = "container_manager"
	logActorType         = "system"
	logActorID           = "container-manager"
	logActorName         = "container-manager"
)

// logEntry represents a single structured log entry for the platform ingest API.
type logEntry struct {
	TraceID      string         `json:"trace_id"`
	SpanID       string         `json:"span_id"`
	Source       string         `json:"source"`
	Category     string         `json:"category"`
	Level        string         `json:"level"`
	Operation    string         `json:"operation"`
	Status       string         `json:"status"`
	DurationMs   *int           `json:"duration_ms,omitempty"`
	Payload      map[string]any `json:"payload,omitempty"`
	Error        *logError      `json:"error,omitempty"`
	ActorType    string         `json:"actor_type"`
	ActorID      string         `json:"actor_id"`
	ActorName    string         `json:"actor_name"`
	ResourceType string         `json:"resource_type,omitempty"`
	ResourceID   string         `json:"resource_id,omitempty"`
	ResourceName string         `json:"resource_name,omitempty"`
	TaskID       string         `json:"task_id,omitempty"`
	CreatedAt    time.Time      `json:"created_at"`
}

// logResourceInfo holds optional resource context for enriched log entries.
type logResourceInfo struct {
	ResourceType string
	ResourceID   string
	ResourceName string
	TaskID       string
}

// logError holds error details for failed operations.
type logError struct {
	Code    string `json:"code,omitempty"`
	Message string `json:"message"`
}

// logIngestPayload wraps entries for the ingest API.
type logIngestPayload struct {
	Entries []logEntry `json:"entries"`
}

// LogEmitter buffers structured log entries and flushes them to the
// platform log ingest API in batches. It is safe for concurrent use.
type LogEmitter struct {
	httpClient    *http.Client
	endpoint      string
	apiKey        string
	buffer        []logEntry
	mu            sync.Mutex
	flushSize     int
	flushInterval time.Duration
	done          chan struct{}
	wg            sync.WaitGroup
	logger        *slog.Logger
}

// NewLogEmitter creates a LogEmitter that posts batched entries to the
// given endpoint using the provided API key. A background goroutine
// flushes buffered entries on a timer.
func NewLogEmitter(endpoint, apiKey string, timeout time.Duration, logger *slog.Logger) *LogEmitter {
	e := &LogEmitter{
		httpClient: &http.Client{
			Timeout: timeout,
		},
		endpoint:      endpoint,
		apiKey:        apiKey,
		buffer:        make([]logEntry, 0, defaultFlushSize),
		flushSize:     defaultFlushSize,
		flushInterval: defaultFlushInterval,
		done:          make(chan struct{}),
		logger:        logger,
	}
	e.wg.Add(1)
	go e.flushLoop()
	return e
}

func (e *LogEmitter) SetTimeout(timeout time.Duration) {
	if e == nil {
		return
	}
	if e.httpClient == nil {
		e.httpClient = &http.Client{}
	}
	e.httpClient.Timeout = timeout
}

// Emit adds a log entry to the buffer. When the buffer reaches the
// flush size, entries are sent immediately. This method never blocks
// on HTTP — the flush happens synchronously under the lock but drops
// entries on error rather than retrying.
func (e *LogEmitter) Emit(entry logEntry) {
	e.mu.Lock()
	defer e.mu.Unlock()

	e.buffer = append(e.buffer, entry)
	if len(e.buffer) >= e.flushSize {
		e.flushLocked()
	}
}

// Close flushes remaining entries and stops the background goroutine.
func (e *LogEmitter) Close() {
	close(e.done)
	e.wg.Wait()

	e.mu.Lock()
	defer e.mu.Unlock()
	if len(e.buffer) > 0 {
		e.flushLocked()
	}
}

// flushLoop runs in a goroutine, flushing buffered entries on a timer.
func (e *LogEmitter) flushLoop() {
	defer e.wg.Done()
	ticker := time.NewTicker(e.flushInterval)
	defer ticker.Stop()

	for {
		select {
		case <-e.done:
			return
		case <-ticker.C:
			e.mu.Lock()
			if len(e.buffer) > 0 {
				e.flushLocked()
			}
			e.mu.Unlock()
		}
	}
}

// flushLocked sends all buffered entries to the ingest API.
// Must be called with e.mu held.
func (e *LogEmitter) flushLocked() {
	if len(e.buffer) == 0 {
		return
	}

	entries := e.buffer
	e.buffer = make([]logEntry, 0, e.flushSize)

	payload := logIngestPayload{Entries: entries}
	body, err := json.Marshal(payload)
	if err != nil {
		e.logger.Warn("log emitter: failed to marshal entries", "error", err, "count", len(entries))
		return
	}

	req, err := http.NewRequest(http.MethodPost, e.endpoint, bytes.NewReader(body))
	if err != nil {
		e.logger.Warn("log emitter: failed to create request", "error", err)
		return
	}
	req.Header.Set("Authorization", "Bearer "+e.apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := e.httpClient.Do(req)
	if err != nil {
		e.logger.Warn("log emitter: flush failed", "error", err, "count", len(entries))
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		e.logger.Warn("log emitter: ingest API returned error",
			"status", resp.StatusCode, "count", len(entries))
	}
}

// newUUID generates a random UUID v4 string without external dependencies.
func newUUID() string {
	var buf [16]byte
	_, _ = rand.Read(buf[:])
	buf[6] = (buf[6] & 0x0f) | 0x40 // version 4
	buf[8] = (buf[8] & 0x3f) | 0x80 // variant 10
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x",
		buf[0:4], buf[4:6], buf[6:8], buf[8:10], buf[10:16])
}

// emitOperation is a convenience for emitting a completed operation log entry.
func (e *LogEmitter) emitOperation(
	category, operation, level, status string,
	metadata map[string]any,
) {
	e.Emit(logEntry{
		TraceID:   newUUID(),
		SpanID:    newUUID(),
		Source:    logSource,
		Category:  category,
		Level:     level,
		Operation: operation,
		Status:    status,
		Payload:   metadata,
		ActorType: logActorType,
		ActorID:   logActorID,
		ActorName: logActorName,
		CreatedAt: time.Now().UTC(),
	})
}

// emitOperationWithResource emits a completed operation enriched with resource context.
func (e *LogEmitter) emitOperationWithResource(
	category, operation, level, status string,
	metadata map[string]any,
	res logResourceInfo,
) {
	e.Emit(logEntry{
		TraceID:      newUUID(),
		SpanID:       newUUID(),
		Source:       logSource,
		Category:     category,
		Level:        level,
		Operation:    operation,
		Status:       status,
		Payload:      metadata,
		ActorType:    logActorType,
		ActorID:      logActorID,
		ActorName:    logActorName,
		ResourceType: res.ResourceType,
		ResourceID:   res.ResourceID,
		ResourceName: res.ResourceName,
		TaskID:       res.TaskID,
		CreatedAt:    time.Now().UTC(),
	})
}

// emitError emits a failed operation with error details.
func (e *LogEmitter) emitError(
	category, operation string,
	metadata map[string]any,
	errMsg string,
) {
	e.Emit(logEntry{
		TraceID:   newUUID(),
		SpanID:    newUUID(),
		Source:    logSource,
		Category:  category,
		Level:     "error",
		Operation: operation,
		Status:    "failed",
		Payload:   metadata,
		Error:     &logError{Message: errMsg},
		ActorType: logActorType,
		ActorID:   logActorID,
		ActorName: logActorName,
		CreatedAt: time.Now().UTC(),
	})
}

// emitLog is a nil-safe convenience on Manager for emitting log entries.
func (m *Manager) emitLog(category, operation, level, status string, metadata map[string]any) {
	if m.logEmitter != nil {
		m.logEmitter.emitOperation(category, operation, level, status, metadata)
	}
}

// emitLogWithResource is a nil-safe convenience for emitting log entries
// enriched with resource context (resource_type, resource_id, resource_name, task_id).
func (m *Manager) emitLogWithResource(category, operation, level, status string, metadata map[string]any, res logResourceInfo) {
	if m.logEmitter != nil {
		m.logEmitter.emitOperationWithResource(category, operation, level, status, metadata, res)
	}
}

// emitLogError is a nil-safe convenience on Manager for emitting error entries.
func (m *Manager) emitLogError(category, operation string, metadata map[string]any, errMsg string) {
	if m.logEmitter != nil {
		m.logEmitter.emitError(category, operation, metadata, errMsg)
	}
}

// emitLogErrorWithResource is a nil-safe convenience for emitting error entries
// enriched with resource context.
func (m *Manager) emitLogErrorWithResource(category, operation string, metadata map[string]any, errMsg string, res logResourceInfo) {
	if m.logEmitter != nil {
		m.logEmitter.emitErrorWithResource(category, operation, metadata, errMsg, res)
	}
}

// emitLogTimed is a nil-safe convenience on Manager for emitting timed entries.
func (m *Manager) emitLogTimed(category, operation, level, status string, metadata map[string]any, durationMs int) {
	if m.logEmitter != nil {
		m.logEmitter.emitTimed(category, operation, level, status, metadata, durationMs)
	}
}

// emitErrorWithResource emits a failed operation enriched with resource context.
func (e *LogEmitter) emitErrorWithResource(
	category, operation string,
	metadata map[string]any,
	errMsg string,
	res logResourceInfo,
) {
	e.Emit(logEntry{
		TraceID:      newUUID(),
		SpanID:       newUUID(),
		Source:       logSource,
		Category:     category,
		Level:        "error",
		Operation:    operation,
		Status:       "failed",
		Payload:      metadata,
		Error:        &logError{Message: errMsg},
		ActorType:    logActorType,
		ActorID:      logActorID,
		ActorName:    logActorName,
		ResourceType: res.ResourceType,
		ResourceID:   res.ResourceID,
		ResourceName: res.ResourceName,
		TaskID:       res.TaskID,
		CreatedAt:    time.Now().UTC(),
	})
}

// emitTimed emits a completed operation with duration tracking.
func (e *LogEmitter) emitTimed(
	category, operation, level, status string,
	metadata map[string]any,
	durationMs int,
) {
	e.Emit(logEntry{
		TraceID:    newUUID(),
		SpanID:     newUUID(),
		Source:     logSource,
		Category:   category,
		Level:      level,
		Operation:  operation,
		Status:     status,
		DurationMs: &durationMs,
		Payload:    metadata,
		ActorType:  logActorType,
		ActorID:    logActorID,
		ActorName:  logActorName,
		CreatedAt:  time.Now().UTC(),
	})
}
