package reconciler

import "time"

// DesiredState represents a row from worker_desired_state.
type DesiredState struct {
	ID                 string                 `json:"id"`
	TenantID           string                 `json:"tenant_id"`
	WorkerName         string                 `json:"worker_name"`
	Role               string                 `json:"role"`
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
	Version            int                    `json:"version"`
	WarmPoolSize       int                    `json:"warm_pool_size"`
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
