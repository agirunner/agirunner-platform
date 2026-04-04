# Audit Export Readiness Test Plan

## Goal

Validate whether the release candidate is ready for enterprise audit
export traffic during quarter close.

## Steps

1. Launch a ninety-day CSV export for an enterprise workspace with more
   than fifty thousand rows.
2. Confirm the operator sees progress instead of a generic timeout
   banner.
3. Retry the same export after a simulated worker restart.
4. Verify completed exports preserve evidence links and download
   metadata.
5. Confirm support-facing error summaries remain readable for exhausted
   retries.

## Known limits

- no direct production data access
- manual browser confirmation required for final operator wording
- only one enterprise fixture account is available in the current stack
