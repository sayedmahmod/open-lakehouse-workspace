/** Shapes returned by the workspace API. */

export interface ColumnMeta {
  name: string;
  type: string;
  nullable?: boolean;
}

export interface QueryResult {
  id: string;
  status: "RUNNING" | "FINISHED" | "FAILED" | "CANCELED" | "SKIPPED";
  sql?: string;
  columns: ColumnMeta[];
  rows: unknown[][];
  row_count: number;
  truncated?: boolean;
  error?: string | null;
  duration_ms?: number;
  started_at?: string;
  ended_at?: string;
  statement_type?: string;
  referenced_tables?: string[];
  script?: boolean;
  statements?: number;
  results?: QueryResult[];
}

export interface HistoryEntry {
  id: string;
  sql: string;
  status: string;
  started_at: string;
  ended_at?: string;
  duration_ms?: number;
  row_count?: number;
  error?: string;
  source: string;
  statement_type?: string;
  referenced_tables: string[];
}

export interface UCColumn {
  name: string;
  type_text?: string;
  type_name?: string;
  comment?: string | null;
  nullable?: boolean;
  position?: number;
  partition_index?: number | null;
}

export interface UCTable {
  name: string;
  catalog_name: string;
  schema_name: string;
  table_type?: string;
  data_source_format?: string;
  columns?: UCColumn[];
  storage_location?: string;
  comment?: string | null;
  owner?: string | null;
  created_at?: number;
  updated_at?: number;
  table_id?: string;
  properties?: Record<string, string>;
}

export interface UCCatalog {
  name: string;
  comment?: string | null;
  created_at?: number;
  updated_at?: number;
  id?: string;
  schema_count?: number;
}

export interface UCSchema {
  name: string;
  catalog_name: string;
  full_name: string;
  comment?: string | null;
  created_at?: number;
  table_count?: number;
  volume_count?: number;
  function_count?: number;
}

export interface UCVolume {
  name: string;
  catalog_name: string;
  schema_name: string;
  full_name: string;
  volume_type?: string;
  storage_location?: string;
  comment?: string | null;
  created_at?: number;
}

export interface UCFunction {
  name: string;
  catalog_name: string;
  schema_name: string;
  full_name?: string;
  data_type?: string;
  full_data_type?: string;
  routine_definition?: string;
  comment?: string | null;
  input_params?: { parameters?: { name: string; type_text?: string }[] };
}

export interface SchemaObjects {
  tables: UCTable[];
  volumes: UCVolume[];
  functions: UCFunction[];
  models: unknown[];
}

export interface SavedQuery {
  id: string;
  name: string;
  description: string;
  sql: string;
  tags: string[];
  created_at: string;
  updated_at: string;
  favorite: boolean;
  folder_id?: string | null;
}

export interface NotebookCell {
  id: string;
  language: "sql" | "markdown";
  source: string;
}

export interface Notebook {
  id: string;
  name: string;
  cells: NotebookCell[];
  default_language: string;
  created_at: string;
  updated_at: string;
  favorite: boolean;
}

export interface Schedule {
  kind: "interval" | "daily" | "cron";
  every?: number;
  unit?: "minutes" | "hours";
  at?: string;
  cron?: string;
  tz?: string;
}

export type TaskType =
  | "sql"
  | "notebook"
  | "saved_query"
  | "dashboard"
  | "condition"
  | "for_each"
  | "run_job"
  | "pipeline";

export type RunIf =
  | "ALL_SUCCESS"
  | "ALL_DONE"
  | "NONE_FAILED"
  | "AT_LEAST_ONE_SUCCESS"
  | "AT_LEAST_ONE_FAILED"
  | "ALL_FAILED";

export type DepOutcome = "success" | "done" | "failed" | "true" | "false";

export interface TaskDep {
  key: string;
  outcome: DepOutcome;
}

export interface RetryPolicy {
  max_retries: number;
  min_retry_interval_millis: number;
  retry_on_timeout: boolean;
}

