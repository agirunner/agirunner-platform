# Export Timeout Bug Report

- Customer: Alder Ridge Capital
- Surface: Audit export jobs
- Environment: Release candidate on enterprise staging

## Summary

Exports larger than fifty thousand rows show a timeout banner at the
sixty-second mark, but the job keeps running long enough to hold worker
capacity and confuse operators about the true state.

## Reproduction

1. Open the audit export screen for an enterprise workspace.
2. Request a CSV covering the last ninety days of activity.
3. Wait for the banner to appear at roughly sixty seconds.
4. Observe that the backend continues retrying the same export batch.

## Why This Matters

Finance teams are using the export for quarter-end evidence packages.
Customer success has now attached two renewal-risk notes to the incident.
