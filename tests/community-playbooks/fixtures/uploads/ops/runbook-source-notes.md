# Runbook Source Notes

Observed during recent alerting incidents:

- repeated upstream webhook failures can trigger pager storms
- engineers need clearer cooldown expectations before retrying manually
- current rollback notes are split across chat, a partial runbook, and
  an on-call handoff brief

Desired outcome:

- one durable runbook and one SOP for customer-credit exceptions
