CREATE UNIQUE INDEX idx_workflows_parent_create_request
  ON workflows (
    tenant_id,
    (metadata->>'parent_workflow_id'),
    (metadata->>'create_request_id')
  )
  WHERE metadata ? 'parent_workflow_id'
    AND metadata ? 'create_request_id'
    AND NULLIF(metadata->>'parent_workflow_id', '') IS NOT NULL
    AND NULLIF(metadata->>'create_request_id', '') IS NOT NULL;
