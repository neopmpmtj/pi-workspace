#!/usr/bin/env python3
"""Offline tests for the `calendar` node. No network, no JEV, no gog.

    python3 ~/.pi/decision-nodes/calendar/tests/test_calendar.py

What is covered: the chain (a write is allowed only on FREE), the gate parser, and
the field validator. The classifier call and the gog call are not exercised here -
they are covered by the manual runs recorded in README.md.
"""
from __future__ import annotations

import os
import sys
import unittest
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import config  # noqa: E402

ZONE = ZoneInfo(config.TIMEZONE)


def row_with(status="ran", gate=None, answer=""):
    result = {"destination": "do:calendar:gog", "status": status}
    if answer:
        result["answer"] = answer
    if gate:
        result["gate"] = gate
    return {"utterance": "dentist tomorrow at 3pm", "routes": [result]}


class GateParser(unittest.TestCase):
    def test_first_word_wins(self):
        self.assertEqual(config._gate_of("FREE\nnothing booked"), "FREE")
        self.assertEqual(config._gate_of("BUSY - standup at 15:00"), "BUSY")
        self.assertEqual(config._gate_of("UNKNOWN - no date given"), "UNKNOWN")

    def test_markdown_and_punctuation_are_tolerated(self):
        self.assertEqual(config._gate_of("**FREE**"), "FREE")
        self.assertEqual(config._gate_of("`FREE:`"), "FREE")

    def test_a_few_lines_of_preamble_are_tolerated(self):
        self.assertEqual(config._gate_of("Read-only check.\n\nFREE\nsee above"), "FREE")

    def test_prose_without_a_token_is_unknown(self):
        self.assertEqual(config._gate_of("Thursday is empty"), "UNKNOWN")
        self.assertEqual(config._gate_of(""), "UNKNOWN")

    def test_a_token_after_the_fifth_line_is_not_read(self):
        self.assertEqual(config._gate_of("\n".join(["-"] * 6 + ["FREE"])), "UNKNOWN")


class Chain(unittest.TestCase):
    def test_free_is_the_only_permission(self):
        self.assertEqual(config._gate(row_with(gate="FREE"))[0], "FREE")
        self.assertEqual(config._gate(row_with(gate="BUSY"))[0], "BUSY")
        self.assertEqual(config._gate(row_with(gate="UNKNOWN"))[0], "UNKNOWN")

    def test_a_failed_read_writes_nothing(self):
        verdict, why = config._gate(row_with(status="failed"))
        self.assertEqual(verdict, "UNKNOWN")
        self.assertIn("blind", why)

    def test_no_read_at_all_writes_nothing(self):
        verdict, why = config._gate({"routes": []})
        self.assertEqual(verdict, "UNKNOWN")
        self.assertIn("did not run", why)

    def test_busy_short_circuits_before_any_extraction(self):
        result = config.do_calendar_create(row_with(gate="BUSY"))
        self.assertEqual(result["status"], "skipped")
        self.assertIn("BUSY", result["note"])
        self.assertNotIn("event", result)


class Validation(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026, 11, 4, 9, 0, tzinfo=ZONE)

    def ok(self, **overrides):
        base = {"summary": "Barber", "location": None, "start_local": "2026-11-05T15:00",
                "end_local": "2026-11-05T16:00", "confidence": 0.9, "reason": "clear"}
        base.update(overrides)
        return config._validate(base, self.now)

    def test_a_complete_event_passes(self):
        event, why = self.ok()
        self.assertIsNotNone(event, why)
        self.assertEqual(event["start"].hour, 15)
        self.assertEqual(event["start"].utcoffset(), timedelta(0))  # WET in November

    def test_a_missing_date_is_refused(self):
        event, why = self.ok(start_local=None)
        self.assertIsNone(event)
        self.assertIn("no definite date", why)

    def test_an_unparsable_start_is_refused(self):
        event, why = self.ok(start_local="next Thursday-ish")
        self.assertIsNone(event)
        self.assertIn("unparsable", why)

    def test_a_past_slot_is_refused(self):
        event, why = self.ok(start_local="2026-11-03T15:00", end_local="2026-11-03T16:00")
        self.assertIsNone(event)
        self.assertIn("past", why)

    def test_low_confidence_is_refused(self):
        event, why = self.ok(confidence=0.2)
        self.assertIsNone(event)
        self.assertIn("confidence", why)

    def test_empty_summary_is_refused(self):
        event, why = self.ok(summary="  ")
        self.assertIsNone(event)
        self.assertIn("summary", why)

    def test_a_bad_end_falls_back_to_the_default_duration(self):
        event, _ = self.ok(end_local="2026-11-05T14:00")
        self.assertEqual(event["end"] - event["start"], timedelta(minutes=config.DEFAULT_MINUTES))

    def test_blank_location_becomes_none(self):
        event, _ = self.ok(location="   ")
        self.assertIsNone(event["location"])


class Routing(unittest.TestCase):
    def test_a_match_returns_both_destinations_in_order(self):
        row = {"abstained": False, "calendar": {"is_match": True}}
        self.assertEqual(config.router(row), ["do:calendar:gog", "do:calendar:create"])

    def test_a_non_match_routes_nothing(self):
        self.assertEqual(config.router({"abstained": False, "calendar": {"is_match": False}}), [])

    def test_an_abstain_fails_open(self):
        self.assertEqual(config.router({"abstained": True}), ["escalate"])

    def test_every_router_name_has_a_handler(self):
        for name in config.router({"abstained": False, "calendar": {"is_match": True}}):
            self.assertIn(name, config.DESTINATIONS)


if __name__ == "__main__":
    unittest.main(verbosity=2)
