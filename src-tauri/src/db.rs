//! Persistent SQLite storage engine for historical bandwidth data.
//!
//! Stores per-application network usage in hourly time buckets so that
//! cumulative bandwidth statistics survive process and system restarts.
//!
//! Database schema:
//!   app_usage_history (id, app_path, app_name, bytes_sent, bytes_received,
//!                      timestamp_bucket, interface_type)
//!
//! Flush mechanism:
//!   The aggregation thread flushes in-memory byte deltas to the database
//!   every 10 seconds or upon graceful app shutdown.

use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};

/// A single historical usage record.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageRecord {
    pub id: i64,
    pub app_path: String,
    pub app_name: String,
    pub bytes_sent: i64,
    pub bytes_received: i64,
    pub timestamp_bucket: i64,
    pub interface_type: String,
}

/// In-memory delta that will be flushed to SQLite periodically.
#[derive(Debug, Clone, Default)]
pub struct PendingDelta {
    pub bytes_sent: u64,
    pub bytes_received: u64,
}

/// Thread-safe SQLite database manager.
pub struct DatabaseManager {
    conn: Mutex<Connection>,
}

impl DatabaseManager {
    /// Open (or create) the SQLite database and ensure the schema exists.
    pub fn open(db_path: &PathBuf) -> Result<Self, String> {
        let conn = Connection::open(db_path)
            .map_err(|e| format!("Failed to open SQLite database: {e}"))?;

        // Enable WAL mode for better concurrent read/write performance.
        conn.execute_batch("PRAGMA journal_mode=WAL;")
            .map_err(|e| format!("Failed to set WAL mode: {e}"))?;

        // Create the usage history table.
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS app_usage_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                app_path TEXT NOT NULL,
                app_name TEXT NOT NULL,
                bytes_sent INTEGER NOT NULL DEFAULT 0,
                bytes_received INTEGER NOT NULL DEFAULT 0,
                timestamp_bucket INTEGER NOT NULL,
                interface_type TEXT NOT NULL DEFAULT 'unknown',
                UNIQUE(app_path, timestamp_bucket, interface_type)
            );

