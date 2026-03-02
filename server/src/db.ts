/**
 * SQLite database for persistent event logging and dashboard stats.
 * Uses Bun's built-in SQLite support.
 */
import { Database } from "bun:sqlite";
import { join, dirname } from "path";

const dbPath = join(dirname(import.meta.dir), "data", "events.db");

// Ensure data directory exists
import { mkdirSync } from "fs";
mkdirSync(dirname(dbPath), { recursive: true });

const db = new Database(dbPath);

// Create events table
db.run(`
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    event_type TEXT NOT NULL,
    metadata TEXT DEFAULT '{}'
  )
`);

// Create index for fast date queries
db.run(`CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type)`);

export type EventType = 
  | "signature_session_created"
  | "signature_session_submitted" 
  | "fax_sent"
  | "fax_delivered"
  | "fax_failed"
  | "skill_download";

export function recordEvent(eventType: EventType, metadata: Record<string, unknown> = {}) {
  const stmt = db.prepare(
    "INSERT INTO events (timestamp, event_type, metadata) VALUES (?, ?, ?)"
  );
  stmt.run(new Date().toISOString(), eventType, JSON.stringify(metadata));
}

export interface DashboardStats {
  totals: Record<EventType, number>;
  today: Record<EventType, number>;
  thisWeek: { date: string; counts: Record<EventType, number> }[];
  thisMonth: { date: string; counts: Record<EventType, number> }[];
}

export function getDashboardStats(): DashboardStats {
  const eventTypes: EventType[] = [
    "signature_session_created",
    "signature_session_submitted",
    "fax_sent",
    "fax_delivered",
    "fax_failed",
    "skill_download",
  ];

  const emptyCount = (): Record<EventType, number> => 
    Object.fromEntries(eventTypes.map(t => [t, 0])) as Record<EventType, number>;

  // All-time totals
  const totalsRows = db.query(
    "SELECT event_type, COUNT(*) as count FROM events GROUP BY event_type"
  ).all() as { event_type: string; count: number }[];
  
  const totals = emptyCount();
  for (const row of totalsRows) {
    if (row.event_type in totals) {
      totals[row.event_type as EventType] = row.count;
    }
  }

  // Today
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayRows = db.query(
    "SELECT event_type, COUNT(*) as count FROM events WHERE timestamp >= ? GROUP BY event_type"
  ).all(todayStart.toISOString()) as { event_type: string; count: number }[];
  
  const today = emptyCount();
  for (const row of todayRows) {
    if (row.event_type in today) {
      today[row.event_type as EventType] = row.count;
    }
  }

  // This week (last 7 days, by day)
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 6);
  weekAgo.setHours(0, 0, 0, 0);
  
  const weekRows = db.query(`
    SELECT date(timestamp) as date, event_type, COUNT(*) as count 
    FROM events 
    WHERE timestamp >= ? 
    GROUP BY date(timestamp), event_type
    ORDER BY date
  `).all(weekAgo.toISOString()) as { date: string; event_type: string; count: number }[];

  const weekMap = new Map<string, Record<EventType, number>>();
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekAgo);
    d.setDate(d.getDate() + i);
    const dateStr = d.toISOString().split('T')[0];
    weekMap.set(dateStr, emptyCount());
  }
  for (const row of weekRows) {
    const dayCounts = weekMap.get(row.date);
    if (dayCounts && row.event_type in dayCounts) {
      dayCounts[row.event_type as EventType] = row.count;
    }
  }
  const thisWeek = Array.from(weekMap.entries()).map(([date, counts]) => ({ date, counts }));

  // This month (last 30 days, by day)
  const monthAgo = new Date();
  monthAgo.setDate(monthAgo.getDate() - 29);
  monthAgo.setHours(0, 0, 0, 0);
  
  const monthRows = db.query(`
    SELECT date(timestamp) as date, event_type, COUNT(*) as count 
    FROM events 
    WHERE timestamp >= ? 
    GROUP BY date(timestamp), event_type
    ORDER BY date
  `).all(monthAgo.toISOString()) as { date: string; event_type: string; count: number }[];

  const monthMap = new Map<string, Record<EventType, number>>();
  for (let i = 0; i < 30; i++) {
    const d = new Date(monthAgo);
    d.setDate(d.getDate() + i);
    const dateStr = d.toISOString().split('T')[0];
    monthMap.set(dateStr, emptyCount());
  }
  for (const row of monthRows) {
    const dayCounts = monthMap.get(row.date);
    if (dayCounts && row.event_type in dayCounts) {
      dayCounts[row.event_type as EventType] = row.count;
    }
  }
  const thisMonth = Array.from(monthMap.entries()).map(([date, counts]) => ({ date, counts }));

  return { totals, today, thisWeek, thisMonth };
}
