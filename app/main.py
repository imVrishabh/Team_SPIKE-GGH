import re
from datetime import datetime
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, ValidationError

from app.gemini_service import GeminiService
from app.hardware import hardware
from app.reminders import reminder_store

app = FastAPI(title="VIVA Home Companion")
app.mount("/static", StaticFiles(directory="static"), name="static")

gemini_service = GeminiService()

MAX_IMAGE_BYTES = 10 * 1024 * 1024


class ReminderCreateRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=200)
    scheduled_at: str = Field(..., min_length=1, max_length=200)


class CommandRequest(BaseModel):
    command: str | None = Field(default=None, max_length=500)
    text: str | None = Field(default=None, max_length=500)
    image_data: str | None = None
    reminder_message: str | None = Field(default=None, max_length=200)
    scheduled_at: str | None = Field(default=None, max_length=200)


class ImageAnalysisRequest(BaseModel):
    image_data: str = Field(..., min_length=1)
    prompt: str | None = Field(default="Describe this image in a concise and useful way.", max_length=500)


@app.on_event("startup")
def startup_event() -> None:
    reminder_store.initialize()
    reminder_store.start_background_loop()
    hardware.connect()


@app.on_event("shutdown")
def shutdown_event() -> None:
    reminder_store.stop_background_loop()
    if hardware.connection and hardware.connection.is_open:
        hardware.disconnect()


@app.get("/")
def index() -> FileResponse:
    return FileResponse("static/index.html")


@app.get("/api/status")
def api_status() -> dict[str, Any]:
    hardware_status = hardware.status_snapshot()
    return {
        "backend": "ok",
        "gemini": gemini_service.status(),
        "arduino": hardware_status,
        "simulation": hardware_status["simulation"],
        "timestamp": datetime.now().isoformat(),
    }


@app.get("/api/reminders")
def list_reminders_api() -> dict[str, Any]:
    reminders = reminder_store.list_all()
    transformed: list[dict[str, Any]] = []
    for item in reminders:
        status = "upcoming"
        if item.get("fired_at"):
            status = "fired"
        elif item.get("canceled_at"):
            status = "canceled"
        transformed.append({**item, "status": status})
    return {"ok": True, "items": transformed}


@app.post("/api/reminders")
async def create_reminder_api(request: Request) -> dict[str, Any]:
    try:
        payload = ReminderCreateRequest.model_validate(await request.json())
    except ValidationError as exc:
        raise HTTPException(status_code=400, detail=exc.errors()) from exc

    message = payload.message.strip()
    scheduled_at = payload.scheduled_at.strip()
    if not message:
        raise HTTPException(status_code=400, detail="Reminder message is required.")
    if not scheduled_at:
        raise HTTPException(status_code=400, detail="Reminder scheduled_at is required.")
    reminder = reminder_store.create(message, scheduled_at)
    return {"ok": True, "reminder": reminder, "message": "Reminder created."}


@app.delete("/api/reminders/{reminder_id}")
def cancel_reminder_api(reminder_id: int) -> dict[str, Any]:
    result = reminder_store.cancel(reminder_id)
    if not result["ok"]:
        raise HTTPException(status_code=404, detail=result["message"])
    return result


@app.get("/api/light/status")
def light_status() -> dict[str, Any]:
    result = hardware.read_status()
    return {"ok": True, **result}


@app.post("/api/light/on")
def set_light_on() -> dict[str, Any]:
    result = hardware.set_light_on()
    return {"ok": result["ok"], **result}


@app.post("/api/light/off")
def set_light_off() -> dict[str, Any]:
    result = hardware.set_light_off()
    return {"ok": result["ok"], **result}


