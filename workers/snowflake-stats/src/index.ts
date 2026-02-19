/**
 * Snowflake Stats Worker
 * Serves Tor Snowflake proxy statistics from Cloudflare KV.
 *
 * GET  /stats - Public endpoint returning current stats (CORS-enabled)
 * PUT  /stats - Authenticated endpoint for pushing stats updates from local collector
 */

interface Env {
  SNOWFLAKE_STATS_KV: KVNamespace;
  ALLOWED_ORIGIN: string;
  STATS_API_KEY: string;
}

const KV_KEY = 'snowflake-stats';
const CORS_HEADERS = {
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

function corsHeaders(origin: string, env: Env): Record<string, string> {
  const allowed = env.ALLOWED_ORIGIN || 'https://baytides.org';
  // Allow the configured origin and localhost for development
  const allowOrigin =
    origin === allowed || origin?.startsWith('http://localhost') ? origin : allowed;

  return {
    ...CORS_HEADERS,
    'Access-Control-Allow-Origin': allowOrigin,
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const headers = corsHeaders(origin, env);

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }

    if (url.pathname === '/stats' || url.pathname === '/') {
      if (request.method === 'GET') {
        return handleGetStats(env, headers);
      }

      if (request.method === 'PUT') {
        return handlePutStats(request, env, headers);
      }
    }

    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { ...headers, 'Content-Type': 'application/json' },
    });
  },
};

async function handleGetStats(env: Env, headers: Record<string, string>): Promise<Response> {
  const stats = await env.SNOWFLAKE_STATS_KV.get(KV_KEY);

  if (!stats) {
    return new Response(
      JSON.stringify({
        totalUsersHelped: 0,
        last24Hours: 0,
        last7Days: 0,
        uptimeHours: 0,
        vmStatus: 'starting',
        source: 'local',
        lastUpdated: null,
      }),
      {
        status: 200,
        headers: {
          ...headers,
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=300',
        },
      }
    );
  }

  return new Response(stats, {
    status: 200,
    headers: {
      ...headers,
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=300',
    },
  });
}

async function handlePutStats(
  request: Request,
  env: Env,
  headers: Record<string, string>
): Promise<Response> {
  // Authenticate with API key
  const authHeader = request.headers.get('Authorization');
  const apiKey = authHeader?.replace('Bearer ', '');

  if (!apiKey || apiKey !== env.STATS_API_KEY) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...headers, 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await request.text();
    // Validate it's valid JSON
    JSON.parse(body);

    await env.SNOWFLAKE_STATS_KV.put(KV_KEY, body);

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...headers, 'Content-Type': 'application/json' },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { ...headers, 'Content-Type': 'application/json' },
    });
  }
}
