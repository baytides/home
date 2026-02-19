#!/usr/bin/env node
/**
 * Snowflake Stats Collector
 * Reads local Snowflake proxy log and pushes stats to Cloudflare KV via Worker API.
 * Runs every 5 minutes via launchd on the local Mac.
 *
 * Data flow:
 *   snowflake-proxy (local) -> proxy log -> this script -> Cloudflare KV -> Worker -> site
 *
 * Environment variables:
 *   SNOWFLAKE_STATS_API_URL  - Worker URL (default: https://snowflake-stats.baytides.org)
 *   SNOWFLAKE_STATS_API_KEY  - API key for authenticating with the Worker
 *   SNOWFLAKE_LOG_PATH       - Path to proxy log (default: ~/logs/snowflake-proxy.log)
 *   SNOWFLAKE_STATS_FILE     - Path to local stats persistence file (default: ~/snowflake-stats.json)
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const API_URL = process.env.SNOWFLAKE_STATS_API_URL || 'https://snowflake-stats.baytides.org';
const API_KEY = process.env.SNOWFLAKE_STATS_API_KEY;
const LOG_PATH =
  process.env.SNOWFLAKE_LOG_PATH || path.join(process.env.HOME, 'logs', 'snowflake-proxy.log');
const STATS_FILE =
  process.env.SNOWFLAKE_STATS_FILE || path.join(process.env.HOME, 'snowflake-stats.json');

function loadLocalStats() {
  try {
    if (fs.existsSync(STATS_FILE)) {
      return JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
    }
  } catch {
    console.warn('Local stats file corrupted, starting fresh');
  }

  return {
    totalConnections: 0,
    historicalTotal: 0,
    history: [],
    startedAt: new Date().toISOString(),
  };
}

function saveLocalStats(stats) {
  fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
}

function parseProxyLog() {
  if (!fs.existsSync(LOG_PATH)) {
    console.log(`Log file not found: ${LOG_PATH}`);
    return { totalFromLog: 0, last24h: 0, last7d: 0, proxyRunning: false };
  }

  const log = fs.readFileSync(LOG_PATH, 'utf8');
  const lines = log.split('\n');

  const now = new Date();
  const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);

  let totalFromLog = 0;
  let last24h = 0;
  let last7d = 0;

  // Snowflake proxy logs "completed transfer" for each successful relay
  // Log format: 2026/02/19 05:44:56 completed transfer ...
  for (const line of lines) {
    if (!line.includes('completed transfer')) continue;
    totalFromLog++;

    // Parse timestamp from log line
    const tsMatch = line.match(/^(\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2})/);
    if (tsMatch) {
      const ts = new Date(tsMatch[1].replace(/\//g, '-'));
      if (ts >= oneDayAgo) last24h++;
      if (ts >= sevenDaysAgo) last7d++;
    }
  }

  // Check if proxy process is running (using execFileSync to avoid shell injection)
  let proxyRunning = false;
  try {
    const result = execFileSync('pgrep', ['-f', 'snowflake-proxy'], {
      stdio: 'pipe',
    })
      .toString()
      .trim();
    proxyRunning = result.length > 0;
  } catch {
    proxyRunning = false;
  }

  return { totalFromLog, last24h, last7d, proxyRunning };
}

function calculateUptime() {
  try {
    const result = execFileSync('sysctl', ['-n', 'kern.boottime'], {
      stdio: 'pipe',
    }).toString();
    // Output: { sec = 1739934296, usec = 0 } ...
    const secMatch = result.match(/sec\s*=\s*(\d+)/);
    if (secMatch) {
      const bootTime = parseInt(secMatch[1], 10);
      return Math.floor((Date.now() / 1000 - bootTime) / 3600);
    }
  } catch {
    // fallback
  }
  return 0;
}

async function pushToKV(stats) {
  if (!API_KEY) {
    console.log('No API key configured, skipping KV push');
    console.log('Set SNOWFLAKE_STATS_API_KEY to enable pushing to Cloudflare KV');
    return false;
  }

  try {
    const response = await fetch(`${API_URL}/stats`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(stats),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`KV push failed (${response.status}): ${text}`);
      return false;
    }

    console.log('Stats pushed to Cloudflare KV');
    return true;
  } catch (error) {
    console.error('KV push error:', error.message);
    return false;
  }
}

async function main() {
  console.log(`[${new Date().toISOString()}] Collecting Snowflake stats...`);

  const localStats = loadLocalStats();
  const logData = parseProxyLog();
  const uptimeHours = calculateUptime();

  // Accumulate total across log rotations
  const accumulatedTotal = (localStats.historicalTotal || 0) + logData.totalFromLog;

  const now = new Date().toISOString();

  // Build stats object matching the format the site expects
  const stats = {
    totalUsersHelped: accumulatedTotal,
    last24Hours: logData.last24h,
    last7Days: logData.last7d,
    uptimeHours,
    lastUpdated: now,
    vmStatus: logData.proxyRunning ? 'online' : 'offline',
    source: 'local',

    // Keep last 168 hours (7 days) of hourly snapshots
    history: [
      {
        timestamp: now,
        connections: logData.last24h,
        total: accumulatedTotal,
      },
      ...(localStats.history || []).slice(0, 167),
    ],

    summary: {
      message: logData.proxyRunning
        ? `Our Tor Snowflake proxy has helped ${accumulatedTotal.toLocaleString()} people access the free internet.`
        : 'Snowflake proxy stats temporarily unavailable.',
      lastHelpedRecently: logData.last24h > 0,
    },
  };

  // Save locally for persistence across log rotations
  saveLocalStats({
    totalConnections: accumulatedTotal,
    historicalTotal: localStats.historicalTotal || 0,
    currentLogConnections: logData.totalFromLog,
    history: stats.history,
    startedAt: localStats.startedAt,
  });

  // Push to Cloudflare KV
  await pushToKV(stats);

  console.log(`- Proxy: ${stats.vmStatus}`);
  console.log(`- Total helped: ${stats.totalUsersHelped}`);
  console.log(`- Last 24h: ${stats.last24Hours}`);
  console.log(`- Uptime: ${stats.uptimeHours}h`);
}

main().catch(console.error);
