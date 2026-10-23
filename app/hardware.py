import re
import threading
import time
from typing import Any, Literal

import serial
from serial.tools import list_ports

from app.config import settings

HardwareMode = Literal["simulation", "usb", "bluetooth"]


class ArduinoHardware:
    def __init__(self) -> None:
        configured_mode = settings.hardware_mode
        self.mode: HardwareMode = (
            configured_mode if configured_mode in {"simulation", "usb", "bluetooth"} else "simulation"
        )
        self.port = settings.arduino_port
        self.baud = settings.arduino_baud
        self.connection: serial.Serial | None = None
        self.connected = False
        self.last_error = ""
        self.state = "OFF"
        self._lock = threading.RLock()

    @staticmethod
    def _port_details(port_info: Any) -> dict[str, str | None]:
        description = str(port_info.description or "").strip()
        hwid = str(port_info.hwid or "").strip()
        is_bluetooth_spp = "BTHENUM" in hwid.upper() and "00001101" in hwid.upper()
        return {
            "port": port_info.device,
            "device_name": None,
            "description": description or None,
            "hardware_id": hwid or None,
            "connection_type": "bluetooth" if is_bluetooth_spp else "serial",
        }

    @classmethod
    def discover_serial_ports(cls, bluetooth_only: bool = False) -> list[dict[str, str | None]]:
        devices = []
        for port_info in list_ports.comports():
            details = cls._port_details(port_info)
            if bluetooth_only and details["connection_type"] != "bluetooth":
                continue
            devices.append(details)
        return devices

    def _close_locked(self) -> str | None:
        connection = self.connection
        self.connection = None
        self.connected = False
        if not connection or not connection.is_open:
            return None
        try:
            connection.close()
        except (serial.SerialException, OSError) as exc:
            return f"Serial close failed: {exc}"
        return None

    @staticmethod
    def _valid_ack(response: str, command: str) -> bool:
        normalized = response.strip().upper()
        if command == "STATUS":
            return bool(
                re.fullmatch(r"OK STATUS(?: (?:ON|OFF))?", normalized)
                or normalized in {"STATUS:ON", "STATUS:OFF"}
            )
        return normalized in {f"OK {command}", f"OK:{command}"}

    def _read_ack_locked(self, command: str, timeout: float = 4.0) -> str | None:
        if not self.connection or not self.connection.is_open:
            return None

        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                raw = self.connection.readline()
            except (serial.SerialException, OSError) as exc:
                self._drop_locked(f"Serial read failed: {exc}")
                return None
            if not raw:
                continue
            response = raw.decode("utf-8", errors="replace").strip()
            if self._valid_ack(response, command):
                return response
        return None

    def _drop_locked(self, message: str) -> None:
        close_error = self._close_locked()
        self.last_error = f"{message} {close_error}" if close_error else message

    def connect(
        self,
        port: str | None = None,
        baud: int | None = None,
        mode: HardwareMode | None = None,
    ) -> dict[str, Any]:
        with self._lock:
            selected_mode = mode or self.mode
            if selected_mode == "simulation":
                close_error = self._close_locked()
                self.mode = "simulation"
                self.port = None
                self.last_error = close_error or ""
                return {
                    **self.status_snapshot(),
                    "ok": close_error is None,
                    "message": close_error or "SIMULATION MODE selected; no physical connection is active.",
                }

            selected_port = (port or self.port or "").strip().upper()
            selected_baud = baud or self.baud
            if not re.fullmatch(r"COM[1-9]\d*", selected_port):
                return {
                    **self.status_snapshot(),
                    "ok": False,
                    "message": "Select a valid Windows COM port, such as COM8.",
                }

            if (
                self.connection
                and self.connection.is_open
                and self.port == selected_port
                and self.baud == selected_baud
                and self.mode == selected_mode
            ):
                return self._test_locked()

            close_error = self._close_locked()
            if close_error:
                self.last_error = close_error
                return {**self.status_snapshot(), "ok": False, "message": close_error}
            self.mode = selected_mode
            self.port = selected_port
            self.baud = selected_baud
            self.state = "UNKNOWN"
            try:
                self.connection = serial.Serial(
                    selected_port,
                    selected_baud,
                    timeout=0.25,
                    write_timeout=2,
                )
                self.connection.reset_input_buffer()
                self.connection.reset_output_buffer()
                # Opening an Uno's serial port resets it; allow its sketch to start.
                time.sleep(1.5)
                self.connection.write(b"STATUS\n")
                acknowledgement = self._read_ack_locked("STATUS")
                if not acknowledgement:
                    self._drop_locked(
                        f"{selected_port} opened, but the Arduino did not acknowledge STATUS. "
                        "Check the HC-05 outgoing COM port, 9600 baud, wiring, and uploaded sketch."
                    )
                    return {
                        **self.status_snapshot(),
                        "ok": False,
                        "message": self.last_error,
                    }

                self.connected = True
                self.last_error = ""
                self._update_state_from_status(acknowledgement)
                return {
                    **self.status_snapshot(),
                    "ok": True,
                    "message": f"Arduino acknowledged STATUS on {selected_port}.",
                    "acknowledgement": acknowledgement,
                }
            except (serial.SerialException, OSError) as exc:
                self._drop_locked(f"Unable to open {selected_port}: {exc}")
                return {**self.status_snapshot(), "ok": False, "message": self.last_error}

    def connect_configured(self) -> dict[str, Any]:
        if self.mode == "simulation":
            return self.connect(mode="simulation")
        return self.connect(port=self.port, baud=self.baud, mode=self.mode)

    def disconnect(self) -> dict[str, Any]:
        with self._lock:
            close_error = self._close_locked()
            self.last_error = close_error or ""
            return {
                **self.status_snapshot(),
                "ok": close_error is None,
                "message": close_error or "Serial connection closed.",
            }

    def _test_locked(self) -> dict[str, Any]:
        if self.mode == "simulation":
            return {
                **self.status_snapshot(),
                "ok": True,
                "message": "SIMULATION MODE: no physical Arduino is connected.",
            }
        if not self.connection or not self.connection.is_open:
            return {
                **self.status_snapshot(),
                "ok": False,
                "message": self.last_error or "No serial connection is open.",
            }
        try:
            self.connection.reset_input_buffer()
            self.connection.write(b"STATUS\n")
            acknowledgement = self._read_ack_locked("STATUS")
        except (serial.SerialException, OSError) as exc:
            self._drop_locked(f"Connection test failed: {exc}")
            acknowledgement = None

        if not acknowledgement:
            if self.connection and self.connection.is_open:
                self._drop_locked(
                    "Serial port is open, but no valid STATUS acknowledgement was received."
                )
            return {
                **self.status_snapshot(),
                "ok": False,
                "message": self.last_error,
            }

        self.connected = True
        self.last_error = ""
        self._update_state_from_status(acknowledgement)
        return {
            **self.status_snapshot(),
            "ok": True,
            "message": f"Arduino acknowledged STATUS on {self.port}.",
            "acknowledgement": acknowledgement,
        }

    def test_connection(self) -> dict[str, Any]:
        with self._lock:
            return self._test_locked()

    def _update_state_from_status(self, response: str) -> None:
        match = re.search(r"\b(ON|OFF)\b", response.upper())
        if match:
            self.state = match.group(1)

    def _send_command(self, command: str) -> dict[str, Any]:
        with self._lock:
            if self.mode == "simulation":
                self.state = "ON" if command == "LIGHT_ON" else "OFF"
                return {
                    **self.status_snapshot(),
                    "ok": True,
                    "simulated": True,
                    "message": (
                        "SIMULATION MODE: command recorded for the demo; "
                        "no physical LED change is confirmed."
                    ),
                }

            if not self.connected or not self.connection or not self.connection.is_open:
                return {
                    **self.status_snapshot(),
                    "ok": False,
                    "simulated": False,
                    "message": self.last_error or "No acknowledged Arduino connection. Connect and test first.",
                }

            try:
                self.connection.reset_input_buffer()
                self.connection.write(f"{command}\n".encode("ascii"))
                acknowledgement = self._read_ack_locked(command)
            except (serial.SerialException, OSError) as exc:
                self._drop_locked(f"Serial command failed: {exc}")
                acknowledgement = None

            if not acknowledgement:
                if self.connection and self.connection.is_open:
                    self.last_error = f"No valid {command} acknowledgement received."
                return {
                    **self.status_snapshot(),
                    "ok": False,
                    "simulated": False,
                    "message": self.last_error,
                }

            self.state = "ON" if command == "LIGHT_ON" else "OFF"
            self.last_error = ""
            return {
                **self.status_snapshot(),
                "ok": True,
                "simulated": False,
                "acknowledgement": acknowledgement,
                "message": f"Arduino acknowledged {command}.",
            }

    def set_light_on(self) -> dict[str, Any]:
        return self._send_command("LIGHT_ON")

    def set_light_off(self) -> dict[str, Any]:
        return self._send_command("LIGHT_OFF")

    def read_status(self) -> dict[str, Any]:
        with self._lock:
            if self.mode == "simulation":
                return {
                    **self.status_snapshot(),
                    "ok": True,
                    "simulated": True,
                    "message": "SIMULATION MODE: no physical Arduino is connected.",
                }
            return self._test_locked()

    def status_snapshot(self, message: str | None = None) -> dict[str, Any]:
        snapshot = {
            "mode": self.mode,
            "port": self.port,
            "baud": self.baud,
            "connected": self.connected,
            "simulation": self.mode == "simulation" or not self.connected,
            "state": self.state,
            "last_error": self.last_error,
        }
        if message is not None:
            snapshot["message"] = message
        return snapshot


hardware = ArduinoHardware()
