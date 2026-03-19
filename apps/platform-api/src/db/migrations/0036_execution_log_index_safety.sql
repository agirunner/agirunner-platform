ALTER TABLE public.execution_logs
  ADD CONSTRAINT execution_logs_operation_length_check
    CHECK (char_length(operation) <= 500),
  ADD CONSTRAINT execution_logs_workflow_name_length_check
    CHECK (workflow_name IS NULL OR char_length(workflow_name) <= 500),
  ADD CONSTRAINT execution_logs_workspace_name_length_check
    CHECK (workspace_name IS NULL OR char_length(workspace_name) <= 500),
  ADD CONSTRAINT execution_logs_stage_name_length_check
    CHECK (stage_name IS NULL OR char_length(stage_name) <= 200),
  ADD CONSTRAINT execution_logs_role_length_check
    CHECK (role IS NULL OR char_length(role) <= 100),
  ADD CONSTRAINT execution_logs_actor_type_length_check
    CHECK (actor_type IS NULL OR char_length(actor_type) <= 50),
  ADD CONSTRAINT execution_logs_actor_id_length_check
    CHECK (actor_id IS NULL OR char_length(actor_id) <= 255),
  ADD CONSTRAINT execution_logs_actor_name_length_check
    CHECK (actor_name IS NULL OR char_length(actor_name) <= 255),
  ADD CONSTRAINT execution_logs_resource_type_length_check
    CHECK (resource_type IS NULL OR char_length(resource_type) <= 100);
