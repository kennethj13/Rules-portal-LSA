const RATE_LIMIT = 20; // requests per IP per day

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Serve static assets for anything that isn't the API proxy
    if (url.pathname !== '/api/chat') {
      return env.ASSETS.fetch(request);
    }

    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    // Rate limiting using Cloudflare KV
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const today = new Date().toISOString().split('T')[0];
    const rateLimitKey = `rate:${ip}:${today}`;

    if (env.RATE_LIMIT_KV) {
      const count = parseInt(await env.RATE_LIMIT_KV.get(rateLimitKey) || '0');
      if (count >= RATE_LIMIT) {
        return new Response(
          JSON.stringify({ error: { message: `Daily limit of ${RATE_LIMIT} questions reached. Please try again tomorrow.` } }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      await env.RATE_LIMIT_KV.put(rateLimitKey, String(count + 1), { expirationTtl: 86400 });
    }

    // Forward to Anthropic
    try {
      const body = await request.json();
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      });

      const data = await response.json();
      return new Response(JSON.stringify(data), {
        status: response.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    } catch (err) {
      return new Response(
        JSON.stringify({ error: { message: 'Worker error: ' + err.message } }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
  }
};
