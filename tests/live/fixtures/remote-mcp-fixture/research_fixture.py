#!/usr/bin/env python3
from __future__ import annotations


RESEARCH_CORPUS = [
    {
        "id": "audit-export-reliability-benchmark",
        "title": "Enterprise Audit Export Reliability Benchmark",
        "url": "https://fixtures.local/research/audit-export-reliability-benchmark",
        "published_at": "2026-01-14",
        "snippet": (
            "Large accounts tolerate queued exports with visible progress, but silent sixty-second stalls "
            "erode trust and create duplicate retries that amplify backend load."
        ),
        "body": (
            "Enterprise teams accept long-running audit exports when the workflow is explicit: queued, preparing, "
            "generating, and ready to download. The sharpest trust penalty comes from ambiguous failure modes, "
            "especially timeout banners that appear while background work continues. Operators favor resumable jobs, "
            "visible retry state, and review-friendly completion packets over aggressive synchronous execution."
        ),
    },
    {
        "id": "operator-review-workflows-study",
        "title": "Operator Review Workflows in Long-Running Automation",
        "url": "https://fixtures.local/research/operator-review-workflows-study",
        "published_at": "2025-11-03",
        "snippet": (
            "Approval-heavy flows succeed when the operator sees the pending decision, the supporting evidence, "
            "and the likely consequence of each action in one place."
        ),
        "body": (
            "Teams running long-lived automated workflows consistently prefer decision packets over notification-only "
            "queues. Approval requests need the latest brief, the proposed output, and a clear next-action ladder. "
            "Escalations resolve faster when the operator can see what the system already tried and whether a legal "
            "resume path exists without leaving the decision surface."
        ),
    },
    {
        "id": "documentation-for-governed-platform-rollouts",
        "title": "Documentation Practices for Governed Platform Rollouts",
        "url": "https://fixtures.local/research/documentation-governed-platform-rollouts",
        "published_at": "2025-09-18",
        "snippet": (
            "Release docs perform best when they separate operator tasks, decision checkpoints, and customer-facing "
            "behavior changes instead of mixing them into one narrative."
        ),
        "body": (
            "Internal rollout documentation should distinguish the operator runbook, the release decision record, "
            "and the external product update. Readers lose confidence when procedural steps, rationale, and customer "
            "impact are blended together. Mature teams publish a concise rollout checklist, a decision memo, and a "
            "support brief that anticipates likely objections and rollback triggers."
        ),
    },
    {
        "id": "research-operations-cost-model",
        "title": "Research Operations Cost Model for Product Teams",
        "url": "https://fixtures.local/research/research-operations-cost-model",
        "published_at": "2026-02-05",
        "snippet": (
            "External research adds value when it changes a roadmap decision, not when it merely increases surface area; "
            "teams should compare integration cost, operator burden, and evidence freshness."
        ),
        "body": (
            "Product organizations evaluating research tooling should score each option against three practical costs: "
            "integration effort, operator burden, and evidence freshness. Search breadth matters less than whether the "
            "tool reduces ambiguous decisions. The best-performing teams pair curated internal context with a small set "
            "of credible external signals and explicitly mark what remains uncertain."
        ),
    },
    {
        "id": "vendor-evaluation-procurement-patterns",
        "title": "Vendor Evaluation Patterns for Regulated Procurement",
        "url": "https://fixtures.local/research/vendor-evaluation-procurement-patterns",
        "published_at": "2025-12-09",
        "snippet": (
            "Procurement reviews move faster when capability fit, implementation cost, and governance posture are "
            "compared side by side instead of in separate documents."
        ),
        "body": (
            "Regulated buyers shorten vendor evaluations when every candidate is scored on capability fit, delivery "
            "cost, governance posture, and operational dependency. High-trust selections typically come from packets "
            "that acknowledge gaps early, link them to compensating controls, and explain which open questions are "
            "still worth escalating before signature."
        ),
    },
]


def _query_tokens(query: str) -> list[str]:
    tokens: list[str] = []
    current: list[str] = []
    for character in query.lower():
        if character.isalnum():
            current.append(character)
            continue
        if current:
            tokens.append("".join(current))
            current = []
    if current:
        tokens.append("".join(current))
    return [token for token in tokens if token]


def search_research_corpus(query: str, *, limit: int = 5) -> list[dict[str, object]]:
    tokens = _query_tokens(query)
    scored: list[tuple[int, dict[str, str]]] = []
    for document in RESEARCH_CORPUS:
        haystack = " ".join(
            [
                document["title"].lower(),
                document["snippet"].lower(),
                document["body"].lower(),
            ]
        )
        score = sum(3 if token in document["title"].lower() else 1 for token in tokens if token in haystack)
        if not tokens:
            score = 1
        if score == 0:
            continue
        scored.append((score, document))
    scored.sort(key=lambda item: (-item[0], item[1]["published_at"]), reverse=False)
    return [
        {
            "title": document["title"],
            "url": document["url"],
            "snippet": document["snippet"],
            "published_at": document["published_at"],
            "source": "Fixture Research Library",
        }
        for _, document in scored[: max(1, limit)]
    ]


def fetch_research_document(url: str) -> dict[str, object]:
    for document in RESEARCH_CORPUS:
        if document["url"] != url:
            continue
        return {
            "found": True,
            "url": document["url"],
            "title": document["title"],
            "published_at": document["published_at"],
            "content": document["body"],
            "source": "Fixture Research Library",
        }
    return {
        "found": False,
        "url": url,
        "title": "",
        "published_at": "",
        "content": "",
        "source": "Fixture Research Library",
    }
