-- Example queries for identifying suspicious activity and potential attackers

-- 1. Find Steam IDs with repeated ticket validation failures (pattern-based detection)
SELECT 
    steam_id,
    COUNT(*) as failed_validations,
    COUNT(DISTINCT ip_address) as unique_ips,
    array_agg(DISTINCT request_result) as failure_reasons,
    MIN(timestamp) as first_failure,
    MAX(timestamp) as last_failure
FROM request_logs
WHERE request_result IN ('Invalid ticket', 'Steam ID mismatch', 'Not app owner', 'Validation failed')
  AND timestamp > NOW() - INTERVAL '24 hours'
  AND steam_id IS NOT NULL
GROUP BY steam_id
HAVING COUNT(*) >= 10  -- 10+ failures in 24 hours suggests attack
ORDER BY failed_validations DESC;

-- 2. Find Steam IDs that have been rate-limited multiple times
SELECT 
    steam_id,
    COUNT(*) as rate_limited_count,
    COUNT(DISTINCT ip_address) as unique_ips,
    MIN(timestamp) as first_seen,
    MAX(timestamp) as last_seen
FROM request_logs
WHERE rate_limited = true AND steam_id IS NOT NULL
GROUP BY steam_id
ORDER BY rate_limited_count DESC
LIMIT 50;

-- 3. Find IPs hitting rate limits frequently
SELECT 
    ip_address,
    COUNT(*) as rate_limited_count,
    COUNT(DISTINCT steam_id) as unique_steam_ids,
    MIN(timestamp) as first_seen,
    MAX(timestamp) as last_seen
FROM request_logs
WHERE rate_limited = true
GROUP BY ip_address
ORDER BY rate_limited_count DESC
LIMIT 50;

-- 3. Find Steam IDs with suspiciously fast scores
-- Scores are in milliseconds
SELECT 
    steam_id,
    MIN(score) as best_score,
    MAX(score) as worst_score,
    COUNT(*) as submission_count,
    COUNT(CASE WHEN rate_limited THEN 1 END) as rate_limited_count,
    COUNT(CASE WHEN success THEN 1 END) as successful_submissions
FROM request_logs
WHERE steam_id IS NOT NULL AND (score < 240000)
GROUP BY steam_id
ORDER BY best_score ASC
LIMIT 50;

-- 4. Find Steam IDs with both suspicious scores AND rate-limit violations
SELECT 
    steam_id,
    MIN(score) as best_score,
    MAX(score) as worst_score,
    COUNT(*) as total_requests,
    COUNT(CASE WHEN rate_limited THEN 1 END) as rate_limited_count,
    COUNT(CASE WHEN success THEN 1 END) as successful_count,
    COUNT(DISTINCT ip_address) as unique_ips
FROM request_logs
WHERE steam_id IS NOT NULL
GROUP BY steam_id
HAVING COUNT(CASE WHEN rate_limited THEN 1 END) > 5  -- More than 5 rate-limits
   OR MIN(score) < 240000  -- Impossibly fast time
ORDER BY rate_limited_count DESC, best_score ASC
LIMIT 50;

-- 5. Recent activity in the last hour (for real-time monitoring)
SELECT 
    timestamp,
    ip_address,
    steam_id,
    score,
    rate_limited,
    success
FROM request_logs
WHERE timestamp > NOW() - INTERVAL '1 hour'
ORDER BY timestamp DESC
LIMIT 100;

-- 6. Summary stats for the last 24 hours
SELECT 
    COUNT(*) as total_requests,
    COUNT(DISTINCT steam_id) as unique_users,
    COUNT(DISTINCT ip_address) as unique_ips,
    COUNT(CASE WHEN rate_limited THEN 1 END) as rate_limited_requests,
    COUNT(CASE WHEN success THEN 1 END) as successful_submissions,
    AVG(score) as avg_score,
    MIN(score) as best_score,
    MAX(score) as worst_score
FROM request_logs
WHERE timestamp > NOW() - INTERVAL '24 hours';

-- 7. Find Steam IDs to ban (manual review recommended before banning)
-- This finds accounts with high rate-limit violations or suspicious scores
SELECT 
    steam_id,
    COUNT(*) as total_requests,
    COUNT(CASE WHEN rate_limited THEN 1 END) as rate_limited_count,
    COUNT(CASE WHEN success THEN 1 END) as successful_count,
    MIN(score) as best_score,
    MAX(score) as worst_score,
    MIN(timestamp) as first_seen,
    MAX(timestamp) as last_seen
FROM request_logs
WHERE steam_id IS NOT NULL
GROUP BY steam_id
HAVING COUNT(CASE WHEN rate_limited THEN 1 END) >= 10  -- 10+ rate-limit violations
   OR MIN(score) < 10  -- Impossibly fast times
ORDER BY rate_limited_count DESC, best_score ASC;

-- 8. Ban a Steam ID (after manual review)
-- INSERT INTO banned_steam_ids (steam_id, reason)
-- VALUES ('76561198012345678', 'Repeated rate-limit violations and suspicious activity');

-- 9. Unban a Steam ID (if banned by mistake)
-- DELETE FROM banned_steam_ids WHERE steam_id = '76561198012345678';

-- 10. Check if a specific Steam ID is banned
-- SELECT * FROM banned_steam_ids WHERE steam_id = '76561198012345678';

-- 11. Clean up old logs (optional - run periodically to save space)
-- Keep only last 90 days of logs
-- DELETE FROM request_logs WHERE timestamp < NOW() - INTERVAL '90 days';

-- 12. Auto-ban candidates based on patterns (for automated cron job)
-- Insert Steam IDs with 10+ validation failures in last 24 hours into ban table
-- INSERT INTO banned_steam_ids (steam_id, reason)
-- SELECT 
--     steam_id,
--     'Automated ban: ' || COUNT(*) || ' ticket validation failures in 24h'
-- FROM request_logs
-- WHERE request_result IN ('Invalid ticket', 'Steam ID mismatch', 'Not app owner', 'Validation failed')
--   AND timestamp > NOW() - INTERVAL '24 hours'
--   AND steam_id IS NOT NULL
--   AND steam_id NOT IN (SELECT steam_id FROM banned_steam_ids)  -- Don't duplicate
-- GROUP BY steam_id
-- HAVING COUNT(*) >= 10
-- ON CONFLICT (steam_id) DO NOTHING;  -- Skip if already banned
