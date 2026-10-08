import type { NotificationDelivery } from "./outbox.js";
import type { NotificationProvider } from "./dispatcher.js";

export interface NotificationRecipientDirectory {
  pushTokens(userId: string): Promise<string[]>;
  email(userId: string): Promise<string | null>;
  disablePushToken(token: string): Promise<void>;
}

export interface PushNotificationChannel {
  send(token: string, delivery: NotificationDelivery): Promise<"sent" | "invalid">;
}

export interface EmailNotificationChannel {
  send(email: string, delivery: NotificationDelivery): Promise<void>;
}

/** Prefer native push and fall back to email only when no registered device
 * accepts the message. The dispatcher records one receipt per recipient after
 * this method completes, independent of the chosen channel. */
export function createFallbackNotificationProvider(directory: NotificationRecipientDirectory,
  push: PushNotificationChannel | null, email: EmailNotificationChannel | null): NotificationProvider {
  return {
    async send(delivery) {
      const errors: string[] = [];
      if (push) {
        for (const token of await directory.pushTokens(delivery.recipientId)) {
          try {
            const result = await push.send(token, delivery);
            if (result === "sent") return;
            await directory.disablePushToken(token);
          } catch (error) {
            errors.push(error instanceof Error ? error.message : String(error));
          }
        }
      }
      if (email) {
        const address = await directory.email(delivery.recipientId);
        if (address) {
          await email.send(address, delivery);
          return;
        }
      }
      throw new Error(errors.length ? `No notification channel completed: ${errors.join("; ")}`
        : "No notification channel is configured for this recipient");
    },
  };
}
