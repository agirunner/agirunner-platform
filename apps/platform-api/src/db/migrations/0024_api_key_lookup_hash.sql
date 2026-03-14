ALTER TABLE public.api_keys
  ADD COLUMN key_lookup_hash character varying(64);

CREATE UNIQUE INDEX idx_api_keys_lookup_hash
  ON public.api_keys USING btree (key_lookup_hash)
  WHERE key_lookup_hash IS NOT NULL;
