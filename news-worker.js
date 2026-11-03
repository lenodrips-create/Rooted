// Cloudflare Worker: gets the latest Epoch Times faith headlines
// and gives them to your Bible app as a simple list.
//
// Setup: dash.cloudflare.com -> Workers & Pages -> Create -> "Hello World"
// -> Edit code -> replace everything with this file -> Deploy.
// Then copy the worker's address into NEWS_URL in saved.html.

const FEED_URL =
  "https://news.google.com/rss/search?q=site:theepochtimes.com/faith&hl=en-US&gl=US&ceid=US:en";

const MAX_STORIES = 10;

export default {
  async fetch(request) {
    const headers = {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      // Browsers and Cloudflare reuse the list for 1 hour, so it refreshes all day
      "Cache-Control": "public, max-age=3600"
    };

    try {
      const res = await fetch(FEED_URL, { cf: { cacheTtl: 3600, cacheEverything: true } });
      if (!res.ok) throw new Error("Feed returned " + res.status);
      const xml = await res.text();

      const stories = [];
      const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
      for (const item of items.slice(0, MAX_STORIES)) {
        const title = clean(pick(item, "title")).replace(/\s+-\s+The Epoch Times\s*$/i, "");
        const link = clean(pick(item, "link"));
        const date = clean(pick(item, "pubDate"));
        if (title && link) stories.push({ title, link, date });
      }

      return new Response(JSON.stringify({ updated: new Date().toISOString(), stories }), { headers });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message, stories: [] }), { status: 502, headers });
    }
  }
};

function pick(text, tag) {
  const m = text.match(new RegExp("<" + tag + "[^>]*>([\\s\\S]*?)</" + tag + ">"));
  return m ? m[1] : "";
}

function clean(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}
