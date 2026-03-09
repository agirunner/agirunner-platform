package manager

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRecordFleetEventPostsToAPI(t *testing.T) {
	var receivedEvent FleetEvent
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/fleet/events" {
			t.Errorf("expected path /api/v1/fleet/events, got %s", r.URL.Path)
		}
		if r.Method != http.MethodPost {
			t.Errorf("expected POST, got %s", r.Method)
		}
		if r.Header.Get("Content-Type") != "application/json" {
			t.Errorf("expected Content-Type application/json, got %s", r.Header.Get("Content-Type"))
		}
		if r.Header.Get("Authorization") != "Bearer test-key" {
			t.Errorf("expected Authorization Bearer test-key, got %s", r.Header.Get("Authorization"))
		}

		if err := json.NewDecoder(r.Body).Decode(&receivedEvent); err != nil {
			t.Fatalf("decode request body: %v", err)
		}
		w.WriteHeader(http.StatusCreated)
	}))
	defer server.Close()

	client := NewPlatformClient(server.URL, "test-key")
	event := FleetEvent{
		EventType:   "runtime.started",
		Level:       "info",
		RuntimeID:   "rt-123",
		TemplateID:  "tmpl-456",
		ContainerID: "container-789",
		Payload:     map[string]interface{}{"image": "agirunner:v1"},
	}

	err := client.RecordFleetEvent(event)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	if receivedEvent.EventType != "runtime.started" {
		t.Errorf("expected event_type runtime.started, got %s", receivedEvent.EventType)
	}
	if receivedEvent.Level != "info" {
		t.Errorf("expected level info, got %s", receivedEvent.Level)
	}
	if receivedEvent.RuntimeID != "rt-123" {
		t.Errorf("expected runtime_id rt-123, got %s", receivedEvent.RuntimeID)
	}
	if receivedEvent.TemplateID != "tmpl-456" {
		t.Errorf("expected template_id tmpl-456, got %s", receivedEvent.TemplateID)
	}
	if receivedEvent.ContainerID != "container-789" {
		t.Errorf("expected container_id container-789, got %s", receivedEvent.ContainerID)
	}
}

func TestRecordFleetEventReturnsErrorOnHTTPFailure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte("internal error"))
	}))
	defer server.Close()

	client := NewPlatformClient(server.URL, "test-key")
	err := client.RecordFleetEvent(FleetEvent{
		EventType: "runtime.started",
		Level:     "info",
	})

	if err == nil {
		t.Fatal("expected error on HTTP 500, got nil")
	}
}

func TestRecordFleetEventReturnsErrorOnConnectionFailure(t *testing.T) {
	client := NewPlatformClient("http://localhost:1", "test-key")
	err := client.RecordFleetEvent(FleetEvent{
		EventType: "runtime.started",
		Level:     "info",
	})

	if err == nil {
		t.Fatal("expected error on connection failure, got nil")
	}
}

func TestRecordFleetEventSendsAllEventTypes(t *testing.T) {
	eventTypes := []struct {
		eventType string
		level     string
	}{
		{"runtime.started", "info"},
		{"runtime.task.claimed", "info"},
		{"runtime.task.completed", "info"},
		{"runtime.task.failed", "error"},
		{"runtime.idle", "debug"},
		{"runtime.draining", "info"},
		{"runtime.shutdown", "info"},
		{"runtime.hung_detected", "warn"},
		{"container.created", "info"},
		{"container.destroyed", "info"},
		{"orphan.cleaned", "warn"},
	}

	for _, tt := range eventTypes {
		t.Run(tt.eventType, func(t *testing.T) {
			var received FleetEvent
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				_ = json.NewDecoder(r.Body).Decode(&received)
				w.WriteHeader(http.StatusCreated)
			}))
			defer server.Close()

			client := NewPlatformClient(server.URL, "key")
			err := client.RecordFleetEvent(FleetEvent{
				EventType: tt.eventType,
				Level:     tt.level,
			})

			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if received.EventType != tt.eventType {
				t.Errorf("expected event_type %s, got %s", tt.eventType, received.EventType)
			}
			if received.Level != tt.level {
				t.Errorf("expected level %s, got %s", tt.level, received.Level)
			}
		})
	}
}

func TestRecordFleetEventSendsOptionalFields(t *testing.T) {
	var received FleetEvent
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&received)
		w.WriteHeader(http.StatusCreated)
	}))
	defer server.Close()

	client := NewPlatformClient(server.URL, "key")
	err := client.RecordFleetEvent(FleetEvent{
		EventType:  "runtime.task.claimed",
		Level:      "info",
		RuntimeID:  "rt-1",
		TemplateID: "tmpl-1",
		TaskID:     "task-1",
		WorkflowID: "wf-1",
	})

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if received.TaskID != "task-1" {
		t.Errorf("expected task_id task-1, got %s", received.TaskID)
	}
	if received.WorkflowID != "wf-1" {
		t.Errorf("expected workflow_id wf-1, got %s", received.WorkflowID)
	}
}
