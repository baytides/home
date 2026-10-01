/**
 * Live carbon and traffic stats for the sustainability and stats pages.
 * Replaces the daily GitHub Action that committed public/data/carbon-stats.json
 * and redeployed the site. Usage comes from the Cloudflare analytics API and
 * the GitHub Actions API, and the result is cached at the edge for an hour.
 */

interface Env {
  CLOUDFLARE_ANALYTICS_TOKEN?: string;
  CLOUDFLARE_ZONE_ID?: string;
  /** Read-only token. GitHub refuses most unauthenticated requests from Cloudflare's shared IPs. */
  GITHUB_STATS_TOKEN?: string;
}

const CACHE_SECONDS = 3600;
const GITHUB_RUNS_URL = 'https://api.github.com/repos/baytides/home/actions/runs?per_page=100';

// Carbon factors (grams CO2e). Unchanged from the former daily script.
const CARBON_FACTORS = {
  pageViewGrams: 0.2,
  ciMinuteGrams: 0.4,
  cdnRequestGrams: 0.0001,
};

const PROVIDER_STATS = {
  cloudflare: {
    name: 'Cloudflare',
    renewableEnergy: 100,
    netZeroSince: 2025,
    note: 'CDN, DDoS protection, edge hosting, and the form and donation workers',
  },
  github: {
    name: 'GitHub',
    carbonNeutralSince: 2019,
    renewableEnergy: 100,
    note: 'Code hosting and CI/CD',
  },
  salesforce: {
    name: 'Salesforce',
    netZeroSince: 2022,
    renewableEnergy: 100,
    note: 'Donor, volunteer, and program records (Nonprofit Success Pack)',
    source: 'https://www.salesforce.com/stakeholder-impact-report',
  },
};

type Freshness = 'live' | 'unavailable';

interface CloudflareUsage {
  requests: number;
  pageViews: number;
  bytes: number;
  cachedRequests: number;
  /** Daily unique visitors, summed over the period. */
  uniqueVisitors: number;
  countries: number;
}

interface CloudflareDay {
  sum?: {
    requests?: number;
    pageViews?: number;
    bytes?: number;
    cachedRequests?: number;
    countryMap?: Array<{ clientCountryName: string }>;
  };
  uniq?: { uniques?: number };
}

interface GitHubUsage {
  totalRuns: number;
  workflowBreakdown: Record<string, number>;
  estimatedMinutes: number;
}

function thirtyDaysAgo(): Date {
  return new Date(Date.now() - 30 * 86_400_000);
}

async function getCloudflareUsage(env: Env): Promise<CloudflareUsage | null> {
  if (!env.CLOUDFLARE_ANALYTICS_TOKEN || !env.CLOUDFLARE_ZONE_ID) return null;

  const since = thirtyDaysAgo().toISOString().slice(0, 10);
  const query = `{
    viewer {
      zones(filter: {zoneTag: "${env.CLOUDFLARE_ZONE_ID}"}) {
        httpRequests1dGroups(limit: 31, filter: {date_gt: "${since}"}) {
          sum { requests bytes cachedRequests pageViews countryMap { clientCountryName } }
          uniq { uniques }
        }
      }
    }
  }`;

  try {
    const response = await fetch('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.CLOUDFLARE_ANALYTICS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    });
    const data = (await response.json()) as {
      errors?: unknown;
      data?: { viewer?: { zones?: Array<{ httpRequests1dGroups?: CloudflareDay[] }> } };
    };
    if (!response.ok || data.errors) return null;

    const groups = data.data?.viewer?.zones?.[0]?.httpRequests1dGroups ?? [];
    const countries = new Set<string>();
    const totals = { requests: 0, pageViews: 0, bytes: 0, cachedRequests: 0, uniqueVisitors: 0 };
    for (const day of groups) {
      totals.requests += day.sum?.requests ?? 0;
      totals.pageViews += day.sum?.pageViews ?? 0;
      totals.bytes += day.sum?.bytes ?? 0;
      totals.cachedRequests += day.sum?.cachedRequests ?? 0;
      totals.uniqueVisitors += day.uniq?.uniques ?? 0;
      for (const c of day.sum?.countryMap ?? []) countries.add(c.clientCountryName);
    }
    return { ...totals, countries: countries.size };
  } catch {
    return null;
  }
}

async function getGitHubUsage(env: Env): Promise<GitHubUsage | null> {
  try {
    const response = await fetch(GITHUB_RUNS_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'baytides.org carbon stats',
        ...(env.GITHUB_STATS_TOKEN ? { Authorization: `Bearer ${env.GITHUB_STATS_TOKEN}` } : {}),
      },
    });
    if (!response.ok) return null;

    const data = (await response.json()) as {
      workflow_runs?: Array<{ name: string; created_at: string }>;
    };
    const since = thirtyDaysAgo();
    const runs = (data.workflow_runs ?? []).filter((run) => new Date(run.created_at) > since);

    const workflowBreakdown: Record<string, number> = {};
    for (const run of runs) workflowBreakdown[run.name] = (workflowBreakdown[run.name] ?? 0) + 1;

    // About two minutes per run on average.
    return { totalRuns: runs.length, workflowBreakdown, estimatedMinutes: runs.length * 2 };
  } catch {
    return null;
  }
}

