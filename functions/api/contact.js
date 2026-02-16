/**
 * Contact form API — Cloudflare Pages Function
 * Route: POST /api/contact
 *
 * Environment variables (required for production):
 * In Cloudflare Dashboard: Pages → [your project] → Settings → Environment variables.
 * Add for Production (and Preview if desired):
 * - TURNSTILE_SECRET: Turnstile secret key (from same Cloudflare Turnstile widget as sitekey)
 * - CONTACT_TO_EMAIL: Inbox address that receives contact form submissions
 */

const ALLOWED_CATEGORIES = ['general', 'bug', 'correction', 'media', 'partnership'];
const EMAIL_MAX = 254;
const NAME_MIN = 2;
const MESSAGE_MIN = 10;
const MESSAGE_MAX = 4000;

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
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
  const data = await res.json();
  return data.success === true;
}

async function sendMail(env, { name, email, category, message }, meta) {
  const categoryLabel = {
    general: 'General Feedback',
    bug: 'Calculator Bug',
    correction: 'Technical Correction',
    media: 'Media Inquiry',
    partnership: 'Partnership Inquiry',
  }[category] || category;

  const body = [
    `Name: ${name}`,
    `Email: ${email}`,
    `Category: ${categoryLabel}`,
    '',
    'Message:',
    message,
    '',
    `Timestamp: ${meta.timestamp}`,
    `User-Agent: ${meta.userAgent}`,
    meta.ip ? `IP: ${meta.ip}` : '',
  ].filter(Boolean).join('\n');

  const res = await fetch('https://api.mailchannels.net/tx/v1/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: env.CONTACT_TO_EMAIL }] }],
      from: { email: 'no-reply@thelongmath.com', name: 'The Long Math Contact' },
      reply_to: { email, name },
      subject: `New Contact Form: ${categoryLabel}`,
      content: [{ type: 'text/plain', value: body }],
    }),
  });
  return res.ok;
}

export async function onRequestPost(context) {
  const { request, env } = context;

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

  const secret = env.TURNSTILE_SECRET;
  const contactTo = env.CONTACT_TO_EMAIL;
  if (!secret || !contactTo) {
    return json({ ok: false, error: 'config' }, 500);
  }

  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || null;
  const turnstileOk = await verifyTurnstile(turnstileToken, secret, ip);
  if (!turnstileOk) {
    return json({ ok: false, error: 'turnstile_failed' }, 400);
  }

  const meta = {
    timestamp: new Date().toISOString(),
    userAgent: request.headers.get('User-Agent') || '',
    ip,
  };
  const mailOk = await sendMail(env, validation, meta);
  if (!mailOk) {
    return json({ ok: false, error: 'mail_failed' }, 500);
  }

  return json({ ok: true });
}
