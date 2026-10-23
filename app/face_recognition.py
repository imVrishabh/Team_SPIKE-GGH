import base64
import binascii
import sqlite3
import threading
from contextlib import closing
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import cv2
import numpy as np

MAX_IMAGE_BYTES = 5 * 1024 * 1024
MAX_IMAGE_PIXELS = 20_000_000
FACE_SIZE = (160, 160)


class FaceRecognitionError(Exception):
    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


@dataclass
class FaceRecord:
    person_id: int
    name: str
    sample: np.ndarray


class FaceRecognitionStore:
    def __init__(self, database_path: Path, match_threshold: float) -> None:
        if not 10 <= match_threshold <= 150:
            raise ValueError("FACE_MATCH_THRESHOLD must be between 10 and 150.")
        if not hasattr(cv2, "face") or not hasattr(cv2.face, "LBPHFaceRecognizer_create"):
            raise RuntimeError(
                "OpenCV contrib is required for local face recognition. Install opencv-contrib-python-headless."
            )
        self.database_path = database_path
        self.match_threshold = match_threshold
        self._lock = threading.RLock()
        self._recognizer: Any | None = None
        self._names: dict[int, str] = {}
        cascade_path = Path(cv2.data.haarcascades) / "haarcascade_frontalface_default.xml"
        self._face_detector = cv2.CascadeClassifier(str(cascade_path))
        if self._face_detector.empty():
            raise RuntimeError(f"Could not load OpenCV face detector: {cascade_path}")

    def initialize(self) -> None:
        with self._lock:
            self.database_path.parent.mkdir(parents=True, exist_ok=True)
            with closing(self._connect()) as connection, connection:
                connection.execute(
                    """
                    CREATE TABLE IF NOT EXISTS people (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        name TEXT NOT NULL COLLATE NOCASE UNIQUE
                    )
                    """
                )
                connection.execute(
                    """
                    CREATE TABLE IF NOT EXISTS face_samples (
                        person_id INTEGER PRIMARY KEY REFERENCES people(id) ON DELETE CASCADE,
                        sample_png BLOB NOT NULL
                    )
                    """
                )
                connection.execute("PRAGMA foreign_keys = ON")
                records = self._read_records(connection)
            self._set_model(records)

    def list_people(self) -> list[dict[str, Any]]:
        with self._lock, closing(self._connect()) as connection:
            rows = connection.execute("SELECT id, name FROM people ORDER BY name").fetchall()
        return [{"id": row["id"], "name": row["name"]} for row in rows]

    def enroll(self, image_bytes: bytes, name: str) -> dict[str, Any]:
        clean_name = name.strip()
        if not clean_name or len(clean_name) > 50:
            raise FaceRecognitionError("Enter a name between 1 and 50 characters.")
        image = self._decode_image(image_bytes)
        detected = self._detect_faces(image)
        if len(detected) == 0:
            raise FaceRecognitionError("No face was detected. Choose a clear, well-lit photo with one visible face.")
        if len(detected) > 1:
            raise FaceRecognitionError("More than one face was detected. Upload a photo containing only one person.")

        sample = self._normalize_face(image, detected[0])
        success, encoded_sample = cv2.imencode(".png", sample)
        if not success:
            raise FaceRecognitionError("Could not process the selected face image.")

        with self._lock:
            try:
                with closing(self._connect()) as connection, connection:
                    cursor = connection.execute("INSERT INTO people(name) VALUES (?)", (clean_name,))
                    person_id = int(cursor.lastrowid)
                    connection.execute(
                        "INSERT INTO face_samples(person_id, sample_png) VALUES (?, ?)",
                        (person_id, encoded_sample.tobytes()),
                    )
                    records = self._read_records(connection)
                self._set_model(records)
            except sqlite3.IntegrityError as exc:
                raise FaceRecognitionError("A person with that name is already enrolled.", 409) from exc

        return {"id": person_id, "name": clean_name}

    def delete_person(self, person_id: int) -> None:
        with self._lock:
            with closing(self._connect()) as connection, connection:
                connection.execute("PRAGMA foreign_keys = ON")
                records = self._read_records(connection, excluded_person_id=person_id)
                cursor = connection.execute("DELETE FROM people WHERE id = ?", (person_id,))
                if cursor.rowcount == 0:
                    raise FaceRecognitionError("That enrolled person was not found.", 404)
            self._set_model(records)

    def recognize(self, image_data: str) -> dict[str, Any]:
        image_bytes = self._decode_data_url(image_data)
        image = self._decode_image(image_bytes)
        detected = self._detect_faces(image)
        with self._lock:
            recognizer = self._recognizer
            names = self._names.copy()
            faces = []
            for rectangle in detected:
                sample = self._normalize_face(image, rectangle)
                name = "Unknown Person"
                distance: float | None = None
                if recognizer is not None:
                    label, distance_value = recognizer.predict(sample)
                    distance = round(float(distance_value), 2)
                    name = self._matched_name(label, distance_value, names, self.match_threshold)
                x, y, width, height = rectangle
                faces.append(
                    {
                        "box": {"x": x, "y": y, "width": width, "height": height},
                        "name": name,
                        "recognized": name != "Unknown Person",
                        "distance": distance,
                    }
                )
        return {
            "ok": True,
            "faces": faces,
            "frame_width": int(image.shape[1]),
            "frame_height": int(image.shape[0]),
            "message": "Face recognized." if any(face["recognized"] for face in faces)
            else "Unknown Person." if faces
            else "No face detected.",
        }

    @staticmethod
    def _matched_name(
        label: int,
        distance: float,
        names: dict[int, str],
        threshold: float,
    ) -> str:
        if label in names and distance <= threshold:
            return names[label]
        return "Unknown Person"

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database_path, timeout=5)
        connection.row_factory = sqlite3.Row
        return connection

    def _read_records(
        self,
        connection: sqlite3.Connection,
        excluded_person_id: int | None = None,
    ) -> list[FaceRecord]:
        query = """
            SELECT people.id, people.name, face_samples.sample_png
            FROM people JOIN face_samples ON people.id = face_samples.person_id
        """
        parameters: tuple[int, ...] = ()
        if excluded_person_id is not None:
            query += " WHERE people.id != ?"
            parameters = (excluded_person_id,)
        query += " ORDER BY people.id"
        rows = connection.execute(query, parameters).fetchall()
        records: list[FaceRecord] = []
        for row in rows:
            sample = cv2.imdecode(
                np.frombuffer(row["sample_png"], dtype=np.uint8),
                cv2.IMREAD_GRAYSCALE,
            )
            if sample is None:
                raise RuntimeError(f"Stored face sample for person {row['id']} is unreadable.")
            records.append(FaceRecord(row["id"], row["name"], sample))
        return records

    def _set_model(self, records: list[FaceRecord]) -> None:
        if not records:
            self._recognizer = None
            self._names = {}
            return
        recognizer = cv2.face.LBPHFaceRecognizer_create(
            radius=1,
            neighbors=8,
            grid_x=8,
            grid_y=8,
        )
        recognizer.train(
            [record.sample for record in records],
            np.asarray([record.person_id for record in records], dtype=np.int32),
        )
        self._recognizer = recognizer
        self._names = {record.person_id: record.name for record in records}

    def _decode_image(self, image_bytes: bytes) -> np.ndarray:
        if not image_bytes or len(image_bytes) > MAX_IMAGE_BYTES:
            raise FaceRecognitionError("Image is empty or larger than 5 MB.", 413)
        image = cv2.imdecode(np.frombuffer(image_bytes, dtype=np.uint8), cv2.IMREAD_COLOR)
        if image is None:
            raise FaceRecognitionError("The selected file is not a supported, readable image.")
        if image.shape[0] * image.shape[1] > MAX_IMAGE_PIXELS:
            raise FaceRecognitionError("Image dimensions are too large. Choose an image under 20 megapixels.", 413)
        return image

    def _decode_data_url(self, image_data: str) -> bytes:
        try:
            header, encoded = image_data.split(",", 1)
        except ValueError as exc:
            raise FaceRecognitionError("Camera frame data is invalid.") from exc
        if header not in ("data:image/jpeg;base64", "data:image/png;base64"):
            raise FaceRecognitionError("Camera frames must be JPEG or PNG images.")
        if len(encoded) > (MAX_IMAGE_BYTES * 4 // 3) + 8:
            raise FaceRecognitionError("Camera frame is too large.", 413)
        try:
            return base64.b64decode(encoded, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise FaceRecognitionError("Camera frame data is not valid base64.") from exc

    def _detect_faces(self, image: np.ndarray) -> list[tuple[int, int, int, int]]:
        height, width = image.shape[:2]
        scale = min(1.0, 1280 / max(width, height))
        resized = cv2.resize(image, None, fx=scale, fy=scale) if scale < 1 else image
        gray = cv2.cvtColor(resized, cv2.COLOR_BGR2GRAY)
        gray = cv2.equalizeHist(gray)
        found = self._face_detector.detectMultiScale(
            gray,
            scaleFactor=1.1,
            minNeighbors=5,
            minSize=(40, 40),
        )
        inverse_scale = 1 / scale
        return [
            (
                max(0, round(x * inverse_scale)),
                max(0, round(y * inverse_scale)),
                min(width, round(face_width * inverse_scale)),
                min(height, round(face_height * inverse_scale)),
            )
            for x, y, face_width, face_height in found
        ]

    @staticmethod
    def _normalize_face(
        image: np.ndarray,
        rectangle: tuple[int, int, int, int],
    ) -> np.ndarray:
        x, y, width, height = rectangle
        margin = round(max(width, height) * 0.15)
        x0 = max(0, x - margin)
        y0 = max(0, y - margin)
        x1 = min(image.shape[1], x + width + margin)
        y1 = min(image.shape[0], y + height + margin)
        crop = image[y0:y1, x0:x1]
        gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
        gray = cv2.equalizeHist(gray)
        return cv2.resize(gray, FACE_SIZE, interpolation=cv2.INTER_AREA)