export interface ConditionSpec {
  left: string;
  op: "==" | "!=" | ">" | ">=" | "<" | "<=";
  right: string;
}

export interface ForEachSpec {
  inputs: string;
  concurrency: number;
}

export interface JobTask {
  key: string;
  name?: string | null;
  description?: string;
  type: TaskType;
  sql: string;
  notebook_id?: string | null;
  query_id?: string | null;
  dashboard_id?: string | null;
  run_job_id?: string | null;
  pipeline_id?: string | null;
  condition?: ConditionSpec | null;
  for_each?: ForEachSpec | null;
  inner_task?: JobTask | null;
  depends_on: TaskDep[];
  run_if: RunIf;
  retry: RetryPolicy;
  timeout_seconds: number;
  parameters: Record<string, string>;
  capture_output: boolean;
  disabled: boolean;
}

export interface JobParameter {
  name: string;
  default: string;
}

export interface JobNotifications {
  on_start: string[];
  on_success: string[];
  on_failure: string[];
  on_duration_warning: string[];
  min_duration_warning_seconds: number;
}

export interface Job {
  id: string;
  name: string;
  description: string;
  tasks: JobTask[];
  schedule: Schedule | null;
  paused: boolean;
  tags: string[];
  parameters: JobParameter[];
  max_concurrent_runs: number;
  timeout_seconds: number;
  queue_enabled: boolean;
  continuous: boolean;
  notifications: JobNotifications;
  health: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  last_run_at?: string | null;
  next_run_at?: string | null;
  last_run?: { id: string; status: string; started_at: string; duration_ms?: number; run_number: number } | null;
  recent_statuses?: string[];
  run_count?: number;
  success_rate?: number | null;
}

export type RunStatus =
  | "PENDING"
  | "RUNNING"
  | "QUEUED"
  | "SUCCESS"
  | "FAILED"
  | "SKIPPED"
  | "UPSTREAM_FAILED"
  | "TIMED_OUT"
  | "CANCELED"
  | "EXCLUDED";

export interface TaskAttempt {
  n: number;
  status: string;
  started_at?: string;
  ended_at?: string;
  duration_ms?: number;
  error?: string | null;
}

export interface ForEachIteration {
  index: number;
  input: unknown;
  status: string;
  duration_ms?: number;
  row_count?: number;
  error?: string | null;
}

export interface TaskRun {
  key: string;
  name: string;
  type: string;
  status: RunStatus;
  depends_on: TaskDep[];
  run_if?: RunIf;
  started_at?: string | null;
  ended_at?: string | null;
  duration_ms?: number | null;
  row_count?: number | null;
  attempts?: TaskAttempt[];
  iterations?: ForEachIteration[];
  condition_result?: boolean | null;
  output?: Record<string, unknown>;
  error?: string | null;
  message?: string | null;
  query_ids?: string[];
  cluster?: string;
}

export interface JobRun {
  id: string;
  job_id: string;
  job_name?: string;
  run_number: number;
  status: string;
  trigger: string;
  started_at: string;
  ended_at?: string;
  duration_ms?: number;
  task_runs: TaskRun[];
  trigger_params?: Record<string, string>;
  repair_count?: number;
  queued_at?: string | null;
  end_state_message?: string | null;
  error?: string | null;
  task_values?: { task_key: string; name: string; value: unknown; set_at: string }[];
}

export interface JobMatrix {
  tasks: { key: string; name: string; type: string }[];
  runs: {
    id: string;
    run_number: number;
    status: string;
    trigger: string;
    started_at: string;
    duration_ms?: number;
    repair_count: number;
    cells: Record<string, { status: string; duration_ms?: number }>;
  }[];
}

/* --------------------------------------------------------------- Pipelines */

export type DatasetType = "materialized_view" | "streaming_table" | "view";
export type ExpectationAction = "warn" | "drop" | "fail";

export interface Expectation {
  name: string;
  condition: string;
  action: ExpectationAction;
}

