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

func TestGetTaskStateReturnsTaskState(t *testing.T) {
	client, capture := newTestPlatformClient(t, func(req *http.Request) (*http.Response, error) {
		if req.URL.Path != "/api/v1/tasks/task-1" {
			t.Errorf("expected path /api/v1/tasks/task-1, got %s", req.URL.Path)
		}
		if req.Method != http.MethodGet {
			t.Errorf("expected GET, got %s", req.Method)
		}
		return jsonResponse(http.StatusOK, `{"data":{"id":"task-1","state":"completed"}}`), nil
	})

	state, err := client.GetTaskState("task-1")
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if capture.authorization != "Bearer test-key" {
		t.Fatalf("expected Authorization Bearer test-key, got %s", capture.authorization)
	}
	if state != "completed" {
		t.Fatalf("expected completed state, got %s", state)
	}
}

func TestFetchRuntimeTargetsReturnsRoutingTags(t *testing.T) {
	client, capture := newTestPlatformClient(t, func(req *http.Request) (*http.Response, error) {
		if req.URL.Path != "/api/v1/fleet/runtime-targets" {
			t.Errorf("expected path /api/v1/fleet/runtime-targets, got %s", req.URL.Path)
		}
		if req.Method != http.MethodGet {
			t.Errorf("expected GET, got %s", req.Method)
		}
		return jsonResponse(http.StatusOK, `{"data":[{"playbook_id":"pb-1","playbook_name":"Build","pool_kind":"specialist","routing_tags":["role:developer","role:reviewer"],"pool_mode":"cold","max_runtimes":3,"priority":10,"idle_timeout_seconds":300,"grace_period_seconds":180,"image":"runtime:v1","pull_policy":"if-not-present","cpu":"1","memory":"512m","pending_tasks":4,"active_workflows":1}]}`), nil
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
	if got := result[0].RoutingTags; len(got) != 2 || got[0] != "role:developer" || got[1] != "role:reviewer" {
		t.Fatalf("expected routing tags [role:developer role:reviewer], got %#v", got)
	}
}

func TestFetchDesiredStateRequestsEnabledWorkersOnly(t *testing.T) {
	client, capture := newTestPlatformClient(t, func(req *http.Request) (*http.Response, error) {
		if req.URL.Path != "/api/v1/fleet/workers" {
			t.Errorf("expected path /api/v1/fleet/workers, got %s", req.URL.Path)
		}
		if req.URL.RawQuery != "enabled=true" {
			t.Errorf("expected enabled=true query, got %s", req.URL.RawQuery)
		}
		return jsonResponse(http.StatusOK, `{"data":[{"id":"worker-1","enabled":true}]}`), nil
	})

	result, err := client.FetchDesiredState()
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if capture.authorization != "Bearer test-key" {
		t.Fatalf("expected Authorization Bearer test-key, got %s", capture.authorization)
	}
	if len(result) != 1 {
		t.Fatalf("expected one worker, got %d", len(result))
	}
	if !result[0].Enabled {
		t.Fatal("expected enabled worker in response")
	}
}

func TestFetchReconcileSnapshotUsesSharedFleetEndpoint(t *testing.T) {
	client, capture := newTestPlatformClient(t, func(req *http.Request) (*http.Response, error) {
		if req.URL.Path != "/api/v1/fleet/reconcile-snapshot" {
			t.Errorf("expected path /api/v1/fleet/reconcile-snapshot, got %s", req.URL.Path)
		}
		if req.Method != http.MethodGet {
			t.Errorf("expected GET, got %s", req.Method)
		}
		return jsonResponse(http.StatusOK, `{"data":{"desired_states":[{"id":"worker-1","enabled":true}],"runtime_targets":[{"playbook_id":"pb-1","playbook_name":"Build","pool_kind":"orchestrator","routing_tags":["orchestrator"],"pool_mode":"warm","max_runtimes":1,"priority":0,"idle_timeout_seconds":300,"grace_period_seconds":180,"image":"runtime:v1","pull_policy":"if-not-present","cpu":"1","memory":"512m","pending_tasks":1,"active_workflows":1}],"heartbeats":[{"runtime_id":"rt-1","playbook_id":"pb-1","pool_kind":"orchestrator","state":"idle","last_heartbeat_at":"2026-03-12T00:00:00Z","active_task_id":"task-1"}],"container_manager_config":{"platform_api_request_timeout_seconds":19,"platform_log_ingest_timeout_seconds":17,"reconcile_interval_seconds":7,"stop_timeout_seconds":45,"shutdown_task_stop_timeout_seconds":3,"docker_action_buffer_seconds":20,"log_flush_interval_ms":500,"docker_event_reconnect_backoff_ms":5000,"crash_log_capture_timeout_seconds":5,"starvation_threshold_seconds":60,"runtime_orphan_grace_cycles":3,"hung_runtime_stale_after_seconds":90,"hung_runtime_stop_grace_period_seconds":30,"global_max_runtimes":12,"runtime_log_max_size_mb":10,"runtime_log_max_files":3}}}`), nil
	})

	result, err := client.FetchReconcileSnapshot()
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if capture.authorization != "Bearer test-key" {
		t.Fatalf("expected Authorization Bearer test-key, got %s", capture.authorization)
	}
	if len(result.DesiredStates) != 1 || len(result.RuntimeTargets) != 1 || len(result.Heartbeats) != 1 {
		t.Fatalf("unexpected snapshot payload sizes: %+v", result)
	}
	if result.ContainerManagerConfig.GlobalMaxRuntimes != 12 {
		t.Fatalf("expected global_max_runtimes 12, got %d", result.ContainerManagerConfig.GlobalMaxRuntimes)
	}
	if result.ContainerManagerConfig.ReconcileIntervalSeconds != 7 {
		t.Fatalf("expected reconcile_interval_seconds 7, got %d", result.ContainerManagerConfig.ReconcileIntervalSeconds)
	}
	if result.ContainerManagerConfig.PlatformAPIRequestTimeoutSeconds != 19 {
		t.Fatalf("expected platform_api_request_timeout_seconds 19, got %d", result.ContainerManagerConfig.PlatformAPIRequestTimeoutSeconds)
	}
	if result.ContainerManagerConfig.PlatformLogIngestTimeoutSeconds != 17 {
		t.Fatalf("expected platform_log_ingest_timeout_seconds 17, got %d", result.ContainerManagerConfig.PlatformLogIngestTimeoutSeconds)
	}
	if result.ContainerManagerConfig.LogFlushIntervalMs != 500 {
		t.Fatalf("expected log_flush_interval_ms 500, got %d", result.ContainerManagerConfig.LogFlushIntervalMs)
	}
	if result.ContainerManagerConfig.DockerEventReconnectBackoffMs != 5000 {
		t.Fatalf("expected docker_event_reconnect_backoff_ms 5000, got %d", result.ContainerManagerConfig.DockerEventReconnectBackoffMs)
	}
	if result.ContainerManagerConfig.CrashLogCaptureTimeoutSeconds != 5 {
		t.Fatalf("expected crash_log_capture_timeout_seconds 5, got %d", result.ContainerManagerConfig.CrashLogCaptureTimeoutSeconds)
	}
	if result.ContainerManagerConfig.StarvationThresholdSeconds != 60 {
		t.Fatalf("expected starvation_threshold_seconds 60, got %d", result.ContainerManagerConfig.StarvationThresholdSeconds)
	}
	if result.ContainerManagerConfig.RuntimeOrphanGraceCycles != 3 {
		t.Fatalf("expected runtime_orphan_grace_cycles 3, got %d", result.ContainerManagerConfig.RuntimeOrphanGraceCycles)
	}
	if result.ContainerManagerConfig.HungRuntimeStaleAfterSeconds != 90 {
		t.Fatalf("expected hung_runtime_stale_after_seconds 90, got %d", result.ContainerManagerConfig.HungRuntimeStaleAfterSeconds)
	}
	if result.ContainerManagerConfig.HungRuntimeStopGracePeriodSec != 30 {
		t.Fatalf("expected hung_runtime_stop_grace_period_seconds 30, got %d", result.ContainerManagerConfig.HungRuntimeStopGracePeriodSec)
	}
	if result.ContainerManagerConfig.RuntimeLogMaxSizeMB != 10 {
		t.Fatalf("expected runtime_log_max_size_mb 10, got %d", result.ContainerManagerConfig.RuntimeLogMaxSizeMB)
	}
	if result.ContainerManagerConfig.RuntimeLogMaxFiles != 3 {
		t.Fatalf("expected runtime_log_max_files 3, got %d", result.ContainerManagerConfig.RuntimeLogMaxFiles)
	}
}

func TestReportLiveContainerInventoryPostsDockerTruth(t *testing.T) {
	var payload struct {
		Containers []LiveContainerReport `json:"containers"`
	}

	client, capture := newTestPlatformClient(t, func(req *http.Request) (*http.Response, error) {
		if req.URL.Path != "/api/v1/fleet/live-containers" {
			t.Errorf("expected path /api/v1/fleet/live-containers, got %s", req.URL.Path)
		}
		if req.Method != http.MethodPost {
			t.Errorf("expected POST, got %s", req.Method)
		}
		if req.Header.Get("Content-Type") != "application/json" {
			t.Errorf("expected Content-Type application/json, got %s", req.Header.Get("Content-Type"))
		}
		if err := json.NewDecoder(req.Body).Decode(&payload); err != nil {
			t.Fatalf("decode request body: %v", err)
		}
		return jsonResponse(http.StatusNoContent, ""), nil
	})

	err := client.ReportLiveContainerInventory([]LiveContainerReport{
		{
			ContainerID: "task-container-1",
			Name:        "task-3d749b2c",
			Kind:        "task",
			ExecutionBackend: "runtime_plus_task",
			State:       "running",
			Status:      "Up 90 seconds",
			Image:       "debian:trixie-slim",
			CPULimit:    "1",
			MemoryLimit: "768m",
			RuntimeID:   "runtime-1",
			TaskID:      "task-1",
			WorkflowID:  "workflow-1",
			RoleName:    "developer",
		},
	})
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if capture.authorization != "Bearer test-key" {
		t.Fatalf("expected Authorization Bearer test-key, got %s", capture.authorization)
	}
	if len(payload.Containers) != 1 {
		t.Fatalf("expected one reported container, got %d", len(payload.Containers))
	}
	if payload.Containers[0].CPULimit != "1" || payload.Containers[0].MemoryLimit != "768m" {
		t.Fatalf("expected docker truth cpu/memory in payload, got cpu=%q memory=%q", payload.Containers[0].CPULimit, payload.Containers[0].MemoryLimit)
	}
	if payload.Containers[0].ExecutionBackend != "runtime_plus_task" {
		t.Fatalf("expected execution_backend runtime_plus_task, got %q", payload.Containers[0].ExecutionBackend)
	}
}

func TestAcknowledgeWorkerRestartPostsToAPI(t *testing.T) {
	client, capture := newTestPlatformClient(t, func(req *http.Request) (*http.Response, error) {
		if req.URL.Path != "/api/v1/fleet/workers/worker-1/restart/ack" {
			t.Errorf("expected path /api/v1/fleet/workers/worker-1/restart/ack, got %s", req.URL.Path)
		}
		if req.Method != http.MethodPost {
			t.Errorf("expected POST, got %s", req.Method)
		}
		return jsonResponse(http.StatusOK, `{"ok":true}`), nil
	})

	err := client.AcknowledgeWorkerRestart("worker-1")
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if capture.authorization != "Bearer test-key" {
		t.Fatalf("expected Authorization Bearer test-key, got %s", capture.authorization)
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
