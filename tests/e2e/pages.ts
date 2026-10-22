import { authFile, hasSession } from "./auth";

export const ROLE_PAGES = [
  { role: "planner", path: "/overview", name: "overview" },
  { role: "planner", path: "/queue", name: "review" },
  { role: "planner", path: "/data", name: "data" },
  { role: "planner", path: "/backtest", name: "backtest" },
  { role: "planner", path: "/settings", name: "settings" },
  { role: "planner", path: "/dashboard", name: "dashboard-planner" },
  { role: "procurement", path: "/procurement", name: "procurement" },
  { role: "viewer", path: "/dashboard", name: "dashboard-viewer" },
] as const;

export const PUBLIC_PAGES = [{ path: "/login", name: "login" }] as const;

export { authFile, hasSession };
