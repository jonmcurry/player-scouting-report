import { GoogleAuth } from "google-auth-library";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NotificationDelivery } from "./outbox.js";
import { createFallbackNotificationProvider, type EmailNotificationChannel,
  type NotificationRecipientDirectory, type PushNotificationChannel } from "./provider.js";

type Fetch = typeof fetch;

const escapeHtml = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

export function createSupabaseRecipientDirectory(db: SupabaseClient): NotificationRecipientDirectory {
  return {
    async pushTokens(userId) {
      const { data, error } = await db.from("notification_push_tokens").select("token")
        .eq("user_id", userId).is("disabled_at", null).order("last_seen_at", { ascending: false });
      if (error) throw new Error(`Loading notification push tokens: ${error.message}`);
      return (data ?? []).map((row) => row.token as string);
    },
    async email(userId) {
      const { data, error } = await db.auth.admin.getUserById(userId);
      if (error) throw new Error(`Loading notification email: ${error.message}`);
      return data.user?.email ?? null;
    },
    async disablePushToken(token) {
      const { error } = await db.rpc("disable_notification_push_token", { p_token: token });
      if (error) throw new Error(`Disabling notification push token: ${error.message}`);
    },
  };
}

export function createFcmChannel(projectId: string, fetchImpl: Fetch = fetch,
  auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/firebase.messaging"] })): PushNotificationChannel {
  return {
    async send(token, delivery) {
      const client = await auth.getClient();
      const access = await client.getAccessToken();
      const bearer = typeof access === "string" ? access : access?.token;
      if (!bearer) throw new Error("FCM access token is unavailable");
      const response = await fetchImpl(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`, {
        method: "POST",
        headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
        body: JSON.stringify({ message: { token, notification: { title: "HitterLoop", body: delivery.body },
          data: { playerId: delivery.playerId, idempotencyKey: delivery.idempotencyKey } } }),
      });
      if (response.ok) return "sent";
      const detail = await response.text();
      if (response.status === 404 || /UNREGISTERED|registration-token-not-registered/i.test(detail)) return "invalid";
      throw new Error(`FCM ${response.status}: ${detail.slice(0, 300)}`);
    },
  };
}

export function createResendChannel(apiKey: string, from: string, appBaseUrl: string,
  fetchImpl: Fetch = fetch): EmailNotificationChannel {
  return {
    async send(address, delivery) {
      const link = new URL("simple.html", appBaseUrl);
      link.searchParams.set("player", delivery.playerId);
      const response = await fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json",
          "Idempotency-Key": delivery.idempotencyKey },
        body: JSON.stringify({ from, to: [address], subject: "HitterLoop update",
          text: `${delivery.body}\n\nOpen HitterLoop: ${link.href}`,
          html: `<p>${escapeHtml(delivery.body)}</p><p><a href="${escapeHtml(link.href)}">Open HitterLoop</a></p>` }),
      });
      if (!response.ok) throw new Error(`Resend ${response.status}: ${(await response.text()).slice(0, 300)}`);
    },
  };
}

export function createHostedNotificationProvider(db: SupabaseClient, env = process.env, fetchImpl: Fetch = fetch) {
  const directory = createSupabaseRecipientDirectory(db);
  const push = env.FIREBASE_PROJECT_ID ? createFcmChannel(env.FIREBASE_PROJECT_ID, fetchImpl) : null;
  const email = env.RESEND_API_KEY && env.NOTIFICATION_FROM_EMAIL && env.APP_BASE_URL
    ? createResendChannel(env.RESEND_API_KEY, env.NOTIFICATION_FROM_EMAIL, env.APP_BASE_URL, fetchImpl) : null;
  if (!push && !email) throw new Error("Configure FIREBASE_PROJECT_ID and/or RESEND_API_KEY, NOTIFICATION_FROM_EMAIL, APP_BASE_URL");
  return createFallbackNotificationProvider(directory, push, email);
}
