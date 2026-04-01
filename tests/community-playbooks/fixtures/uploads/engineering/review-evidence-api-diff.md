# Review Evidence Packet

This packet summarizes the export queue changes prepared for review:

- switch queue claim retries from aggressive polling to bounded backoff
- add explicit terminal state mapping for exhausted export retries
- expose clearer operator-facing error summaries in the audit export UI
- preserve existing job identifiers for downstream evidence linking

Known concerns:

- duplicate retry paths may still exist in one worker loop
- rollout notes need support-facing language before merge
