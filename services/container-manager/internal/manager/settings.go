package manager

import (
	"fmt"
	"time"
)

func (m *Manager) applySnapshotConfig(snapshot *ReconcileSnapshot) (bool, error) {
	if snapshot == nil {
		return false, nil
	}

	next, err := validateContainerManagerConfig(snapshot.ContainerManagerConfig)
	if err != nil {
		return false, err
	}
	current := m.currentContainerManagerConfig()
	if current == next {
		return false, nil
	}

	m.config.ReconcileInterval = next.ReconcileInterval
	m.config.StopTimeout = next.StopTimeout
	m.config.ShutdownTaskStopTimeout = next.ShutdownTaskStopTimeout
	m.config.DockerActionBuffer = next.DockerActionBuffer
	m.config.HungRuntimeStaleAfter = next.HungRuntimeStaleAfter
	m.config.HungRuntimeStopGrace = next.HungRuntimeStopGrace
	m.config.PlatformAPIRequestTimeout = next.PlatformAPIRequestTimeout
	m.config.PlatformLogIngestTimeout = next.PlatformLogIngestTimeout
	m.config.GlobalMaxRuntimes = next.GlobalMaxRuntimes
	applyManagerTimeouts(m.platform, m.logEmitter, next.PlatformAPIRequestTimeout, next.PlatformLogIngestTimeout)

	m.logger.Info(
		"container-manager config applied",
		"platform_api_request_timeout", next.PlatformAPIRequestTimeout,
		"platform_log_ingest_timeout", next.PlatformLogIngestTimeout,
		"reconcile_interval", next.ReconcileInterval,
		"stop_timeout", next.StopTimeout,
		"shutdown_task_stop_timeout", next.ShutdownTaskStopTimeout,
		"docker_action_buffer", next.DockerActionBuffer,
		"hung_runtime_stale_after", next.HungRuntimeStaleAfter,
		"hung_runtime_stop_grace", next.HungRuntimeStopGrace,
		"global_max_runtimes", next.GlobalMaxRuntimes,
	)
	m.emitLog("container", "config.apply", "info", "completed", map[string]any{
		"action":                             "apply_snapshot_config",
		"platform_api_request_timeout_seconds": int(next.PlatformAPIRequestTimeout / time.Second),
		"platform_log_ingest_timeout_seconds":  int(next.PlatformLogIngestTimeout / time.Second),
		"reconcile_interval_seconds":         int(next.ReconcileInterval / time.Second),
		"stop_timeout_seconds":               int(next.StopTimeout / time.Second),
		"shutdown_task_stop_timeout_seconds": int(next.ShutdownTaskStopTimeout / time.Second),
		"docker_action_buffer_seconds":       int(next.DockerActionBuffer / time.Second),
		"hung_runtime_stale_after_seconds":   int(next.HungRuntimeStaleAfter / time.Second),
		"hung_runtime_stop_grace_seconds":    int(next.HungRuntimeStopGrace / time.Second),
		"global_max_runtimes":                next.GlobalMaxRuntimes,
	})
	return true, nil
}

func (m *Manager) currentContainerManagerConfig() Config {
	return Config{
		PlatformAPIRequestTimeout: m.config.PlatformAPIRequestTimeout,
		PlatformLogIngestTimeout:  m.config.PlatformLogIngestTimeout,
		ReconcileInterval:       m.config.ReconcileInterval,
		StopTimeout:             m.config.StopTimeout,
		ShutdownTaskStopTimeout: m.config.ShutdownTaskStopTimeout,
		DockerActionBuffer:      m.config.DockerActionBuffer,
		HungRuntimeStaleAfter:   m.config.HungRuntimeStaleAfter,
		HungRuntimeStopGrace:    m.config.HungRuntimeStopGrace,
		GlobalMaxRuntimes:       m.config.GlobalMaxRuntimes,
	}
}

func validateContainerManagerConfig(config ContainerManagerConfig) (Config, error) {
	platformAPIRequestTimeout, err := readRequiredDuration(
		config.PlatformAPIRequestTimeoutSeconds,
		"platform.api_request_timeout_seconds",
	)
	if err != nil {
		return Config{}, err
	}
	platformLogIngestTimeout, err := readRequiredDuration(
		config.PlatformLogIngestTimeoutSeconds,
		"platform.log_ingest_timeout_seconds",
	)
	if err != nil {
		return Config{}, err
	}
	reconcileInterval, err := readRequiredDuration(config.ReconcileIntervalSeconds, "container_manager.reconcile_interval_seconds")
	if err != nil {
		return Config{}, err
	}
	stopTimeout, err := readRequiredDuration(config.StopTimeoutSeconds, "container_manager.stop_timeout_seconds")
	if err != nil {
		return Config{}, err
	}
	shutdownTaskStopTimeout, err := readRequiredDuration(config.ShutdownTaskStopTimeoutSeconds, "container_manager.shutdown_task_stop_timeout_seconds")
	if err != nil {
		return Config{}, err
	}
	dockerActionBuffer, err := readRequiredDuration(config.DockerActionBufferSeconds, "container_manager.docker_action_buffer_seconds")
	if err != nil {
		return Config{}, err
	}
	hungRuntimeStaleAfter, err := readRequiredDuration(config.HungRuntimeStaleAfterSeconds, "container_manager.hung_runtime_stale_after_seconds")
	if err != nil {
		return Config{}, err
	}
	hungRuntimeStopGrace, err := readRequiredDuration(config.HungRuntimeStopGracePeriodSec, "container_manager.hung_runtime_stop_grace_period_seconds")
	if err != nil {
		return Config{}, err
	}
	globalMaxRuntimes, err := readRequiredPositiveInt(config.GlobalMaxRuntimes, "global_max_runtimes")
	if err != nil {
		return Config{}, err
	}

	return Config{
		PlatformAPIRequestTimeout: platformAPIRequestTimeout,
		PlatformLogIngestTimeout:  platformLogIngestTimeout,
		ReconcileInterval:       reconcileInterval,
		StopTimeout:             stopTimeout,
		ShutdownTaskStopTimeout: shutdownTaskStopTimeout,
		DockerActionBuffer:      dockerActionBuffer,
		HungRuntimeStaleAfter:   hungRuntimeStaleAfter,
		HungRuntimeStopGrace:    hungRuntimeStopGrace,
		GlobalMaxRuntimes:       globalMaxRuntimes,
	}, nil
}

type timeoutConfigurablePlatform interface {
	SetTimeout(time.Duration)
}

type timeoutConfigurableLogEmitter interface {
	SetTimeout(time.Duration)
}

func applyManagerTimeouts(
	platform PlatformAPI,
	logEmitter *LogEmitter,
	platformTimeout time.Duration,
	logIngestTimeout time.Duration,
) {
	if configurablePlatform, ok := platform.(timeoutConfigurablePlatform); ok {
		configurablePlatform.SetTimeout(platformTimeout)
	}
	if logEmitter != nil {
		logEmitter.SetTimeout(logIngestTimeout)
	}
}

func readRequiredDuration(seconds int, key string) (time.Duration, error) {
	value, err := readRequiredPositiveInt(seconds, key)
	if err != nil {
		return 0, err
	}
	return time.Duration(value) * time.Second, nil
}

func readRequiredPositiveInt(value int, key string) (int, error) {
	if value > 0 {
		return value, nil
	}
	return 0, fmt.Errorf("missing container-manager config %q", key)
}
