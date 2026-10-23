import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()


@dataclass
class Settings:
    gemini_api_key: str | None = os.getenv("GEMINI_API_KEY")
    gemini_model: str = os.getenv("GEMINI_MODEL", "gemini-2.0-flash")
    hardware_mode: str = os.getenv("HARDWARE_MODE", "simulation").strip().lower()
    arduino_port: str | None = os.getenv("ARDUINO_PORT")
    arduino_baud: int = int(os.getenv("ARDUINO_BAUD", "9600"))
    reminder_db_path: str = os.getenv("REMINDER_DB_PATH", "data/reminders.db")
    face_db_path: str = os.getenv("FACE_DB_PATH", "data/face_recognition.db")
    face_match_threshold: float = float(os.getenv("FACE_MATCH_THRESHOLD", "75"))
    timezone_name: str = os.getenv("TIMEZONE", "Asia/Kolkata")

    @property
    def reminder_db_file(self) -> Path:
        return Path(self.reminder_db_path)

    @property
    def face_db_file(self) -> Path:
        return Path(self.face_db_path)


settings = Settings()
