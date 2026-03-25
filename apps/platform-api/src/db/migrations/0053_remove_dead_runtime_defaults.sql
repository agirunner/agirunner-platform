DELETE FROM runtime_defaults
WHERE config_key IN (
  'docker.checker_timeout_ms',
  'docker.stop_timeout_seconds',
  'container.copy_timeout_seconds',
  'containerd.connect_timeout_seconds',
  'workspace.inject_context_rename_timeout_seconds',
  'platform.webhook_max_attempts',
  'platform.webhook_retry_base_delay_ms'
);
