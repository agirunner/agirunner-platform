-- Tools overhaul: new tools, remove web_search, recategorize.

-- Add new tools
INSERT INTO tool_tags (tenant_id, id, name, description, category, is_built_in)
SELECT t.id, 'grep', 'Grep', 'Search file contents using regex patterns', 'search', true
FROM tenants t ON CONFLICT DO NOTHING;

INSERT INTO tool_tags (tenant_id, id, name, description, category, is_built_in)
SELECT t.id, 'glob', 'Glob', 'Find files by glob pattern', 'search', true
FROM tenants t ON CONFLICT DO NOTHING;

INSERT INTO tool_tags (tenant_id, id, name, description, category, is_built_in)
SELECT t.id, 'tool_search', 'Tool Search', 'Search for available tools by name or description', 'search', true
FROM tenants t ON CONFLICT DO NOTHING;

-- Remove web_search
DELETE FROM tool_tags WHERE id = 'web_search' AND is_built_in = true;

-- Recategorize all tools
UPDATE tool_tags SET category = 'files' WHERE id IN ('file_read', 'file_write', 'file_edit', 'file_list');
UPDATE tool_tags SET category = 'execution' WHERE id = 'shell_exec';
UPDATE tool_tags SET category = 'git' WHERE id IN ('git_status', 'git_diff', 'git_log', 'git_commit', 'git_push');
UPDATE tool_tags SET category = 'artifacts' WHERE id IN ('artifact_upload', 'artifact_list', 'artifact_read');
UPDATE tool_tags SET category = 'memory' WHERE id IN ('memory_read', 'memory_write', 'memory_delete');
UPDATE tool_tags SET category = 'web' WHERE id = 'web_fetch';
UPDATE tool_tags SET category = 'control' WHERE id = 'escalate';
UPDATE tool_tags SET category = 'workflow' WHERE id IN (
  'create_task', 'retry_task', 'approve_task', 'approve_task_output',
  'request_task_changes', 'create_work_item', 'update_work_item',
  'advance_stage', 'request_gate_approval', 'complete_workflow', 'create_workflow',
  'memory_delete'
);

-- Remove web_search runtime defaults
DELETE FROM runtime_defaults WHERE config_key LIKE 'tools.web_search%';
