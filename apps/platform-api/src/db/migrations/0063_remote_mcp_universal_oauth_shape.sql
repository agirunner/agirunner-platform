ALTER TABLE remote_mcp_servers
  ADD COLUMN IF NOT EXISTS transport_preference text NOT NULL DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS oauth_definition jsonb;

ALTER TABLE remote_mcp_registration_drafts
  ADD COLUMN IF NOT EXISTS transport_preference text NOT NULL DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS oauth_definition jsonb;

ALTER TABLE remote_mcp_server_parameters
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

WITH ranked_parameters AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY remote_mcp_server_id
      ORDER BY created_at ASC, id ASC
    ) - 1 AS computed_sort_order
  FROM remote_mcp_server_parameters
)
UPDATE remote_mcp_server_parameters parameters
SET sort_order = ranked_parameters.computed_sort_order
FROM ranked_parameters
WHERE ranked_parameters.id = parameters.id;
