package manager

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// PlatformClient communicates with the platform API to read desired state
// and report actual state.
type PlatformClient struct {
	baseURL    string
	apiKey     string
	httpClient *http.Client
}

// NewPlatformClient creates a client for the platform API.
func NewPlatformClient(baseURL, apiKey string, timeout time.Duration) *PlatformClient {
	return NewPlatformClientWithHTTPClient(baseURL, apiKey, &http.Client{
		Timeout: timeout,
	})
}

func NewPlatformClientWithHTTPClient(baseURL, apiKey string, httpClient *http.Client) *PlatformClient {
	if httpClient == nil {
		httpClient = &http.Client{}
	}
	return &PlatformClient{
		baseURL:    baseURL,
		apiKey:     apiKey,
		httpClient: httpClient,
	}
}

func (c *PlatformClient) SetTimeout(timeout time.Duration) {
	if c == nil {
		return
	}
	if c.httpClient == nil {
		c.httpClient = &http.Client{}
	}
	c.httpClient.Timeout = timeout
}

type fleetResponse struct {
	Data []DesiredState `json:"data"`
}

type reconcileSnapshotResponse struct {
	Data ReconcileSnapshot `json:"data"`
}

// FetchDesiredState retrieves all enabled worker desired states.
func (c *PlatformClient) FetchDesiredState() ([]DesiredState, error) {
	url := fmt.Sprintf("%s/api/v1/fleet/workers?enabled=true", c.baseURL)

	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fleet request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("fleet API returned HTTP %d: %s", resp.StatusCode, string(body))
	}

	var result fleetResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode fleet response: %w", err)
	}

	return result.Data, nil
}

// FetchReconcileSnapshot retrieves the desired state, runtime targets, and
// heartbeat snapshot for a single reconcile cycle.
func (c *PlatformClient) FetchReconcileSnapshot() (*ReconcileSnapshot, error) {
	url := fmt.Sprintf("%s/api/v1/fleet/reconcile-snapshot", c.baseURL)

	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("create reconcile snapshot request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("reconcile snapshot request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("reconcile snapshot API returned HTTP %d: %s", resp.StatusCode, string(body))
	}

	var result reconcileSnapshotResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode reconcile snapshot response: %w", err)
	}
	return &result.Data, nil
}

// ReportActualState sends container state back to the platform.
func (c *PlatformClient) ReportActualState(state ActualState) error {
	payload := map[string]interface{}{
		"desiredStateId":   state.DesiredStateID,
		"containerId":      state.ContainerID,
		"containerStatus":  state.ContainerStatus,
		"cpuUsagePercent":  state.CPUUsagePercent,
		"memoryUsageBytes": state.MemoryUsageBytes,
		"networkRxBytes":   state.NetworkRxBytes,
		"networkTxBytes":   state.NetworkTxBytes,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal actual state: %w", err)
	}

	url := fmt.Sprintf("%s/api/v1/fleet/workers/actual-state", c.baseURL)
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create actual state request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("actual state request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("actual state API returned HTTP %d: %s", resp.StatusCode, string(respBody))
	}
	return nil
}

// ReportLiveContainerInventory replaces the tenant's current live container
// snapshot with Docker-inspected managed containers from the latest reconcile.
func (c *PlatformClient) ReportLiveContainerInventory(containers []LiveContainerReport) error {
	body, err := json.Marshal(map[string]any{
		"containers": containers,
	})
	if err != nil {
		return fmt.Errorf("marshal live container inventory: %w", err)
	}

	url := fmt.Sprintf("%s/api/v1/fleet/live-containers", c.baseURL)
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create live container inventory request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("live container inventory request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("live container inventory API returned HTTP %d: %s", resp.StatusCode, string(respBody))
	}
	return nil
}

// PruneActualState removes actual-state rows for containers no longer running.
func (c *PlatformClient) PruneActualState(desiredStateID string, activeContainerIDs []string) error {
	payload := map[string]interface{}{
		"desiredStateId":     desiredStateID,
		"activeContainerIds": activeContainerIDs,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal prune request: %w", err)
	}

	url := fmt.Sprintf("%s/api/v1/fleet/workers/actual-state/prune", c.baseURL)
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create prune request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("prune request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("prune API returned HTTP %d: %s", resp.StatusCode, string(respBody))
	}
	return nil
}

// ReportImage reports a discovered Docker image to the platform.
func (c *PlatformClient) ReportImage(image ContainerImage) error {
	payload := map[string]interface{}{
		"repository": image.Repository,
		"tag":        image.Tag,
		"digest":     image.Digest,
		"sizeBytes":  image.SizeBytes,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal image report: %w", err)
	}

	url := fmt.Sprintf("%s/api/v1/fleet/images", c.baseURL)
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create image report request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("image report request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("image report API returned HTTP %d: %s", resp.StatusCode, string(respBody))
	}
	return nil
}
