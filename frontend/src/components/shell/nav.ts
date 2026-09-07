/** Sidebar model.
 *
 * Section names and ordering group the workspace by function
 * (Workspace / Recents / Catalog / Jobs & Pipelines / Compute, then the SQL,
 * Data Engineering and Machine Learning groups). Entries exist only where the
 * open-lakehouse stack can actually back them.
 */
export interface NavItem {
  label: string;
  href: string;
  icon: string;
  /** Match nested routes, e.g. /catalog/unity/demo. */
  prefix?: boolean;
}

export interface NavSection {
  label?: string;
  items: NavItem[];
}

export const NAV: NavSection[] = [
  {
    items: [
      { label: "Workspace", href: "/workspace", icon: "LayoutGrid", prefix: true },
      { label: "Recents", href: "/recents", icon: "Clock" },
      { label: "Catalog", href: "/catalog", icon: "Database", prefix: true },
      { label: "Jobs & Pipelines", href: "/jobs", icon: "Workflow", prefix: true },
      { label: "Compute", href: "/compute", icon: "Server", prefix: true },
    ],
  },
  {
    label: "SQL",
    items: [
      { label: "SQL Editor", href: "/sql-editor", icon: "Terminal" },
      { label: "Queries", href: "/queries", icon: "FileCode2" },
      { label: "Dashboards", href: "/dashboards", icon: "LayoutDashboard", prefix: true },
      { label: "Alerts", href: "/alerts", icon: "BellRing", prefix: true },
      { label: "Query History", href: "/query-history", icon: "History" },
    ],
  },
  {
    label: "Data Engineering",
    items: [
      { label: "Notebooks", href: "/notebooks", icon: "NotebookText", prefix: true },
      { label: "Job Runs", href: "/job-runs", icon: "PlayCircle", prefix: true },
      { label: "Pipelines", href: "/pipelines", icon: "Waypoints", prefix: true },
      { label: "Data Ingestion", href: "/ingestion", icon: "Import" },
      { label: "Lineage", href: "/lineage", icon: "GitBranch" },
    ],
  },
  {
    label: "Machine Learning",
    items: [{ label: "Models", href: "/models", icon: "Boxes" }],
  },
];
