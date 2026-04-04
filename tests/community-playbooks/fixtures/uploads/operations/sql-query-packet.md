# SQL Packet Review Candidate

Question answered by the packet:

Which enterprise export jobs timed out in the UI while continuing to
run in the backend?

Logic summary:

1. joins `export_jobs` to `export_job_events`
2. filters to enterprise workspaces and quarter-close date windows
3. flags rows where a timeout banner event exists before a terminal job
   completion event
4. aggregates by workspace, row-count bucket, and release candidate

Known caveats:

- the query assumes timeout-banner events are always written
- one join uses event timestamps instead of explicit event ids
- no direct customer-severity field exists, so escalation count is
  stitched from a support export
