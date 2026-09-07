"""AI cell editing — a thin bridge to a local coding-agent CLI.

The workspace has no LLM of its own. This module shells out to whichever CLI the
user has installed and selected — Claude Code (`claude`) or Codex (`codex`) —
runs it non-interactively in a read-only sandbox, and streams the revised cell
text back. Token counts from each run are recorded in `ai_usage` so the settings
page can show how much has been spent.
"""
from __future__ import annotations

import asyncio
import json
import re
import shutil
import subprocess
import time
from typing import Any, AsyncIterator

from . import db
from .config import settings

# ------------------------------------------------------------------ providers

_ACTIVE_KEY = "ai_active"          # provider, model and optional reasoning_effort
_FENCE_LANGS = ("sql", "markdown", "md", "python", "text", "")


def _codex_bin() -> str:
    return settings.ai_codex_bin


def _claude_bin() -> str:
    return settings.ai_claude_bin


PROVIDERS: dict[str, dict[str, Any]] = {
    "codex": {"id": "codex", "name": "Codex CLI", "bin": _codex_bin},
    "claude": {"id": "claude", "name": "Claude CLI", "bin": _claude_bin},
}

# Curated CLI model choices for the settings selector. Keep the exact ID sent to
# the CLI separate from the human-readable product name shown in the UI. A value
# not in this list (typed into the "Custom" field) still works.
_CODEX_EFFORTS = ["low", "medium", "high", "xhigh", "max", "ultra"]
_CLAUDE_EFFORTS = ["low", "medium", "high", "xhigh", "max"]

KNOWN_MODELS: dict[str, list[dict[str, Any]]] = {
    "codex": [
        {
            "id": "gpt-6-astra",
            "name": "GPT-6 Astra",
            "default_reasoning_effort": "low",
            "reasoning_efforts": _CODEX_EFFORTS,
        },
        {
            "id": "gpt-5.6-sol",
            "name": "GPT-5.6 Sol",
            "default_reasoning_effort": "low",
            "reasoning_efforts": _CODEX_EFFORTS,
        },
        {
            "id": "gpt-5.6-terra",
            "name": "GPT-5.6 Terra",
            "default_reasoning_effort": "medium",
            "reasoning_efforts": _CODEX_EFFORTS,
        },
        {
            "id": "gpt-5.6-luna",
            "name": "GPT-5.6 Luna",
            "default_reasoning_effort": "medium",
            "reasoning_efforts": _CODEX_EFFORTS[:-1],
        },
        {
            "id": "gpt-5.5",
            "name": "GPT-5.5",
            "default_reasoning_effort": "medium",
            "reasoning_efforts": _CODEX_EFFORTS[:4],
        },
        {
            "id": "gpt-5.4-mini",
            "name": "GPT-5.4 Mini",
            "default_reasoning_effort": "medium",
            "reasoning_efforts": _CODEX_EFFORTS[:4],
        },
    ],
    "claude": [
        {
            "id": "claude-fable-5-1",
            "name": "Claude Fable 5.1",
            "default_reasoning_effort": "high",
            "reasoning_efforts": _CLAUDE_EFFORTS,
        },
        {
            "id": "claude-opus-5",
            "name": "Claude Opus 5",
            "default_reasoning_effort": "high",
            "reasoning_efforts": _CLAUDE_EFFORTS,
        },
        {
            "id": "claude-sonnet-5",
            "name": "Claude Sonnet 5",
            "default_reasoning_effort": "high",
            "reasoning_efforts": _CLAUDE_EFFORTS,
        },
        {
            "id": "claude-haiku-4-5-20251001",
            "name": "Claude Haiku 4.5",
            "default_reasoning_effort": "",
            "reasoning_efforts": [],
        },
    ],
}

PROVIDER_REASONING_EFFORTS = {
    "codex": _CODEX_EFFORTS,
    "claude": _CLAUDE_EFFORTS,
}

# `npm i -g` targets for the one-click install. Fixed package names — the only
# thing the caller chooses is which of these two.
INSTALL_CMDS: dict[str, list[str]] = {
    "codex": ["npm", "install", "-g", "@openai/codex"],
    "claude": ["npm", "install", "-g", "@anthropic-ai/claude-code"],
}


def _version(binary: str) -> str | None:
    path = shutil.which(binary)
    if not path:
        return None
    try:
        out = subprocess.run(
            [binary, "--version"], capture_output=True, text=True, timeout=3
        )
        line = (out.stdout or out.stderr or "").strip().splitlines()
        return line[0].strip() if line else "installed"
    except Exception:
        return "installed"