export interface PipelineDataset {
  name: string;
  type: DatasetType;
  comment: string;
  sql: string;
  partition_cols: string[];
  incremental_key: string;
  expectations: Expectation[];
}

export interface PipelineNotifications {
  on_update_success: string[];
  on_update_failure: string[];
}

export interface Pipeline {
  id: string;
  name: string;
  description: string;
  target_catalog: string;
  target_schema: string;
  datasets: PipelineDataset[];
  configuration: Record<string, string>;
  development: boolean;
  continuous: boolean;
  schedule: Schedule | null;
  paused: boolean;
  notifications: PipelineNotifications;
  tags: string[];
  created_at: string;
  updated_at: string;
  last_update_at?: string | null;
  next_run_at?: string | null;
  last_update?: { id: string; status: string; started_at: string; duration_ms?: number; update_number: number } | null;
  recent_statuses?: string[];
  update_count?: number;
}

export interface ExpectationResult {
  name: string;
  condition: string;
  action: ExpectationAction;
  total: number | null;
  failed: number | null;
  passed?: number;
  error?: string;
}

export interface DatasetResult {
  name: string;
  type: DatasetType;
  status: string;
  rows?: number | null;
  rows_written?: number | null;
  duration_ms?: number | null;
  expectations: ExpectationResult[];
  error?: string | null;
  query_ids?: string[];
}

export interface PipelineEvent {
  ts: string;
  level: "INFO" | "WARN" | "ERROR";
  dataset: string | null;
  message: string;
}

export interface PipelineUpdate {
  id: string;
  pipeline_id: string;
  pipeline_name?: string;
  update_number: number;
  status: string;
  cause: string;
  full_refresh: boolean;
  refresh_selection: string[];
  development: boolean;
  started_at: string;
  ended_at?: string;
  duration_ms?: number;
  datasets: DatasetResult[];
  events: PipelineEvent[];
  error?: string | null;
}

export interface PipelineGraphNode {
  name: string;
  type: DatasetType;
  full_name: string;
  comment: string;
  expectation_count: number;
  status?: string | null;
  rows?: number | null;
  rows_written?: number | null;
  duration_ms?: number | null;
  quality?: { total: number; failed: number } | null;
}

export interface PipelineGraph {
  nodes: PipelineGraphNode[];
  edges: { source: string; target: string }[];
  last_update?: string | null;
}

export interface DashboardDataset {
  key: string;
  name: string;
  sql: string;
}

export type WidgetType = "table" | "bar" | "line" | "area" | "pie" | "counter" | "text";

export interface DashboardWidget {
  id: string;
  type: WidgetType;
  title: string;
  dataset_key: string | null;
  x: string | null;
  y: string[];
  group_by: string | null;
  text: string;
  layout: { w?: number };
  options: Record<string, unknown>;
}

export interface Dashboard {
  id: string;
  name: string;
  description: string;
  datasets: DashboardDataset[];
  widgets: DashboardWidget[];
  created_at: string;
  updated_at: string;
  favorite: boolean;
}

export interface DashboardData {
  refreshed_at: string;
  data: Record<
    string,
    { status: string; columns: ColumnMeta[]; rows: unknown[][]; row_count: number; error?: string; duration_ms?: number }
  >;
}

export interface Alert {
  id: string;
  name: string;
  sql: string;
  column_name: string;
  operator: string;
  threshold: string;
  schedule: Schedule | null;
  paused: boolean;
  state: "ok" | "triggered" | "error" | "unknown";
  last_checked_at?: string | null;
  last_triggered_at?: string | null;
  last_value?: string | null;
  created_at: string;
  updated_at: string;
}

export interface AlertEvent {
  id: string;
  alert_id: string;
  state: string;
  value?: string;
  checked_at: string;
  error?: string;
}

export interface ClusterWorker {
  id: string;
  host: string;
  port: number;
  webui: string;
  state: string;
  cores: number;
  cores_used: number;
  cores_free: number;
  memory_mb: number;
  memory_used_mb: number;
  memory_free_mb: number;
  last_heartbeat: number;
}

