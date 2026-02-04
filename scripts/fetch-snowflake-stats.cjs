/**
 * Fetch Snowflake Proxy Stats from Azure VM
 * Runs hourly via GitHub Actions to update public/data/snowflake-stats.json
 *
 * The Tor Snowflake proxy on the Azure VM maintains a stats file that tracks:
 * - Total connections served
 * - Recent connection counts (24h, 7d)
 * - Uptime information
 *
 * Note: This script uses execSync for Azure CLI commands which require shell execution.
 * All inputs are hardcoded environment variables or resource IDs, not user-provided.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

async function getSnowflakeStats() {
  // Check if Azure CLI is available and logged in
  try {
    execSync('az account show', { stdio: 'pipe' });
  } catch {
    console.log('Azure CLI not available or not logged in');
    return null;
  }

  const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID;
  const resourceGroup = process.env.AZURE_RESOURCE_GROUP || 'baytides-rg';
  const vmName = process.env.AZURE_VM_NAME || 'carl-ai-vm';

  if (!subscriptionId) {
    console.log('Azure subscription ID not configured');
    return null;
  }

  try {
    // Use Azure Run Command to get Snowflake metrics from the VM
    // The script on the VM collects stats from the Snowflake proxy logs
    console.log('Fetching Snowflake stats from Azure VM...');

    const runCmdResult = execSync(
      `az vm run-command invoke --resource-group "${resourceGroup}" --name "${vmName}" --command-id RunShellScript --scripts "cat /var/log/snowflake-stats.json 2>/dev/null || echo '{\\"totalConnections\\":0,\\"last24Hours\\":0,\\"last7Days\\":0,\\"uptimeHours\\":0}'" -o json`,
      { stdio: 'pipe', timeout: 120000 }
    ).toString();

    const cmdOutput = JSON.parse(runCmdResult);
    const stdoutMessage = cmdOutput?.value?.[0]?.message || '';

    // Extract JSON from the output (it's in [stdout] section)
    const stdoutMatch = stdoutMessage.match(/\[stdout\]\n([\s\S]*?)(?:\[stderr\]|$)/);
    if (stdoutMatch && stdoutMatch[1]) {
      const statsJson = stdoutMatch[1].trim();
      if (statsJson) {
        return JSON.parse(statsJson);
      }
    }

    console.log('No stats data returned from VM');
    return null;
  } catch (error) {
    console.error('Failed to fetch Snowflake stats:', error.message);
    return null;
  }
}

async function main() {
  console.log('Fetching Snowflake proxy stats...');

  // Load existing stats to preserve historical data
  const outputPath = path.join(__dirname, '..', 'public', 'data', 'snowflake-stats.json');
  let existingStats = {
    totalUsersHelped: 0,
    lastUpdated: null,
    history: [],
  };

  try {
    if (fs.existsSync(outputPath)) {
      existingStats = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
    }
  } catch {
    console.log('No existing stats file or invalid JSON, starting fresh');
  }

  const vmStats = await getSnowflakeStats();

  // Update stats with new data from VM
  const now = new Date().toISOString();
  const stats = {
    // Current totals from the VM
    totalUsersHelped: vmStats?.totalConnections ?? existingStats.totalUsersHelped ?? 0,
    last24Hours: vmStats?.last24Hours ?? 0,
    last7Days: vmStats?.last7Days ?? 0,
    uptimeHours: vmStats?.uptimeHours ?? 0,

    // Metadata
    lastUpdated: now,
    vmStatus: vmStats ? 'online' : 'offline',
    source: 'azure_vm',

    // Keep last 168 hours (7 days) of hourly snapshots for trending
    history: [
      {
        timestamp: now,
        connections: vmStats?.last24Hours ?? 0,
        total: vmStats?.totalConnections ?? existingStats.totalUsersHelped ?? 0,
      },
      ...(existingStats.history || []).slice(0, 167), // Keep last 167 + new = 168 entries
    ],

    // Human-readable summary
    summary: {
      message: vmStats
        ? `Our Tor Snowflake proxy has helped ${(vmStats.totalConnections || 0).toLocaleString()} people access the free internet.`
        : 'Snowflake proxy stats temporarily unavailable.',
      lastHelpedRecently: (vmStats?.last24Hours || 0) > 0,
    },
  };

  // Ensure output directory exists
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Write stats file
  fs.writeFileSync(outputPath, JSON.stringify(stats, null, 2));

  console.log('Snowflake stats updated successfully!');
  console.log(`- Total users helped: ${stats.totalUsersHelped.toLocaleString()}`);
  console.log(`- Last 24 hours: ${stats.last24Hours}`);
  console.log(`- VM status: ${stats.vmStatus}`);
}

main().catch(console.error);
