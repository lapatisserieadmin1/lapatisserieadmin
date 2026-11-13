import { createPublicClient } from "@/lib/supabase/server";
import { whatsappCloudConfig } from "@/lib/whatsapp-cloud";
import { statusUpdates, validSignature, verifyChallenge } from "@/lib/whatsapp-webhook";

// Meta calls this with the delivery status of the Terms the server sent (owner, 2026-11-07). Public by
// necessity, so every call must carry Meta's signature made with WHATSAPP_APP_SECRET.
function appSecret(): string | undefined {
  return process.env.WHATSAPP_APP_SECRET?.trim() || (whatsappCloudConfig()?.testMode ? "local-test-app-secret" : undefined);
}

export async function GET(request: Request) {
  const challenge = verifyChallenge(new URL(request.url).searchParams, process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN?.trim());
  return challenge ? new Response(challenge, { headers: { "Content-Type": "text/plain" } }) : new Response("Forbidden", { status: 403 });
}

export async function POST(request: Request) {
  const raw = await request.text();
  if (!validSignature(appSecret(), raw, request.headers.get("x-hub-signature-256"))) {
    return new Response("Forbidden", { status: 403 });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  const updates = statusUpdates(payload);
  if (updates.length) {
    const supabase = createPublicClient();
    for (const u of updates) {
      const { error } = await supabase.rpc("record_whatsapp_status", { p_message_id: u.messageId, p_status: u.status, p_problem: u.problem });
      if (error) console.error("whatsapp status not recorded", error.code, error.message);
    }
  }
  // Meta retries anything but 200, so known and unknown messages alike are acknowledged.
  return new Response("OK");
}
