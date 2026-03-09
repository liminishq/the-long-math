/**
 * Contact form API — Cloudflare Pages Function
 * Route: POST /api/contact
 *
 * Bindings required:
 * - DB (D1 database) -> thelongmath_contact
 *
 * Environment variables required:
 * - TURNSTILE_SECRET (Turnstile secret key)
 */

const ALLOWED_CATEGORIES = ['general', 'bug', 'correction', 'media', 'partnership'];
const EMAIL_MAX = 254;
const NAME_MIN = 2;
const MESSAGE_MIN = 10;
const MESSAGE_MAX = 4000;

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });

function validate(body) {
  const details = [];
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const category = typeof body.category === 'string' ? body.category.trim() : '';
  const message = typeof body.message === 'string' ? body.message.trim() : '';

  if (name.length < NAME_MIN) details.push('name');
  if (email.length > EMAIL_MAX || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) details.push('email');
  if (!ALLOWED_CATEGORIES.includes(category)) details.push('category');
  if (message.length < MESSAGE_MIN || message.length > MESSAGE_MAX) details.push('message');

  if (details.length) return { ok: false, details };
  return { ok: true, name, email, category, message };
}

async function verifyTurnstile(token, secret, ip) {
  const form = new FormData();
  form.set('secret', secret);
  form.set('response', token);
  if (ip) form.set('remoteip', ip);

  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: form,
  });

  const data = await res.json().catch(() => ({}));
  return data.success === true;
}

export async function onRequestPost(context) {
  try {
    const { request, env } = context;

    // Basic content-type guard
    const ct = request.headers.get('Content-Type') || '';
    if (!ct.includes('application/json')) {
      return json({ ok: false, error: 'content_type' }, 415);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, error: 'validation', details: ['body'] }, 400);
    }

    const turnstileToken = typeof body.turnstileToken === 'string' ? body.turnstileToken.trim() : '';
    if (!turnstileToken) {
      return json({ ok: false, error: 'validation', details: ['turnstile'] }, 400);
    }

    const validation = validate(body);
    if (!validation.ok) {
      return json({ ok: false, error: 'validation', details: validation.details }, 400);
    }

    if (!env.TURNSTILE_SECRET) return json({ ok: false, error: 'config_turnstile' }, 500);
    if (!env.DB) return json({ ok: false, error: 'config_db' }, 500);

    const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || null;

    const turnstileOk = await verifyTurnstile(turnstileToken, env.TURNSTILE_SECRET, ip);
    if (!turnstileOk) {
      return json({ ok: false, error: 'turnstile_failed' }, 400);
    }

    const userAgent = request.headers.get('User-Agent') || '';
    const createdAt = new Date().toISOString();

    // Insert into D1
    await env.DB.prepare(
      `INSERT INTO contact_messages (created_at, name, email, category, message, ip, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(createdAt, validation.name, validation.email, validation.category, validation.message, ip, userAgent)
      .run();

    return json({ ok: true });
  } catch (err) {
    // Always return JSON (no HTML 500)
    return json({ ok: false, error: 'unhandled_exception', detail: String(err?.stack || err) }, 500);
  }
}
