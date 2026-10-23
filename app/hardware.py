import os
import time
from datetime import datetime
from typing import Any

import serial

from app.config import settings


class ArduinoHardware:
    def __init__(self) -> None:
        self.mode = settings.hardware_mode
        self.port = settings.arduino_port
        self.baud = settings.arduino_baud
        self.connection = None
        self.connected = False
        self.last_error = ""
        self.state = "OFF"
        self.simulation = self.mode == "simulation"

    def _is_serial_mode(self) -> bool:
        return self.mode in {"usb", "bluetooth"}

    def connect(self) -> dict[str, Any]:
        if self.mode == "simulation":
            self.connected = False
            self.simulation = True
            self.last_error = "SIMULATION MODE: hardware not connected."
            return {
                "ok": True,
                "mode": "simulation",
                "connected": False,
                "message": "Simulation mode active; no physical Arduino connected.",
            }

        if not self.port:
            self.connected = False
            self.simulation = True
            self.last_error = "No ARDUINO_PORT configured for this hardware mode."
            return {
                "ok": False,
                "mode": self.mode,
                "connected": False,
                "message": "Arduino port is not configured. Set ARDUINO_PORT to the device COM port.",
            }

        try:
            self.connection = serial.Serial(self.port, self.baud, timeout=1)
            self.connected = self.connection.is_open
            self.simulation = False
            if self.connected:
                self.last_error = ""
                self.connection.reset_input_buffer()
                self.connection.reset_output_buffer()
                return {
                    "ok": True,
                    "mode": self.mode,
                    "connected": True,
                    "message": f"Connected to Arduino on {self.port}.",
                }
        except (serial.SerialException, OSError) as exc:
            self.connected = False
            self.simulation = True
            self.last_error = f"Unable to open {self.port}: {exc}"
            return {
                "ok": False,
                "mode": self.mode,
                "connected": False,
                "message": self.last_error,
            }

        self.connected = False
        self.simulation = True
        self.last_error = "Arduino connection could not be established."
        return {
            "ok": False,
            "mode": self.mode,
            "connected": False,
            "message": self.last_error,
        }

    def disconnect(self) -> dict[str, Any]:
        if self.connection and self.connection.is_open:
            self.connection.close()
        self.connection = None
        self.connected = False
        self.simulation = self.mode == "simulation"
        self.last_error = "" if self.simulation else "Disconnected from Arduino."
        return {
            "ok": True,
            "mode": self.mode,
            "connected": False,
            "message": "Arduino disconnected.",
        }

    def test_connection(self) -> dict[str, Any]:
        if self.mode == "simulation":
            return {
                "ok": True,
                "mode": "simulation",
                "connected": False,
                "simulation": True,
                "message": "SIMULATION MODE: no hardware connection is active.",
            }

        if not self.connection or not self.connection.is_open:
            result = self.connect()
            if not result["ok"]:
                return {
                    "ok": False,
                    "mode": self.mode,
                    "connected": False,
                    "simulation": True,
                    "message": result["message"],
                }

        self.connection.write(b"STATUS\n")
        time.sleep(0.2)
        response = self.read_response()
        return {
            "ok": True,
            "mode": self.mode,
            "connected": True,
            "simulation": False,
            "message": response or "Arduino responded.",
        }

    def read_response(self) -> str:
        if self.mode == "simulation" or not self.connection or not self.connection.is_open:
            return "SIMULATION MODE: no physical Arduino connected."

        try:
            raw = self.connection.readline()
        except serial.SerialException:
            self.connected = False
            self.last_error = "Serial communication error."
            return self.last_error

        if raw:
            decoded = raw.decode("utf-8", errors="replace").strip()
            if decoded:
                return decoded
        return "No response received from Arduino."

    def _send_command(self, command: str) -> dict[str, Any]:
        if self.mode == "simulation":
            self.state = "ON" if command == "LIGHT_ON" else "OFF" if command == "LIGHT_OFF" else self.state
            return {
                "ok": True,
                "mode": "simulation",
                "connected": False,
                "simulated": True,
                "state": self.state,
                "message": "SIMULATION MODE: physical LED state is not confirmed. The command was queued for display only.",
            }

        if not self.connection or not self.connection.is_open:
            result = self.connect()
            if not result["ok"]:
                return {
                    "ok": False,
                    "mode": self.mode,
                    "connected": False,
                    "simulated": True,
                    "state": self.state,
                    "message": result["message"],
                }

        try:
            self.connection.write(f"{command}\n".encode("utf-8"))
            time.sleep(0.15)
            response = self.read_response()
            self.state = "ON" if command == "LIGHT_ON" else "OFF" if command == "LIGHT_OFF" else self.state
            return {
                "ok": True,
                "mode": self.mode,
                "connected": True,
                "simulated": False,
                "state": self.state,
                "message": response,
            }
        except serial.SerialException as exc:  # pragma: no cover
            self.connected = False
            self.last_error = str(exc)
            return {
                "ok": False,
                "mode": self.mode,
                "connected": False,
                "simulated": True,
                "state": self.state,
                "message": f"Serial error: {exc}",
            }

    def set_light_on(self) -> dict[str, Any]:
        return self._send_command("LIGHT_ON")

    def set_light_off(self) -> dict[str, Any]:
        return self._send_command("LIGHT_OFF")

    def read_status(self) -> dict[str, Any]:
        if self.mode == "simulation":
            return {
                "ok": True,
                "mode": "simulation",
                "connected": False,
                "simulated": True,
                "state": self.state,
                "message": "SIMULATION MODE: no physical Arduino is connected.",
            }

        if not self.connection or not self.connection.is_open:
            result = self.connect()
            if not result["ok"]:
                return {
                    "ok": False,
                    "mode": self.mode,
                    "connected": False,
                    "simulated": True,
                    "state": self.state,
                    "message": result["message"],
                }

        try:
            self.connection.write(b"STATUS\n")
            time.sleep(0.2)
            response = self.read_response()
            if response.upper().startswith("STATUS:"):
                self.state = response.split(":", 1)[1].strip().upper()
            return {
                "ok": True,
                "mode": self.mode,
                "connected": True,
                "simulated": False,
                "state": self.state,
                "message": response,
            }
        except serial.SerialException as exc:  # pragma: no cover
            return {
                "ok": False,
                "mode": self.mode,
                "connected": False,
                "simulated": True,
                "state": self.state,
                "message": f"Status read failed: {exc}",
            }

    def status_snapshot(self) -> dict[str, Any]:
        return {
            "mode": self.mode,
            "connected": self.connected,
            "simulation": self.mode == "simulation" or not self.connected,
            "state": self.state,
            "last_error": self.last_error,
        }


hardware = ArduinoHardware()
