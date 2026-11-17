// Rooted Bible text — Supabase Edge Function (named rooted-esv)
// Fetches one chapter of a copyrighted translation for read.html:
//   ?version=esv  Crossway's ESV API. Needs a free key saved in Supabase secrets
//                 as ESV_API_KEY (https://api.esv.org, non-commercial use).
//   ?version=nlt  Tyndale's NLT API. Works with Tyndale's public TEST key; an
//                 optional free key (NLT_API_KEY, https://api.nlt.to) raises the limits.
// These translations are copyrighted, so they can't be stored in the site's files.

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

function getKey(names = ["ESV_API_KEY", "ESV_API", "ESV_KEY", "esv api"]): string | undefined {
  for (const name of names) {
    const v = Deno.env.get(name);
    if (v && v.trim()) return v.trim();
  }
}

// Rooted book ids ("1Samuel", "SongofSolomon") → ESV names ("1 Samuel", "Song of Solomon")
function bookName(id: string): string {
  if (id === "SongofSolomon") return "Song of Solomon";
  return id.replace(/^(\d)/, "$1 ");
}

// ---------- NLT ----------
// The NLT API returns HTML where each verse is wrapped in
// <verse_export ... vn="16">…</verse_export>, with footnotes and headings inside.
const DROP_CLASSES = /\b(tn|tn-ref|a-tn|vn|subhead|chapter-number|chapter-title|book-title|cw)\b/;

function decode(t: string): string {
  const named: Record<string, string> = {
    amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "\u2019", lsquo: "\u2018",
    rdquo: "\u201d", ldquo: "\u201c", mdash: "\u2014", ndash: "\u2013", hellip: "\u2026",
  };
  return t
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => named[n.toLowerCase()] ?? m);
}

// Keep the readable text of one verse, skipping footnotes, verse numbers and headings
function verseText(html: string): string {
  const stack: boolean[] = [];
  let out = "";
  const re = /<(\/?)([a-zA-Z0-9_]+)([^>]*?)(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const dropping = stack.length > 0 && stack[stack.length - 1];
    if (m[5] !== undefined) {
      if (!dropping) out += m[5];
      continue;
    }
    const [, closing, tag, attrs, selfClose] = m;
    const t = tag.toLowerCase();
    if (selfClose || t === "br" || t === "hr" || t === "img") {
      if (!dropping && t === "br") out += " ";
      continue;
    }
    if (closing) {
      stack.pop();
      continue;
    }
    const cls = (attrs.match(/class\s*=\s*"([^"]*)"/i) ?? [])[1] ?? "";
    stack.push(dropping || /^h[1-6]$/.test(t) || DROP_CLASSES.test(cls));
  }
  return decode(out).replace(/\s+/g, " ").trim();
}

async function nltChapter(book: string, chapter: number) {
  const nltKey = getKey(["NLT_API_KEY", "NLT_KEY", "NLT_API"]) ?? "TEST";
  const chunk = nltKey === "TEST" ? 50 : 500; // verses per request allowed by the API
  const verses: [number, string][] = [];
  for (let start = 1; start <= 200; start += chunk) {
    const ref = bookName(book) + " " + chapter + ":" + start + "-" + (start + chunk - 1);
    const q = new URLSearchParams({ ref, version: "NLT", key: nltKey });
    let res: Response;
    try {
      res = await fetch("https://api.nlt.to/api/passages?" + q);
    } catch (err) {
      console.error(err);
      return reply({ error: "Couldn't reach the NLT service." }, 502);
    }
    if (res.status === 429) return reply({ error: "The NLT is busy right now. Please try again later." }, 429);
    if (!res.ok) {
      console.error("NLT error", res.status, (await res.text()).slice(0, 300));
      return reply({ error: "The NLT service had a problem (" + res.status + ")." }, 502);
    }
    const html = await res.text();
    const found: [number, string][] = [];
    const re = /<verse_export\b([^>]*)>([\s\S]*?)<\/verse_export>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) {
      const vn = parseInt((m[1].match(/\bvn\s*=\s*"(\d+)"/i) ?? [])[1] ?? "", 10);
      const ch = parseInt((m[1].match(/\bch\s*=\s*"(\d+)"/i) ?? [])[1] ?? String(chapter), 10);
      const text = verseText(m[2]);
      if (vn && ch === chapter && text) found.push([vn, text]);
    }
    if (!found.length) {
      if (!verses.length) console.error("NLT parse found no verses", ref, html.slice(0, 500));
      break;
    }
    verses.push(...found);
    if (found[found.length - 1][0] < start + chunk - 1) break; // reached the end of the chapter
  }
  if (!verses.length) return reply({ error: "That chapter wasn't found in the NLT." }, 404);
  return reply({ verses }, 200, { "Cache-Control": "public, max-age=86400" });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "GET") return reply({ error: "Use GET." }, 405);

  const url = new URL(req.url);
  const book = url.searchParams.get("book") ?? "";
  const chapter = parseInt(url.searchParams.get("chapter") ?? "", 10);
  const version = (url.searchParams.get("version") ?? "esv").toLowerCase();
  const key = getKey();

  // With no book: report which translations are ready, so the reader can hide the rest
  if (!book) {
    return reply({ ok: true, message: "Rooted Bible text is running.", keyFound: !!key, versions: { esv: !!key, nlt: true } });
  }
  if (!/^[1-3]?[A-Za-z]+$/.test(book) || !(chapter >= 1 && chapter <= 150)) {
    return reply({ error: "Unknown book or chapter." }, 400);
  }
  if (version === "nlt") return await nltChapter(book, chapter);
  if (version !== "esv") return reply({ error: "Unknown translation." }, 400);
  if (!key) return reply({ error: "The ESV isn't set up yet. Add an ESV_API_KEY secret in Supabase." }, 500);

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
