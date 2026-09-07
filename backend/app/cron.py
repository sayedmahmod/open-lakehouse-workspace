"""A dependency-free cron expression parser.

Supports the standard five fields (minute hour day-of-month month day-of-week)
with `*`, `*/step`, `a-b`, `a-b/step` and comma lists, three-letter month and
weekday names, `?` as an alias for `*`, and the `@hourly` / `@daily` /
`@weekly` / `@monthly` / `@yearly` macros. Day-of-week accepts both 0 and 7 for
Sunday. Resolution is one minute; `next_after` walks forward minute by minute,
which is fast enough for a scheduler that ticks every few seconds and keeps the
implementation obviously correct.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

_MACROS = {
    "@hourly": "0 * * * *",
    "@daily": "0 0 * * *",
    "@midnight": "0 0 * * *",
    "@weekly": "0 0 * * 0",
    "@monthly": "0 0 1 * *",
    "@yearly": "0 0 1 1 *",
    "@annually": "0 0 1 1 *",
}
_MONTHS = {m: i for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], start=1)}
_DOW = {d: i for i, d in enumerate(
    ["sun", "mon", "tue", "wed", "thu", "fri", "sat"], start=0)}

_BOUNDS = {
    "minute": (0, 59),
    "hour": (0, 23),
    "dom": (1, 31),
    "month": (1, 12),
    "dow": (0, 6),
}


class CronError(ValueError):
    """Raised for a syntactically invalid cron expression."""


def _parse_field(raw: str, name: str, names: dict[str, int] | None = None) -> set[int]:
    lo, hi = _BOUNDS[name]
    out: set[int] = set()
    for piece in raw.split(","):
        piece = piece.strip().lower()
        if not piece:
            raise CronError(f"empty term in {name} field")
        step = 1
        if "/" in piece:
            piece, _, step_s = piece.partition("/")
            if not step_s.isdigit() or int(step_s) == 0:
                raise CronError(f"bad step '{step_s}' in {name} field")
            step = int(step_s)
        if piece in ("*", "?"):
            start, end = lo, hi
        elif "-" in piece and not piece.startswith("-"):
            a, _, b = piece.partition("-")
            start, end = _token(a, name, names), _token(b, name, names)
        else:
            start = end = _token(piece, name, names)
            if step != 1:
                end = hi
        if start > end:
            # wrap-around ranges, e.g. fri-mon
            span = list(range(start, hi + 1)) + list(range(lo, end + 1))
        else:
            span = list(range(start, end + 1))
        for i, value in enumerate(span):
            if i % step == 0:
                out.add(value)
    if not out:
        raise CronError(f"{name} field matched nothing")
    return out


def _token(tok: str, name: str, names: dict[str, int] | None) -> int:
    tok = tok.strip().lower()
    if names and tok[:3] in names:
        return names[tok[:3]]
    if not tok.lstrip("-").isdigit():
        raise CronError(f"'{tok}' is not valid in the {name} field")
    lo, hi = _BOUNDS[name]
    value = int(tok)
    if name == "dow" and value == 7:
        value = 0
    if not lo <= value <= hi:
        raise CronError(f"{name} value {value} out of range {lo}-{hi}")
    return value


class Cron:
    """A parsed cron expression, evaluated in a fixed timezone."""

    __slots__ = ("expression", "tz", "_minute", "_hour", "_dom", "_month", "_dow", "_dom_star", "_dow_star")

    def __init__(self, expression: str, tz: str = "UTC") -> None:
        raw = expression.strip()
        raw = _MACROS.get(raw.lower(), raw)
        parts = raw.split()
        if len(parts) != 5:
            raise CronError("a cron expression needs exactly five fields")
        self.expression = expression.strip()
        try:
            self.tz = ZoneInfo(tz or "UTC")
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise CronError(f"unknown timezone '{tz}'") from exc
        self._minute = _parse_field(parts[0], "minute")
        self._hour = _parse_field(parts[1], "hour")
        self._dom = _parse_field(parts[2], "dom")
        self._month = _parse_field(parts[3], "month", _MONTHS)
        self._dow = _parse_field(parts[4], "dow", _DOW)
        self._dom_star = parts[2].strip() in ("*", "?")
        self._dow_star = parts[4].strip() in ("*", "?")

    def matches(self, moment: datetime) -> bool:
        local = moment.astimezone(self.tz)
        if local.minute not in self._minute or local.hour not in self._hour:
            return False
        if local.month not in self._month:
            return False
        dom_ok = local.day in self._dom
        dow_ok = (local.weekday() + 1) % 7 in self._dow  # python Mon=0 -> cron Sun=0
        # Standard cron semantics: when both day fields are restricted the match
        # is their union; otherwise it is their intersection.
        if self._dom_star or self._dow_star:
            return dom_ok and dow_ok
        return dom_ok or dow_ok

    def next_after(self, after: datetime) -> datetime:
        cursor = (after + timedelta(minutes=1)).replace(second=0, microsecond=0)
        limit = cursor + timedelta(days=400)
        while cursor < limit:
            if self.matches(cursor):
                return cursor
            cursor += timedelta(minutes=1)
        raise CronError(f"cron '{self.expression}' has no run in the next 400 days")


def describe(expression: str) -> str:
    """A short human label for common expressions, falling back to the raw text."""
    raw = _MACROS.get(expression.strip().lower(), expression.strip())
    common = {
        "0 * * * *": "Every hour",
        "*/15 * * * *": "Every 15 minutes",
        "*/30 * * * *": "Every 30 minutes",
        "0 0 * * *": "Daily at midnight",
        "0 9 * * *": "Daily at 09:00",
        "0 9 * * 1-5": "Weekdays at 09:00",
        "0 0 * * 0": "Weekly on Sunday",
        "0 0 1 * *": "Monthly on the 1st",
    }
    return common.get(raw, f"cron: {expression.strip()}")
