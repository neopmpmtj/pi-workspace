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
from subprocess import CompletedProcess as Completed
from unittest import mock
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


class FreebusyVerdict(unittest.TestCase):
    """The read's JSON -> FREE / BUSY / UNKNOWN. Measured shape, 2026-11-04."""

    def test_an_empty_busy_list_is_free(self):
        verdict, why = config.freebusy_verdict({"calendars": {"primary": {}}})
        self.assertEqual((verdict, why), ("FREE", "nothing busy"))

    def test_an_empty_array_is_also_free(self):
        verdict, _ = config.freebusy_verdict({"calendars": {"primary": {"busy": []}}})
        self.assertEqual(verdict, "FREE")

    def test_any_busy_block_is_busy(self):
        payload = {"calendars": {"primary": {"busy": [
            {"start": "2026-11-09T09:30:00Z", "end": "2026-11-09T10:00:00Z"}]}}}
        verdict, why = config.freebusy_verdict(payload)
        self.assertEqual(verdict, "BUSY")
        self.assertIn("2026-11-09T09:30:00Z", why)

    def test_several_blocks_are_counted(self):
        payload = {"calendars": {"primary": {"busy": [
            {"start": "a", "end": "b"}, {"start": "c", "end": "d"}]}}}
        verdict, why = config.freebusy_verdict(payload)
        self.assertEqual(verdict, "BUSY")
        self.assertIn("+1 more", why)

    def test_unreadable_json_is_unknown(self):
        self.assertEqual(config.freebusy_verdict({})[0], "UNKNOWN")
        self.assertEqual(config.freebusy_verdict({"calendars": {}})[0], "UNKNOWN")
        self.assertEqual(config.freebusy_verdict({"calendars": {"primary": {"busy": "x"}}})[0], "UNKNOWN")


class ReadDestination(unittest.TestCase):
    """The read resolves the fields first; no fields means no freebusy call at all."""

    def test_no_fields_skips_before_any_calendar_call(self):
        with mock.patch.object(config, "extract_event", return_value=(None, "no definite date/time")):
            with mock.patch.object(config.subprocess, "run") as run:
                result = config.do_calendar_gog({"utterance": "book something sometime"})
        run.assert_not_called()
        self.assertEqual(result["status"], "skipped")
        self.assertEqual(result["gate"], "UNKNOWN")
        self.assertIn("no definite date", result["note"])

    def test_the_read_stashes_the_fields_for_the_write(self):
        event = {"summary": "Barber", "location": None,
                 "start": datetime(2026, 11, 5, 15, 0, tzinfo=ZONE),
                 "end": datetime(2026, 11, 5, 16, 0, tzinfo=ZONE), "confidence": 0.9}
        row = {"utterance": "barber tomorrow 3pm"}
        with mock.patch.object(config, "extract_event", return_value=(event, "")):
            with mock.patch.object(config.subprocess, "run", return_value=Completed(["gog"], 0, '{"calendars":{"primary":{}}}', "")):
                result = config.do_calendar_gog(row)
        self.assertEqual(result["gate"], "FREE")
        self.assertIs(row["event"], event)


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

    def test_busy_short_circuits_before_the_write(self):
        with mock.patch.object(config, "create_event") as create:
            result = config.do_calendar_create(row_with(gate="BUSY"))
        create.assert_not_called()
        self.assertEqual(result["status"], "skipped")
        self.assertIn("BUSY", result["note"])
        self.assertNotIn("event", result)

    def test_free_without_fields_writes_nothing(self):
        with mock.patch.object(config, "create_event") as create:
            result = config.do_calendar_create(row_with(gate="FREE"))
        create.assert_not_called()
        self.assertEqual(result["status"], "skipped")
        self.assertIn("no resolved fields", result["note"])

    def test_free_with_fields_writes_them(self):
        event = {"summary": "Barber", "start": "x", "end": "y"}
        row = row_with(gate="FREE")
        row["event"] = event
        with mock.patch.object(config, "create_event", return_value={"status": "created"}) as create:
            config.do_calendar_create(row)
        create.assert_called_once()
        self.assertIs(create.call_args[0][0], event)


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


class Write(unittest.TestCase):
    """The write is idempotent: the same title in the same window never lands twice."""

    def setUp(self):
        self.event = {"summary": "Barber", "location": None, "confidence": 0.9,
                      "start": datetime(2026, 11, 5, 15, 0, tzinfo=ZONE),
                      "end": datetime(2026, 11, 5, 16, 0, tzinfo=ZONE)}
        self.row = {"utterance": "barber tomorrow 3pm", "routes": []}

    def test_an_identical_event_blocks_a_second_write(self):
        payload = '{"events": [{"id": "abc", "summary": "barber", "htmlLink": "L"}]}'
        with mock.patch.object(config.subprocess, "run",
                               return_value=Completed(["gog"], 0, payload, "")) as run:
            result = config.create_event(self.event, self.row)
        self.assertEqual(run.call_count, 1)          # the check only
        self.assertEqual(result["status"], "skipped")
        self.assertIn("already on the calendar", result["note"])
        self.assertEqual(result["event"]["link"], "L")

    def test_a_different_title_lets_the_write_through(self):
        check = Completed(["gog"], 0, '{"events": [{"id": "x", "summary": "Other"}]}', "")
        created = Completed(["gog"], 0, '{"id": "new", "htmlLink": "L2"}', "")
        with mock.patch.object(config.subprocess, "run", side_effect=[check, created]) as run:
            result = config.create_event(self.event, self.row)
        self.assertEqual(run.call_count, 2)
        self.assertEqual(result["status"], "created")
        self.assertEqual(result["event"]["id"], "new")

    def test_a_failed_duplicate_check_still_writes(self):
        check = Completed(["gog"], 1, "", "boom")
        created = Completed(["gog"], 0, '{"id": "new"}', "")
        with mock.patch.object(config.subprocess, "run", side_effect=[check, created]):
            result = config.create_event(self.event, self.row)
        self.assertEqual(result["status"], "created")

    def test_an_empty_window_writes(self):
        check = Completed(["gog"], 0, '{"events": []}', "")
        created = Completed(["gog"], 0, '{"id": "new"}', "")
        with mock.patch.object(config.subprocess, "run", side_effect=[check, created]):
            result = config.create_event(self.event, self.row)
        self.assertEqual(result["status"], "created")

    def test_a_gog_failure_is_reported_not_raised(self):
        check = Completed(["gog"], 0, '{"events": []}', "")
        failed = Completed(["gog"], 1, "", "quota exceeded")
        with mock.patch.object(config.subprocess, "run", side_effect=[check, failed]):
            result = config.create_event(self.event, self.row)
        self.assertEqual(result["status"], "failed")
        self.assertIn("quota exceeded", result["note"])


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