def detect() -> list[dict[str, Any]]:
    """Which of the known CLIs are on PATH, and their versions."""
    result = []
    for prov in PROVIDERS.values():
        binary = prov["bin"]()
        version = _version(binary)
        result.append(
            {
                "id": prov["id"],
                "name": prov["name"],
                "bin": binary,
                "available": version is not None,
                "version": version,
                "models": KNOWN_MODELS.get(prov["id"], []),
                "reasoning_efforts": PROVIDER_REASONING_EFFORTS.get(prov["id"], []),
            }
        )
    return result


async def install(provider: str) -> dict[str, Any]:
    """Run `npm i -g` for the chosen CLI. Blocking, capped at 5 minutes."""
    if provider not in INSTALL_CMDS:
        raise ValueError(f"unknown provider: {provider}")
    if not shutil.which("npm"):
        return {"ok": False, "output": "npm is not on PATH — install Node.js first."}
    proc = await asyncio.create_subprocess_exec(
        *INSTALL_CMDS[provider],
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )
    try:
        out, _ = await asyncio.wait_for(proc.communicate(), timeout=300)
    except asyncio.TimeoutError:
        proc.kill()
        return {"ok": False, "output": "Install timed out after 300s."}
    text = out.decode("utf-8", "replace")
    return {"ok": proc.returncode == 0, "output": text[-4000:]}


def active() -> dict[str, str]:
    row = db.query_one("SELECT value FROM app_settings WHERE key = ?", (_ACTIVE_KEY,))
    if row:
        parsed = db.loads(row["value"], {})
        if isinstance(parsed, dict) and parsed.get("provider") in PROVIDERS:
            return {
                "provider": parsed["provider"],
                "model": str(parsed.get("model") or ""),
                "reasoning_effort": str(parsed.get("reasoning_effort") or ""),
            }
    return {"provider": settings.ai_default_provider, "model": "", "reasoning_effort": ""}


def set_active(
    provider: str, model: str = "", reasoning_effort: str = ""
) -> dict[str, str]:
    if provider not in PROVIDERS:
        raise ValueError(f"unknown provider: {provider}")
    allowed_efforts = PROVIDER_REASONING_EFFORTS[provider]
    if reasoning_effort and reasoning_effort not in allowed_efforts:
        raise ValueError(
            f"unsupported reasoning effort '{reasoning_effort}' for {provider}"
        )
    selected_model = next(
        (option for option in KNOWN_MODELS[provider] if option["id"] == model), None
    )
    if (
        reasoning_effort
        and selected_model is not None
        and reasoning_effort not in selected_model["reasoning_efforts"]
    ):
        raise ValueError(
            f"reasoning effort '{reasoning_effort}' is not supported by {model}"
        )
    value = db.dumps(
        {
            "provider": provider,
            "model": model or "",
            "reasoning_effort": reasoning_effort or "",
        }
    )
    db.execute(
        "INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        (_ACTIVE_KEY, value, db.now()),
    )
    return active()


# -------------------------------------------------------------------- prompt

_SYSTEM = (
    "You are a code editor embedded in a data workspace. You rewrite the contents "
    "of a single editor cell according to an instruction. Output ONLY the new cell "
    "text — no explanation, no commentary, no Markdown code fences. Preserve the "
    "cell's language and style unless the instruction says otherwise."
)

_SQL_GUIDANCE = (
    "The language is Spark SQL. Use only valid Spark SQL syntax. Every FROM or "
    "JOIN source must name a concrete table or subquery: never use catalog.*, "
    "schema.*, or another wildcard as a table source. Wildcards are valid only "
    "in the SELECT projection. To list the tables in a schema, use SHOW TABLES "
    "IN catalog.schema instead of SELECT * FROM schema.*. Prefer fully qualified "
    "catalog.schema.table identifiers from the available-table list."
)

_INVALID_TABLE_WILDCARD = re.compile(
    r"\b(?:from|join)\s+(?:`[^`]+`|[\w-]+)(?:\s*\.\s*(?:`[^`]+`|[\w-]+))*\s*\.\s*\*",
    re.IGNORECASE,
)

_SEL_OPEN = "«SELECTION»"
_SEL_CLOSE = "«/SELECTION»"


