"""Explicit recorded-wall or UTC timestamps; never use the host timezone."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import re

from .mapping import ImportRefusal, exact_object

FORMATS = ("iso8601", "dmy_dot_minute", "mdy_dot_minute", "dmy_slash_minute", "mdy_slash_minute",
           "dmy_dot_second", "mdy_dot_second", "dmy_slash_second", "mdy_slash_second", "dmy_dash_second",
           "mdy_slash_12h_minute", "mdy_slash_12h_second")
_STRPTIME = {"dmy_dot_minute": "%d.%m.%Y %H:%M", "mdy_dot_minute": "%m.%d.%Y %H:%M",
             "dmy_slash_minute": "%d/%m/%Y %H:%M", "mdy_slash_minute": "%m/%d/%Y %H:%M",
             "dmy_dot_second": "%d.%m.%Y %H:%M:%S", "mdy_dot_second": "%m.%d.%Y %H:%M:%S",
             "dmy_slash_second": "%d/%m/%Y %H:%M:%S", "mdy_slash_second": "%m/%d/%Y %H:%M:%S",
             "dmy_dash_second": "%d-%m-%Y %H:%M:%S"}
# Keep guards broader than strptime's legitimate one-digit/space-padded day fields.
# Impossible labels/IDs do not need an exception-driven date parse during inspection.
_NUMERIC = {name: re.compile(r" ?\d{1,2}" + (r"\." if "_dot_" in name else "-" if "_dash_" in name else "/") +
                           r" ?\d{1,2}" + (r"\." if "_dot_" in name else "-" if "_dash_" in name else "/") +
                           r"\d{4}\s+\d{1,2}:\d{1,2}" +
                           (r":\d{1,2}(?:\.\d{1,6})?" if name.endswith("_second") else ""))
            for name in _STRPTIME}
_AMPM = {name: re.compile(r"(?P<date> ?\d{1,2}/ ?\d{1,2}/\d{4})\s+"
                         r"(?P<hour>\d{1,2}):(?P<minute>\d{1,2})" +
                         (r":(?P<second>\d{1,2})(?:\.(?P<fraction>\d{1,6}))?" if name.endswith("_second") else "") +
                         r"\s+(?P<period>AM|PM)", re.IGNORECASE)
         for name in ("mdy_slash_12h_minute", "mdy_slash_12h_second")}
_ISO = re.compile(r"\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})?")
_LOCAL = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?")
_UTC = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z")


def parse_format(value: str, format_name: str) -> datetime | None:
    try:
        if format_name == "iso8601":
            if _ISO.fullmatch(value) is None:
                return None
            if len(value) >= 6 and value[-6] in "+-" and value[-3] == ":":
                # fromisoformat normalizes +00:60/+00:99; those are malformed source offsets.
                if int(value[-5:-3]) > 23 or int(value[-2:]) > 59:
                    return None
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        if format_name in _AMPM:
            match = _AMPM[format_name].fullmatch(value)
            if match is None:
                return None
            hour = int(match["hour"])
            if not 1 <= hour <= 12:
                return None
            # English AM/PM is intentional; %p would depend on the host locale.
            hour = hour % 12 + (12 if match["period"].upper() == "PM" else 0)
            parts = match.groupdict()
            fraction = parts.get("fraction") or ""
            return datetime.strptime(match["date"], "%m/%d/%Y").replace(
                hour=hour, minute=int(match["minute"]), second=int(parts.get("second") or 0),
                microsecond=int(fraction.ljust(6, "0") or "0"))
        template = _STRPTIME.get(format_name)
        if template is None or _NUMERIC[format_name].fullmatch(value) is None:
            return None
        # Strptime accepts one-digit fields; preserve that legitimate source precision.
        if format_name.endswith("_second") and "." in value.rsplit(":", 1)[-1]:
            template += ".%f"
        return datetime.strptime(value, template)
    except (ValueError, OverflowError):
        return None


def iso_utc(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat(timespec="microseconds" if value.microsecond else "seconds").replace("+00:00", "Z")


def iso_local(value: datetime) -> str:
    return value.isoformat(timespec="microseconds" if value.microsecond else "seconds")


@dataclass(frozen=True)
class TimeInterpretation:
    kind: str
    format_name: str
    mode: str
    offset_minutes: int | None
    cutoff: datetime

    def parse(self, value: str) -> datetime | None | ImportRefusal:
        parsed = parse_format(value, self.format_name)
        if parsed is None:
            return None
        aware = parsed.tzinfo is not None
        if self.kind == "wall_clock":
            if aware:
                return ImportRefusal("mixed_timezone_values", "Recorded-wall interpretation requires timestamps without a recorded zone.", "policies.time")
            return parsed
        if self.mode == "from_values":
            if not aware:
                return ImportRefusal("timezone_required", "A timestamp without a zone needs an explicit wall-clock or fixed-offset interpretation.", "policies.time")
            try:
                return parsed.astimezone(timezone.utc)
            except (ValueError, OverflowError):
                return None
        if aware:
            return ImportRefusal("mixed_timezone_values", "Fixed-offset interpretation requires unzoned source timestamps.", "policies.time")
        try:
            return parsed.replace(tzinfo=timezone(timedelta(minutes=self.offset_minutes or 0))).astimezone(timezone.utc)
        except (ValueError, OverflowError):
            return None


def validate_time_policy(value: object) -> TimeInterpretation | ImportRefusal:
    refusal = exact_object(value, {"id", "parameters"}, "policies.time")
    if refusal is not None:
        return refusal
    assert isinstance(value, Mapping)
    policy_id = value["id"]
    if not isinstance(policy_id, str) or policy_id not in {"incident.time.wall_clock_as_recorded.v1", "incident.time.explicit_format_timezone_utc.v1"}:
        return ImportRefusal("unsupported_policy", "The time policy identifier or version is unsupported.", "policies.time.id")
    wall = policy_id == "incident.time.wall_clock_as_recorded.v1"
    parameters = value["parameters"]
    cutoff_key = "snapshot_cutoff_local" if wall else "snapshot_cutoff_utc"
    refusal = exact_object(parameters, {"format", "timezone", cutoff_key}, "policies.time.parameters")
    if refusal is not None:
        return refusal
    assert isinstance(parameters, Mapping)
    if parameters["format"] not in FORMATS:
        return ImportRefusal("invalid_parameter", "The timestamp format is unsupported.", "policies.time.parameters.format")
    mode, offset = "wall_clock", None
    if wall:
        if parameters["timezone"] != "none_as_recorded":
            return ImportRefusal("invalid_parameter", "Wall timestamps must remain unzoned as recorded.", "policies.time.parameters.timezone")
    else:
        zone = parameters["timezone"]
        if not isinstance(zone, Mapping):
            return ImportRefusal("invalid_parameter", "Choose recorded offsets or an explicit fixed offset.", "policies.time.parameters.timezone")
        mode = zone.get("mode")
        if mode == "from_values":
            refusal = exact_object(zone, {"mode"}, "policies.time.parameters.timezone")
        elif mode == "fixed_offset":
            refusal = exact_object(zone, {"mode", "offset_minutes"}, "policies.time.parameters.timezone")
            offset = zone.get("offset_minutes")
            if refusal is None and (type(offset) is not int or not -840 <= offset <= 840):
                refusal = ImportRefusal("invalid_parameter", "Offset minutes must be an integer between -840 and 840.", "policies.time.parameters.timezone.offset_minutes")
        else:
            refusal = ImportRefusal("unsupported_timezone", "This timezone mode is not supported.", "policies.time.parameters.timezone")
        if refusal is not None:
            return refusal
    cutoff_text = parameters[cutoff_key]
    pattern = _LOCAL if wall else _UTC
    if not isinstance(cutoff_text, str) or pattern.fullmatch(cutoff_text) is None:
        return ImportRefusal("invalid_parameter", "The cutoff must use the selected time domain and supported precision.", "policies.time.parameters." + cutoff_key)
    cutoff = parse_format(cutoff_text, "iso8601")
    if cutoff is None:
        return ImportRefusal("invalid_parameter", "The cutoff is not a valid date and time.", "policies.time.parameters." + cutoff_key)
    return TimeInterpretation("wall_clock" if wall else "utc_instant", parameters["format"], mode, offset, cutoff)
