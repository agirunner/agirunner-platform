BEGIN;

CREATE TABLE workflow_stage_gates (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    workflow_id uuid NOT NULL REFERENCES workflows(id),
    stage_id uuid NOT NULL REFERENCES workflow_stages(id),
    stage_name text NOT NULL,
    request_summary text NOT NULL,
    recommendation text,
    concerns jsonb NOT NULL DEFAULT '[]'::jsonb,
    key_artifacts jsonb NOT NULL DEFAULT '[]'::jsonb,
    status text NOT NULL CHECK (status IN ('awaiting_approval', 'approved', 'rejected', 'changes_requested')),
    requested_by_type text NOT NULL,
    requested_by_id text,
    requested_at timestamptz NOT NULL DEFAULT now(),
    decision_feedback text,
    decided_by_type text,
    decided_by_id text,
    decided_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_workflow_stage_gates_active
    ON workflow_stage_gates (tenant_id, workflow_id, stage_id)
    WHERE status = 'awaiting_approval';

CREATE INDEX idx_workflow_stage_gates_queue
    ON workflow_stage_gates (tenant_id, status, requested_at ASC);

CREATE INDEX idx_workflow_stage_gates_workflow_stage
    ON workflow_stage_gates (tenant_id, workflow_id, stage_id, requested_at DESC);

INSERT INTO workflow_stage_gates (
    tenant_id,
    workflow_id,
    stage_id,
    stage_name,
    request_summary,
    recommendation,
    concerns,
    key_artifacts,
    status,
    requested_by_type,
    requested_by_id,
    requested_at,
    decision_feedback,
    decided_by_type,
    decided_by_id,
    decided_at
)
SELECT
    ws.tenant_id,
    ws.workflow_id,
    ws.id,
    ws.name,
    COALESCE(NULLIF(ws.summary, ''), ws.goal),
    NULLIF(ws.metadata->'gate_request'->>'recommendation', ''),
    CASE
        WHEN jsonb_typeof(ws.metadata->'gate_request'->'concerns') = 'array'
            THEN ws.metadata->'gate_request'->'concerns'
        ELSE '[]'::jsonb
    END,
    CASE
        WHEN jsonb_typeof(ws.metadata->'gate_request'->'key_artifacts') = 'array'
            THEN ws.metadata->'gate_request'->'key_artifacts'
        ELSE '[]'::jsonb
    END,
    ws.gate_status,
    'migration',
    NULL,
    COALESCE(
        NULLIF(ws.metadata->'gate_request'->>'requested_at', '')::timestamptz,
        ws.updated_at,
        now()
    ),
    NULLIF(ws.metadata->'gate_decision'->>'feedback', ''),
    CASE
        WHEN ws.gate_status = 'awaiting_approval' THEN NULL
        ELSE 'migration'
    END,
    NULL,
    CASE
        WHEN ws.gate_status = 'awaiting_approval' THEN NULL
        ELSE COALESCE(
            NULLIF(ws.metadata->'gate_decision'->>'decided_at', '')::timestamptz,
            ws.updated_at,
            now()
        )
    END
FROM workflow_stages ws
WHERE ws.human_gate = true
  AND ws.gate_status IN ('awaiting_approval', 'approved', 'rejected', 'changes_requested');

COMMIT;
