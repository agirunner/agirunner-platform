ALTER TYPE api_key_scope ADD VALUE IF NOT EXISTS 'service';

ALTER TABLE api_keys
    ALTER COLUMN expires_at DROP NOT NULL;

ALTER TABLE api_keys
    ADD COLUMN IF NOT EXISTS revoked_at timestamp with time zone;
