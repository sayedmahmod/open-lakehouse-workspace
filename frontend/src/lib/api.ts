/** Typed client for the workspace API.
 *
 * Requests go to /api/*, which next.config.ts rewrites to the FastAPI gateway,
 * so the browser never needs CORS or a second origin.
 */
import type {
  AiStatus,
  AiUsageSummary,
  Alert,
  AlertEvent,
  AppConfig,
  ClusterOverview,
  ColumnProfile,
  Dashboard,
  DashboardData,
  Executor,
  HistoryEntry,
  Job,
  JobMatrix,
  JobRun,
  LineageEdge,
  Notebook,
  Pipeline,
  PipelineGraph,
  PipelineUpdate,
  QueryResult,
  SavedQuery,
  SchemaObjects,
  SearchResult,
  ServiceHealth,
  SparkJob,
  UCCatalog,
  UCFunction,
  UCSchema,
  UCTable,
  UCVolume,
  WorkspaceObject,
  WorkspaceSummary,
} from "./types";

const BASE = "/api";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      detail = typeof body?.detail === "string" ? body.detail : JSON.stringify(body?.detail ?? body);
    } catch {
      /* response had no JSON body — keep the status line */
    }
    throw new ApiError(detail, res.status);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const get = <T>(path: string) => request<T>(path);
const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
const patch = <T>(path: string, body: unknown) =>
  request<T>(path, { method: "PATCH", body: JSON.stringify(body) });
const put = <T>(path: string, body: unknown) =>
  request<T>(path, { method: "PUT", body: JSON.stringify(body) });
const del = <T>(path: string) => request<T>(path, { method: "DELETE" });

/** URL-safe encoding for dotted Unity Catalog identifiers. */
const enc = (value: string) => encodeURIComponent(value);

