// Meta's WhatsApp webhook (owner, 2026-11-07): delivery status of the messages the server sent (sent,
// delivered, read, failed). Meta signs every call with the app secret (X-Hub-Signature-256); unsigned or
// wrongly signed calls are refused. Pure: imported by unit tests.
import { createHmac, timingSafeEqual } from "node:crypto";

export type DeliveryStatus = "sent" | "delivered" | "read" | "failed";
export type StatusUpdate = { messageId: string; status: DeliveryStatus; problem: string | null };

const STATUSES = new Set<string>(["sent", "delivered", "read", "failed"]);

export function signBody(appSecret: string, rawBody: string): string {
  return `sha256=${createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex")}`;
}

export function validSignature(appSecret: string | undefined, rawBody: string, header: string | null): boolean {
  if (!appSecret || !header) return false;
  const expected = Buffer.from(signBody(appSecret, rawBody));
  const given = Buffer.from(header.trim());
  return expected.length === given.length && timingSafeEqual(expected, given);
}

// Meta's one-time check when the webhook is added: echo the challenge if the verify token matches.
export function verifyChallenge(params: URLSearchParams, verifyToken: string | undefined): string | null {
  if (!verifyToken) return null;
  if (params.get("hub.mode") !== "subscribe" || params.get("hub.verify_token") !== verifyToken) return null;
  return params.get("hub.challenge");
}

type Payload = {
  entry?: {
    changes?: {
      value?: {
        statuses?: { id?: unknown; status?: unknown; errors?: { title?: unknown; message?: unknown; error_data?: { details?: unknown } }[] }[];
      };
    }[];
  }[];
};

const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

export function statusUpdates(payload: unknown): StatusUpdate[] {
  const out: StatusUpdate[] = [];
  for (const entry of (payload as Payload)?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      for (const s of change?.value?.statuses ?? []) {
        const messageId = text(s?.id);
        const status = text(s?.status);
        if (!messageId || messageId.length > 200 || !status || !STATUSES.has(status)) continue;
        const e = s.errors?.[0];
        const problem = status === "failed" ? (text(e?.error_data?.details) ?? text(e?.message) ?? text(e?.title)) : null;
        out.push({ messageId, status: status as DeliveryStatus, problem: problem?.slice(0, 500) ?? null });
      }
    }
  }
  return out;
}
