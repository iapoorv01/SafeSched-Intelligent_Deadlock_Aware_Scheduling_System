import * as simulationRoute from '../app/api/simulation/route';
import * as analyticsRoute from '../app/api/analytics/route';
import * as scenarioRoute from '../app/api/scenario/route';
import * as graphRoute from '../app/api/graph/route';
import * as predictRoute from '../app/api/predict/route';
import * as logsRoute from '../app/api/logs/route';
import * as requestsRoute from '../app/api/requests/route';
import * as recoveryRoute from '../app/api/recovery/route';
import * as replayRoute from '../app/api/replay/route';

type Method = 'GET' | 'POST' | 'DELETE';

type LocalResponse<T> = {
  ok: boolean;
  status: number;
  json: () => Promise<T>;
};

function createResponse<T>(status: number, payload: T): LocalResponse<T> {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

/** Parse path + query string into { basePath, params } */
function parsePath(path: string): { basePath: string; params: Record<string, string> } {
  const [basePath, qs] = path.split('?');
  const params: Record<string, string> = {};
  if (qs) {
    for (const part of qs.split('&')) {
      const [k, v] = part.split('=');
      if (k) params[decodeURIComponent(k)] = decodeURIComponent(v ?? '');
    }
  }
  return { basePath, params };
}

export async function localApiFetch<T = any>(
  path: string,
  options?: { method?: Method; body?: string }
): Promise<LocalResponse<T>> {
  const method = options?.method ?? 'GET';
  const parsedBody = options?.body ? JSON.parse(options.body) : undefined;
  const { basePath, params } = parsePath(path);

  try {
    // ── Simulation ──
    if (basePath === '/api/simulation' && method === 'GET') {
      return createResponse(200, await simulationRoute.GET() as T);
    }
    if (basePath === '/api/simulation' && method === 'POST') {
      return createResponse(200, await simulationRoute.POST(parsedBody) as T);
    }

    // ── Analytics ──
    if (basePath === '/api/analytics' && method === 'GET') {
      return createResponse(200, await analyticsRoute.GET() as T);
    }

    // ── Scenario (full CRUD + presets + import/export) ──
    if (basePath === '/api/scenario' && method === 'GET') {
      return createResponse(200, await scenarioRoute.GET() as T);
    }
    if (basePath === '/api/scenario' && method === 'POST') {
      return createResponse(200, await scenarioRoute.POST(parsedBody) as T);
    }
    if (basePath === '/api/scenario' && method === 'DELETE') {
      return createResponse(200, await scenarioRoute.DELETE() as T);
    }

    // ── Graph (supports ?type=rag|wfg) ──
    if (basePath === '/api/graph' && method === 'GET') {
      return createResponse(200, await graphRoute.GET(params as any) as T);
    }

    // ── Logs ──
    if (basePath === '/api/logs' && method === 'GET') {
      return createResponse(200, await logsRoute.GET(params as any) as T);
    }

    // ── Requests ──
    if (basePath === '/api/requests' && method === 'GET') {
      return createResponse(200, await requestsRoute.GET() as T);
    }
    if (basePath === '/api/requests' && method === 'POST') {
      return createResponse(200, await requestsRoute.POST(parsedBody) as T);
    }
    if (basePath === '/api/requests' && method === 'DELETE') {
      return createResponse(200, await requestsRoute.DELETE() as T);
    }

    // ── Recovery ──
    if (basePath === '/api/recovery' && method === 'GET') {
      return createResponse(200, await recoveryRoute.GET() as T);
    }
    if (basePath === '/api/recovery' && method === 'POST') {
      return createResponse(200, await recoveryRoute.POST(parsedBody) as T);
    }

    // ── Replay ──
    if (basePath === '/api/replay' && method === 'GET') {
      return createResponse(200, await replayRoute.GET() as T);
    }
    if (basePath === '/api/replay' && method === 'POST') {
      return createResponse(200, await replayRoute.POST(parsedBody) as T);
    }

    // ── Predict ──
    if ((basePath === '/predict' || basePath === '/api/predict') && method === 'POST') {
      return createResponse(200, await predictRoute.POST(parsedBody) as T);
    }

    return createResponse(404, { error: `Route not found: ${method} ${path}` } as T);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return createResponse(500, { error: msg } as T);
  }
}
