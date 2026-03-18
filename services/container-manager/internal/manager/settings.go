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
	m.config.LogFlushInterval = next.LogFlushInterval
	m.config.DockerEventReconnectBackoff = next.DockerEventReconnectBackoff
	m.config.CrashLogCaptureTimeout = next.CrashLogCaptureTimeout
	m.config.StarvationThreshold = next.StarvationThreshold
	m.config.RuntimeOrphanGraceCycles = next.RuntimeOrphanGraceCycles
	m.config.HungRuntimeStaleAfter = next.HungRuntimeStaleAfter
	m.config.HungRuntimeStopGrace = next.HungRuntimeStopGrace
	m.config.PlatformAPIRequestTimeout = next.PlatformAPIRequestTimeout
	m.config.PlatformLogIngestTimeout = next.PlatformLogIngestTimeout
	m.config.GlobalMaxRuntimes = next.GlobalMaxRuntimes
	applyManagerTimeouts(m.platform, m.logEmitter, m.dockerEventWatcher, next)

	m.logger.Info(
		"container-manager config applied",
		"platform_api_request_timeout", next.PlatformAPIRequestTimeout,
		"platform_log_ingest_timeout", next.PlatformLogIngestTimeout,
		"reconcile_interval", next.ReconcileInterval,
		"stop_timeout", next.StopTimeout,
		"shutdown_task_stop_timeout", next.ShutdownTaskStopTimeout,
		"docker_action_buffer", next.DockerActionBuffer,
		"log_flush_interval", next.LogFlushInterval,
		"docker_event_reconnect_backoff", next.DockerEventReconnectBackoff,
		"crash_log_capture_timeout", next.CrashLogCaptureTimeout,
		"starvation_threshold", next.StarvationThreshold,
		"runtime_orphan_grace_cycles", next.RuntimeOrphanGraceCycles,
		"hung_runtime_stale_after", next.HungRuntimeStaleAfter,
		"hung_runtime_stop_grace", next.HungRuntimeStopGrace,
		"global_max_runtimes", next.GlobalMaxRuntimes,
	)
	m.emitLog("container", "config.apply", "info", "completed", map[string]any{
		"action":                               "apply_snapshot_config",
		"platform_api_request_timeout_seconds": int(next.PlatformAPIRequestTimeout / time.Second),
		"platform_log_ingest_timeout_seconds":  int(next.PlatformLogIngestTimeout / time.Second),
		"reconcile_interval_seconds":           int(next.ReconcileInterval / time.Second),
		"stop_timeout_seconds":                 int(next.StopTimeout / time.Second),
		"shutdown_task_stop_timeout_seconds":   int(next.ShutdownTaskStopTimeout / time.Second),
		"docker_action_buffer_seconds":         int(next.DockerActionBuffer / time.Second),
		"log_flush_interval_ms":                int(next.LogFlushInterval / time.Millisecond),
		"docker_event_reconnect_backoff_ms":    int(next.DockerEventReconnectBackoff / time.Millisecond),
		"crash_log_capture_timeout_seconds":    int(next.CrashLogCaptureTimeout / time.Second),
		"starvation_threshold_seconds":         int(next.StarvationThreshold / time.Second),
		"runtime_orphan_grace_cycles":          next.RuntimeOrphanGraceCycles,
		"hung_runtime_stale_after_seconds":     int(next.HungRuntimeStaleAfter / time.Second),
		"hung_runtime_stop_grace_seconds":      int(next.HungRuntimeStopGrace / time.Second),
		"global_max_runtimes":                  next.GlobalMaxRuntimes,
	})
	return true, nil
}