            CREATE INDEX IF NOT EXISTS idx_usage_app_path
                ON app_usage_history(app_path);
            CREATE INDEX IF NOT EXISTS idx_usage_timestamp
                ON app_usage_history(timestamp_bucket);
            "
        )
        .map_err(|e| format!("Failed to create schema: {e}"))?;

        log::info!("SQLite database opened at {}", db_path.display());
        Ok(DatabaseManager {
            conn: Mutex::new(conn),
        })
    }

    /// Open the database at the default location (next to the executable).
    pub fn open_default() -> Result<Self, String> {
        let db_path = Self::default_db_path();
        Self::open(&db_path)
    }

    /// Default database file path: data_guardian.db in the app's data directory.
    pub fn default_db_path() -> PathBuf {
        // Use the current directory as a fallback; Tauri's app_data_dir
        // should be used in production, but this keeps things simple.
        PathBuf::from("data_guardian.db")
    }

    /// Flush a batch of pending byte deltas into the database.
    ///
    /// `deltas` is a map of `(app_path, app_name, interface_type) -> PendingDelta`.
    /// Each entry is upserted into the appropriate hourly time bucket.
    pub fn flush_batch(
        &self,
        deltas: &[(String, String, String, PendingDelta)],
    ) -> Result<usize, String> {
        if deltas.is_empty() {
            return Ok(0);
        }

        let conn = self.conn.lock().map_err(|e| format!("Lock poisoned: {e}"))?;

        let mut total_flushed = 0;

        for (app_path, app_name, interface_type, delta) in deltas {
            if delta.bytes_sent == 0 && delta.bytes_received == 0 {
                continue;
            }

            // Bucket timestamp to the nearest hour.
            let now = chrono::Utc::now().timestamp();
            let bucket = now - (now % 3600);

            conn.execute(
                "INSERT INTO app_usage_history
                    (app_path, app_name, bytes_sent, bytes_received, timestamp_bucket, interface_type)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                 ON CONFLICT(app_path, timestamp_bucket, interface_type)
                 DO UPDATE SET
                    bytes_sent = bytes_sent + excluded.bytes_sent,
                    bytes_received = bytes_received + excluded.bytes_received,
                    app_name = excluded.app_name",
                params![
                    app_path,
                    app_name,
                    delta.bytes_sent as i64,
                    delta.bytes_received as i64,
                    bucket,
                    interface_type,
                ],
            )
            .map_err(|e| format!("Failed to insert usage record: {e}"))?;

            total_flushed += 1;
        }

        Ok(total_flushed)
    }

    /// Get total bytes sent/received for a specific app across all time.
    pub fn get_app_totals(&self, app_path: &str) -> Result<(i64, i64), String> {
        let conn = self.conn.lock().map_err(|e| format!("Lock poisoned: {e}"))?;

        let mut stmt = conn
            .prepare(
                "SELECT COALESCE(SUM(bytes_sent), 0), COALESCE(SUM(bytes_received), 0)
                 FROM app_usage_history WHERE app_path = ?1",
            )
            .map_err(|e| format!("Failed to prepare query: {e}"))?;

        let (sent, received): (i64, i64) = stmt
            .query_row(params![app_path], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(|e| format!("Failed to query app totals: {e}"))?;

        Ok((sent, received))
    }

    /// Get all apps with their total bandwidth, ordered by total usage descending.
    pub fn get_all_app_totals(&self) -> Result<Vec<(String, String, i64, i64)>, String> {
        let conn = self.conn.lock().map_err(|e| format!("Lock poisoned: {e}"))?;

        let mut stmt = conn
            .prepare(
                "SELECT app_path, app_name, SUM(bytes_sent), SUM(bytes_received)
                 FROM app_usage_history
                 GROUP BY app_path
                 ORDER BY (SUM(bytes_sent) + SUM(bytes_received)) DESC",
            )
            .map_err(|e| format!("Failed to prepare query: {e}"))?;

        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                ))
            })
            .map_err(|e| format!("Failed to query app totals: {e}"))?;

        let mut result = Vec::new();
        for row in rows {
            result.push(row.map_err(|e| format!("Failed to read row: {e}"))?);
        }

        Ok(result)
    }

    /// Get hourly usage for a specific app (last 24 hours).
    pub fn get_hourly_usage(
        &self,
        app_path: &str,
        hours: i64,
    ) -> Result<Vec<(i64, i64, i64)>, String> {
        let conn = self.conn.lock().map_err(|e| format!("Lock poisoned: {e}"))?;

        let cutoff = chrono::Utc::now().timestamp() - (hours * 3600);

        let mut stmt = conn
            .prepare(
                "SELECT timestamp_bucket, bytes_sent, bytes_received
                 FROM app_usage_history
                 WHERE app_path = ?1 AND timestamp_bucket >= ?2
                 ORDER BY timestamp_bucket ASC",
            )
            .map_err(|e| format!("Failed to prepare query: {e}"))?;

        let rows = stmt
            .query_map(params![app_path, cutoff], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?))
            })
            .map_err(|e| format!("Failed to query hourly usage: {e}"))?;

        let mut result = Vec::new();
        for row in rows {
            result.push(row.map_err(|e| format!("Failed to read row: {e}"))?);
        }

        Ok(result)
    }

    /// Delete old records older than the specified number of days.
    pub fn cleanup_old_records(&self, days: i64) -> Result<usize, String> {
        let conn = self.conn.lock().map_err(|e| format!("Lock poisoned: {e}"))?;

        let cutoff = chrono::Utc::now().timestamp() - (days * 86400);

        let deleted = conn
            .execute(
                "DELETE FROM app_usage_history WHERE timestamp_bucket < ?1",
                params![cutoff],
            )
            .map_err(|e| format!("Failed to cleanup old records: {e}"))?;

        if deleted > 0 {
            log::info!("Cleaned up {} old usage records", deleted);
        }

        Ok(deleted)
    }
}
