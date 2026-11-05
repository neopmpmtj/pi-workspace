#!/usr/bin/env python3
"""Offline tests for the `reminder` node. No network, no JEV, no gog.

    python3 ~/.pi/decision-nodes/reminder/tests/test_reminder.py
"""
from __future__ import annotations

import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta
from unittest import mock
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import config  # noqa: E402
import reminder_store as store  # noqa: E402

ZONE = ZoneInfo(config.TIMEZONE)
NOW = datetime(2026, 11, 5, 14, 0, tzinfo=ZONE)


def won(cls="reminder", band="act", confidence=0.95):
    return {"abstained": False, "winner": {"class": cls, "band": band, "confidence": confidence}}


class Routing(unittest.TestCase):
    def test_a_reminder_logs_then_writes(self):
        self.assertEqual(config.router(won()), ["do:reminder:log", "do:reminder:calendar"])

    def test_a_done_message_closes(self):
        self.assertEqual(config.router(won("reminder_done")), ["do:reminder:done"])

    def test_hints_run_nothing(self):
        self.assertEqual(config.router(won(band="hint")), ["hint:reminder"])
        self.assertEqual(config.router(won("reminder_done", band="hint")), ["hint:reminder_done"])

    def test_other_winners_route_nothing(self):
        self.assertEqual(config.router(won("calendar")), [])
        self.assertEqual(config.router(won("none", band="none")), [])

    def test_an_abstain_fails_open(self):
        self.assertEqual(config.router({"abstained": True}), ["escalate"])

    def test_every_name_has_a_handler(self):
        for row in (won(), won("reminder_done"), won(band="hint"), won("reminder_done", band="hint")):
            for name in config.router(row):
                self.assertIn(name, config.DESTINATIONS)


class Defaults(unittest.TestCase):
    def ok(self, **overrides):
        base = {"title": "Buy milk", "date_local": None, "time_local": None,
                "kind": "reminder_request", "confidence": 0.9}
        base.update(overrides)
        return config.validate_reminder(base, NOW)

    def test_no_date_and_no_time_is_tomorrow_at_six(self):
        reminder, why = self.ok()
        self.assertIsNotNone(reminder, why)
        self.assertEqual(reminder["start"], datetime(2026, 11, 6, 6, 0, tzinfo=ZONE))
        self.assertTrue(reminder["date_defaulted"] and reminder["time_defaulted"])

    def test_a_named_day_without_time_is_six_that_day(self):
        reminder, _ = self.ok(date_local="2026-11-13")
        self.assertEqual(reminder["start"], datetime(2026, 11, 13, 6, 0, tzinfo=ZONE))

    def test_a_stated_time_is_kept(self):
        reminder, _ = self.ok(date_local="2026-11-06", time_local="15:00")
        self.assertEqual(reminder["start"].hour, 15)
        self.assertFalse(reminder["time_defaulted"])

    def test_today_without_time_moves_to_the_next_full_hour(self):
        reminder, _ = self.ok(date_local="2026-11-05")
        self.assertEqual(reminder["start"], datetime(2026, 11, 5, 15, 0, tzinfo=ZONE))

    def test_the_extractor_must_agree(self):
        reminder, why = self.ok(kind="calendar_request")
        self.assertIsNone(reminder)
        self.assertTrue(why.startswith(config.SECOND_OPINION))

    def test_low_confidence_and_empty_title_are_refused(self):
        self.assertIsNone(self.ok(confidence=0.2)[0])
        self.assertIsNone(self.ok(title="  ")[0])

    def test_unparsable_values_are_refused(self):
        self.assertIn("date", self.ok(date_local="next week-ish")[1])
        self.assertIn("time", self.ok(time_local="noonish")[1])


