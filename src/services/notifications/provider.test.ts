import test from "node:test";
import assert from "node:assert/strict";
import { createFallbackNotificationProvider, type NotificationRecipientDirectory } from "./provider.js";
import type { NotificationDelivery } from "./outbox.js";

const delivery: NotificationDelivery = {
  recipientId: "parent", playerId: "player", eventIds: ["event"], idempotencyKey: "key", body: "Report ready",
};

function directory(tokens: string[], address = "parent@example.test") {
  const disabled: string[] = [];
  const value: NotificationRecipientDirectory = {
    pushTokens: async () => tokens,
    email: async () => address,
    disablePushToken: async (token) => { disabled.push(token); },
  };
  return { value, disabled };
}

test("successful native push does not disclose the recipient email", async () => {
  const dir = directory(["device-token"]);
  let emailLookups = 0;
  dir.value.email = async () => { emailLookups += 1; return "parent@example.test"; };
  const provider = createFallbackNotificationProvider(dir.value,
    { send: async () => "sent" }, { send: async () => assert.fail("email must not send") });
  await provider.send(delivery);
  assert.equal(emailLookups, 0);
});

test("invalid native tokens are disabled before email fallback", async () => {
  const dir = directory(["expired-token"]);
  const emails: string[] = [];
  const provider = createFallbackNotificationProvider(dir.value,
    { send: async () => "invalid" }, { send: async (address) => { emails.push(address); } });
  await provider.send(delivery);
  assert.deepEqual(dir.disabled, ["expired-token"]);
  assert.deepEqual(emails, ["parent@example.test"]);
});

test("a transient push failure can fall back to email and no channel fails closed", async () => {
  const dir = directory(["device-token"]);
  let emails = 0;
  const provider = createFallbackNotificationProvider(dir.value,
    { send: async () => { throw new Error("FCM unavailable"); } }, { send: async () => { emails += 1; } });
  await provider.send(delivery);
  assert.equal(emails, 1);

  const none = directory([], "");
  await assert.rejects(createFallbackNotificationProvider(none.value, null, null).send(delivery), /No notification channel/);
});
