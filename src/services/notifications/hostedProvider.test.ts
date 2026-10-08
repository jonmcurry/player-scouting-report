import test from "node:test";
import assert from "node:assert/strict";
import { createFcmChannel, createResendChannel } from "./hostedProvider.js";
import type { NotificationDelivery } from "./outbox.js";

const delivery: NotificationDelivery = {
  recipientId: "recipient-id", playerId: "player-id", eventIds: ["event-id"],
  idempotencyKey: "hl-0123456789abcdef0123456789abcdef", body: "Maya's <report> is ready.",
};

test("Resend receives the opaque idempotency key and escaped one-player content", async () => {
  let request: RequestInit | undefined;
  const channel = createResendChannel("secret", "HitterLoop <reports@example.test>", "https://app.example.test/coach/",
    async (_url, init) => { request = init; return new Response("{}", { status: 200 }); });
  await channel.send("parent@example.test", delivery);
  const headers = request!.headers as Record<string, string>;
  assert.equal(headers["Idempotency-Key"], delivery.idempotencyKey);
  const body = JSON.parse(String(request!.body));
  assert.deepEqual(body.to, ["parent@example.test"]);
  assert.match(body.text, /player=player-id/);
  assert.match(body.html, /Maya&#39;s &lt;report&gt; is ready/);
  assert.doesNotMatch(JSON.stringify(body), /recipient-id|event-id/);
});

test("FCM invalid-token responses are classified for disable-and-fallback", async () => {
  let sent: Record<string, unknown> | undefined;
  const auth = { getClient: async () => ({ getAccessToken: async () => ({ token: "access" }) }) };
  const channel = createFcmChannel("project", async (_url, init) => {
    sent = JSON.parse(String(init?.body));
    return new Response('{"error":{"status":"NOT_FOUND","details":[{"errorCode":"UNREGISTERED"}]}}', { status: 404 });
  }, auth as never);
  assert.equal(await channel.send("expired-device-token", delivery), "invalid");
  assert.deepEqual((sent!.message as { data: unknown }).data,
    { playerId: "player-id", idempotencyKey: delivery.idempotencyKey });
  assert.doesNotMatch(JSON.stringify(sent), /recipient-id|event-id/);
});
