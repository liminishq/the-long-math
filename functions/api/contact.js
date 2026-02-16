/**
 * Contact form API — Cloudflare Pages Function
 * Route: POST /api/contact
 *
 * Environment variables (required for production):
 * Cloudflare Dashboard → Workers & Pages → Pages → the-long-math → Settings → Variables and secrets
 * - TURNSTILE_SECRET: Turnstile secret key (private)
 * - CONTACT_TO_EMAIL: Inbox that receives submissions (e.g., your Gmail)
 */

const ALLOWED_CATEGORIES = ["general", "bug", "correction", "media", "partnership"];
const EMAIL_MAX = 254;
const NAME_MIN = 2;
const MESSAGE_MIN = 10;
const MESSAGE_MAX = 4000;

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function validate(body) {
  const details = [];

  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const category = typeof body?.category === "string" ? body.category.trim() : "";
  const message = typeof body?.message === "string" ? body.message.trim() : "";

  if (name.length < NAME_MIN) details.push("name");

  const emailOk =
    email.length >= 5 &&
    email.length <= EMAIL_MAX &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  if (!emailOk) details.push("email");

  if (!ALLOWED_CATEGORIES.includes(category)) details.push("category");

  if (message.length < MESSAGE_MIN || message.length > MESSAGE_MAX) details.push("message");

  if (details.length) return { ok: false, details };
  return { ok: true, name, email, category, message };
}

async function verifyTurnstile(token, secret, ip) {
  const form = new FormData();
  form.set("secret", secret);
  form.set("response", token);
  if (ip) form.set("remoteip", ip);

  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: form,
  });

  let data;
  try {
    data = await res.json();
  } catch {
    return false;
  }

  return data && data.success === true;
}

function categoryLabel(category) {
  return (
    {
      general: "General Feedback",
      bug: "Calculator Bug",
      correction: "Technical Correction",
      media: "Media Inquiry",
      partnership: "Partnership Inquiry",
    }[category] || category
  );
}

async function sendMail(env, { name, email, category, message }, meta) {
  const label = categoryLabel(category);

  const body = [
    `Name: ${name}`,
    `Email: ${email}`,
    `Category: ${label}`,
    "",
    "Message:",
    message,
    "",
    `Timestamp: ${meta.timestamp}`,
    `User-Agent: ${meta.userAgent}`,
    meta.ip ? `IP: ${meta.ip}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const resp = await fetch("https://api.mailchannels.net/tx/v1/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: env.CONTACT_TO_EMAIL }] }],
      from: { email: "no-reply@thelongmath.com", name: "The Long Math Contact" },
      reply_to: { email, name },
      subject: `New Contact Form: ${label}`,
      content: [{ type: "text/plain", value: body }],
    }),
  });

  if (resp.ok) return { ok: true };

  const txt = await resp.text().catch(() => "");
  return { ok: false, detail: txt.slice(0, 500) };
}

export async function onRequestPost(context) {
  const { request, env } = context;

  // Helpful failure mode if frontend accidentally submits non-JSON
  const ct = request.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    return json({ ok: false, error: "content_type" }, 415);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "bad_json" }, 400);
  }

  const turnstileToken =
    typeof body?.turnstileToken === "string" ? body.turnstileToken.trim() : "";

  if (!turnstileToken) {
    return json({ ok: false, error: "validation", details: ["turnstileToken"] }, 400);
  }

  const validation = validate(body);
  if (!validation.ok) {
    return json({ ok: false, error: "validation", details: validation.details }, 400);
  }

  const secret = env.TURNSTILE_SECRET;
  const contactTo = env.CONTACT_TO_EMAIL;

  if (!secret || !contactTo) {
    // Misconfigured environment vars
    return json({ ok: false, error: "config" }, 500);
  }

  const ip =
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for") ||
    null;

  const turnstileOk = await verifyTurnstile(turnstileToken, secret, ip);
  if (!turnstileOk) {
    return json({ ok: false, error: "turnstile_failed" }, 400);
  }

  const meta = {
    timestamp: new Date().toISOString(),
    userAgent: request.headers.get("user-agent") || "",
    ip,
  };

  const mailRes = await sendMail(env, validation, meta);
  if (!mailRes.ok) {
    return json({ ok: false, error: "mail_failed", detail: mailRes.detail || "" }, 500);
  }

  return json({ ok: true }, 200);
}
