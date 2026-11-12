import type { Config } from "@netlify/functions";
import Anthropic from "@anthropic-ai/sdk";
import { timingSafeEqual } from "node:crypto";

// Credentials come from Netlify AI Gateway (injected ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL),
// or from your own ANTHROPIC_API_KEY if you set one on the site.
const client = new Anthropic();

const MODEL = Netlify.env.get("CLAUDE_MODEL") || "claude-opus-5-5";
// The stream ends with one control line so the browser can tell a finished answer
// from one cut off by the 60-second function limit.
const MARK = "\u0000";

type Turn = { role: "user" | "assistant"; content: string };
type Img = { media_type: "image/jpeg" | "image/png" | "image/webp" | "image/gif"; data: string };

function passcodeOk(req: Request): "ok" | "wrong" | "unset" {
  const want = Netlify.env.get("SITE_PASSCODE");
  if (!want) return "unset";
  const a = Buffer.from(req.headers.get("x-passcode") || "");
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b) ? "ok" : "wrong";
}

function errorCode(e: unknown): string {
  if (e instanceof Anthropic.RateLimitError) return "rate_limited";
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return "not_configured";
  if (e instanceof Anthropic.BadRequestError) return /too long|too large|context/i.test(e.message) ? "prompt_too_large" : "bad_request";
  if (e instanceof Anthropic.APIError && e.status === 413) return "prompt_too_large";
  return "upstream_error";
}

export default async (req: Request) => {
  const pass = passcodeOk(req);
  if (pass === "unset") return Response.json({ code: "not_configured" }, { status: 503 });
  if (pass === "wrong") return Response.json({ code: "passcode" }, { status: 401 });

  let body: { ping?: boolean; messages?: Turn[]; images?: Img[] };
  try { body = await req.json(); } catch { return Response.json({ code: "bad_request" }, { status: 400 }); }
  if (body.ping) return Response.json({ ok: true });

  const turns = Array.isArray(body.messages) ? body.messages : [];
  const valid = turns.length > 0 && turns.every(t => t && (t.role === "user" || t.role === "assistant") && typeof t.content === "string" && t.content.trim());
  if (!valid || turns[0].role !== "user" || turns[turns.length - 1].role !== "user") {
    return Response.json({ code: "bad_request" }, { status: 400 });
  }
  const images = (Array.isArray(body.images) ? body.images : []).slice(0, 8)
    .filter(i => i && typeof i.data === "string" && /^image\/(jpeg|png|webp|gif)$/.test(i.media_type));

  const messages: Anthropic.MessageParam[] = turns.map((t, k) => {
    if (k !== turns.length - 1 || !images.length) return { role: t.role, content: t.content };
    return {
      role: "user",
      content: [
        ...images.map(i => ({ type: "image" as const, source: { type: "base64" as const, media_type: i.media_type, data: i.data } })),
        { type: "text" as const, text: t.content },
      ],
    };
  });

  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const run = client.messages.stream(
          {
            model: MODEL,
            max_tokens: 64000,
            // Low effort keeps answers inside the 60-second function limit.
            output_config: { effort: "low" },
            messages,
          },
          { signal: req.signal },
        );
        for await (const event of run) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            controller.enqueue(enc.encode(event.delta.text));
          }
        }
        const final = await run.finalMessage();
        controller.enqueue(enc.encode(`${MARK}END:${final.stop_reason ?? "end_turn"}`));
      } catch (e) {
        if (!req.signal.aborted) {
          console.error("ask failed:", e instanceof Error ? e.message : e);
          controller.enqueue(enc.encode(`${MARK}ERR:${errorCode(e)}`));
        }
      } finally {
        try { controller.close(); } catch { /* already closed by an abort */ }
      }
    },
  });

  return new Response(stream, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
};

export const config: Config = {
  path: "/api/ask",
  method: "POST",
  rateLimit: { action: "rate_limit", aggregateBy: ["ip", "domain"], windowSize: 60, windowLimit: 30 },
};
