CREATE TABLE IF NOT EXISTS public.project_artifact_files (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES public.tenants(id),
    project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    key text NOT NULL,
    description text NULL,
    file_name text NOT NULL,
    storage_backend text NOT NULL,
    storage_key text NOT NULL,
    content_type text NOT NULL,
    size_bytes bigint NOT NULL,
    checksum_sha256 text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_artifact_files_tenant_project
    ON public.project_artifact_files (tenant_id, project_id);

CREATE INDEX IF NOT EXISTS idx_project_artifact_files_tenant_project_key
    ON public.project_artifact_files (tenant_id, project_id, key);