@app.post("/api/command")
async def handle_command(request: Request) -> dict[str, Any]:
    try:
        payload = CommandRequest.model_validate(await request.json())
    except ValidationError as exc:
        raise HTTPException(status_code=400, detail=exc.errors()) from exc

    text = (payload.command or payload.text or "").strip()
    image_data = payload.image_data
    if not text:
        return JSONResponse(status_code=400, content={"ok": False, "message": "No command was provided."})

    intent = await gemini_service.interpret_command(text, image_data)
    action = intent.get("action", "unknown")

    if action == "light_on":
        result = hardware.set_light_on()
        return {"ok": True, "action": "light_on", **result}

    if action == "light_off":
        result = hardware.set_light_off()
        return {"ok": True, "action": "light_off", **result}

    if action == "list_reminders":
        reminders = reminder_store.list_all()
        return {"ok": True, "action": "list_reminders", "items": reminders}

    if action == "create_reminder":
        reminder_message = (
            intent.get("reminder_message")
            or payload.reminder_message
            or extract_reminder_message(text)
        )
        scheduled_at = (
            intent.get("scheduled_at")
            or payload.scheduled_at
            or parse_reminder_datetime(text)
        )
        if not reminder_message or not scheduled_at:
            return {
                "ok": False,
                "action": "create_reminder",
                "message": "Please clarify the reminder message and time before I set it.",
            }
        created = reminder_store.create(reminder_message, scheduled_at)
        return {
            "ok": True,
            "action": "create_reminder",
            "message": f"Reminder set: {reminder_message} at {scheduled_at}",
            "reminder": created,
        }

    if action == "cancel_reminder":
        reminder_id = extract_reminder_id(text)
        if reminder_id is None:
            return {
                "ok": False,
                "action": "cancel_reminder",
                "message": "Please tell me which reminder number to cancel.",
            }
        result = reminder_store.cancel(reminder_id)
        if not result["ok"]:
            return {"ok": False, "action": "cancel_reminder", "message": result["message"]}
        return {"ok": True, "action": "cancel_reminder", "reminder": result["reminder"]}

    if action == "describe_image":
        if not image_data:
            return {"ok": False, "action": "describe_image", "message": "Please provide an image before requesting analysis."}
        response = await gemini_service.interpret_command(text, image_data)
        return {"ok": True, "action": "describe_image", "result": response}

    if action == "help":
        return {"ok": True, "action": "help", "message": "Supported commands: turn on/off the bedroom light, create or list reminders, and describe an image."}

    return {"ok": False, "action": "unknown", "message": intent.get("message", "I did not understand that request.")}


@app.post("/api/camera/analyze")
async def analyze_image(request: Request) -> dict[str, Any]:
    try:
        payload = ImageAnalysisRequest.model_validate(await request.json())
    except ValidationError as exc:
        raise HTTPException(status_code=400, detail=exc.errors()) from exc

    image_data = payload.image_data
    if len(image_data) > MAX_IMAGE_BYTES * 2:
        raise HTTPException(status_code=413, detail="Image is too large. Please use a smaller file.")

    result = await gemini_service.interpret_command(payload.prompt or "Describe this image in a concise and useful way.", image_data)
    if result.get("action") == "unknown":
        return {"ok": False, "message": result.get("message", "Image analysis failed.")}
    return {"ok": True, "result": result}


def extract_reminder_message(text: str) -> str | None:
    normalized = text.strip()
    if not normalized:
        return None

    without_prefix = re.sub(r"^(?:remind me|reminder|notify me)\s+(?:to\s+)?", "", normalized, flags=re.IGNORECASE)
    if not without_prefix.strip():
        return None

    time_pattern = r"(?:in\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\s*(?:minute|minutes|hour|hours|day|days|second|seconds)|tomorrow(?:\s+at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?|today(?:\s+at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?|at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?)"
    match = re.search(time_pattern, without_prefix, flags=re.IGNORECASE)
    if match:
        before = without_prefix[:match.start()].strip()
        after = without_prefix[match.end():].strip()
        candidates = []
        for candidate in [before, after]:
            candidate = re.sub(r"^(?:to\s+|for\s+)", "", candidate, flags=re.IGNORECASE)
            candidate = candidate.strip(" .")
            if candidate:
                candidates.append(candidate)
        if candidates:
            return max(candidates, key=len)

    cleaned = re.sub(r"^(?:to\s+|for\s+)", "", without_prefix, flags=re.IGNORECASE)
    return cleaned.strip(" .") or normalized


def parse_reminder_datetime(text: str) -> str | None:
    due = reminder_store.parse_relative_datetime(text)[1]
    if due:
        return due
    lowered = text.lower()
    if "tomorrow" in lowered or "today" in lowered or re.search(r"\bat\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?", lowered):
        due = reminder_store.parse_relative_datetime(text)[1]
        return due
    return None


def extract_reminder_id(text: str) -> int | None:
    match = re.search(r"(?:reminder\s*#?|id\s*[:=])\s*(\d+)", text, flags=re.IGNORECASE)
    if match:
        return int(match.group(1))
    match = re.search(r"(\d+)", text)
    if match:
        return int(match.group(1))
    return None


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
    
