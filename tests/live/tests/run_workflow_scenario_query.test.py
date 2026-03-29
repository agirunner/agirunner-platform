#!/usr/bin/env python3
from __future__ import annotations

import re
import sys
import unittest
from pathlib import Path


LIVE_LIB = Path(__file__).resolve().parents[1] / "lib"
sys.path.insert(0, str(LIVE_LIB))

import run_workflow_scenario  # noqa: E402


class BuildDbStateQueryTests(unittest.TestCase):
    def test_db_state_query_selects_brief_sequence_number_for_ordering(self) -> None:
        sql = run_workflow_scenario.build_db_state_query("workflow-123")

        self.assertRegex(
            sql,
            re.compile(
                r"'operator_briefs'.*?SELECT\s+id,.*?sequence_number,.*?FROM workflow_operator_briefs",
                re.DOTALL,
            ),
        )

    def test_db_state_query_omits_deprecated_operator_updates(self) -> None:
        sql = run_workflow_scenario.build_db_state_query("workflow-123")

        self.assertNotIn("'operator_updates'", sql)
        self.assertNotIn("FROM workflow_operator_updates", sql)


if __name__ == "__main__":
    unittest.main()