export const api = {
  config: () => get<AppConfig>("/config"),

  catalog: {
    catalogs: () => get<UCCatalog[]>("/catalog/catalogs"),
    createCatalog: (body: { name: string; comment?: string; storage_root?: string }) =>
      post<UCCatalog>("/catalog/catalogs", body),
    dropCatalog: (name: string, force = false) =>
      del<{ status: string }>(`/catalog/catalogs/${enc(name)}?force=${force}`),
    schemas: (catalog: string) => get<UCSchema[]>(`/catalog/catalogs/${enc(catalog)}/schemas`),
    createSchema: (catalog: string, body: { name: string; comment?: string }) =>
      post<UCSchema>(`/catalog/catalogs/${enc(catalog)}/schemas`, body),
    dropSchema: (fullName: string, force = false) =>
      del<{ status: string }>(`/catalog/schemas/${enc(fullName)}?force=${force}`),
    objects: (catalog: string, schema: string) =>
      get<SchemaObjects>(`/catalog/catalogs/${enc(catalog)}/schemas/${enc(schema)}/objects`),
    table: (fullName: string) => get<UCTable>(`/catalog/tables/${enc(fullName)}`),
    dropTable: (fullName: string) => del<{ status: string }>(`/catalog/tables/${enc(fullName)}`),
    setTableComment: (fullName: string, comment: string) =>
      put<{ status: string }>(`/catalog/tables/${enc(fullName)}/comment`, { comment }),
    sample: (fullName: string, limit = 100) =>
      get<QueryResult>(`/catalog/tables/${enc(fullName)}/sample?limit=${limit}`),
    history: (fullName: string, limit = 50) =>
      get<QueryResult>(`/catalog/tables/${enc(fullName)}/history?limit=${limit}`),
    detail: (fullName: string) => get<QueryResult>(`/catalog/tables/${enc(fullName)}/detail`),
    profile: (fullName: string) =>
      get<{ row_count: number; columns: ColumnProfile[] }>(`/catalog/tables/${enc(fullName)}/profile`),
    volume: (fullName: string) => get<UCVolume>(`/catalog/volumes/${enc(fullName)}`),
    func: (fullName: string) => get<UCFunction>(`/catalog/functions/${enc(fullName)}`),
    externalLocations: () =>
      get<{ external_locations: unknown[]; credentials: unknown[]; storage_root: string }>(
        "/catalog/external-locations",
      ),
    tree: () => get<{ name: string; comment?: string; schemas: string[] }[]>("/catalog/tree"),
  },

  sql: {
    execute: (body: { sql: string; limit?: number; source?: string; source_id?: string }) =>
      post<QueryResult>("/sql/execute", body),
    status: (id: string) => get<QueryResult>(`/sql/queries/${id}`),
    cancel: (id: string) => post<{ cancelled: boolean }>(`/sql/queries/${id}/cancel`),
    history: (params: { limit?: number; status?: string; search?: string } = {}) => {
      const qs = new URLSearchParams();
      if (params.limit) qs.set("limit", String(params.limit));
      if (params.status && params.status !== "all") qs.set("status", params.status);
      if (params.search) qs.set("search", params.search);
      return get<HistoryEntry[]>(`/sql/history?${qs.toString()}`);
    },
    historyStats: () =>
      get<{
        total: number;
        by_status: Record<string, number>;
        avg_duration_ms: number;
        max_duration_ms: number;
        slowest: HistoryEntry[];
      }>("/sql/history/stats"),
    exportUrl: (id: string) => `${BASE}/sql/queries/${id}/export`,
    saved: () => get<SavedQuery[]>("/sql/saved"),
    getSaved: (id: string) => get<SavedQuery>(`/sql/saved/${id}`),
    createSaved: (body: { name: string; sql: string; description?: string; tags?: string[] }) =>
      post<SavedQuery>("/sql/saved", body),
    updateSaved: (id: string, body: Partial<SavedQuery>) => patch<SavedQuery>(`/sql/saved/${id}`, body),
    deleteSaved: (id: string) => del<{ status: string }>(`/sql/saved/${id}`),
    completion: (catalog?: string, schema?: string) => {
      const qs = new URLSearchParams();
      if (catalog) qs.set("catalog", catalog);
      if (schema) qs.set("schema", schema);
      return get<{
        catalogs: string[];
        schemas: string[];
        tables: string[];
        columns: Record<string, { name: string; type: string }[]>;
        functions: string[];
      }>(`/sql/completion?${qs.toString()}`);
    },
  },

  compute: {
    cluster: () => get<ClusterOverview>("/compute/cluster"),
    executors: () => get<Executor[]>("/compute/executors"),
    sparkJobs: (limit = 60) => get<SparkJob[]>(`/compute/spark-jobs?limit=${limit}`),
    restartSession: () => post<{ reachable: boolean; version?: string }>("/compute/connect/restart-session"),
    health: () => get<{ services: ServiceHealth[]; healthy: boolean }>("/compute/health"),
  },

  jobs: {
    list: () => get<Job[]>("/jobs"),
    create: (body: Partial<Job>) => post<Job>("/jobs", body),
    get: (id: string) => get<Job>(`/jobs/${id}`),
    update: (id: string, body: Partial<Job>) => patch<Job>(`/jobs/${id}`, body),
    remove: (id: string) => del<{ status: string }>(`/jobs/${id}`),
    validate: (id: string) => post<{ errors: string[] }>(`/jobs/${id}/validate`),
    run: (id: string, parameters: Record<string, string> = {}) =>
      post<JobRun>(`/jobs/${id}/run`, { parameters }),
    repair: (runId: string, parameters: Record<string, string> = {}) =>
      post<JobRun>(`/jobs/runs/${runId}/repair`, { parameters }),
    cancelRun: (runId: string) => post<{ status: string }>(`/jobs/runs/${runId}/cancel`),
    runs: (id: string, limit = 50) => get<JobRun[]>(`/jobs/${id}/runs?limit=${limit}`),
    matrix: (id: string, limit = 20) => get<JobMatrix>(`/jobs/${id}/matrix?limit=${limit}`),
    allRuns: (limit = 100, status?: string, jobId?: string) => {
      const qs = new URLSearchParams({ limit: String(limit) });
      if (status && status !== "all") qs.set("status", status);
      if (jobId) qs.set("job_id", jobId);
      return get<JobRun[]>(`/jobs/runs/all?${qs.toString()}`);
    },
    runDetail: (runId: string) => get<JobRun>(`/jobs/runs/detail/${runId}`),
    notificationLog: (id: string, limit = 50) =>
      get<{ id: string; created_at: string; event: string; url: string; status: string; detail?: string }[]>(
        `/jobs/${id}/notifications/log?limit=${limit}`,
      ),
    testWebhook: (id: string, url: string) => post<{ status: string }>(`/jobs/${id}/notifications/test`, { url }),
  },

  pipelines: {
    list: () => get<Pipeline[]>("/pipelines"),
    create: (body: Partial<Pipeline>) => post<Pipeline>("/pipelines", body),
    get: (id: string) => get<Pipeline>(`/pipelines/${id}`),
    update: (id: string, body: Partial<Pipeline>) => patch<Pipeline>(`/pipelines/${id}`, body),
    remove: (id: string) => del<{ status: string }>(`/pipelines/${id}`),
    validate: (id: string) => post<{ errors: string[] }>(`/pipelines/${id}/validate`),
    start: (id: string, body: { full_refresh?: boolean; refresh_selection?: string[] } = {}) =>
      post<PipelineUpdate>(`/pipelines/${id}/start`, body),
    stopUpdate: (updateId: string) => post<{ status: string }>(`/pipelines/updates/${updateId}/stop`),
    updates: (id: string, limit = 50) => get<PipelineUpdate[]>(`/pipelines/${id}/updates?limit=${limit}`),
    updateDetail: (updateId: string) => get<PipelineUpdate>(`/pipelines/updates/detail/${updateId}`),
    graph: (id: string) => get<PipelineGraph>(`/pipelines/${id}/graph`),
    datasetPreview: (id: string, name: string, limit = 100) =>
      get<QueryResult>(`/pipelines/${id}/datasets/${enc(name)}/preview?limit=${limit}`),
  },

  dashboards: {
    list: () => get<Dashboard[]>("/dashboards"),
    create: (body: Partial<Dashboard>) => post<Dashboard>("/dashboards", body),
    get: (id: string) => get<Dashboard>(`/dashboards/${id}`),
    update: (id: string, body: Partial<Dashboard>) => patch<Dashboard>(`/dashboards/${id}`, body),
    remove: (id: string) => del<{ status: string }>(`/dashboards/${id}`),
    refresh: (id: string) => post<DashboardData>(`/dashboards/${id}/refresh`),
  },

  alerts: {
    list: () => get<Alert[]>("/alerts"),
    create: (body: Partial<Alert>) => post<Alert>("/alerts", body),
    get: (id: string) => get<Alert>(`/alerts/${id}`),
    update: (id: string, body: Partial<Alert>) => patch<Alert>(`/alerts/${id}`, body),
    remove: (id: string) => del<{ status: string }>(`/alerts/${id}`),
    evaluate: (id: string) =>
      post<{ state: string; value?: unknown; checked_at: string; error?: string }>(`/alerts/${id}/evaluate`),
    events: (id: string, limit = 50) => get<AlertEvent[]>(`/alerts/${id}/events?limit=${limit}`),
  },

  notebooks: {
    list: () => get<Notebook[]>("/notebooks"),
    create: (body: Partial<Notebook>) => post<Notebook>("/notebooks", body),
    get: (id: string) => get<Notebook>(`/notebooks/${id}`),
    update: (id: string, body: Partial<Notebook>) => patch<Notebook>(`/notebooks/${id}`, body),
    remove: (id: string) => del<{ status: string }>(`/notebooks/${id}`),
    runCell: (id: string, cellId: string, body: { source: string; language: string }) =>
      post<QueryResult>(`/notebooks/${id}/cells/${cellId}/run`, body),
    runAll: (id: string) => post<{ results: (QueryResult & { cell_id: string })[] }>(`/notebooks/${id}/run`),
  },

  lineage: {
    graph: () =>
      get<{ nodes: { id: string; name: string; full_name: string }[]; edges: LineageEdge[] }>("/lineage/graph"),
    table: (fullName: string) =>
      get<{ table: string; upstream: LineageEdge[]; downstream: LineageEdge[]; has_lineage: boolean }>(
        `/lineage/table/${enc(fullName)}`,
      ),
  },

  workspace: {
    objects: (folderId?: string) =>
      get<WorkspaceObject[]>(`/workspace/objects${folderId ? `?folder_id=${enc(folderId)}` : ""}`),
    recents: (limit = 20) =>
      get<{ id: string; kind: string; object_id: string; name: string; href: string; visited_at: string }[]>(
        `/workspace/recents?limit=${limit}`,
      ),
    trackRecent: (body: { kind: string; object_id: string; name: string; href: string }) =>
      post<{ status: string }>("/workspace/recents", body),
    search: (q: string) => get<SearchResult[]>(`/workspace/search?q=${enc(q)}`),
    summary: () => get<WorkspaceSummary>("/workspace/summary"),
  },

  streaming: {
    status: () => get<{ bootstrap: string; reachable: boolean }>("/streaming/status"),
  },

  ai: {
    status: () => get<AiStatus>("/ai/status"),
    saveSettings: (body: { provider: string; model?: string; reasoning_effort?: string }) =>
      put<AiStatus>("/ai/settings", body),
    resetUsage: () => post<AiUsageSummary>("/ai/usage/reset"),
    install: (provider: string) =>
      post<{ ok: boolean; output: string; status: AiStatus }>("/ai/install", { provider }),
    /** Streamed edit. Returns the AbortController so the caller can cancel. */
    edit: (
      body: {
        source: string;
        language: string;
        instruction: string;
        selection?: { start: number; end: number };
        context?: { tables: string[] };
        surface: string;
      },
      handlers: {
        onDelta?: (text: string) => void;
        onDone?: (output: string, usage: Record<string, unknown>) => void;
        onError?: (message: string) => void;
      },
    ) => {
      const controller = new AbortController();
      (async () => {
        let res: Response;
        try {
          res = await fetch(`${BASE}/ai/edit`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: controller.signal,
            cache: "no-store",
          });
        } catch (err) {
          if (!controller.signal.aborted)
            handlers.onError?.(err instanceof Error ? err.message : "Request failed");
          return;
        }
        if (!res.ok || !res.body) {
          handlers.onError?.(`${res.status} ${res.statusText}`);
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const frames = buffer.split("\n\n");
            buffer = frames.pop() ?? "";
            for (const frame of frames) {
              const line = frame.trim();
              if (!line.startsWith("data:")) continue;
              let event: { type: string; text?: string; output?: string; message?: string; usage?: Record<string, unknown> };
              try {
                event = JSON.parse(line.slice(5).trim());
              } catch {
                continue;
              }
              if (event.type === "delta") handlers.onDelta?.(event.text ?? "");
              else if (event.type === "done") handlers.onDone?.(event.output ?? "", event.usage ?? {});
              else if (event.type === "error") handlers.onError?.(event.message ?? "Failed");
            }
          }
        } catch (err) {
          if (!controller.signal.aborted)
            handlers.onError?.(err instanceof Error ? err.message : "Stream interrupted");
        }
      })();
      return controller;
    },
  },
};
