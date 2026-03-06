import { getSetting } from './app-db';

// Map client profile names to OpenRouteService profile names
const ORS_PROFILES: Record<string, string> = {
  driving: 'driving-car',
  walking: 'foot-walking',
  hiking: 'foot-hiking',
  cycling: 'cycling-regular'
};

function getApiKey(): string | null {
  return (
    process.env.PUBLIC_ORS_API_KEY ??
    process.env.ORS_API_KEY ??
    getSetting('ors_api_key')
  );
}

async function fetchRoute(
  apiKey: string,
  coordinates: Array<[number, number]>,
  orsProfile: string
): Promise<Response> {
  const url = `https://api.openrouteservice.org/v2/directions/${orsProfile}/geojson`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': apiKey },
    body: JSON.stringify({ coordinates })
  });
  if (!resp.ok) {
    const text = await resp.text();
    console.error(`[route] ORS ${resp.status}: ${text}`);
    return new Response(`Routing error: ${resp.status}`, {
      status: resp.status
    });
  }
  const data = (await resp.json()) as {
    features?: Array<{ geometry: unknown }>;
  };
  const feature = data.features?.[0];
  if (feature === undefined) {
    return new Response('No route found', { status: 404 });
  }
  return Response.json({ geometry: feature.geometry });
}

export async function handleRouteProxy(req: Request): Promise<Response> {
  const apiKey = getApiKey();
  if (apiKey === null || apiKey === '') {
    return new Response(
      'ORS_API_KEY not configured. Set env var or db setting "ors_api_key".',
      { status: 503 }
    );
  }
  try {
    const body = (await req.json()) as {
      coordinates: Array<[number, number]>;
      profile: string;
    };
    const orsProfile = ORS_PROFILES[body.profile];
    if (orsProfile === undefined || body.coordinates.length < 2) {
      return new Response('Invalid request', { status: 400 });
    }
    return await fetchRoute(apiKey, body.coordinates, orsProfile);
  } catch (err) {
    console.error('handleRouteProxy error:', err);
    return new Response('Internal server error', { status: 500 });
  }
}
