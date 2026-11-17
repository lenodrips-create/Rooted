// Rooted sign-in — Supabase Edge Function
// Signs the site owner in so they can post Developer News. The password lives in Supabase
// (Edge Functions → Secrets) as ADMIN_PASSWORD and never reaches the browser.
//
//   POST { password }  → { token } if the password is right (the pass lasts 30 days)
//   GET  with "Authorization: Bearer <token>" → { valid: true/false }
//
// Changing ADMIN_PASSWORD signs everyone out, because old passes stop matching.

const DAYS = 30;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function sitePassword(): string | undefined {
  for (const name of ["ADMIN_PASSWORD", "SITE_PASSWORD"]) {
    const v = Deno.env.get(name);
    if (v && v.length) return v;
  }
}

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmacKey(password: string) {
  const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("rooted-site-pass:" + password));
  return crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

async function sign(payload: string, password: string): Promise<string> {
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(password), new TextEncoder().encode(payload));
  return b64url(new Uint8Array(sig));
}

// Compare without leaking how many characters matched
function same(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export async function tokenIsValid(token: string, password: string): Promise<boolean> {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return false;
  if (!same(sig, await sign(payload, password))) return false;
  try {
    const data = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return typeof data.exp === "number" && data.exp * 1000 > Date.now();
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  const password = sitePassword();
  if (!password) {
    return reply({ error: "The password isn't set up yet. Add an ADMIN_PASSWORD secret in Supabase." }, 500);
  }

  if (req.method === "GET") {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    return reply({ valid: token ? await tokenIsValid(token, password) : false });
  }

  if (req.method !== "POST") return reply({ error: "Use POST." }, 405);

  let given = "";
  try {
    const body = JSON.parse(await req.text());
    given = typeof body.password === "string" ? body.password : "";
  } catch {
    return reply({ error: "Couldn't read the password." }, 400);
  }

  if (!same(given, password)) {
    await new Promise((r) => setTimeout(r, 700)); // slows down guessing
    return reply({ error: "That password isn't right." }, 401);
  }

  const exp = Math.floor(Date.now() / 1000) + DAYS * 24 * 60 * 60;
  const payload = b64url(new TextEncoder().encode(JSON.stringify({ exp })));
  return reply({ token: payload + "." + (await sign(payload, password)), expires: exp });
});