func (m *Manager) currentContainerManagerConfig() Config {
	return Config{
		PlatformAPIRequestTimeout:   m.config.PlatformAPIRequestTimeout,
		PlatformLogIngestTimeout:    m.config.PlatformLogIngestTimeout,
		ReconcileInterval:           m.config.ReconcileInterval,
		StopTimeout:                 m.config.StopTimeout,
		ShutdownTaskStopTimeout:     m.config.ShutdownTaskStopTimeout,
		DockerActionBuffer:          m.config.DockerActionBuffer,
		LogFlushInterval:            m.config.LogFlushInterval,
		DockerEventReconnectBackoff: m.config.DockerEventReconnectBackoff,
		CrashLogCaptureTimeout:      m.config.CrashLogCaptureTimeout,
		StarvationThreshold:         m.config.StarvationThreshold,
		RuntimeOrphanGraceCycles:    m.config.RuntimeOrphanGraceCycles,
		HungRuntimeStaleAfter:       m.config.HungRuntimeStaleAfter,
		HungRuntimeStopGrace:        m.config.HungRuntimeStopGrace,
		GlobalMaxRuntimes:           m.config.GlobalMaxRuntimes,
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
	logFlushInterval, err := readRequiredMilliseconds(config.LogFlushIntervalMs, "container_manager.log_flush_interval_ms")
	if err != nil {
		return Config{}, err
	}
	dockerEventReconnectBackoff, err := readRequiredMilliseconds(
		config.DockerEventReconnectBackoffMs,
		"container_manager.docker_event_reconnect_backoff_ms",
	)
	if err != nil {
		return Config{}, err
	}
	crashLogCaptureTimeout, err := readRequiredDuration(
		config.CrashLogCaptureTimeoutSeconds,
		"container_manager.crash_log_capture_timeout_seconds",
	)
	if err != nil {
		return Config{}, err
	}
	starvationThreshold, err := readRequiredDuration(
		config.StarvationThresholdSeconds,
		"container_manager.starvation_threshold_seconds",
	)
	if err != nil {
		return Config{}, err
	}
	runtimeOrphanGraceCycles, err := readRequiredPositiveInt(
		config.RuntimeOrphanGraceCycles,
		"container_manager.runtime_orphan_grace_cycles",
	)
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
		PlatformAPIRequestTimeout:   platformAPIRequestTimeout,
		PlatformLogIngestTimeout:    platformLogIngestTimeout,
		ReconcileInterval:           reconcileInterval,
		StopTimeout:                 stopTimeout,
		ShutdownTaskStopTimeout:     shutdownTaskStopTimeout,
		DockerActionBuffer:          dockerActionBuffer,
		LogFlushInterval:            logFlushInterval,
		DockerEventReconnectBackoff: dockerEventReconnectBackoff,
		CrashLogCaptureTimeout:      crashLogCaptureTimeout,
		StarvationThreshold:         starvationThreshold,
		RuntimeOrphanGraceCycles:    runtimeOrphanGraceCycles,
		HungRuntimeStaleAfter:       hungRuntimeStaleAfter,
		HungRuntimeStopGrace:        hungRuntimeStopGrace,
		GlobalMaxRuntimes:           globalMaxRuntimes,
	}, nil
}

type timeoutConfigurablePlatform interface {
	SetTimeout(time.Duration)
}

type timeoutConfigurableLogEmitter interface {
	SetTimeout(time.Duration)
	SetFlushInterval(time.Duration)
}

type timeoutConfigurableDockerEventWatcher interface {
	SetReconnectBackoff(time.Duration)
	SetCrashLogCaptureTimeout(time.Duration)
}

func applyManagerTimeouts(
	platform PlatformAPI,
	logEmitter timeoutConfigurableLogEmitter,
	watcher timeoutConfigurableDockerEventWatcher,
	config Config,
) {
	if configurablePlatform, ok := platform.(timeoutConfigurablePlatform); ok {
		configurablePlatform.SetTimeout(config.PlatformAPIRequestTimeout)
	}
	if logEmitter != nil {
		logEmitter.SetTimeout(config.PlatformLogIngestTimeout)
		logEmitter.SetFlushInterval(config.LogFlushInterval)
	}
	if watcher != nil {
		watcher.SetReconnectBackoff(config.DockerEventReconnectBackoff)
		watcher.SetCrashLogCaptureTimeout(config.CrashLogCaptureTimeout)
	}
}

func readRequiredDuration(seconds int, key string) (time.Duration, error) {
	value, err := readRequiredPositiveInt(seconds, key)
	if err != nil {
		return 0, err
	}
	return time.Duration(value) * time.Second, nil
}

func readRequiredMilliseconds(milliseconds int, key string) (time.Duration, error) {
	value, err := readRequiredPositiveInt(milliseconds, key)
	if err != nil {
		return 0, err
	}
	return time.Duration(value) * time.Millisecond, nil
}

func readRequiredPositiveInt(value int, key string) (int, error) {
	if value > 0 {
		return value, nil
	}
	return 0, fmt.Errorf("missing container-manager config %q", key)
}
