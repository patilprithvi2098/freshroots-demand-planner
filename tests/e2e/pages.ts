import { authFile } from "./auth";

export const ROLE_PAGES = [
  { role: "planner", path: "/queue", name: "queue" },
  { role: "planner", path: "/upload", name: "upload" },
  { role: "planner", path: "/runs", name: "runs" },
  { role: "planner", path: "/backtest", name: "backtest" },
  { role: "planner", path: "/settings", name: "settings" },
  { role: "planner", path: "/dashboard", name: "dashboard-planner" },
  { role: "procurement", path: "/procurement", name: "procurement" },
  { role: "viewer", path: "/dashboard", name: "dashboard-viewer" },
] as const;

export const PUBLIC_PAGES = [{ path: "/login", name: "login" }] as const;

export { authFile };
