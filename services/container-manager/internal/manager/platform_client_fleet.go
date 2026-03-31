package manager

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

// ReportMeteringEvent sends a metering event to the platform API.
func (c *PlatformClient) ReportMeteringEvent(event MeteringEvent) error {
	body, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("marshal metering event: %w", err)
	}

	url := fmt.Sprintf("%s/api/v1/metering/events", c.baseURL)
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create metering request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("metering request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("metering API returned HTTP %d: %s", resp.StatusCode, string(respBody))
	}
	return nil
}

// ReportSecurityEvent sends a security event for audit logging.
func (c *PlatformClient) ReportSecurityEvent(event SecurityEvent) error {
	body, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("marshal security event: %w", err)
	}

	url := fmt.Sprintf("%s/api/v1/audit/security-events", c.baseURL)
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create security event request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("security event request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("security event API returned HTTP %d: %s", resp.StatusCode, string(respBody))
	}
	return nil
}

type runtimeTargetsResponse struct {
	Data []RuntimeTarget `json:"data"`
}

// FetchRuntimeTargets retrieves current fleet runtime targets from the platform.
func (c *PlatformClient) FetchRuntimeTargets() ([]RuntimeTarget, error) {
	url := fmt.Sprintf("%s/api/v1/fleet/runtime-targets", c.baseURL)

	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("create runtime targets request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("runtime targets request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("runtime targets API returned HTTP %d: %s", resp.StatusCode, string(body))
	}

	var result runtimeTargetsResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode runtime targets response: %w", err)
	}
	return result.Data, nil
}

type heartbeatsResponse struct {
	Data []RuntimeHeartbeat `json:"data"`
}

type taskStateResponse struct {
	Data struct {
		State string `json:"state"`
	} `json:"data"`
}

// FetchHeartbeats retrieves runtime heartbeat data from the platform.
func (c *PlatformClient) FetchHeartbeats() ([]RuntimeHeartbeat, error) {
	url := fmt.Sprintf("%s/api/v1/fleet/heartbeats", c.baseURL)

	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("create heartbeats request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("heartbeats request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("heartbeats API returned HTTP %d: %s", resp.StatusCode, string(body))
	}

	var result heartbeatsResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode heartbeats response: %w", err)
	}
	return result.Data, nil
}

// GetTaskState retrieves the current public task state from the platform API.
func (c *PlatformClient) GetTaskState(taskID string) (string, error) {
	url := fmt.Sprintf("%s/api/v1/tasks/%s", c.baseURL, taskID)

	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return "", fmt.Errorf("create task state request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("task state request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("task state API returned HTTP %d: %s", resp.StatusCode, string(body))
	}

	var result taskStateResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("decode task state response: %w", err)
	}
	return result.Data.State, nil
}

// RecordFleetEvent posts a fleet event to the platform API for persistence.
func (c *PlatformClient) RecordFleetEvent(event FleetEvent) error {
	body, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("marshal fleet event: %w", err)
	}

	url := fmt.Sprintf("%s/api/v1/fleet/events", c.baseURL)
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create fleet event request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("fleet event request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("fleet event API returned HTTP %d: %s", resp.StatusCode, string(respBody))
	}
	return nil
}

// DrainRuntime requests the platform to drain a runtime.
func (c *PlatformClient) DrainRuntime(runtimeID string) error {
	url := fmt.Sprintf("%s/api/v1/fleet/runtimes/%s/drain", c.baseURL, runtimeID)
	req, err := http.NewRequest(http.MethodPost, url, nil)
	if err != nil {
		return fmt.Errorf("create drain request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("drain runtime request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("drain runtime API returned HTTP %d: %s", resp.StatusCode, string(body))
	}
	return nil
}

// AcknowledgeWorkerRestart clears the one-shot restart request after DCM has
// recreated the worker successfully.
func (c *PlatformClient) AcknowledgeWorkerRestart(desiredStateID string) error {
	url := fmt.Sprintf("%s/api/v1/fleet/workers/%s/restart/ack", c.baseURL, desiredStateID)
	req, err := http.NewRequest(http.MethodPost, url, nil)
	if err != nil {
		return fmt.Errorf("create restart acknowledgement request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("restart acknowledgement request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("restart acknowledgement API returned HTTP %d: %s", resp.StatusCode, string(body))
	}
	return nil
}

// FailTask marks a task as failed via the platform API.
func (c *PlatformClient) FailTask(taskID, reason string) error {
	payload := map[string]interface{}{
		"error": map[string]string{
			"code":    "RUNTIME_HUNG",
			"message": reason,
		},
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal fail task payload: %w", err)
	}

	url := fmt.Sprintf("%s/api/v1/tasks/%s/fail", c.baseURL, taskID)
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create fail task request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("fail task request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == 409 {
		return nil
	}
	if resp.StatusCode >= 300 {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("fail task API returned HTTP %d: %s", resp.StatusCode, string(respBody))
	}
	return nil
}

// ReportCircuitBreakerOutcome reports a task outcome for quality scoring.
func (c *PlatformClient) ReportCircuitBreakerOutcome(workerID, outcome, reason string) error {
	payload := map[string]string{
		"workerId": workerID,
		"outcome":  outcome,
		"reason":   reason,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal circuit breaker report: %w", err)
	}

	url := fmt.Sprintf("%s/api/v1/circuit-breaker/report", c.baseURL)
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create circuit breaker request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("circuit breaker request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("circuit breaker API returned HTTP %d: %s", resp.StatusCode, string(respBody))
	}
	return nil
}
