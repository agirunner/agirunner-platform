package manager

import "time"

const (
	defaultReconcileIntervalSeconds       = 5
	defaultStopTimeoutSeconds             = 30
	defaultShutdownTaskStopTimeoutSeconds = 2
	defaultDockerActionBufferSeconds      = 15
	defaultGlobalMaxRuntimes              = 10
)

func (m *Manager) applySnapshotConfig(snapshot *ReconcileSnapshot) bool {
	if snapshot == nil {
		return false
	}

	next := normalizeContainerManagerConfig(snapshot.ContainerManagerConfig)
	current := m.currentContainerManagerConfig()
	if current == next {
		return false
	}

	m.config.ReconcileInterval = next.ReconcileInterval
	m.config.StopTimeout = next.StopTimeout
	m.config.ShutdownTaskStopTimeout = next.ShutdownTaskStopTimeout
	m.config.DockerActionBuffer = next.DockerActionBuffer
	m.config.GlobalMaxRuntimes = next.GlobalMaxRuntimes

	m.logger.Info(
		"container-manager config applied",
		"reconcile_interval", next.ReconcileInterval,
		"stop_timeout", next.StopTimeout,
		"shutdown_task_stop_timeout", next.ShutdownTaskStopTimeout,
		"docker_action_buffer", next.DockerActionBuffer,
		"global_max_runtimes", next.GlobalMaxRuntimes,
	)
	m.emitLog("container", "config.apply", "info", "completed", map[string]any{
		"action":                             "apply_snapshot_config",
		"reconcile_interval_seconds":         int(next.ReconcileInterval / time.Second),
		"stop_timeout_seconds":               int(next.StopTimeout / time.Second),
		"shutdown_task_stop_timeout_seconds": int(next.ShutdownTaskStopTimeout / time.Second),
		"docker_action_buffer_seconds":       int(next.DockerActionBuffer / time.Second),
		"global_max_runtimes":                next.GlobalMaxRuntimes,
	})
	return true
}

func (m *Manager) currentContainerManagerConfig() Config {
	return Config{
		ReconcileInterval:       m.config.ReconcileInterval,
		StopTimeout:             m.config.StopTimeout,
		ShutdownTaskStopTimeout: m.config.ShutdownTaskStopTimeout,
		DockerActionBuffer:      m.config.DockerActionBuffer,
		GlobalMaxRuntimes:       m.config.GlobalMaxRuntimes,
	}
}

func normalizeContainerManagerConfig(config ContainerManagerConfig) Config {
	return Config{
		ReconcileInterval:       durationOrDefault(config.ReconcileIntervalSeconds, defaultReconcileIntervalSeconds),
		StopTimeout:             durationOrDefault(config.StopTimeoutSeconds, defaultStopTimeoutSeconds),
		ShutdownTaskStopTimeout: durationOrDefault(config.ShutdownTaskStopTimeoutSeconds, defaultShutdownTaskStopTimeoutSeconds),
		DockerActionBuffer:      durationOrDefault(config.DockerActionBufferSeconds, defaultDockerActionBufferSeconds),
		GlobalMaxRuntimes:       intOrDefault(config.GlobalMaxRuntimes, defaultGlobalMaxRuntimes),
	}
}

func durationOrDefault(seconds int, fallbackSeconds int) time.Duration {
	return time.Duration(intOrDefault(seconds, fallbackSeconds)) * time.Second
}

func intOrDefault(value int, fallback int) int {
	if value > 0 {
		return value
	}
	return fallback
}