class StoreBase(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.path = os.path.join(self.dir, "reminders.jsonl")
        patcher = mock.patch.object(store, "STORE", self.path)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.deleted: list[str] = []

    def delete(self, event_id):
        self.deleted.append(event_id)
        return True, "deleted"

    def add(self, rid, title, due, at=NOW, event_id=None):
        store.append({"op": "add", "id": rid, "title": title, "due": due.isoformat()}, at)
        if event_id:
            store.append({"op": "event", "id": rid, "event_id": event_id, "link": "L"}, at)


class Store(StoreBase):
    def test_fold_gives_one_row_per_reminder(self):
        self.add("r-1", "Buy milk", NOW + timedelta(days=1), event_id="e1")
        self.add("r-2", "Pay light", NOW + timedelta(days=2))
        rows = store.listing()
        self.assertEqual([r["id"] for r in rows], ["r-1", "r-2"])
        self.assertEqual(rows[0]["event_id"], "e1")
        self.assertTrue(all(r["status"] == "pending" for r in rows))

    def test_done_deletes_a_future_event(self):
        self.add("r-1", "Buy milk", NOW + timedelta(days=1), event_id="e1")
        result = store.mark_done("r-1", "command", NOW, self.delete)
        self.assertEqual((result["status"], result["event"]), ("done", "deleted"))
        self.assertEqual(self.deleted, ["e1"])
        self.assertEqual(store.listing(), [])
        self.assertEqual(store.listing(True)[0]["status"], "done")

    def test_done_keeps_a_past_event(self):
        self.add("r-1", "Buy milk", NOW - timedelta(hours=2), event_id="e1")
        result = store.mark_done("r-1", "command", NOW, self.delete)
        self.assertEqual(result["event"], "kept-past")
        self.assertEqual(self.deleted, [])

    def test_done_twice_changes_nothing(self):
        self.add("r-1", "Buy milk", NOW + timedelta(days=1))
        store.mark_done("r-1", "command", NOW, self.delete)
        self.assertEqual(store.mark_done("r-1", "command", NOW, self.delete)["status"], "unchanged")
        self.assertEqual(store.mark_done("r-9", "command", NOW, self.delete)["status"], "unknown")

    def test_undo_withdraws_the_newest_pending(self):
        self.add("r-1", "Old", NOW + timedelta(days=1), at=NOW - timedelta(hours=1))
        self.add("r-2", "New", NOW + timedelta(days=1), event_id="e2")
        result = store.undo_last(NOW, self.delete)
        self.assertEqual((result["status"], result["id"]), ("undone", "r-2"))
        self.assertEqual(self.deleted, ["e2"])
        self.assertEqual([r["id"] for r in store.listing()], ["r-1"])

    def test_lines_from_two_hosts_fold_by_time(self):
        later = NOW + timedelta(minutes=5)
        store.append({"op": "done", "id": "r-1", "how": "natural", "event": "none"}, later)
        self.add("r-1", "Buy milk", NOW + timedelta(days=1))
        self.assertEqual(store.listing(True)[0]["status"], "done")


class Done(StoreBase):
    def test_no_pending_reminders_is_no_match(self):
        result = config.do_reminder_done({"utterance": "I bought the milk"})
        self.assertEqual(result["status"], "no-match")

    def test_a_confident_match_closes_it(self):
        self.add("r-1", "Buy milk", NOW + timedelta(days=1))
        with mock.patch.object(config, "match_pending", return_value=("r-1", 0.95, "")), \
                mock.patch.object(config.calendar_config, "delete_event", side_effect=self.delete):
            result = config.do_reminder_done({"utterance": "I bought the milk"})
        self.assertEqual(result["status"], "done")
        self.assertEqual(store.listing(), [])

    def test_the_match_guard(self):
        rows = [{"id": "r-1", "title": "Buy milk", "due": "x"}]
        self.assertEqual(config.pick_match({"id": "r-1", "confidence": 0.9}, rows)[0], "r-1")
        self.assertIsNone(config.pick_match({"id": "r-1", "confidence": 0.5}, rows)[0])
        self.assertIsNone(config.pick_match({"id": "r-7", "confidence": 0.99}, rows)[0])
        self.assertIsNone(config.pick_match({"id": None, "confidence": 0.99}, rows)[0])
        self.assertIsNone(config.pick_match("junk", rows)[0])


class Calendar(StoreBase):
    def test_the_event_is_written_and_recorded(self):
        start = datetime.now(ZONE) + timedelta(days=1)
        row = {"utterance": "remind me to buy milk",
               "logged": {"id": "r-1", "title": "Buy milk", "start": start, "confidence": 0.9}}
        self.add("r-1", "Buy milk", start)
        created = {"destination": "do:calendar:create", "status": "created",
                   "event": {"id": "e1", "link": "L"}}
        with mock.patch.object(config.calendar_config, "create_event", return_value=created) as create:
            result = config.do_reminder_calendar(row)
        event = create.call_args.args[0]
        self.assertEqual(event["summary"], "Reminder: Buy milk")
        self.assertEqual(event["end"] - event["start"], timedelta(minutes=config.DEFAULT_MINUTES))
        self.assertEqual(result["destination"], "do:reminder:calendar")
        self.assertEqual(store.listing()[0]["event_id"], "e1")

    def test_nothing_logged_writes_nothing(self):
        self.assertEqual(config.do_reminder_calendar({})["status"], "skipped")

    def test_a_past_slot_is_logged_only(self):
        row = {"logged": {"id": "r-1", "title": "x", "start": datetime.now(ZONE) - timedelta(hours=1),
                          "confidence": 0.9}}
        self.assertIn("past", config.do_reminder_calendar(row)["note"])


if __name__ == "__main__":
    unittest.main(verbosity=1)
