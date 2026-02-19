/**
 * Fetch Carbon Stats Script for Bay Tides Website
 * Runs daily via GitHub Actions to update public/data/carbon-stats.json
 *
 * Data Sources:
 * - Cloudflare: CDN requests and bandwidth
 * - GitHub: CI/CD workflow runs
 * - Snowflake Stats Worker: Tor Snowflake proxy stats (served from Cloudflare KV)
 */

const fs = require('fs');
const path = require('path');

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
  local: {
    name: 'Self-Hosted Mac Mini',
    renewableEnergy: 100,
    note: 'Local hosting for Tor Snowflake proxy',
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

async function getSnowflakeStats() {
  const statsUrl = process.env.SNOWFLAKE_STATS_URL || 'https://snowflake-stats.baytides.org/stats';

  try {
    const response = await fetch(statsUrl);
    if (!response.ok) {
      console.log(`Snowflake stats API returned ${response.status}`);
      return null;
    }

    const data = await response.json();
    return {
      proxyRunning: data.vmStatus === 'online',
      snowflake: {
        totalConnections: data.totalUsersHelped || 0,
        last24Hours: data.last24Hours || 0,
        last7Days: data.last7Days || 0,
        uptimeHours: data.uptimeHours || 0,
        lastUpdated: data.lastUpdated,
      },
      source: 'cloudflare_kv',
    };
  } catch (error) {
    console.error('Snowflake stats fetch error:', error.message);
    return null;
  }
}

async function main() {
  console.log('Fetching carbon stats for Bay Tides website...');

  const [cloudflareStats, githubStats, snowflakeApiStats] = await Promise.all([
    getCloudflareStats(),
    getGitHubStats(),
    getSnowflakeStats(),
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
    snowflake: snowflakeApiStats ? 'live' : 'unavailable',
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

  // Snowflake proxy stats from Cloudflare KV Worker
  const snowflakeData = snowflakeApiStats?.snowflake || null;

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

    // Tor Snowflake proxy statistics
    snowflake: snowflakeData
      ? {
          totalUsersHelped: snowflakeData.totalConnections || 0,
          last24Hours: snowflakeData.last24Hours || 0,
          last7Days: snowflakeData.last7Days || 0,
          uptime: snowflakeData.uptimeHours || 0,
          lastUpdated: snowflakeData.lastUpdated || new Date().toISOString(),
        }
      : null,

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
        'Snowflake proxy runs on a self-hosted Mac Mini powered by local energy',
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
    `- Snowflake: ${dataSources.snowflake} (proxy ${snowflakeApiStats?.proxyRunning ? 'running' : 'not available'})`
  );
  console.log(`- Total gross emissions: ${stats.summary.totalGrossEmissionsKg} kg CO₂e`);
}

main().catch(console.error);
