"""Runtime configuration, sourced from the environment with local-Docker defaults."""
from __future__ import annotations

import os
from dataclasses import dataclass, field


def _env(key: str, default: str) -> str:
    return os.environ.get(key, default)


@dataclass(frozen=True)
class Settings:
    # Spark Connect (gRPC) — the only way to run SQL against the lakehouse.
    spark_remote: str = field(default_factory=lambda: _env("LAKEHOUSE_SPARK_REMOTE", "sc://localhost:15002"))
    # Unity Catalog OSS REST API.
    uc_url: str = field(default_factory=lambda: _env("LAKEHOUSE_UC_URL", "http://localhost:8081"))
    uc_token: str = field(default_factory=lambda: _env("LAKEHOUSE_UC_TOKEN", "not_used"))
    # Spark standalone master / worker web UIs (JSON endpoints).
    spark_master_ui: str = field(default_factory=lambda: _env("LAKEHOUSE_SPARK_MASTER_UI", "http://localhost:8082"))
    spark_worker_ui: str = field(default_factory=lambda: _env("LAKEHOUSE_SPARK_WORKER_UI", "http://localhost:8083"))
    # Spark Connect server's own driver UI (application UI).
    spark_connect_ui: str = field(default_factory=lambda: _env("LAKEHOUSE_SPARK_CONNECT_UI", "http://localhost:4040"))
    # SeaweedFS S3 gateway.
    s3_endpoint: str = field(default_factory=lambda: _env("LAKEHOUSE_S3_ENDPOINT", "http://localhost:8333"))
    s3_bucket: str = field(default_factory=lambda: _env("LAKEHOUSE_S3_BUCKET", "lakehouse"))
    warehouse_root: str = field(default_factory=lambda: _env("LAKEHOUSE_WAREHOUSE", "s3://lakehouse/warehouse"))
    # Where pipeline-materialised tables live. Unity Catalog OSS only supports EXTERNAL
    # tables and its s3:// credential vending returns a placeholder token SeaweedFS
    # rejects, so pipeline datasets are written as external Delta tables under a
    # container-local file path (the open-lakehouse repo's ./data is mounted at /data
    # in every Spark container).
    pipeline_storage_root: str = field(default_factory=lambda: _env("LAKEHOUSE_PIPELINE_STORAGE", "file:///data/warehouse"))
    # Kafka bootstrap (used for the streaming views).
    kafka_bootstrap: str = field(default_factory=lambda: _env("LAKEHOUSE_KAFKA", "localhost:9092"))
    # MLflow tracking server — optional, surfaced as "unavailable" when down.
    mlflow_url: str = field(default_factory=lambda: _env("LAKEHOUSE_MLFLOW_URL", "http://localhost:5000"))
    # Application state (saved queries, dashboards, jobs, runs, history).
    state_db: str = field(default_factory=lambda: _env("LAKEHOUSE_STATE_DB", os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "workspace.db")))
    # Rows returned to the browser for a single query result set.
    max_result_rows: int = field(default_factory=lambda: int(_env("LAKEHOUSE_MAX_ROWS", "10000")))
    # AI cell editing — shells out to a local coding-agent CLI (Claude Code or
    # Codex). Which one is active is stored in the workspace DB; these are the
    # binaries to look for and the wall-clock budget for a single edit.
    ai_default_provider: str = field(default_factory=lambda: _env("LAKEHOUSE_AI_PROVIDER", "codex"))
    ai_codex_bin: str = field(default_factory=lambda: _env("LAKEHOUSE_AI_CODEX_BIN", "codex"))
    ai_claude_bin: str = field(default_factory=lambda: _env("LAKEHOUSE_AI_CLAUDE_BIN", "claude"))
    ai_timeout_seconds: int = field(default_factory=lambda: int(_env("LAKEHOUSE_AI_TIMEOUT", "180")))


settings = Settings()
