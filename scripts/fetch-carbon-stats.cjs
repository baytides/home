/**
 * Fetch Carbon Stats Script for Bay Tides Website
 * Runs daily via GitHub Actions to update public/data/carbon-stats.json
 *
 * Data Sources:
 * - Cloudflare: CDN requests and bandwidth
 * - GitHub: CI/CD workflow runs
 * - Azure: VM metrics (optional, for Snowflake proxy stats)
 *
 * Note: This script uses execSync for Azure CLI commands which require shell execution.
 * All inputs are hardcoded environment variables or resource IDs, not user-provided.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Carbon factors (grams CO2e)
const CARBON_FACTORS = {
  pageViewGrams: 0.2,
  ciMinuteGrams: 0.4,
  cdnRequestGrams: 0.0001,
};

// Provider sustainability stats
const PROVIDER_STATS = {
  cloudflare: {
    name: 'Cloudflare',
    renewableEnergy: 100,
    netZeroSince: 2025,
    note: 'CDN, DDoS protection, and edge hosting',
  },
  github: {
    name: 'GitHub',
    carbonNeutralSince: 2019,
    renewableEnergy: 100,
    note: 'Code hosting and CI/CD',
  },
  azure: {
    name: 'Microsoft Azure',
    carbonNeutralSince: 2012,
    renewableEnergy: 100,
    renewableEnergySince: 2025,
    carbonNegativeTarget: 2030,
    note: 'VM hosting for Tor Snowflake proxy',
  },
};

async function getCloudflareStats() {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const zoneId = process.env.CLOUDFLARE_ZONE_ID;

  if (!token || !zoneId) {
    console.log('Cloudflare credentials not configured');
    return null;
  }

  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const dateFilter = thirtyDaysAgo.toISOString().split('T')[0];

    const query = `{
      viewer {
        zones(filter: {zoneTag: "${zoneId}"}) {
          httpRequests1dGroups(limit: 30, filter: {date_gt: "${dateFilter}"}) {
            sum {
              requests
              bytes
              cachedRequests
              cachedBytes
              pageViews
            }
            dimensions {
              date
            }
          }
        }
      }
    }`;

    const response = await fetch('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    });

    const data = await response.json();

    if (data.errors) {
      console.error('Cloudflare API error:', data.errors);
      return null;
    }

    const groups = data.data?.viewer?.zones?.[0]?.httpRequests1dGroups || [];

    const totals = groups.reduce(
      (acc, day) => ({
        requests: acc.requests + (day.sum?.requests || 0),
        bytes: acc.bytes + (day.sum?.bytes || 0),
        cachedRequests: acc.cachedRequests + (day.sum?.cachedRequests || 0),
        pageViews: acc.pageViews + (day.sum?.pageViews || 0),
      }),
      { requests: 0, bytes: 0, cachedRequests: 0, pageViews: 0 }
    );

    return {
      requests: totals.requests,
      pageViews: totals.pageViews,
      bytesTransferred: totals.bytes,
      cachedRequests: totals.cachedRequests,
      cacheHitRate:
        totals.requests > 0 ? ((totals.cachedRequests / totals.requests) * 100).toFixed(1) : '0',
      daysIncluded: groups.length,
      source: 'cloudflare_api',
    };
  } catch (error) {
    console.error('Cloudflare fetch error:', error.message);
    return null;
  }
}

async function getGitHubStats() {
  try {
    const response = await fetch(
      'https://api.github.com/repos/baytides/home/actions/runs?per_page=100',
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        },
      }
    );

    if (!response.ok) {
      console.log('GitHub API error:', response.status);
      return null;
    }

    const data = await response.json();
    const runs = data.workflow_runs || [];

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recentRuns = runs.filter((run) => new Date(run.created_at) > thirtyDaysAgo);

    const workflowCounts = {};
    recentRuns.forEach((run) => {
      workflowCounts[run.name] = (workflowCounts[run.name] || 0) + 1;
    });

    // Estimate 2 minutes per run on average
    const estimatedMinutes = recentRuns.length * 2;

    return {
      totalRuns: recentRuns.length,
      workflowBreakdown: workflowCounts,
      estimatedMinutes,
      successfulRuns: recentRuns.filter((r) => r.conclusion === 'success').length,
      source: 'github_api',
    };
  } catch (error) {
    console.error('GitHub fetch error:', error.message);
    return null;
  }
}

async function getAzureStats() {
  // Check if Azure CLI is available and logged in
  // Note: execSync is used here because Azure CLI requires shell execution.
  // All inputs are from environment variables, not user-provided data.
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

  // Calculate date range (last 30 days)
  const endTime = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 30);
  const startTime = startDate.toISOString().split('T')[0] + 'T00:00:00Z';

  try {
    // Get VM CPU percentage (to confirm VM is running)
    const vmResourceId = `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Compute/virtualMachines/${vmName}`;
    const vmCmd = `az monitor metrics list --resource "${vmResourceId}" --metric "Percentage CPU" --interval P1D --aggregation Average --start-time ${startTime} --end-time ${endTime} -o json`;

    let vmRunning = false;
    let avgCpuPercent = 0;
    try {
      const vmResult = JSON.parse(execSync(vmCmd, { stdio: 'pipe' }).toString());
      const timeseries = vmResult?.value?.[0]?.timeseries?.[0]?.data || [];
      const validData = timeseries.filter((d) => d.average !== null && d.average !== undefined);
      vmRunning = validData.length > 0;
      avgCpuPercent =
        validData.length > 0
          ? (validData.reduce((sum, d) => sum + d.average, 0) / validData.length).toFixed(1)
          : 0;
    } catch (err) {
      console.error('Failed to fetch VM metrics:', err.message);
    }

    return {
      vmRunning,
      avgCpuPercent: parseFloat(avgCpuPercent),
      source: 'azure_monitor',
    };
  } catch (error) {
    console.error('Azure fetch error:', error.message);
    return null;
  }
}

async function main() {
  console.log('Fetching carbon stats for Bay Tides website...');

  const [cloudflareStats, githubStats, azureStats] = await Promise.all([
    getCloudflareStats(),
    getGitHubStats(),
    getAzureStats(),
  ]);

  // Use real data where available, fall back to null
  const usage = {
    cdnRequests: cloudflareStats?.requests ?? null,
    pageViews: cloudflareStats?.pageViews ?? null,
    cdnBytesTransferred: cloudflareStats?.bytesTransferred ?? null,
    cdnCacheHitRate: cloudflareStats?.cacheHitRate ?? null,
    ciRuns: githubStats?.totalRuns ?? null,
    ciMinutes: githubStats?.estimatedMinutes ?? null,
    ciWorkflows: githubStats?.workflowBreakdown ?? null,
  };

  const dataSources = {
    cloudflare: cloudflareStats ? 'live' : 'unavailable',
    github: githubStats ? 'live' : 'unavailable',
    azure: azureStats ? 'live' : 'unavailable',
  };

  // Calculate emissions (use 0 if data unavailable)
  const grossEmissions = {
    cdn: (usage.cdnRequests || 0) * CARBON_FACTORS.cdnRequestGrams,
    hosting: (usage.pageViews || 0) * CARBON_FACTORS.pageViewGrams * 0.1, // Static hosting is efficient
    ci: (usage.ciMinutes || 0) * CARBON_FACTORS.ciMinuteGrams,
  };

  const totalGrossGrams = Object.values(grossEmissions).reduce((a, b) => a + b, 0);
  const renewableOffset = 100; // All providers use 100% renewable
  const netEmissionsGrams = totalGrossGrams * (1 - renewableOffset / 100);

  // Calculate equivalents
  const equivalentMilesDriven = (totalGrossGrams / 400).toFixed(2);
  const equivalentPaperPages = Math.round(totalGrossGrams / 10);

  const stats = {
    generatedAt: new Date().toISOString(),
    period: 'last30days',
    dataFreshness: dataSources,

    summary: {
      totalGrossEmissionsKg: (totalGrossGrams / 1000).toFixed(3),
      renewableEnergyPercent: renewableOffset,
      netEmissionsKg: netEmissionsGrams.toFixed(3),
      greenRating: 'A+',
      carbonNeutral: true,
    },

    usage,

    emissionsBySource: {
      cdn: {
        grams: grossEmissions.cdn.toFixed(1),
        percent:
          totalGrossGrams > 0 ? ((grossEmissions.cdn / totalGrossGrams) * 100).toFixed(1) : '0',
        provider: 'Cloudflare',
        renewablePercent: 100,
      },
      hosting: {
        grams: grossEmissions.hosting.toFixed(1),
        percent:
          totalGrossGrams > 0 ? ((grossEmissions.hosting / totalGrossGrams) * 100).toFixed(1) : '0',
        provider: 'Cloudflare Pages',
        renewablePercent: 100,
      },
      ci: {
        grams: grossEmissions.ci.toFixed(1),
        percent:
          totalGrossGrams > 0 ? ((grossEmissions.ci / totalGrossGrams) * 100).toFixed(1) : '0',
        provider: 'GitHub Actions',
        renewablePercent: 100,
      },
    },

    comparison: {
      equivalentMilesDriven,
      equivalentPaperPages,
      cleanerThanPercent: 85,
    },

    providers: PROVIDER_STATS,
    carbonFactors: CARBON_FACTORS,

    methodology: {
      cdnEmissionsPerRequest: CARBON_FACTORS.cdnRequestGrams,
      ciEmissionsPerMinute: CARBON_FACTORS.ciMinuteGrams,
      renewableOffset: 1.0,
      notes: [
        'All infrastructure providers use 100% renewable energy',
        'Cloudflare achieved net-zero emissions in 2025',
        'GitHub Actions runners are powered by renewable energy',
        'Azure has been carbon neutral since 2012',
        'Usage data is updated daily via GitHub Actions',
      ],
    },
  };

  // Ensure output directory exists
  const outputDir = path.join(__dirname, '..', 'public', 'data');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Write stats file
  const outputPath = path.join(outputDir, 'carbon-stats.json');
  fs.writeFileSync(outputPath, JSON.stringify(stats, null, 2));

  console.log('Carbon stats updated successfully!');
  console.log(
    `- Cloudflare: ${dataSources.cloudflare} (${usage.cdnRequests ?? 'N/A'} requests, ${usage.pageViews ?? 'N/A'} page views)`
  );
  console.log(`- GitHub: ${dataSources.github} (${usage.ciRuns ?? 'N/A'} CI runs)`);
  console.log(
    `- Azure: ${dataSources.azure} (VM ${azureStats?.vmRunning ? 'running' : 'not available'})`
  );
  console.log(`- Total gross emissions: ${stats.summary.totalGrossEmissionsKg} kg CO₂e`);
}

main().catch(console.error);
