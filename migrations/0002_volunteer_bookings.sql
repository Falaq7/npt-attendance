CREATE TABLE IF NOT EXISTS bookings (
 id TEXT PRIMARY KEY, session TEXT NOT NULL, email TEXT NOT NULL, name TEXT NOT NULL,
 registered_at TEXT NOT NULL, removed INTEGER NOT NULL DEFAULT 0,
 attended TEXT, hours REAL NOT NULL DEFAULT 2, notes TEXT NOT NULL DEFAULT '',
 signed_out_at TEXT, updated_at TEXT, source TEXT, cancel_token TEXT NOT NULL,
 UNIQUE(session,email)
);
CREATE INDEX IF NOT EXISTS bookings_session_active ON bookings(session,removed);
CREATE UNIQUE INDEX IF NOT EXISTS bookings_cancel_token ON bookings(cancel_token);
