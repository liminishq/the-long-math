const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    }, 
  });

export async function onRequestGet(context) {
  try {
    const { request, env } = context;

    if (!env.DB) return json({ ok: false, error: 'config_db' }, 500);
    if (!env.INBOX_KEY) return json({ ok: false, error: 'config_inbox_key' }, 500);

    const url = new URL(request.url);
    const key = url.searchParams.get('key') || '';

    // Return 404 on bad key (so it doesn't advertise "auth exists")
    if (key !== env.INBOX_KEY) {
      return new Response('Not Found', { status: 404 });
    }

    const limitRaw = url.searchParams.get('limit');
    const limit = Math.max(1, Math.min(200, Number(limitRaw || 50) || 50));

    const result = await env.DB.prepare(
      `SELECT id, created_at, name, email, category, message
       FROM contact_messages
       ORDER BY id DESC
       LIMIT ?`
    ).bind(limit).all();

    return json({ ok: true, rows: result.results || [] });
  } catch (err) {
    return json({ ok: false, error: 'unhandled_exception', detail: String(err?.stack || err) }, 500);
  }
}
