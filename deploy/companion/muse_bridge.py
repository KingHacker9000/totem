"""Restricted registry for the unmodified upstream Muse Linux transport.

Launch this module instead of `musegadget run`. Never instantiate upstream Executor.
Transport state belongs to the musegadget account, companion state to another user.
"""
import asyncio
import json
import logging
import os
import signal
import socket
from pathlib import Path
from types import SimpleNamespace
from musegadget import config, identity
from musegadget import service as upstream


def spec(description, required=None, optional=None):
    def fields(values):
        return {k: {"type": kind, "description": desc} for k, (kind, desc) in (values or {}).items()}
    return {"description": description, "required": fields(required), "optional": fields(optional), "timeout_ms": 15000}

COMMANDS = {
    "totem.set_brightness": spec("Set touchscreen backlight brightness.", {"percent": ("integer", "1 to 100")}),
    "totem.health": spec("Read Pi/Totem health and Muse connectivity."),
    "totem.avatar.set_state": spec("Change the physical companion. Put sunglasses on with accessory=sunglasses. No audio hardware.", optional={
        "mood": ("string", "neutral, pleased, smug, confused, concerned, excited, annoyed, alarmed"),
        "activity": ("string", "idle, attentive, thinking, working, sleeping, celebrating, focus"),
        "energy": ("number", "0 to 1"), "accessory": ("string", "none, sunglasses, laptop, clock")}),
    "totem.avatar.react": spec("Make a temporary physical reaction.", {"reaction": ("string", "boop, blink, wake, success, error, curious, celebrate, sunglasses_tilt")}),
    "totem.avatar.look_at": spec("Look toward a normalized screen position.", {"x": ("number", "-1 to 1"), "y": ("number", "-1 to 1")}),
    "totem.notify": spec("Show a temporary notice; critical alerts persist until acknowledged.", {"title": ("string", "Up to 90 characters")}, {"detail": ("string", "Up to 300 characters"), "severity": ("string", "info, attention, urgent, critical"), "dedupeKey": ("string", "Stable event key"), "ttlSeconds": ("number", "3 to 86400")}),
    "totem.show_card": spec("Show a compact context card around the character.", {"title": ("string", "Up to 90 characters")}, {"detail": ("string", "Up to 300 characters"), "ttlSeconds": ("number", "3 to 86400")}),
    "totem.dismiss": spec("Acknowledge a physical notice by its ID.", {"id": ("string", "Alert ID from health/display event")}),
    "totem.focus": spec("Start focus/break timer, or minutes=0 to end it.", {"minutes": ("number", "0 to 180")}, {"kind": ("string", "focus or break")}),
    "totem.next": spec("Show the next assignment or calendar item using existing local connectors."),
    "totem.briefing": spec("Show a concise day briefing."),
    "totem.restart_display": spec("Restart only the Totem Chromium kiosk; no general service access."),
    "totem.restart_core": spec("Request Totem core restart; requires physical confirmation and is unavailable until local approval UI is enabled."),

}


class RestrictedExecutor:
    def __init__(self):
        self.account = SimpleNamespace(gid=os.getgid())

    def run(self, command, params, timeout_ms=None):
        if command not in COMMANDS:
            return {"ok": False, "error": "unsupported command"}
        if not isinstance(params, dict):
            return {"ok": False, "error": "expected object"}
        try:
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
                client.settimeout(14)
                client.connect(os.environ.get("TOTEM_COMPANION_SOCKET", "/run/totem-companion/commands.sock"))
                packet = json.dumps({"command": command, "args": params}).encode() + b"\n"
                if len(packet) > 8192:
                    return {"ok": False, "error": "request too large"}
                client.sendall(packet)
                response = client.makefile("rb").readline(65537)
                if len(response) > 65536:
                    raise ValueError("response too large")
                result = json.loads(response)
                return {"ok": True, "payload": result} if result.get("ok") else result
        except (OSError, ValueError) as exc:
            return {"ok": False, "error": f"Totem unavailable: {type(exc).__name__}"}


async def main():
    # Service constructs DeviceDescription from this exact registry.
    upstream.COMMAND_SPECS = COMMANDS
    instance = upstream.Service(identity=identity.load_or_create(), executor=RestrictedExecutor(), sdk_token=config.sdk_token(), display_name="Totem Companion")
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, instance.stop)
    local = await instance.serve_local(config.socket_path())

    async def status():
        while not instance._stop.is_set():
            current = instance._current
            value = {"paired": config.load_json(config.PAIRING_FILE) is not None, "connected": bool(current and current.registered_at), "at": __import__('time').time()}
            path = Path("/run/musegadget/status.json")
            temp = path.with_suffix('.tmp')
            temp.write_text(json.dumps(value))
            os.chmod(temp, 0o640)
            temp.replace(path)
            await asyncio.sleep(5)
    reporter = asyncio.create_task(status())
    try:
        await instance.run()
    finally:
        reporter.cancel()
        local.close()
        await local.wait_closed()


if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO)
    asyncio.run(main())
