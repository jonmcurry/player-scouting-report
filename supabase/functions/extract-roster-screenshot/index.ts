// Coach-only, transient GameChanger roster screenshot extraction.
// The image is forwarded to Gemini and is never written to HitterLoop storage
// or logs. The browser treats the response as untrusted, requires a review
// screen, and persists only the coach-confirmed player identity fields.

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BASE64_LENGTH = Math.ceil(8_000_000 / 3) * 4 + 8;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function validPlayers(value: unknown) {
  if (!value || typeof value !== "object" || !Array.isArray((value as { players?: unknown }).players)) return null;
  const rows = (value as { players: unknown[] }).players;
  if (rows.length > 100) return null;
  const clean = (input: unknown, max: number) => typeof input === "string"
    ? input.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max) : "";
  const players = rows.map((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return null;
    const item = row as Record<string, unknown>;
    const firstName = clean(item.firstName, 80);
    const lastName = clean(item.lastName, 80);
    const jerseyNumber = clean(item.jerseyNumber, 12);
    const confidence = ["high", "medium", "low"].includes(String(item.confidence)) ? String(item.confidence) : "low";
    return firstName || lastName || jerseyNumber ? { firstName, lastName, jerseyNumber, confidence } : null;
  });
  return players.every(Boolean) ? players : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Not authorized" }, 401);
    const { teamId, mimeType, imageBase64 } = await req.json();
    if (typeof teamId !== "string" || !UUID.test(teamId) || typeof mimeType !== "string" || !MIME_TYPES.has(mimeType) ||
        typeof imageBase64 !== "string" || !imageBase64 || imageBase64.length > MAX_BASE64_LENGTH || !/^[A-Za-z0-9+/]+={0,2}$/.test(imageBase64)) {
      return json({ error: "Choose a valid JPG, PNG, or WebP screenshot smaller than 8 MB." }, 400);
    }

    const caller = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } }, auth: { persistSession: false, autoRefreshToken: false },
    });
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const { data: userData, error: userError } = await caller.auth.getUser(token);
    if (userError || !userData.user) return json({ error: "Not authorized" }, 401);
    const { data: access, error: accessError } = await caller.from("coach_team_access").select("team_id")
      .eq("coach_id", userData.user.id).eq("team_id", teamId).limit(1);
    if (accessError || !access?.length) return json({ error: "Team not found or not accessible" }, 404);

    const apiKey = Deno.env.get("GEMINI_API_KEY")?.trim();
    const model = Deno.env.get("GEMINI_MODEL")?.trim();
    if (!apiKey || !model) return json({ error: "Screenshot extraction is not configured." }, 503);
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [
          { text: "Read only the player roster visible in this screenshot. Return one row per player with jersey number, first name, and last name. Do not include teams, coaches, parents, statistics, or other text. Never guess: leave an uncertain field blank and lower confidence. Names split across first and last name fields must reflect only visible text." },
          { inlineData: { mimeType, data: imageBase64 } },
        ] }],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
          responseSchema: { type: "OBJECT", required: ["players"], properties: { players: { type: "ARRAY", maxItems: 100, items: {
            type: "OBJECT", required: ["firstName", "lastName", "jerseyNumber", "confidence"], properties: {
              firstName: { type: "STRING" }, lastName: { type: "STRING" }, jerseyNumber: { type: "STRING" },
              confidence: { type: "STRING", enum: ["high", "medium", "low"] },
            },
          } } },
        },
      }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return json({ error: "Couldn't read that screenshot. Use CSV or paste the roster instead." }, 502);
    }
    const result = await response.json();
    const text = result?.candidates?.[0]?.content?.parts?.find((part: { text?: unknown }) => typeof part?.text === "string")?.text;
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { return json({ error: "Couldn't read that screenshot. Use CSV or paste the roster instead." }, 502); }
    const players = validPlayers(parsed);
    if (!players) return json({ error: "Couldn't read that screenshot. Crop it to the roster and try again." }, 502);
    return json({ players });
  } catch {
    return json({ error: "Couldn't read that screenshot. Use CSV or paste the roster instead." }, 500);
  }
});
