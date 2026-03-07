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
