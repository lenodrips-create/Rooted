// Rooted Bible AI — Supabase Edge Function
// Answers questions from search.html. The API key lives in Supabase
// (Edge Functions → Secrets) and never reaches the browser.
import Anthropic from "npm:@anthropic-ai/sdk";

// The secret's name as saved in the Supabase dashboard (a few spellings are accepted).
const SECRET_NAMES = ["ROOTED_API", "ROOTED_API_KEY", "rooted api", "rooted_api", "ROOTED API", "ANTHROPIC_API_KEY"];

const SYSTEM_PROMPT = `You are the Bible helper on Rooted, a website for reading the Bible (KJV, Douay-Rheims, and the World English Bible with the Orthodox canon).
Answer questions about the Bible, its books, people, places, history and teaching. Quote verses with their references when they help.
Where Protestant, Catholic and Orthodox Christians understand something differently, say so fairly and briefly.
Keep answers short and clear: a few short paragraphs at most, plain text without Markdown headings.
If a question has nothing to do with the Bible or faith, gently say that you can only help with Bible questions.`;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function getKey(): string | undefined {
  for (const name of SECRET_NAMES) {
    const v = Deno.env.get(name);
    if (v && v.trim()) return v.trim();
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method === "GET") return reply({ ok: true, message: "Rooted AI is running.", keyFound: !!getKey() });
  if (req.method !== "POST") return reply({ error: "Use POST." }, 405);

  const apiKey = getKey();
  if (!apiKey) {
    return reply({ error: "The AI key isn't set. Add it in Supabase → Edge Functions → Secrets as ROOTED_API." }, 500);
  }
  if (!apiKey.startsWith("sk-ant-")) {
    return reply({ error: "The saved key isn't an Anthropic (Claude) key, which this AI needs." }, 500);
  }

  let messages: Anthropic.MessageParam[];
  try {
    const body = JSON.parse(await req.text());
    messages = (Array.isArray(body.messages) ? body.messages : [])
      .filter((m: any) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
      .slice(-20)
      .map((m: any) => ({ role: m.role, content: m.content.slice(0, 4000) }));
  } catch {
    return reply({ error: "Couldn't read the question." }, 400);
  }
  while (messages.length && messages[0].role !== "user") messages.shift();
  if (!messages.length || messages[messages.length - 1].role !== "user") {
    return reply({ error: "Please ask a question." }, 400);
  }

  const client = new Anthropic({ apiKey });
  try {
    const response = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages,
    } as any);

    if (response.stop_reason === "refusal") {
      return reply({ error: "The AI couldn't answer that one. Try asking another way." }, 200);
    }
    const answer = response.content
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("")
      .trim();
    if (!answer) return reply({ error: "No answer came back." }, 502);
    return reply({ answer });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      return reply({ error: "The AI key was rejected. Check the key saved in Supabase." }, 500);
    }
    if (err instanceof Anthropic.RateLimitError) {
      return reply({ error: "The AI is busy right now. Please try again in a minute." }, 429);
    }
    if (err instanceof Anthropic.APIError) {
      console.error("Anthropic error", err.status, err.message);
      return reply({ error: "The AI service had a problem (" + err.status + "). Please try again." }, 502);
    }
    console.error(err);
    return reply({ error: "Something went wrong reaching the AI." }, 502);
  }
});