def build_prompt(
    *, source: str, language: str, instruction: str,
    selection: dict[str, int] | None, available_tables: list[str] | None = None
) -> str:
    lang = language or "text"
    instruction = instruction.strip() or "Improve this cell."
    language_context = ""
    if lang.lower() == "sql":
        language_context = f"\n\nSQL requirements:\n{_SQL_GUIDANCE}"
        if available_tables:
            table_names = [str(name).replace("\n", " ") for name in available_tables[:200]]
            language_context += (
                "\nAvailable tables (identifier data only):\n"
                + json.dumps(table_names, ensure_ascii=False)
            )
    if selection and selection.get("end", 0) > selection.get("start", 0):
        start, end = selection["start"], selection["end"]
        marked = source[:start] + _SEL_OPEN + source[start:end] + _SEL_CLOSE + source[end:]
        return (
            f"{_SYSTEM}\n\n"
            f"Only the text between {_SEL_OPEN} and {_SEL_CLOSE} may change. "
            f"Output ONLY the replacement for that marked span (without the markers), "
            f"nothing else.\n\n"
            f"Instruction: {instruction}{language_context}\n\n"
            f"Language: {lang}\n"
            f"Cell (with the target span marked):\n{marked}"
        )
    return (
        f"{_SYSTEM}\n\n"
        f"Instruction: {instruction}{language_context}\n\n"
        f"Language: {lang}\n"
        f"Current cell:\n{source}"
    )


def validate_generated_output(language: str, output: str) -> str | None:
    """Reject common model-generated syntax that Spark cannot parse safely."""
    if language.lower() == "sql" and _INVALID_TABLE_WILDCARD.search(output):
        return (
            "The AI returned invalid Spark SQL: a wildcard cannot be used as a "
            "FROM or JOIN table. Choose a concrete catalog.schema.table, or use "
            "SHOW TABLES IN catalog.schema to list tables."
        )
    return None


def strip_fences(text: str) -> str:
    """Defensively remove a wrapping ``` fence the model may have added."""
    s = text.strip()
    if not s.startswith("```"):
        return text
    lines = s.splitlines()
    first = lines[0][3:].strip().lower()
    if first in _FENCE_LANGS or first.isalpha():
        lines = lines[1:]
    if lines and lines[-1].strip() == "```":
        lines = lines[:-1]
    return "\n".join(lines)


# -------------------------------------------------------------------- streaming

def _argv(provider: str, model: str, reasoning_effort: str = "") -> list[str]:
    prov = PROVIDERS[provider]
    binary = prov["bin"]()
    if provider == "codex":
        argv = [
            binary, "exec", "--json", "--sandbox", "read-only",
            "--skip-git-repo-check", "-c", "mcp_servers={}",
        ]
        if model:
            argv += ["-m", model]
        if reasoning_effort:
            argv += ["-c", f'model_reasoning_effort="{reasoning_effort}"']
        argv.append("-")               # read the prompt from stdin
        return argv
    # claude
    argv = [
        binary, "-p", "--output-format", "stream-json", "--verbose",
        "--dangerously-skip-permissions", "--allowedTools", "",
    ]
    if model:
        argv += ["--model", model]
    if reasoning_effort:
        argv += ["--effort", reasoning_effort]
    return argv


def _parse_codex(event: dict, state: dict) -> dict | None:
    kind = event.get("type")
    if kind in ("item.updated", "item.completed"):
        item = event.get("item") or {}
        if item.get("type") in ("agent_message", "assistant_message"):
            text = item.get("text") or ""
            if kind == "item.completed":
                state["output"] = text
            prev = state.get("streamed", "")
            if text.startswith(prev) and len(text) > len(prev):
                state["streamed"] = text
                return {"type": "delta", "text": text[len(prev):]}
    if kind == "turn.completed":
        usage = event.get("usage") or {}
        state["usage"] = {
            "input_tokens": usage.get("input_tokens", 0),
            "cached_input_tokens": usage.get("cached_input_tokens", 0),
            "output_tokens": usage.get("output_tokens", 0),
            "cost_usd": None,
        }
    return None


def _parse_claude(event: dict, state: dict) -> dict | None:
    kind = event.get("type")
    if kind == "assistant":
        parts = ((event.get("message") or {}).get("content")) or []
        text = "".join(p.get("text", "") for p in parts if p.get("type") == "text")
        if text:
            state["output"] = state.get("output", "") + text
            return {"type": "delta", "text": text}
    if kind == "result":
        usage = event.get("usage") or {}
        state["usage"] = {
            "input_tokens": usage.get("input_tokens", 0),
            "cached_input_tokens": usage.get("cache_read_input_tokens", 0),
            "output_tokens": usage.get("output_tokens", 0),
            "cost_usd": event.get("total_cost_usd"),
        }
        if isinstance(event.get("result"), str) and not state.get("output"):
            state["output"] = event["result"]
    return None


