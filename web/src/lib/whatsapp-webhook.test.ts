import { test } from "node:test";
import assert from "node:assert/strict";
import { signBody, statusUpdates, validSignature, verifyChallenge } from "./whatsapp-webhook.ts";

test("webhook signature: only Meta's app secret signature is accepted", () => {
  const body = JSON.stringify({ entry: [] });
  const sig = signBody("app-secret", body);
  assert.match(sig, /^sha256=[0-9a-f]{64}$/);
  assert.equal(validSignature("app-secret", body, sig), true);
  assert.equal(validSignature("app-secret", body + " ", sig), false);
  assert.equal(validSignature("other", body, sig), false);
  assert.equal(validSignature(undefined, body, sig), false);
  assert.equal(validSignature("app-secret", body, null), false);
  assert.equal(validSignature("app-secret", body, "sha256=short"), false);
});

test("webhook check: the challenge comes back only with the right verify token", () => {
  const p = (token: string) => new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": token, "hub.challenge": "1234" });
  assert.equal(verifyChallenge(p("tok"), "tok"), "1234");
  assert.equal(verifyChallenge(p("bad"), "tok"), null);
  assert.equal(verifyChallenge(p("tok"), undefined), null);
});

test("webhook statuses: delivered, read and failed with Meta's reason; junk ignored", () => {
  const payload = {
    entry: [{
      changes: [{
        value: {
          statuses: [
            { id: "wamid.1", status: "delivered" },
            { id: "wamid.2", status: "read" },
            { id: "wamid.3", status: "failed", errors: [{ title: "Re-engagement message", error_data: { details: "More than 24 hours since the customer replied." } }] },
            { id: "wamid.4", status: "deleted" },
            { status: "read" },
          ],
        },
      }, { value: { messages: [{ id: "x" }] } }],
    }],
  };
  assert.deepEqual(statusUpdates(payload), [
    { messageId: "wamid.1", status: "delivered", problem: null },
    { messageId: "wamid.2", status: "read", problem: null },
    { messageId: "wamid.3", status: "failed", problem: "More than 24 hours since the customer replied." },
  ]);
  assert.deepEqual(statusUpdates(null), []);
  assert.deepEqual(statusUpdates({ entry: "x" }), []);
});
