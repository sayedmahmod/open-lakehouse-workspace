# open-lakehouse workspace

> A focused, open lakehouse workspace for exploring data, writing Spark SQL, building workflows, and operating a local analytics stack.

![Status](https://img.shields.io/badge/status-active%20development-0f766e)
![Frontend](https://img.shields.io/badge/frontend-Next.js%2016%20%C2%B7%20React%2019-111827)
![Backend](https://img.shields.io/badge/backend-FastAPI%20%C2%B7%20Python%203.12-111827)
![Data](https://img.shields.io/badge/data-Delta%20Lake%20%C2%B7%20Unity%20Catalog%20OSS-0f766e)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

A web workspace that sits in front of an [**open-lakehouse**](../open-lakehouse) deployment. It brings catalog exploration, Spark SQL, notebooks, dashboards, jobs, alerts, lineage and cluster visibility into one coherent interface, while the data plane stays in the lakehouse itself: Unity Catalog OSS, Apache Spark 4.1 (Connect), Delta Lake and SeaweedFS.

> [!NOTE]
> **Active development.** [**Feature coverage**](#feature-coverage) describes what works today; [**Next To Do**](#next-to-do) is the product roadmap and does not claim that those integrations are already implemented.

## Contents

- [**Why**](#why)
- [**What this is**](#what-this-is)
- [**Architecture**](#architecture)
- [**Quick start**](#quick-start)
- [**What the workspace does**](#what-the-workspace-does)
- [**Feature coverage**](#feature-coverage)
- [**Next To Do**](#next-to-do)
- [**Configuration**](#configuration)
- [**Limitations**](#limitations)
- [**Stack changes this required**](#stack-changes-this-required)
- [**Development**](#development)
- [**Repository layout**](#repository-layout)
- [**Security and scope**](#security-and-scope)
- [**Contributing**](#contributing)
- [**License**](#license)

## Why

Commercial lakehouse platforms pair a polished UI with a closed, managed dataplane. The open components — Unity Catalog, Spark Connect, Delta Lake — are powerful, but they ship as services and CLIs, not as a workspace you can think in.

This repository is that workspace: a single coherent interface over an open lakehouse you fully control, with no feature gated behind a managed service and nothing leaving the machine.

## What this is

A web workspace for the local [**open-lakehouse**](../open-lakehouse) stack.

**No authentication — this is a workspace for a local Docker stack.**

Layout and navigation follow the shape of the data itself: **catalog, query, orchestrate**. The colour system is an original teal/emerald palette, defined once as semantic tokens in `frontend/src/app/globals.css` and consumed everywhere through `var(--token)`, in both light and dark themes. **Settings → Colours** re-skins the workspace: pick a preset or any hex, and the hover, pressed, link, focus, chart and task-graph variants are derived from it in OKLCH (`frontend/src/lib/accent.ts`) for each theme, with button labels flipping between white and dark ink so contrast holds. The choice is saved per browser.

```text
frontend/   Next.js 16 · React 19 · TypeScript · Tailwind 4   (the UI)
backend/    FastAPI · pyspark-client · SQLite                 (the workspace API)
```

## Architecture

```text
Browser
   | same-origin /api/* requests
   v
Next.js workspace -- rewrite --> FastAPI gateway
                                      |
                                      +-- Spark Connect (gRPC)
                                      +-- Unity Catalog OSS (REST)
                                      +-- Spark master / driver UIs
                                      +-- SQLite workspace state
                                               |
                                               v
                                      Delta Lake + SeaweedFS
```

The browser never talks to Spark or Unity Catalog directly, for two reasons:

- **Spark Connect speaks gRPC, not HTTP.** There is no usable browser client, and running SQL requires `pyspark`, which is Python.
- **Unity Catalog sends no CORS headers**, so browser-side REST is not an option either.

A thin FastAPI gateway therefore sits in between. It owns one long-lived Spark Connect session, proxies catalog and compute operations, reads the Spark master and driver UIs, and keeps workspace metadata — saved queries, dashboards, jobs, alerts, notebooks, query history — in SQLite. Next.js rewrites `/api/*` onto it, so the browser stays on a single origin.

## Quick start

### Prerequisites

- macOS or Linux
- Python 3.12
- [**`uv`**](https://docs.astral.sh/uv/)
- Node.js 20+ and npm
- A running [**open-lakehouse**](../open-lakehouse) Docker stack with Unity Catalog, Spark Connect, Spark, SeaweedFS and Kafka endpoints available locally

### Start the workspace

Start the lakehouse stack first, then:

```bash
./start.sh                       # API on :8090, UI on :3002
open http://localhost:3002
```

`start.sh` creates the Python virtualenv and installs npm packages on first run.

### Frontend only

```bash
cd frontend
npm run dev       # http://localhost:3000 by default
npm run lint
npm run build
```

The full workspace uses port `3002` so it can run alongside a standalone Next.js development server.

## What the workspace does

Every feature below is wired to the running stack. Nothing is mocked.

**Catalog Explorer** — catalogs, schemas, tables, volumes and functions from Unity Catalog; create and drop catalogs, schemas and tables. Each table has the full tab set: Overview (columns, types, editable comment), Sample Data (a real `SELECT`), Details (`DESCRIBE DETAIL` — file count, size, partition columns, Delta protocol versions), History (the Delta transaction log, with one-click **time travel** per version), Lineage, and Insights (per-column null counts, distinct counts, min/max/mean from a single aggregate scan).

**SQL Editor** — CodeMirror with a Spark SQL dialect and catalog-aware autocomplete (tables, columns, schemas and functions pulled from Unity Catalog). ⌘↵ runs. Queries execute asynchronously, the UI shows a live _Running_ state, and **Cancel actually interrupts the Spark job** (via Spark job tags). The results grid sorts, filters and exports to CSV; a resizable catalog tree sits beside the editor.

**Queries · Query History** — save, tag and reopen statements; every execution is recorded with status, duration, row count and the tables it touched.

**Dashboards** — SQL datasets plus widgets: bar, line, area, pie, counter, table and text. Widgets are configured in-app (chart type, x axis, value columns, width) and refreshed against the lakehouse.

**Jobs & Pipelines** — multi-task jobs with `depends_on` edges, executed in topological order. Tasks run SQL, a saved query or a whole notebook. Failures skip downstream tasks. Schedules (every N minutes/hours, or daily) are fired by a background scheduler.

**Job Runs** — every run with its per-task status graph, durations, row counts and error output.

**Notebooks** — ordered SQL and Markdown cells, run individually or top-to-bottom against Spark Connect, with results under each cell.

**Alerts** — a query, a column and a threshold, evaluated on a schedule, with state (`ok` / `triggered` / `error`) and full evaluation history.

**Compute** — the Spark cluster: workers, cores and memory meters, applications, executors, recent Spark jobs, and a working _Restart session_ button.

**Lineage** — see [**Limitations**](#limitations).

**Data Ingestion** — builds runnable `CREATE TABLE … AS SELECT read_files(...)` statements for CSV/JSON/Parquet, and reports Kafka reachability.

**Global search** (⌘K) across workspace objects and Unity Catalog assets, plus Recents, Workspace browser, Models, and light/dark/system theming.

## Feature coverage

What a commercial lakehouse platform offers, and what this stack can honestly back:

| Capability                   | Here               | Notes                                                                                     |
| ---------------------------- | ------------------ | ----------------------------------------------------------------------------------------- |
| Catalog Explorer             | **Full**           | Unity Catalog OSS REST                                                                    |
| Table overview / columns     | **Full**           | with a Spark `DESCRIBE` fallback — see [**Limitations**](#limitations)                    |
| Sample data                  | **Full**           | real `SELECT` through Spark Connect                                                       |
| Table details, size, files   | **Full**           | `DESCRIBE DETAIL`                                                                         |
| Delta history + time travel  | **Full**           | `DESCRIBE HISTORY`, `VERSION AS OF`                                                       |
| Data profiling / Insights    | **Full**           | computed live, one aggregate scan                                                         |
| SQL editor + autocomplete    | **Full**           | Spark SQL dialect, UC-driven completion                                                   |
| Query cancellation           | **Full**           | Spark job tags → real interrupt                                                           |
| Query history                | **Full**           | own store                                                                                 |
| Saved queries                | **Full**           | own store                                                                                 |
| Dashboards / AI-BI charts    | **Full** (charts)  | no natural-language authoring                                                             |
| Alerts                       | **Full**           | no email/Slack destinations                                                               |
| Notebooks                    | **SQL + Markdown** | no Python cells — see [**Next To Do**](#next-to-do)                                       |
| Workflows / Jobs (task DAG)  | **Full**           | topological execution, schedules, run history                                             |
| Job run graph + logs         | **Full**           | per-task status, timing, errors                                                           |
| Compute / cluster monitoring | **Read-only**      | Spark standalone exposes state, not provisioning                                          |
| Cluster create / autoscale   | **No**             | managed provisioning has no OSS counterpart here                                          |
| Lineage                      | **Derived**        | UC OSS records none, so it is built from executed SQL                                     |
| Permissions / grants         | **No**             | UC auth is disabled in this stack                                                         |
| Volumes, UC functions        | **Read**           | listed and inspectable                                                                    |
| Model registry               | **Read**           | UC models API (empty until MLflow registers one)                                          |
| Genie / natural-language SQL | **No**             | needs an LLM service                                                                      |
| Marketplace, Partner Connect | **No**             | no OSS equivalent                                                                         |
| Delta Live Tables            | **Not yet**        | the stack ships Spark Declarative Pipelines; a job task type could wrap `spark-pipelines` |

## Next To Do

The next product milestones, ordered roughly from platform foundations to ecosystem integrations.

### Notebook experience

- **Python cells** alongside the existing SQL and Markdown cells, with a managed Python execution path backed by Spark Connect — clear kernel/session lifecycle, output, error and dependency states.
- Keep notebook execution reproducible, and make Python results available to jobs, dashboards and query history where appropriate.

### Compute and infrastructure

- **Connect external VMs as Spark clusters**, including worker discovery, health, credentials, lifecycle state and secure network configuration.
- **Create, configure, resize and terminate clusters on AWS, Azure and Google Cloud** through a CLI and Terraform provider/modules.
- Provider-neutral cluster profiles, secrets handling, cost visibility, autoscaling policies and audit events.

### Engineering workflow

- **Git integration** for notebooks, SQL, jobs, dashboards and workspace configuration — branches, diffs, commits and pull-request workflows.
- **CI/CD pipelines** for linting, type checks, tests, builds, infrastructure validation and environment promotion.
- Deployment environments with safe configuration and secrets management for local, staging and production installations.

### Ecosystem and model workflows

- **Marketplace integration** for discovering and importing external datasets, tables and data products.
- **Hugging Face integration** for datasets and models — authenticated downloads, catalog registration, caching, version tracking and licensing metadata.
- Connect model development workflows to the Unity Catalog model view and make dataset/model provenance visible in lineage.

### Platform hardening

- Authentication, authorization, workspace isolation and catalog grants.
- Production observability, structured audit logs, notifications and operational health checks.
- End-to-end coverage for SQL execution, jobs, notebooks, cluster lifecycle, Git operations and cloud provisioning.

## Configuration

Everything is configurable through environment variables read by the backend:

| Variable                    | Default                     |
| --------------------------- | --------------------------- |
| `LAKEHOUSE_SPARK_REMOTE`    | `sc://localhost:15002`      |
| `LAKEHOUSE_UC_URL`          | `http://localhost:8081`     |
| `LAKEHOUSE_SPARK_MASTER_UI` | `http://localhost:8082`     |
| `LAKEHOUSE_S3_ENDPOINT`     | `http://localhost:8333`     |
| `LAKEHOUSE_KAFKA`           | `localhost:9092`            |
| `LAKEHOUSE_STATE_DB`        | `backend/data/workspace.db` |
| `LAKEHOUSE_MAX_ROWS`        | `10000`                     |

## Limitations

**Lineage is derived, not recorded.** Unity Catalog OSS stores no lineage. The workspace builds the graph from statements it has executed — a write target plus the tables that statement read. SQL run outside the workspace does not appear.

**Unity Catalog stores no column metadata for tables created through the Spark connector.** `columns` comes back empty even for an explicit `CREATE TABLE (...)`. The backend falls back to `DESCRIBE TABLE` in Spark, so the UI shows the real schema either way.

**Table storage is `file:///data/...`, not S3.** The UC Spark connector always calls `generateTemporaryPathCredentials`, and Unity Catalog vends a static placeholder session token that SeaweedFS rejects with a 403 — so UC-managed tables on `s3://` cannot be written. Direct path writes (`spark.write.save("s3a://...")`) work fine; only the catalog-mediated path is affected. Tables therefore live under `file:///data/warehouse`, a host directory mounted into every Spark container.

**Compute is observable, not controllable.** Spark standalone reports workers, cores and memory, but has no API for creating or resizing clusters.

## Stack changes this required

Getting the lakehouse into a working state needed three fixes in the `open-lakehouse` repo (all in gitignored live configs):

1. `config/spark/spark-defaults.conf` — S3 endpoint `localhost:8333` → `host.docker.internal:8333`. The Spark containers use `network_mode: host`, which on Docker Desktop is the Linux VM, not the Mac where the object store runs.
2. `config/unity-catalog/server.properties` — the same endpoint correction.
3. SeaweedFS now runs as a Docker container (`seaweedfs`) with an S3 identity file at `~/seaweedfs-data/s3.json`, because Spark signs its requests and SeaweedFS rejects signed requests unless credentials are configured.

Backups of the original files are noted in the session that made them.

## Development

`npm run dev` uses **webpack** rather than Turbopack: Turbopack's persistent cache database corrupts on the exFAT volume this project lives on. Production builds (`npm run build`) use the default bundler and work normally.

## Repository layout

```text
backend/                 FastAPI gateway and lakehouse integrations
backend/app/routers/     HTTP routes grouped by workspace domain
frontend/src/app/        Next.js routes and page-level experiences
frontend/src/components/ Reusable shell, editor, chart, graph and UI components
frontend/src/lib/        API clients, types, formatting, scheduling and helpers
start.sh                 Local development launcher for API and UI
```

## Security and scope

This repository targets a trusted local development environment. It does not provide authentication, authorization, tenant isolation, production secret management or cloud cluster provisioning, and it must not be exposed to an untrusted network until those controls are implemented. The roadmap above tracks these requirements explicitly.

## Contributing

Keep changes focused and document user-visible behaviour. Run the relevant frontend checks before opening a pull request:

```bash
cd frontend
npm run lint
npm run build
```

For backend changes, install `backend/requirements.txt` into the project virtual environment and verify the affected API path against a running lakehouse stack.

## License

[**MIT**](LICENSE)
