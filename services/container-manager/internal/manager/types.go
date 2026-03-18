package manager

import "time"

// DesiredState represents a row from worker_desired_state.
type DesiredState struct {
	ID                 string                 `json:"id"`
	TenantID           string                 `json:"tenant_id"`
	WorkerName         string                 `json:"worker_name"`
	Role               string                 `json:"role"`
	PoolKind           string                 `json:"pool_kind"`
	RuntimeImage       string                 `json:"runtime_image"`
	CPULimit           string                 `json:"cpu_limit"`
	MemoryLimit        string                 `json:"memory_limit"`
	NetworkPolicy      string                 `json:"network_policy"`
	Environment        map[string]interface{} `json:"environment"`
	LLMProvider        *string                `json:"llm_provider"`
	LLMModel           *string                `json:"llm_model"`
	LLMAPIKeySecretRef *string                `json:"llm_api_key_secret_ref"`
	Replicas           int                    `json:"replicas"`
	Enabled            bool                   `json:"enabled"`
	RestartRequested   bool                   `json:"restart_requested"`
	Draining           bool                   `json:"draining"`
	ActiveTaskID       string                 `json:"active_task_id,omitempty"`
	Version            int                    `json:"version"`
}

// ActualState represents the current state of a container.
type ActualState struct {
	DesiredStateID   string    `json:"desired_state_id"`
	ContainerID      string    `json:"container_id"`
	ContainerStatus  string    `json:"container_status"`
	CPUUsagePercent  float32   `json:"cpu_usage_percent"`
	MemoryUsageBytes int64     `json:"memory_usage_bytes"`
	NetworkRxBytes   int64     `json:"network_rx_bytes"`
	NetworkTxBytes   int64     `json:"network_tx_bytes"`
	StartedAt        time.Time `json:"started_at"`
}

// ContainerImage represents an available Docker image.
type ContainerImage struct {
	Repository string  `json:"repository"`
	Tag        *string `json:"tag"`
	Digest     *string `json:"digest"`
	SizeBytes  *int64  `json:"size_bytes"`
}

// MeteringEvent represents a usage metering event to report to the platform.
type MeteringEvent struct {
	TaskID          string `json:"taskId"`
	WorkerID        string `json:"workerId,omitempty"`
	WallTimeMs      int64  `json:"wallTimeMs"`
	CpuMs           int64  `json:"cpuMs,omitempty"`
	MemoryPeakBytes int64  `json:"memoryPeakBytes,omitempty"`
	NetworkBytes    int64  `json:"networkBytes,omitempty"`
}

// SecurityEvent represents a security-relevant event for audit logging.
type SecurityEvent struct {
	Type     string                 `json:"type"`
	WorkerID string                 `json:"worker_id"`
	Severity string                 `json:"severity"`
	Message  string                 `json:"message"`
	Metadata map[string]interface{} `json:"metadata,omitempty"`
}

// ContainerStats holds resource usage metrics returned by Docker stats.
type ContainerStats struct {
	CPUPercent  float64
	MemoryBytes uint64
	RxBytes     uint64
	TxBytes     uint64
}

// ContainerResourceMetrics holds per-container resource usage stats.
type ContainerResourceMetrics struct {
	ContainerID      string  `json:"container_id"`
	DesiredStateID   string  `json:"desired_state_id"`
	CPUUsagePercent  float64 `json:"cpu_usage_percent"`
	MemoryUsageBytes int64   `json:"memory_usage_bytes"`
	MemoryPeakBytes  int64   `json:"memory_peak_bytes"`
	NetworkRxBytes   int64   `json:"network_rx_bytes"`
	NetworkTxBytes   int64   `json:"network_tx_bytes"`
}

