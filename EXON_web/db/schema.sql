-- Request logging table
CREATE TABLE IF NOT EXISTS request_logs (
    id SERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ip_address VARCHAR(45) NOT NULL,
    steam_id VARCHAR(255),
    level_name VARCHAR(100),
    difficulty VARCHAR(20),
    score INTEGER,
    rate_limited BOOLEAN NOT NULL DEFAULT FALSE,
    success BOOLEAN NOT NULL DEFAULT FALSE,
    request_result VARCHAR(255)
);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_request_logs_timestamp ON request_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_request_logs_ip ON request_logs(ip_address);
CREATE INDEX IF NOT EXISTS idx_request_logs_steam_id ON request_logs(steam_id);
CREATE INDEX IF NOT EXISTS idx_request_logs_rate_limited ON request_logs(rate_limited);
CREATE INDEX IF NOT EXISTS idx_request_logs_request_result ON request_logs(request_result);
CREATE INDEX IF NOT EXISTS idx_request_logs_difficulty ON request_logs(difficulty);
CREATE INDEX IF NOT EXISTS idx_request_logs_level_name ON request_logs(level_name);

-- Banned Steam IDs table
CREATE TABLE IF NOT EXISTS banned_steam_ids (
    id SERIAL PRIMARY KEY,
    steam_id VARCHAR(255) UNIQUE NOT NULL,
    reason TEXT,
    banned_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast ban lookups
CREATE INDEX IF NOT EXISTS idx_banned_steam_ids_steam_id ON banned_steam_ids(steam_id);

-- Optional: Add a composite index for common queries
CREATE INDEX IF NOT EXISTS idx_request_logs_steam_rate ON request_logs(steam_id, rate_limited);
