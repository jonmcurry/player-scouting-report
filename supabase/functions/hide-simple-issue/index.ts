// Authenticated feedback boundary: the caller-scoped RPC checks coach or
// linked guardian access, then the service client persists any focus change.
import { createClient } from "npm:@supabase/supabase-js@2";
import { persistPlayerFocus } from "../../../src/services/development/focusPersistence.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body),
  { status, headers: { ...cors, "Content-Type": "application/json" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return reply({ error: "Method not allowed." }, 405);
  const { issueId, reason } = await request.json().catch(() => ({}));
  if (typeof issueId !== "string" || !UUID.test(issueId) ||
      (reason !== undefined && reason !== null && !["not_what_happened", "wrong_kid", "other"].includes(reason)))
    return reply({ error: "Invalid feedback." }, 400);
  const authorization = request.headers.get("Authorization");
  if (!authorization) return reply({ error: "Sign in to hide a fix." }, 401);
  try {
    const caller = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
    const { data: user, error: authError } = await caller.auth.getUser(authorization.replace(/^Bearer\s+/i, ""));
    if (authError || !user?.user || user.user.is_anonymous) return reply({ error: "Sign in to hide a fix." }, 401);
    const { error: hideError } = await caller.rpc("hide_simple_issue", { p_issue_id: issueId, p_reason: reason ?? null });
    if (hideError) return reply({ error: "This fix could not be hidden." }, 403);
    const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: issue, error: issueError } = await service.from("issues").select("player_id").eq("id", issueId).single();
    if (issueError || !issue) throw issueError ?? new Error("Hidden issue disappeared");
    await persistPlayerFocus(service, issue.player_id);
    return reply({ ok: true });
  } catch (error) {
    console.error("hide-simple-issue:", error);
    return reply({ error: "Feedback was saved, but progress could not be updated. Please try again." }, 500);
  }
});
