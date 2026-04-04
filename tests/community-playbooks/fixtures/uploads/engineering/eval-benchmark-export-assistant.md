# Eval Benchmark Summary

Candidate under review: audit export assistant revision `rc-12`.

Benchmark packet:

- 12 benchmark prompts covering queue failures, retry behavior, evidence
  retention, and operator guidance
- grounded answer rate improved from 7/12 to 10/12
- unsupported certainty dropped from 4 turns to 1 turn
- still weak on distinguishing timeout banners from backend job state

Reviewer notes:

- stronger source citation discipline than the prior revision
- still overconfident when the benchmark packet omits a direct product
  source
- operator-friendly wording improved, but one answer still implies a
  workaround that was never tested
