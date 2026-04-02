package manager

import "strings"

const (
	labelExecutionMode          = "agirunner.execution_mode"
	labelPlatformAPIURL         = "agirunner.platform_api_url"
	labelDockerHost             = "agirunner.docker_host"
	labelPlatformContract       = "agirunner.platform_contract"
	labelRuntimeNetwork         = "agirunner.runtime_network"
	labelRuntimeInternalNetwork = "agirunner.runtime_internal_network"
	orchestratorExecutionMode   = "orchestrator"
	orchestratorContractLabel   = "connected-platform-v1"
	envRuntimeWorkerName        = "AGIRUNNER_WORKER_NAME"
	envPlatformAPIURL           = "AGIRUNNER_RUNTIME_PLATFORM_API_URL"
	envPlatformAdminAPIKey      = "AGIRUNNER_RUNTIME_PLATFORM_ADMIN_API_KEY"
	envPlatformAgentExecMode    = "AGIRUNNER_RUNTIME_PLATFORM_AGENT_EXECUTION_MODE"
	envDockerHost               = "DOCKER_HOST"
)

func isOrchestratorDesiredState(ds DesiredState) bool {
	if normalizePoolKind(ds.PoolKind) == orchestratorExecutionMode {
		return true
	}
	return strings.EqualFold(strings.TrimSpace(ds.Role), orchestratorExecutionMode)
}

func applyOrchestratorRuntimeContract(spec *ContainerSpec, cfg Config, ds DesiredState) {
	if !isOrchestratorDesiredState(ds) {
		return
	}
	if spec.Environment == nil {
		spec.Environment = map[string]string{}
	}
	if spec.Labels == nil {
		spec.Labels = map[string]string{}
	}

	apiURL := strings.TrimSpace(cfg.PlatformAPIURL)
	if apiURL != "" {
		spec.Environment[envPlatformAPIURL] = apiURL
		spec.Labels[labelPlatformAPIURL] = apiURL
	}
	dockerHost := strings.TrimSpace(cfg.DockerHost)
	if dockerHost != "" {
		spec.Environment[envDockerHost] = dockerHost
		spec.Labels[labelDockerHost] = dockerHost
	}
	runtimeNetwork := strings.TrimSpace(cfg.RuntimeNetwork)
	if runtimeNetwork != "" {
		spec.Labels[labelRuntimeNetwork] = runtimeNetwork
	}
	internalNetwork := strings.TrimSpace(cfg.RuntimeInternalNetwork)
	if internalNetwork != "" {
		spec.Labels[labelRuntimeInternalNetwork] = internalNetwork
	}
	serviceKey := strings.TrimSpace(cfg.PlatformAPIKey)
	if serviceKey != "" {
		spec.Environment[envPlatformAdminAPIKey] = serviceKey
		spec.Environment[envRuntimeAuthAPIKey] = serviceKey
	}
	spec.Environment[envPlatformAgentExecMode] = orchestratorExecutionMode
	spec.Labels[labelExecutionMode] = orchestratorExecutionMode
	spec.Labels[labelPlatformContract] = orchestratorContractLabel
}

func needsOrchestratorContractReplacement(ds DesiredState, c ContainerInfo, cfg Config) bool {
	if !isOrchestratorDesiredState(ds) {
		return false
	}
	if c.Labels[labelExecutionMode] != orchestratorExecutionMode {
		return true
	}
	if c.Labels[labelPlatformContract] != orchestratorContractLabel {
		return true
	}
	expectedAPIURL := strings.TrimSpace(cfg.PlatformAPIURL)
	if expectedAPIURL == "" {
		expectedAPIURL = c.Labels[labelPlatformAPIURL]
	}
	if c.Labels[labelPlatformAPIURL] != expectedAPIURL {
		return true
	}
	expectedDockerHost := strings.TrimSpace(cfg.DockerHost)
	if expectedDockerHost == "" {
		expectedDockerHost = c.Labels[labelDockerHost]
	}
	if c.Labels[labelDockerHost] != expectedDockerHost {
		return true
	}
	expectedRuntimeNetwork := strings.TrimSpace(cfg.RuntimeNetwork)
	if expectedRuntimeNetwork == "" {
		expectedRuntimeNetwork = c.Labels[labelRuntimeNetwork]
	}
	if c.Labels[labelRuntimeNetwork] != expectedRuntimeNetwork {
		return true
	}
	expectedRuntimeInternalNetwork := strings.TrimSpace(cfg.RuntimeInternalNetwork)
	if expectedRuntimeInternalNetwork == "" {
		expectedRuntimeInternalNetwork = c.Labels[labelRuntimeInternalNetwork]
	}
	return c.Labels[labelRuntimeInternalNetwork] != expectedRuntimeInternalNetwork
}

func orchestratorInternalNetwork(cfg Config, ds DesiredState) string {
	if !isOrchestratorDesiredState(ds) {
		return ""
	}
	return strings.TrimSpace(cfg.RuntimeInternalNetwork)
}

func isContainerRunning(status string) bool {
	normalized := strings.ToLower(strings.TrimSpace(status))
	return normalized == "running" || normalized == "up" || strings.HasPrefix(normalized, "up ")
}