export interface ClusterOverview {
  master: {
    reachable: boolean;
    error?: string;
    master_url?: string;
    status?: string;
    cores_total: number;
    cores_used: number;
    memory_total_mb: number;
    memory_used_mb: number;
    alive_workers: number;
    workers: ClusterWorker[];
    active_apps: SparkApp[];
    completed_apps: SparkApp[];
  };
  worker: { reachable: boolean; error?: string };
  connect: { reachable: boolean; version?: string; error?: string; remote: string };
  links: { master_ui: string; worker_ui: string; driver_ui: string };
}

export interface SparkApp {
  id: string;
  name: string;
  state: string;
  cores: number;
  memory_per_executor_mb: number;
  submitted_at?: number;
  duration_ms?: number;
  user?: string;
}

export interface Executor {
  id: string;
  host_port: string;
  is_active: boolean;
  memory_used: number;
  disk_used: number;
  total_cores: number;
  active_tasks: number;
  failed_tasks: number;
  completed_tasks: number;
  total_duration_ms: number;
  total_input_bytes: number;
  total_shuffle_read: number;
  total_shuffle_write: number;
  max_memory: number;
  add_time?: string;
}

export interface SparkJob {
  job_id: number;
  name: string;
  status: string;
  submitted_at?: string;
  completed_at?: string;
  num_tasks: number;
  completed_tasks: number;
  failed_tasks: number;
  active_tasks: number;
  stage_ids: number[];
}

export interface ServiceHealth {
  name: string;
  kind: string;
  healthy: boolean;
  detail?: string;
  endpoint: string;
}

export interface LineageEdge {
  source: string;
  target: string;
  count: number;
  last_seen: string;
  query_id: string;
}

export interface WorkspaceObject {
  id: string;
  name: string;
  kind: string;
  href: string;
  updated_at?: string;
  created_at?: string;
  favorite: boolean;
  folder_id?: string | null;
}

export interface SearchResult {
  kind: string;
  name: string;
  id: string;
  href: string;
  subtitle: string;
}

export interface ColumnProfile {
  name: string;
  type: string;
  comment?: string | null;
  nullable: boolean;
  non_null: number;
  null_count: number;
  null_pct: number;
  distinct: number;
  min?: number | null;
  max?: number | null;
  avg?: number | null;
}

export interface WorkspaceSummary {
  catalog: { catalogs: number; schemas: number; tables: number };
  notebooks: number;
  queries: number;
  dashboards: number;
  jobs: number;
  pipelines?: number;
  alerts: number;
  runs_today: number;
  queries_today: number;
}

export interface AiProviderStatus {
  id: "codex" | "claude";
  name: string;
  bin: string;
  available: boolean;
  version: string | null;
  models: AiModelOption[];
  reasoning_efforts: ReasoningEffort[];
}

export type ReasoningEffort = "low" | "medium" | "high" | "xhigh" | "max" | "ultra";

export interface AiModelOption {
  id: string;
  name: string;
  default_reasoning_effort: ReasoningEffort | "";
  reasoning_efforts: ReasoningEffort[];
}

export interface AiUsageRow {
  created_at: string;
  provider: string;
  model: string;
  surface: string;
  ok: boolean;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number | null;
  duration_ms: number;
}

export interface AiUsageSummary {
  requests: number;
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  cost_usd: number | null;
  since: string | null;
  recent: AiUsageRow[];
}

export interface AiStatus {
  providers: AiProviderStatus[];
  active: { provider: "codex" | "claude"; model: string; reasoning_effort: ReasoningEffort | "" };
  usage: AiUsageSummary;
}

export interface AppConfig {
  spark_remote: string;
  unity_catalog_url: string;
  spark_master_ui: string;
  spark_worker_ui: string;
  spark_driver_ui: string;
  s3_endpoint: string;
  warehouse_root: string;
  kafka_bootstrap: string;
  max_result_rows: number;
}
