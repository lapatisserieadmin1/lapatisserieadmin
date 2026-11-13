import { test } from "node:test";
import assert from "node:assert/strict";
import { LIVE_ORIGIN, linkProblem, resetRedirectUrl, strayResetLink, trustedOrigin } from "./password-reset.ts";

test("the reset link comes back to this site's callback", () => {
  assert.equal(resetRedirectUrl("https://bakery-admin-ten.vercel.app"), "https://bakery-admin-ten.vercel.app/auth/callback");
  assert.equal(resetRedirectUrl("http://localhost:3123/"), "http://localhost:3123/auth/callback");
});

test("a reset link that lands elsewhere is forwarded to the callback", () => {
  assert.equal(strayResetLink("/", new URLSearchParams("code=0f8fad5b-d9cb-469f")), "/auth/callback?code=0f8fad5b-d9cb-469f");
  assert.equal(strayResetLink("/login", new URLSearchParams("token_hash=abc123&type=recovery")), "/auth/callback?token_hash=abc123&type=recovery");
  assert.equal(strayResetLink("/auth/callback", new URLSearchParams("code=0f8fad5b-d9cb")), null);
  assert.equal(strayResetLink("/", new URLSearchParams("token_hash=abc&type=signup")), null);
  assert.equal(strayResetLink("/admin", new URLSearchParams("q=cake")), null);
  assert.equal(strayResetLink("/", new URLSearchParams("code=<script>")), null);
});

test("Supabase link errors are read out", () => {
  assert.equal(linkProblem(new URLSearchParams("error=access_denied&error_description=Email+link+is+invalid+or+has+expired")), "Email link is invalid or has expired");
  assert.equal(linkProblem(new URLSearchParams("")), null);
});

test("the reset link never follows a forged host", () => {
  assert.equal(trustedOrigin(undefined, "evil.example.com", false), LIVE_ORIGIN);
  assert.equal(trustedOrigin(undefined, "evil.example.com", true), LIVE_ORIGIN);
  assert.equal(trustedOrigin(undefined, "localhost:3123", false), LIVE_ORIGIN);
  assert.equal(trustedOrigin(undefined, "localhost:3123", true), "http://localhost:3123");
  assert.equal(trustedOrigin("https://shop.example.in/", "evil.example.com", false), "https://shop.example.in");
  assert.equal(trustedOrigin("not a url", null, false), LIVE_ORIGIN);
});
