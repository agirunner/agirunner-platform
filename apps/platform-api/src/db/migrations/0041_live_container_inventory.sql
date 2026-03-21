CREATE TABLE live_container_inventory (
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    container_id text NOT NULL,
    name text NOT NULL,
    kind text NOT NULL,
    state text NOT NULL,
    status text NOT NULL,
    image text NOT NULL,
    cpu_limit text,
    memory_limit text,
    started_at timestamptz,
    desired_state_id uuid,
    runtime_id text,
    task_id uuid,
    workflow_id uuid,
    role_name text,
    playbook_id text,
    playbook_name text,
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_live_container_inventory PRIMARY KEY (tenant_id, container_id)
);

CREATE INDEX idx_live_container_inventory_tenant
    ON live_container_inventory (tenant_id, last_seen_at);

CREATE INDEX idx_live_container_inventory_kind
    ON live_container_inventory (tenant_id, kind, last_seen_at);

CREATE INDEX idx_live_container_inventory_runtime
    ON live_container_inventory (tenant_id, runtime_id);

CREATE INDEX idx_live_container_inventory_task
    ON live_container_inventory (tenant_id, task_id);
