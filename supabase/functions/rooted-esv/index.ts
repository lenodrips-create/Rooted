// Rooted ESV — Supabase Edge Function
// Fetches one chapter of the ESV from Crossway's ESV API for read.html.
// The ESV is copyrighted, so it can't be stored in the site's files; the API key
// lives in Supabase (Edge Functions → Secrets) as ESV_API_KEY.
// Get a free key at https://api.esv.org (non-commercial use).

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

function reply(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", ...extra },
  });
}

function getKey(): string | undefined {
  for (const name of ["ESV_API_KEY", "ESV_API", "ESV_KEY", "esv api"]) {
    const v = Deno.env.get(name);
    if (v && v.trim()) return v.trim();
  }
}

// Rooted book ids ("1Samuel", "SongofSolomon") → ESV names ("1 Samuel", "Song of Solomon")
function bookName(id: string): string {
  if (id === "SongofSolomon") return "Song of Solomon";
  return id.replace(/^(\d)/, "$1 ");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "GET") return reply({ error: "Use GET." }, 405);

  const url = new URL(req.url);
  const book = url.searchParams.get("book") ?? "";
  const chapter = parseInt(url.searchParams.get("chapter") ?? "", 10);
  const key = getKey();

  if (!book) return reply({ ok: true, message: "Rooted ESV is running.", keyFound: !!key });
  if (!key) return reply({ error: "The ESV isn't set up yet. Add an ESV_API_KEY secret in Supabase." }, 500);
  if (!/^[1-3]?[A-Za-z]+$/.test(book) || !(chapter >= 1 && chapter <= 150)) {
    return reply({ error: "Unknown book or chapter." }, 400);
  }

  const q = new URLSearchParams({
    q: bookName(book) + " " + chapter,
    "include-passage-references": "false",
    "include-verse-numbers": "true",
    "include-first-verse-numbers": "true",
    "include-footnotes": "false",
    "include-footnote-body": "false",
    "include-headings": "false",
    "include-short-copyright": "false",
    "include-copyright": "false",
    "include-selahs": "true",
    "indent-paragraphs": "0",
    "indent-poetry": "false",
    "indent-declares": "0",
    "indent-psalm-doxology": "0",
    "line-length": "0",
  });

  let res: Response;
  try {
    res = await fetch("https://api.esv.org/v3/passage/text/?" + q, {
      headers: { Authorization: "Token " + key },
    });
  } catch (err) {
    console.error(err);
    return reply({ error: "Couldn't reach the ESV service." }, 502);
  }
  if (res.status === 401 || res.status === 403) {
    return reply({ error: "The ESV key was rejected. Check ESV_API_KEY in Supabase." }, 500);
  }
  if (res.status === 429) return reply({ error: "The ESV is busy right now. Please try again in a minute." }, 429);
  if (!res.ok) {
    console.error("ESV error", res.status, (await res.text()).slice(0, 300));
    return reply({ error: "The ESV service had a problem (" + res.status + ")." }, 502);
  }

  const data = await res.json();
  const text: string = (data.passages ?? [])[0] ?? "";
  // Text looks like "[1] In the beginning ... [2] The earth was ..."
  const pieces = text.split(/\[(\d+)\]/);
  const before = pieces[0].replace(/\s+/g, " ").trim(); // e.g. a psalm title
  const verses: [number, string][] = [];
  for (let i = 1; i < pieces.length; i += 2) {
    const t = pieces[i + 1].replace(/\s+/g, " ").trim();
    if (t) verses.push([parseInt(pieces[i], 10), t]);
  }
  if (!verses.length) return reply({ error: "That chapter wasn't found in the ESV." }, 404);
  if (before) verses[0][1] = before + " " + verses[0][1];

  return reply({ verses }, 200, { "Cache-Control": "public, max-age=3600" });
});
