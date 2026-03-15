-- Recategorize tools: merge vcs into runtime, add orchestrator category.
UPDATE tool_tags SET category = 'runtime' WHERE category = 'vcs';
UPDATE tool_tags SET category = 'orchestrator' WHERE id IN (
  'memory_delete', 'create_work_item', 'update_work_item', 'create_task',
  'create_workflow', 'request_gate_approval', 'advance_stage',
  'complete_workflow', 'approve_task', 'approve_task_output',
  'request_task_changes', 'retry_task'
);
