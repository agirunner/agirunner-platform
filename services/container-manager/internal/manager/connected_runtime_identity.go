package manager

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"
)

const (
	envRuntimePlatformWorkerID     = "AGIRUNNER_RUNTIME_PLATFORM_WORKER_ID"
	envRuntimePlatformWorkerAPIKey = "AGIRUNNER_RUNTIME_PLATFORM_WORKER_API_KEY"
	envRuntimePlatformAgentID      = "AGIRUNNER_RUNTIME_PLATFORM_AGENT_ID"
	envRuntimePlatformAgentAPIKey  = "AGIRUNNER_RUNTIME_PLATFORM_AGENT_API_KEY"
	envRuntimeAuthAPIKey           = "AGIRUNNER_RUNTIME_AUTH_API_KEY"

	labelPlatformWorkerID = "agirunner.platform_worker_id"
	labelPlatformAgentID  = "agirunner.platform_agent_id"
)

type connectedRuntimeIdentity struct {
	WorkerID     string
	WorkerAPIKey string
	AgentID      string
	AgentAPIKey  string
}

type connectedRuntimeIdentityRequest struct {
	WorkerName    string
	ExecutionMode string
	RoutingTags   []string
	PlaybookID    string
	PoolKind      string
	Metadata      map[string]any
}

func (m *Manager) issueConnectedRuntimeIdentity(
	ctx context.Context,
	request connectedRuntimeIdentityRequest,
) (connectedRuntimeIdentity, error) {
	heartbeatSeconds := m.connectedRuntimeHeartbeatSeconds()
	normalizedPlaybookID := normalizeConnectedRuntimePlaybookID(request.PlaybookID)
	workerResponse, err := m.platform.RegisterWorker(WorkerRegistrationRequest{
		Name:                     strings.TrimSpace(request.WorkerName),
		RuntimeType:              "external",
		ConnectionMode:           "polling",
		RoutingTags:              copyStringSlice(request.RoutingTags),
		HeartbeatIntervalSeconds: heartbeatSeconds,
		Metadata:                 cloneAnyMap(request.Metadata),
	})
	if err != nil {
		return connectedRuntimeIdentity{}, fmt.Errorf("register runtime worker: %w", err)
	}

	agentResponse, err := m.platform.RegisterAgent(AgentRegistrationRequest{
		Name:                     strings.TrimSpace(request.WorkerName),
		RoutingTags:              copyStringSlice(request.RoutingTags),
		ExecutionMode:            strings.TrimSpace(request.ExecutionMode),
		PlaybookID:               normalizedPlaybookID,
		WorkerID:                 workerResponse.WorkerID,
		HeartbeatIntervalSeconds: heartbeatSeconds,
		Metadata:                 connectedRuntimeAgentMetadata(normalizedPlaybookID, request.PoolKind),
	})
	if err != nil {
		m.releaseConnectedRuntimeIdentity(ctx, workerResponse.WorkerID)
		return connectedRuntimeIdentity{}, fmt.Errorf("register runtime agent: %w", err)
	}

	return connectedRuntimeIdentity{
		WorkerID:     strings.TrimSpace(workerResponse.WorkerID),
		WorkerAPIKey: strings.TrimSpace(workerResponse.WorkerAPIKey),
		AgentID:      strings.TrimSpace(agentResponse.ID),
		AgentAPIKey:  strings.TrimSpace(agentResponse.APIKey),
	}, nil
}

func (m *Manager) releaseConnectedRuntimeIdentity(ctx context.Context, workerID string) {
	trimmedWorkerID := strings.TrimSpace(workerID)
	if trimmedWorkerID == "" {
		return
	}
	if err := m.platform.DeleteWorker(trimmedWorkerID); err != nil {
		m.logger.Warn("failed to release connected runtime identity", "worker_id", trimmedWorkerID, "error", err)
	}
}

func (m *Manager) connectedRuntimeHeartbeatSeconds() int {
	if m.config.ReconcileInterval <= 0 {
		return 5
	}
	seconds := int(m.config.ReconcileInterval.Seconds())
	if seconds <= 0 {
		return 5
	}
	return seconds
}

func injectConnectedRuntimeIdentity(
	environment map[string]string,
	labels map[string]string,
	identity connectedRuntimeIdentity,
) {
	environment[envRuntimePlatformWorkerID] = identity.WorkerID
	environment[envRuntimePlatformWorkerAPIKey] = identity.WorkerAPIKey
	environment[envRuntimePlatformAgentID] = identity.AgentID
	environment[envRuntimePlatformAgentAPIKey] = identity.AgentAPIKey
	labels[labelPlatformWorkerID] = identity.WorkerID
	labels[labelPlatformAgentID] = identity.AgentID
}

func cloneAnyMap(source map[string]any) map[string]any {
	if len(source) == 0 {
		return nil
	}
	cloned := make(map[string]any, len(source))
	for key, value := range source {
		cloned[key] = value
	}
	return cloned
}

func copyStringSlice(values []string) []string {
	if len(values) == 0 {
		return []string{}
	}
	cloned := make([]string, len(values))
	copy(cloned, values)
	return cloned
}

func normalizeConnectedRuntimePlaybookID(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return ""
	}
	if _, err := uuid.Parse(trimmed); err != nil {
		return ""
	}
	return trimmed
}

func connectedRuntimeAgentMetadata(playbookID, poolKind string) map[string]any {
	metadata := map[string]any{
		"pool_kind": poolKind,
	}
	if playbookID != "" {
		metadata["playbook_id"] = playbookID
	}
	return metadata
}
