import asyncio
import re
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from app.config import settings

_NUMBER_WORDS = {
    "zero": 0,
    "one": 1,
    "two": 2,
    "three": 3,
    "four": 4,
    "five": 5,
    "six": 6,
    "seven": 7,
    "eight": 8,
    "nine": 9,
    "ten": 10,
    "eleven": 11,
    "twelve": 12,
    "thirteen": 13,
    "fourteen": 14,
    "fifteen": 15,
    "sixteen": 16,
    "seventeen": 17,
    "eighteen": 18,
    "nineteen": 19,
    "twenty": 20,
}


class ReminderStore:
    def __init__(self, db_path: str | None = None) -> None:
        self.db_path = Path(db_path or settings.reminder_db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.timezone = ZoneInfo(settings.timezone_name)
        self._initialized = False
        self._loop_task: asyncio.Task | None = None

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def initialize(self) -> None:
        if self._initialized:
            return
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS reminders (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    message TEXT NOT NULL,
                    scheduled_at TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    fired_at TEXT,
                    canceled_at TEXT,
                    status TEXT DEFAULT 'upcoming'
                )
                """
            )
        self._initialized = True

    def create(self, message: str, scheduled_at: str | datetime) -> dict[str, Any]:
        if isinstance(scheduled_at, datetime):
            value = scheduled_at.astimezone(self.timezone).isoformat()
        else:
            value = scheduled_at

        created_at = datetime.now(self.timezone).isoformat()
        with self._connect() as conn:
            cur = conn.execute(
                "INSERT INTO reminders (message, scheduled_at, created_at, status) VALUES (?, ?, ?, 'upcoming')",
                (message.strip(), value, created_at),
            )
            reminder_id = cur.lastrowid
            row = conn.execute("SELECT * FROM reminders WHERE id = ?", (reminder_id,)).fetchone()
            return dict(row)

    def list_all(self) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT * FROM reminders WHERE canceled_at IS NULL ORDER BY scheduled_at ASC"
            ).fetchall()
            return [dict(row) for row in rows]

    def upcoming(self) -> list[dict[str, Any]]:
        now = datetime.now(self.timezone).isoformat()
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT * FROM reminders WHERE canceled_at IS NULL AND fired_at IS NULL AND scheduled_at > ? ORDER BY scheduled_at ASC",
                (now,),
            ).fetchall()
        return [dict(row) for row in rows]

    def cancel(self, reminder_id: int) -> dict[str, Any]:
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM reminders WHERE id = ?", (reminder_id,)).fetchone()
            if not row:
                return {"ok": False, "message": "Reminder not found."}
            conn.execute(
                "UPDATE reminders SET canceled_at = ?, status = 'canceled' WHERE id = ?",
                (datetime.now(self.timezone).isoformat(), reminder_id),
            )
            updated = conn.execute("SELECT * FROM reminders WHERE id = ?", (reminder_id,)).fetchone()
            return {"ok": True, "reminder": dict(updated)}

    def process_due(self) -> list[dict[str, Any]]:
        now = datetime.now(self.timezone)
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT * FROM reminders WHERE canceled_at IS NULL AND fired_at IS NULL AND scheduled_at <= ? ORDER BY scheduled_at ASC",
                (now.isoformat(),),
            ).fetchall()
            fired = []
            for row in rows:
                fired_at = now.isoformat()
                conn.execute(
                    "UPDATE reminders SET fired_at = ?, status = 'fired' WHERE id = ?",
                    (fired_at, row["id"]),
                )
                fired.append({**dict(row), "fired_at": fired_at, "status": "fired"})
        return fired

    async def reminder_loop(self) -> None:
        while True:
            self.process_due()
            await asyncio.sleep(2)

    def start_background_loop(self) -> None:
        if self._loop_task is None or self._loop_task.done():
            self._loop_task = asyncio.create_task(self.reminder_loop())

    def stop_background_loop(self) -> None:
        if self._loop_task is not None and not self._loop_task.done():
            self._loop_task.cancel()
            self._loop_task = None

    @staticmethod
    def _parse_number_word(value: str) -> int | None:
        cleaned = value.lower().strip()
        if cleaned.isdigit():
            return int(cleaned)
        return _NUMBER_WORDS.get(cleaned)

    @staticmethod
    def parse_relative_datetime(text: str, tz: ZoneInfo | None = None) -> tuple[str | None, str | None]:
        time_zone = tz or ZoneInfo(settings.timezone_name)
        now = datetime.now(time_zone)
        lowered = text.lower().strip()

        if not lowered:
            return None, None

        duration_match = re.search(
            r"(?:in\s+)?(\d+|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\s*(minute|minutes|hour|hours|day|days|second|seconds)",
            lowered,
        )
        if duration_match:
            amount_raw = duration_match.group(1)
            amount = ReminderStore._parse_number_word(amount_raw)
            if amount is None:
                return None, None
            unit = duration_match.group(2)
            if unit.startswith("minute"):
                delta = timedelta(minutes=amount)
            elif unit.startswith("hour"):
                delta = timedelta(hours=amount)
            elif unit.startswith("day"):
                delta = timedelta(days=amount)
            else:
                delta = timedelta(seconds=amount)
            due = now + delta
            return "Reminder", due.isoformat()

        time_match = re.search(r"(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?", lowered)
        if "tomorrow" in lowered and time_match:
            hour = int(time_match.group(1))
            minute = int(time_match.group(2) or 0)
            meridiem = time_match.group(3)
            if meridiem and meridiem.lower() == "pm" and hour < 12:
                hour += 12
            if meridiem and meridiem.lower() == "am" and hour == 12:
                hour = 0
            due = (now + timedelta(days=1)).replace(hour=hour, minute=minute, second=0, microsecond=0)
            return "Reminder", due.isoformat()

        if time_match:
            hour = int(time_match.group(1))
            minute = int(time_match.group(2) or 0)
            meridiem = time_match.group(3)
            if meridiem and meridiem.lower() == "pm" and hour < 12:
                hour += 12
            if meridiem and meridiem.lower() == "am" and hour == 12:
                hour = 0
            today = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
            if today <= now:
                today += timedelta(days=1)
            return "Reminder", today.isoformat()

        return None, None


reminder_store = ReminderStore()
