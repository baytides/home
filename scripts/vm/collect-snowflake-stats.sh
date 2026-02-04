#!/bin/bash
# Snowflake Stats Collector for Azure VM
# This script should be run via cron on the Azure VM to collect Snowflake proxy stats
# Add to crontab: */5 * * * * /opt/snowflake/collect-snowflake-stats.sh
#
# The Snowflake proxy logs connection info that we parse to track:
# - Total connections served since proxy started
# - Connections in last 24 hours
# - Connections in last 7 days
# - Uptime hours

STATS_FILE="/var/log/snowflake-stats.json"
HISTORY_FILE="/var/log/snowflake-history.log"
SNOWFLAKE_LOG="/var/log/snowflake-proxy.log"

# Get current timestamp
NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
UPTIME_SECONDS=$(cat /proc/uptime | cut -d' ' -f1 | cut -d'.' -f1)
UPTIME_HOURS=$((UPTIME_SECONDS / 3600))

# Count connections from Snowflake proxy log
# Snowflake proxy logs "completed transfer" for each successful connection
if [ -f "$SNOWFLAKE_LOG" ]; then
    # Total connections (all time from current log)
    TOTAL=$(grep -c "completed transfer" "$SNOWFLAKE_LOG" 2>/dev/null || echo "0")

    # Connections in last 24 hours
    YESTERDAY=$(date -u -d "24 hours ago" +"%Y-%m-%d %H:%M")
    LAST_24H=$(awk -v since="$YESTERDAY" '$0 >= since && /completed transfer/' "$SNOWFLAKE_LOG" 2>/dev/null | wc -l || echo "0")

    # Connections in last 7 days
    WEEK_AGO=$(date -u -d "7 days ago" +"%Y-%m-%d %H:%M")
    LAST_7D=$(awk -v since="$WEEK_AGO" '$0 >= since && /completed transfer/' "$SNOWFLAKE_LOG" 2>/dev/null | wc -l || echo "0")
else
    # No log file yet - check if running systemd service
    if systemctl is-active --quiet snowflake-proxy 2>/dev/null; then
        # Try journalctl for systemd-managed services
        TOTAL=$(journalctl -u snowflake-proxy --no-pager 2>/dev/null | grep -c "completed transfer" || echo "0")
        LAST_24H=$(journalctl -u snowflake-proxy --since "24 hours ago" --no-pager 2>/dev/null | grep -c "completed transfer" || echo "0")
        LAST_7D=$(journalctl -u snowflake-proxy --since "7 days ago" --no-pager 2>/dev/null | grep -c "completed transfer" || echo "0")
    else
        TOTAL=0
        LAST_24H=0
        LAST_7D=0
    fi
fi

# Load historical total if we have one (to accumulate across log rotations)
HISTORICAL_TOTAL=0
if [ -f "$STATS_FILE" ]; then
    HISTORICAL_TOTAL=$(jq -r '.historicalTotal // 0' "$STATS_FILE" 2>/dev/null || echo "0")
fi

# The actual total is historical + current log
ACCUMULATED_TOTAL=$((HISTORICAL_TOTAL + TOTAL))

# Append to history log for trend tracking
echo "$NOW,$TOTAL,$LAST_24H" >> "$HISTORY_FILE"

# Keep history file from growing too large (last 30 days of 5-min intervals = ~8640 lines)
if [ -f "$HISTORY_FILE" ]; then
    tail -n 8640 "$HISTORY_FILE" > "${HISTORY_FILE}.tmp" && mv "${HISTORY_FILE}.tmp" "$HISTORY_FILE"
fi

# Write JSON stats file
cat > "$STATS_FILE" << EOF
{
  "totalConnections": $ACCUMULATED_TOTAL,
  "currentLogConnections": $TOTAL,
  "historicalTotal": $HISTORICAL_TOTAL,
  "last24Hours": $LAST_24H,
  "last7Days": $LAST_7D,
  "uptimeHours": $UPTIME_HOURS,
  "lastUpdated": "$NOW",
  "proxyStatus": "$(systemctl is-active snowflake-proxy 2>/dev/null || echo 'unknown')"
}
EOF

echo "Stats updated: $ACCUMULATED_TOTAL total connections, $LAST_24H in last 24h"
