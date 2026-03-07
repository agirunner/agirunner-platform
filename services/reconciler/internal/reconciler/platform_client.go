package reconciler

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
func NewPlatformClient(baseURL, apiKey string) *PlatformClient {
	return &PlatformClient{
		baseURL: baseURL,
		apiKey:  apiKey,
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

type fleetResponse struct {
	Data []DesiredState `json:"data"`
}

// FetchDesiredState retrieves all enabled worker desired states.
func (c *PlatformClient) FetchDesiredState() ([]DesiredState, error) {
	url := fmt.Sprintf("%s/api/v1/fleet/workers", c.baseURL)

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

	// Filter to enabled only
	var enabled []DesiredState
	for _, ds := range result.Data {
		if ds.Enabled {
			enabled = append(enabled, ds)
		}
	}
	return enabled, nil
}

// ReportActualState sends container state back to the platform.
func (c *PlatformClient) ReportActualState(state ActualState) error {
	// The reconciler reports state via internal API — this is a placeholder
	// for the actual implementation that will use the fleet report endpoints.
	return nil
}

// ReportImage reports a discovered Docker image to the platform.
func (c *PlatformClient) ReportImage(image ContainerImage) error {
	return nil
}

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
