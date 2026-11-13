import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { RESET_PATH, linkProblem } from "@/lib/password-reset";

// The link in a "reset your password" email ends here: it signs the person in (only on this device)
// so /reset-password can set the new password. Handles both link styles Supabase sends.
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const fail = (why: string) => NextResponse.redirect(new URL(`/forgot-password?${new URLSearchParams({ problem: why })}`, url));

  const problem = linkProblem(url.searchParams);
  if (problem) return fail(problem);

  const supabase = await createClient();
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const { error } = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : tokenHash && url.searchParams.get("type") === "recovery"
      ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "recovery" })
      : { error: new Error("missing") };
  if (error) return fail("This reset link has expired or was already used. Ask for a new one.");

  return NextResponse.redirect(new URL(RESET_PATH, url));
}