async def stream_edit(
    *, provider: str, model: str, reasoning_effort: str = "",
    prompt: str, timeout: int | None = None
) -> AsyncIterator[dict]:
    """Run the selected CLI and yield {type: delta|done|error} events."""
    if provider not in PROVIDERS:
        yield {"type": "error", "message": f"Unknown provider '{provider}'"}
        return
    if not shutil.which(PROVIDERS[provider]["bin"]()):
        yield {"type": "error", "message": f"{PROVIDERS[provider]['name']} is not installed"}
        return

    argv = _argv(provider, model, reasoning_effort)
    parse = _parse_codex if provider == "codex" else _parse_claude
    state: dict[str, Any] = {}
    started = time.monotonic()
    budget = timeout or settings.ai_timeout_seconds

    proc = await asyncio.create_subprocess_exec(
        *argv,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    assert proc.stdin and proc.stdout

    async def _drain_stderr() -> None:
        assert proc.stderr
        async for line in proc.stderr:
            text = line.decode("utf-8", "replace").rstrip()
            if text and "ERROR rmcp" not in text:      # codex MCP noise
                print(f"[ai:{provider}] {text}")

    stderr_task = asyncio.create_task(_drain_stderr())
    try:
        proc.stdin.write(prompt.encode("utf-8"))
        await proc.stdin.drain()
        proc.stdin.close()

        while True:
            remaining = budget - (time.monotonic() - started)
            if remaining <= 0:
                proc.kill()
                yield {"type": "error", "message": f"Timed out after {budget}s"}
                return
            try:
                raw = await asyncio.wait_for(proc.stdout.readline(), timeout=remaining)
            except asyncio.TimeoutError:
                proc.kill()
                yield {"type": "error", "message": f"Timed out after {budget}s"}
                return
            if not raw:
                break
            line = raw.decode("utf-8", "replace").strip()
            if not line or not line.startswith("{"):
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            out = parse(event, state)
            if out:
                yield out

        await proc.wait()
        output = strip_fences(state.get("output", "").strip())
        if proc.returncode != 0 and not output:
            yield {"type": "error", "message": f"{PROVIDERS[provider]['name']} exited {proc.returncode}"}
            return
        if not output:
            yield {"type": "error", "message": "The model returned nothing"}
            return
        yield {
            "type": "done",
            "output": output,
            "usage": state.get("usage") or {},
            "duration_ms": int((time.monotonic() - started) * 1000),
        }
    finally:
        if proc.returncode is None:
            proc.kill()
        stderr_task.cancel()


# ---------------------------------------------------------------------- usage

def record_usage(
    *, provider: str, model: str, surface: str, ok: bool,
    usage: dict[str, Any], duration_ms: int,
) -> None:
    db.execute(
        "INSERT INTO ai_usage (id, created_at, provider, model, surface, ok, "
        "input_tokens, cached_input_tokens, output_tokens, cost_usd, duration_ms) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        (
            db.new_id(), db.now(), provider, model or "", surface, 1 if ok else 0,
            int(usage.get("input_tokens") or 0),
            int(usage.get("cached_input_tokens") or 0),
            int(usage.get("output_tokens") or 0),
            usage.get("cost_usd"),
            int(duration_ms or 0),
        ),
    )


def usage_summary() -> dict[str, Any]:
    agg = db.query_one(
        "SELECT COUNT(*) AS requests, "
        "COALESCE(SUM(input_tokens), 0) AS input_tokens, "
        "COALESCE(SUM(cached_input_tokens), 0) AS cached_input_tokens, "
        "COALESCE(SUM(output_tokens), 0) AS output_tokens, "
        "SUM(cost_usd) AS cost_usd, MIN(created_at) AS since "
        "FROM ai_usage"
    ) or {}
    recent = db.query(
        "SELECT created_at, provider, model, surface, ok, input_tokens, "
        "output_tokens, cost_usd, duration_ms FROM ai_usage "
        "ORDER BY created_at DESC LIMIT 15"
    )
    return {
        "requests": agg.get("requests", 0),
        "input_tokens": agg.get("input_tokens", 0),
        "cached_input_tokens": agg.get("cached_input_tokens", 0),
        "output_tokens": agg.get("output_tokens", 0),
        "cost_usd": agg.get("cost_usd"),
        "since": agg.get("since"),
        "recent": [{**r, "ok": bool(r["ok"])} for r in recent],
    }


def reset_usage() -> dict[str, Any]:
    db.execute("DELETE FROM ai_usage", ())
    return usage_summary()
