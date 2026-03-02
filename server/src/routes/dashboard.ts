import { Hono } from "hono";
import { getDashboardStats } from "../db.ts";

export const dashboardRoutes = new Hono();

// API endpoint for dashboard stats
dashboardRoutes.get("/stats", (c) => {
  const stats = getDashboardStats();
  return c.json(stats);
});
