-- Per-project git webhook secrets (replaces global GIT_WEBHOOK_*_SECRET env vars)
ALTER TABLE projects
  ADD COLUMN git_webhook_provider text CHECK (git_webhook_provider IN ('github', 'gitea', 'gitlab')),
  ADD COLUMN git_webhook_secret text;

COMMENT ON COLUMN projects.git_webhook_provider IS 'Git hosting provider for webhook signature verification';
COMMENT ON COLUMN projects.git_webhook_secret IS 'Encrypted webhook secret for signature verification (enc:v1:... format)';