// RuntimeTarget describes the desired runtime fleet configuration for a playbook.
type RuntimeTarget struct {
	PlaybookID              string   `json:"playbook_id"`
	PlaybookName            string   `json:"playbook_name"`
	PoolKind                string   `json:"pool_kind"`
	CapabilityTags          []string `json:"capability_tags"`
	PoolMode                string   `json:"pool_mode"`
	MaxRuntimes             int      `json:"max_runtimes"`
	Priority                int      `json:"priority"`
	IdleTimeoutSeconds      int      `json:"idle_timeout_seconds"`
	GracePeriodSeconds      int      `json:"grace_period_seconds"`
	Image                   string   `json:"image"`
	PullPolicy              string   `json:"pull_policy"`
	CPU                     string   `json:"cpu"`
	Memory                  string   `json:"memory"`
	PendingTasks            int      `json:"pending_tasks"`
	TasksWithCapabilities   int      `json:"tasks_with_capabilities"`
	DistinctCapabilitySets  int      `json:"distinct_capability_sets"`
	MaxRequiredCapabilities int      `json:"max_required_capabilities"`
	CapabilityDemandUnits   int      `json:"capability_demand_units"`
	ActiveWorkflows         int      `json:"active_workflows"`
}

// RuntimeHeartbeat represents a runtime's last known heartbeat state.
type RuntimeHeartbeat struct {
	RuntimeID       string `json:"runtime_id"`
	PlaybookID      string `json:"playbook_id"`
	PoolKind        string `json:"pool_kind"`
	State           string `json:"state"`
	LastHeartbeatAt string `json:"last_heartbeat_at"`
	ActiveTaskID    string `json:"active_task_id,omitempty"`
}

type ContainerManagerConfig struct {
	PlatformAPIRequestTimeoutSeconds int `json:"platform_api_request_timeout_seconds"`
	PlatformLogIngestTimeoutSeconds  int `json:"platform_log_ingest_timeout_seconds"`
	ReconcileIntervalSeconds       int `json:"reconcile_interval_seconds"`
	StopTimeoutSeconds             int `json:"stop_timeout_seconds"`
	ShutdownTaskStopTimeoutSeconds int `json:"shutdown_task_stop_timeout_seconds"`
	DockerActionBufferSeconds      int `json:"docker_action_buffer_seconds"`
	HungRuntimeStaleAfterSeconds   int `json:"hung_runtime_stale_after_seconds"`
	HungRuntimeStopGracePeriodSec  int `json:"hung_runtime_stop_grace_period_seconds"`
	GlobalMaxRuntimes              int `json:"global_max_runtimes"`
}

// ReconcileSnapshot bundles the worker desired state and DCM inputs needed for
// a single reconcile cycle so the manager can fetch them with one API call.
type ReconcileSnapshot struct {
	DesiredStates          []DesiredState         `json:"desired_states"`
	RuntimeTargets         []RuntimeTarget        `json:"runtime_targets"`
	Heartbeats             []RuntimeHeartbeat     `json:"heartbeats"`
	ContainerManagerConfig ContainerManagerConfig `json:"container_manager_config"`
}

// ContainerHealthStatus holds health inspection data from Docker.
type ContainerHealthStatus struct {
	Status string
}

// FleetEvent records a fleet management event for auditing.
type FleetEvent struct {
	EventType   string                 `json:"event_type"`
	Level       string                 `json:"level"`
	RuntimeID   string                 `json:"runtime_id,omitempty"`
	PlaybookID  string                 `json:"playbook_id,omitempty"`
	PoolKind    string                 `json:"pool_kind,omitempty"`
	TaskID      string                 `json:"task_id,omitempty"`
	WorkflowID  string                 `json:"workflow_id,omitempty"`
	ContainerID string                 `json:"container_id,omitempty"`
	Payload     map[string]interface{} `json:"payload,omitempty"`
}

func (t RuntimeTarget) TargetKey() string {
	return runtimeTargetKey(t.PlaybookID, t.PoolKind)
}

func runtimeTargetKey(playbookID, poolKind string) string {
	return playbookID + "::" + normalizePoolKind(poolKind)
}

func normalizePoolKind(poolKind string) string {
	switch poolKind {
	case "orchestrator":
		return "orchestrator"
	default:
		return "specialist"
	}
}
