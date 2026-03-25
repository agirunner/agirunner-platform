WITH updates(config_key, old_value, new_value) AS (
  VALUES
    ('specialist_runtime_bootstrap_claim_timeout_seconds', '30', '60'),
    ('specialist_runtime_drain_grace_seconds', '30', '120'),
    ('tasks.default_timeout_minutes', '30', '180'),
    ('platform.api_request_timeout_seconds', '30', '60'),
    ('platform.log_ingest_timeout_seconds', '10', '30'),
    ('platform.log_flush_interval_ms', '500', '2000'),
    ('platform.drain_timeout_seconds', '600', '1800'),
    ('platform.self_terminate_cleanup_timeout_seconds', '15', '60'),
    ('platform.workflow_activation_stale_after_ms', '300000', '900000'),
    ('platform.task_cancel_signal_grace_period_ms', '60000', '180000'),
    ('platform.worker_dispatch_ack_timeout_ms', '15000', '45000'),
    ('platform.lifecycle_agent_heartbeat_check_interval_ms', '15000', '30000'),
    ('platform.lifecycle_worker_heartbeat_check_interval_ms', '15000', '30000'),
    ('platform.heartbeat_prune_interval_ms', '60000', '300000'),
    ('platform.governance_retention_job_interval_ms', '3600000', '21600000'),
    ('container_manager.reconcile_interval_seconds', '5', '10'),
    ('container_manager.stop_timeout_seconds', '30', '60'),
    ('container_manager.shutdown_task_stop_timeout_seconds', '2', '10'),
    ('container_manager.docker_action_buffer_seconds', '15', '30'),
    ('container_manager.log_flush_interval_ms', '500', '2000'),
    ('container_manager.starvation_threshold_seconds', '60', '180'),
    ('container_manager.runtime_orphan_grace_cycles', '3', '6'),
    ('container_manager.hung_runtime_stale_after_seconds', '90', '180'),
    ('container_manager.hung_runtime_stop_grace_period_seconds', '30', '60'),
    ('llm.http_timeout_seconds', '60', '120'),
    ('tools.shell_exec_timeout_seconds', '120', '300'),
    ('tools.shell_exec_timeout_max_seconds', '300', '900'),
    ('workspace.clone_timeout_seconds', '120', '600'),
    ('workspace.clone_max_retries', '3', '5'),
    ('workspace.clone_backoff_base_seconds', '1', '2'),
    ('capture.push_retries', '3', '5'),
    ('capture.push_timeout_seconds', '60', '180'),
    ('agent.history_max_messages', '100', '150'),
    ('agent.history_preserve_recent', '20', '30'),
    ('agent.specialist_context_tail_messages', '20', '30'),
    ('agent.max_iterations', '500', '800'),
    ('agent.max_tool_steps_per_burst', '8', '12'),
    ('agent.max_mutating_steps_per_burst', '3', '5'),
    ('agent.max_burst_elapsed_ms', '45000', '120000'),
    ('agent.max_parallel_tool_calls_per_burst', '4', '8')
)
UPDATE runtime_defaults AS rd
SET
  config_value = updates.new_value,
  updated_at = NOW()
FROM updates
WHERE rd.config_key = updates.config_key
  AND rd.config_value = updates.old_value;
