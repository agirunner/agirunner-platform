package manager

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestRecordFleetEventPostsToAPI(t *testing.T) {
	var receivedEvent FleetEvent
	client, capture := newTestPlatformClient(t, func(req *http.Request) (*http.Response, error) {
		if req.URL.Path != "/api/v1/fleet/events" {
			t.Errorf("expected path /api/v1/fleet/events, got %s", req.URL.Path)
		}
		if req.Method != http.MethodPost {
			t.Errorf("expected POST, got %s", req.Method)
		}
		if req.Header.Get("Content-Type") != "application/json" {
			t.Errorf("expected Content-Type application/json, got %s", req.Header.Get("Content-Type"))
		}
		if err := json.NewDecoder(req.Body).Decode(&receivedEvent); err != nil {
			t.Fatalf("decode request body: %v", err)
		}
		return jsonResponse(http.StatusCreated, `{"ok":true}`), nil
	})

	event := FleetEvent{
		EventType:   "runtime.started",
		Level:       "info",
		RuntimeID:   "rt-123",
		PlaybookID:  "tmpl-456",
		PoolKind:    "orchestrator",
		ContainerID: "container-789",
		Payload:     map[string]interface{}{"image": "agirunner:v1"},
	}

	err := client.RecordFleetEvent(event)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if capture.authorization != "Bearer test-key" {
		t.Fatalf("expected Authorization Bearer test-key, got %s", capture.authorization)
	}
	if receivedEvent.PoolKind != "orchestrator" {
		t.Errorf("expected pool_kind orchestrator, got %s", receivedEvent.PoolKind)
	}
}

func TestRecordFleetEventReturnsErrorOnHTTPFailure(t *testing.T) {
	client, _ := newTestPlatformClient(t, func(_ *http.Request) (*http.Response, error) {
		return jsonResponse(http.StatusInternalServerError, `internal error`), nil
	})

	err := client.RecordFleetEvent(FleetEvent{
		EventType: "runtime.started",
		Level:     "info",
	})
	if err == nil {
		t.Fatal("expected error on HTTP 500, got nil")
	}
}

func TestRecordFleetEventReturnsErrorOnConnectionFailure(t *testing.T) {
	client := NewPlatformClientWithHTTPClient("http://platform.example", "test-key", &http.Client{
		Transport: roundTripFunc(func(_ *http.Request) (*http.Response, error) {
			return nil, fmt.Errorf("dial failure")
		}),
	})
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
			client, _ := newTestPlatformClient(t, func(req *http.Request) (*http.Response, error) {
				_ = json.NewDecoder(req.Body).Decode(&received)
				return jsonResponse(http.StatusCreated, `{"ok":true}`), nil
			})

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
	client, _ := newTestPlatformClient(t, func(req *http.Request) (*http.Response, error) {
		_ = json.NewDecoder(req.Body).Decode(&received)
		return jsonResponse(http.StatusCreated, `{"ok":true}`), nil
	})

	err := client.RecordFleetEvent(FleetEvent{
		EventType:  "runtime.task.claimed",
		Level:      "info",
		RuntimeID:  "rt-1",
		PlaybookID: "tmpl-1",
		PoolKind:   "specialist",
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
	if received.PoolKind != "specialist" {
		t.Errorf("expected pool_kind specialist, got %s", received.PoolKind)
	}
}

func TestFetchHeartbeatsIncludesPoolKind(t *testing.T) {
	client, capture := newTestPlatformClient(t, func(req *http.Request) (*http.Response, error) {
		if req.URL.Path != "/api/v1/fleet/heartbeats" {
			t.Errorf("expected path /api/v1/fleet/heartbeats, got %s", req.URL.Path)
		}
		if req.Method != http.MethodGet {
			t.Errorf("expected GET, got %s", req.Method)
		}
		return jsonResponse(http.StatusOK, `{"data":[{"runtime_id":"rt-1","playbook_id":"pb-1","pool_kind":"orchestrator","state":"idle","last_heartbeat_at":"2026-03-12T00:00:00Z","active_task_id":"task-1"}]}`), nil
	})

	result, err := client.FetchHeartbeats()
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if capture.authorization != "Bearer test-key" {
		t.Fatalf("expected Authorization Bearer test-key, got %s", capture.authorization)
	}
	if len(result) != 1 {
		t.Fatalf("expected one heartbeat, got %d", len(result))
	}
	if result[0].PoolKind != "orchestrator" {
		t.Fatalf("expected pool_kind orchestrator, got %s", result[0].PoolKind)
	}
	if result[0].ActiveTaskID != "task-1" {
		t.Fatalf("expected active_task_id task-1, got %s", result[0].ActiveTaskID)
	}
}

func TestFetchRuntimeTargetsIncludesCapabilityDemandSummary(t *testing.T) {
	client, capture := newTestPlatformClient(t, func(req *http.Request) (*http.Response, error) {
		if req.URL.Path != "/api/v1/fleet/runtime-targets" {
			t.Errorf("expected path /api/v1/fleet/runtime-targets, got %s", req.URL.Path)
		}
		if req.Method != http.MethodGet {
			t.Errorf("expected GET, got %s", req.Method)
		}
		return jsonResponse(http.StatusOK, `{"data":[{"playbook_id":"pb-1","playbook_name":"Build","pool_kind":"specialist","pool_mode":"cold","max_runtimes":3,"priority":10,"idle_timeout_seconds":300,"grace_period_seconds":180,"image":"runtime:v1","pull_policy":"if-not-present","cpu":"1","memory":"512m","pending_tasks":4,"tasks_with_capabilities":3,"distinct_capability_sets":2,"max_required_capabilities":2,"capability_demand_units":7,"active_workflows":1}]}`), nil
	})

	result, err := client.FetchRuntimeTargets()
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if capture.authorization != "Bearer test-key" {
		t.Fatalf("expected Authorization Bearer test-key, got %s", capture.authorization)
	}
	if len(result) != 1 {
		t.Fatalf("expected one runtime target, got %d", len(result))
	}
	if result[0].CapabilityDemandUnits != 7 {
		t.Fatalf("expected capability_demand_units 7, got %d", result[0].CapabilityDemandUnits)
	}
	if result[0].TasksWithCapabilities != 3 {
		t.Fatalf("expected tasks_with_capabilities 3, got %d", result[0].TasksWithCapabilities)
	}
}

type capturedRequest struct {
	authorization string
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

func newTestPlatformClient(t *testing.T, responder func(*http.Request) (*http.Response, error)) (*PlatformClient, *capturedRequest) {
	t.Helper()

	capture := &capturedRequest{}
	httpClient := &http.Client{
		Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
			capture.authorization = req.Header.Get("Authorization")
			return responder(req)
		}),
	}
	return NewPlatformClientWithHTTPClient("http://platform.example", "test-key", httpClient), capture
}

func jsonResponse(statusCode int, body string) *http.Response {
	return &http.Response{
		StatusCode: statusCode,
		Header: http.Header{
			"Content-Type": []string{"application/json"},
		},
		Body: io.NopCloser(strings.NewReader(body)),
	}
}
