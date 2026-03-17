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
	return true, nil
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

func validateContainerManagerConfig(config ContainerManagerConfig) (Config, error) {
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
	globalMaxRuntimes, err := readRequiredPositiveInt(config.GlobalMaxRuntimes, "global_max_runtimes")
	if err != nil {
		return Config{}, err
	}

	return Config{
		ReconcileInterval:       reconcileInterval,
		StopTimeout:             stopTimeout,
		ShutdownTaskStopTimeout: shutdownTaskStopTimeout,
		DockerActionBuffer:      dockerActionBuffer,
		GlobalMaxRuntimes:       globalMaxRuntimes,
	}, nil
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
