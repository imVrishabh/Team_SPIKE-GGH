import asyncio
import base64
import json
import re
from typing import Any

from google import genai
from google.genai import types

from app.config import settings


class GeminiService:
    def __init__(self) -> None:
        self.api_key = settings.gemini_api_key
        self.model = settings.gemini_model
        self.client = genai.Client(api_key=self.api_key) if self.api_key else None

    def available(self) -> bool:
        return self.client is not None

    def status(self) -> dict[str, Any]:
        return {
            "configured": bool(self.api_key),
            "available": self.available(),
            "model": self.model,
        }

    async def interpret_command(self, text: str, image_data: str | None = None) -> dict[str, Any]:
        if not text or not text.strip():
            return {"action": "unknown", "message": "Please enter a command first."}

        if not self.api_key:
            return self._fallback_intent(text, image_data)

        try:
            return await asyncio.to_thread(self._call_gemini, text, image_data)
        except Exception as exc:  # pragma: no cover - best-effort failure handling
            return {
                "action": "unknown",
                "message": f"Gemini could not process the request right now: {exc}",
                "error": str(exc),
            }

    def _call_gemini(self, text: str, image_data: str | None = None) -> dict[str, Any]:
        if not self.client:
            return self._fallback_intent(text, image_data)

        prompt = (
            "You are VIVA, a home assistant. Return ONLY valid JSON with these keys: "
            "action, message, scheduled_at, reminder_message, clarification. "
            "Allowed actions: light_on, light_off, create_reminder, list_reminders, cancel_reminder, "
            "describe_image, help, unknown. "
            "Use action=light_on for turning the bedroom light on; use light_off for OFF. "
            "Use create_reminder when the user asks to remind them. For reminders, include message, "
            "scheduled_at as ISO 8601 when known or a natural phrase if relative time is used, and "
            "reminder_message as the actual reminder text. If the request is unclear, ask for clarification "
            "instead of guessing. If unrelated, answer briefly with help or unknown. "
            "Examples: {'action':'light_on','message':'Turning on the bedroom light.'}; "
            "{'action':'create_reminder','message':'Reminder created.','scheduled_at':'2026-10-23T12:00:00+05:30','reminder_message':'Carry my notebook.'}; "
            "{'action':'list_reminders','message':'Showing your upcoming reminders.'}; "
            "{'action':'help','message':'Supported features: light control, reminders, and camera descriptions.'} "
            "Do not return markdown."
        )

        try:
            if image_data:
                binary = base64.b64decode(image_data)
                mime = "image/jpeg"
                response = self.client.models.generate_content(
                    model=self.model,
                    contents=[
                        types.Part.from_bytes(data=binary, mime_type=mime),
                        f"{prompt}\nUser request: {text}",
                    ],
                )
            else:
                response = self.client.models.generate_content(
                    model=self.model,
                    contents=f"{prompt}\nUser request: {text}",
                )

            raw_text = getattr(response, "text", "") or ""
            cleaned = self._extract_json(raw_text)
            if not cleaned:
                return self._fallback_intent(text, image_data)

            result = json.loads(cleaned)
            allowed = {
                "light_on",
                "light_off",
                "create_reminder",
                "list_reminders",
                "cancel_reminder",
                "describe_image",
                "help",
                "unknown",
            }
            action = result.get("action", "unknown")
            if action not in allowed:
                action = "unknown"

            return {
                "action": action,
                "message": result.get("message", "I understood your request."),
                "scheduled_at": result.get("scheduled_at"),
                "reminder_message": result.get("reminder_message"),
                "clarification": result.get("clarification"),
                "raw": raw_text,
            }
        except Exception as exc:
            return {
                "action": "unknown",
                "message": f"Gemini request failed. Please try again or use manual control: {exc}",
                "error": str(exc),
            }

    @staticmethod
    def _extract_json(raw_text: str) -> str | None:
        text = raw_text.strip()
        if not text:
            return None
        if text.startswith("```"):
            text = re.sub(r"^```(?:json)?\s*", "", text)
            text = re.sub(r"\s*```$", "", text)
        return text

    @staticmethod
    def _fallback_intent(text: str, image_data: str | None = None) -> dict[str, Any]:
        lowered = text.lower().strip()
        if image_data or "describe this image" in lowered or "describe the image" in lowered:
            return {"action": "describe_image", "message": "Image analysis requested. Please upload the image before analysis."}
        if any(word in lowered for word in ["turn on", "switch on", "light on"]):
            return {"action": "light_on", "message": "Turning on the bedroom light."}
        if any(word in lowered for word in ["turn off", "switch off", "light off"]):
            return {"action": "light_off", "message": "Turning off the bedroom light."}
        if ("reminders" in lowered and any(word in lowered for word in ["show", "list", "upcoming"])) or any(
            word in lowered for word in ["show reminders", "list reminders", "upcoming reminders", "my reminders"]
        ):
            return {"action": "list_reminders", "message": "Showing your upcoming reminders."}
        if "remind" in lowered or "reminder" in lowered:
            return {"action": "create_reminder", "message": "Reminder requested. Please clarify the time or message if it is not already clear.", "clarification": "Please tell me when and what to remind you about."}
        if any(word in lowered for word in ["help", "what can you do", "options"]):
            return {"action": "help", "message": "Supported features: bedroom light control, reminders, and image descriptions."}
        return {"action": "unknown", "message": "I can help with the bedroom light, reminders, or image descriptions."}
