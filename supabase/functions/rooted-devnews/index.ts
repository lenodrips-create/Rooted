// Rooted Developer News — Supabase Edge Function
//   GET                         → the latest posts (anyone; shown on the home page)
//   POST   { title, body }      → add a post    (needs a pass from rooted-login)
//   DELETE ?id=123              → delete a post (needs a pass from rooted-login)
// Posts live in the public.dev_news table. Only this function can touch it.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

function reply(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", ...extra },
  });
}

function adminPassword(): string | undefined {
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

function same(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

// The pass from rooted-login is signed with the admin password
async function hasPass(req: Request): Promise<boolean> {
  const password = adminPassword();
  if (!password) return false;
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return false;
  try {
    const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("rooted-site-pass:" + password));
    const key = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const expected = b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload))));
    if (!same(sig, expected)) return false;
    const data = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return typeof data.exp === "number" && data.exp * 1000 > Date.now();
  } catch {
    return false;
  }
}

// Talk to the database with the service role (only available inside Supabase)
function db(path: string, init: RequestInit = {}) {
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  return fetch(Deno.env.get("SUPABASE_URL") + "/rest/v1/" + path, {
    ...init,
    headers: { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  if (req.method === "GET") {
    const res = await db("dev_news?select=id,title,body,created_at&order=created_at.desc&limit=20");
    if (!res.ok) {
      console.error("dev_news read failed", res.status, await res.text());
      return reply({ error: "Couldn't load the news." }, 502);
    }
    return reply({ posts: await res.json() }, 200, { "Cache-Control": "public, max-age=60" });
  }

  if (!(await hasPass(req))) return reply({ error: "Please sign in again." }, 401);

  if (req.method === "POST") {
    let title = "", body = "";
    try {
      const data = JSON.parse(await req.text());
      title = String(data.title ?? "").trim();
      body = String(data.body ?? "").trim();
    } catch {
      return reply({ error: "Couldn't read the post." }, 400);
    }
    if (!title || !body) return reply({ error: "Add a title and a message." }, 400);
    if (title.length > 120) return reply({ error: "Keep the title under 120 characters." }, 400);
    if (body.length > 2000) return reply({ error: "Keep the message under 2,000 characters." }, 400);
    const res = await db("dev_news", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ title, body }),
    });
    if (!res.ok) {
      console.error("dev_news insert failed", res.status, await res.text());
      return reply({ error: "Couldn't save the post." }, 502);
    }
    return reply({ post: (await res.json())[0] });
  }

  if (req.method === "DELETE") {
    const id = parseInt(new URL(req.url).searchParams.get("id") ?? "", 10);
    if (!(id > 0)) return reply({ error: "Which post?" }, 400);
    const res = await db("dev_news?id=eq." + id, { method: "DELETE" });
    if (!res.ok) {
      console.error("dev_news delete failed", res.status, await res.text());
      return reply({ error: "Couldn't delete the post." }, 502);
    }
    return reply({ ok: true });
  }

  return reply({ error: "Not supported." }, 405);
});