function percentOf(part: number, total: number): string {
  return total > 0 ? ((part / total) * 100).toFixed(1) : '0';
}

async function buildStats(env: Env) {
  const [cloudflare, github] = await Promise.all([getCloudflareUsage(env), getGitHubUsage(env)]);

  const usage = {
    cdnRequests: cloudflare?.requests ?? null,
    pageViews: cloudflare?.pageViews ?? null,
    uniqueVisitors: cloudflare?.uniqueVisitors ?? null,
    countriesReached: cloudflare?.countries ?? null,
    cdnBytesTransferred: cloudflare?.bytes ?? null,
    cdnCacheHitRate:
      cloudflare && cloudflare.requests > 0
        ? ((cloudflare.cachedRequests / cloudflare.requests) * 100).toFixed(1)
        : null,
    ciRuns: github?.totalRuns ?? null,
    ciMinutes: github?.estimatedMinutes ?? null,
    ciWorkflows: github?.workflowBreakdown ?? null,
  };

  const dataFreshness: Record<string, Freshness> = {
    cloudflare: cloudflare ? 'live' : 'unavailable',
    github: github ? 'live' : 'unavailable',
  };

  const gross = {
    cdn: (usage.cdnRequests ?? 0) * CARBON_FACTORS.cdnRequestGrams,
    // Static hosting is efficient, so a page view counts a tenth of the average.
    hosting: (usage.pageViews ?? 0) * CARBON_FACTORS.pageViewGrams * 0.1,
    ci: (usage.ciMinutes ?? 0) * CARBON_FACTORS.ciMinuteGrams,
  };
  const totalGrams = gross.cdn + gross.hosting + gross.ci;
  const renewablePercent = 100;

  return {
    generatedAt: new Date().toISOString(),
    period: 'last30days',
    dataFreshness,
    summary: {
      totalGrossEmissionsKg: (totalGrams / 1000).toFixed(3),
      renewableEnergyPercent: renewablePercent,
      netEmissionsKg: (totalGrams * (1 - renewablePercent / 100)).toFixed(3),
      greenRating: 'A+',
      carbonNeutral: true,
    },
    usage,
    emissionsBySource: {
      cdn: {
        grams: gross.cdn.toFixed(1),
        percent: percentOf(gross.cdn, totalGrams),
        provider: 'Cloudflare',
        renewablePercent,
      },
      hosting: {
        grams: gross.hosting.toFixed(1),
        percent: percentOf(gross.hosting, totalGrams),
        provider: 'Cloudflare Pages',
        renewablePercent,
      },
      ci: {
        grams: gross.ci.toFixed(1),
        percent: percentOf(gross.ci, totalGrams),
        provider: 'GitHub Actions',
        renewablePercent,
      },
    },
    comparison: {
      equivalentMilesDriven: (totalGrams / 400).toFixed(2),
      equivalentPaperPages: Math.round(totalGrams / 10),
    },
    providers: PROVIDER_STATS,
    carbonFactors: CARBON_FACTORS,
    methodology: {
      notes: [
        'All infrastructure providers use 100% renewable energy',
        'Cloudflare achieved net-zero emissions in 2025',
        'GitHub Actions runners are powered by renewable energy',
        'Usage data is fetched live and cached for up to one hour',
      ],
    },
  };
}

export const onRequestGet = async (context: {
  request: Request;
  env: Env;
  waitUntil: (promise: Promise<unknown>) => void;
}): Promise<Response> => {
  const cache = (caches as unknown as { default: Cache }).default;
  const cacheKey = new Request(new URL('/api/carbon-stats', context.request.url).toString());

  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const stats = await buildStats(context.env);
  const anyLive = Object.values(stats.dataFreshness).some((v) => v === 'live');
  const response = new Response(JSON.stringify(stats), {
    headers: {
      'Content-Type': 'application/json',
      // Cache a full result for an hour. When every source failed, retry soon.
      'Cache-Control': `public, max-age=${anyLive ? CACHE_SECONDS : 60}`,
    },
  });

  context.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
};
