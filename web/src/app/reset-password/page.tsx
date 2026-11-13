import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Alert, Brand } from "@/components/ui";
import { NewPasswordForm } from "../forgot-password/forms";

export const metadata: Metadata = { title: "Set a new password" };

// Reached from the reset email (via /auth/callback), which signed the person in on this device.
export default async function ResetPasswordPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <Brand />
          <h1 className="mt-8 text-2xl font-semibold">Set a new password</h1>
          {data.user?.email && <p className="mt-1 text-sm text-muted">For {data.user.email}</p>}
        </div>
        {data.user ? (
          <div className="rounded-2xl border border-line bg-surface p-6 shadow-[0_8px_30px_-16px_rgba(176,58,94,0.28)]">
            <NewPasswordForm />
          </div>
        ) : (
          <Alert tone="warn" title="This link has expired">
            Reset links work once, for one hour.{" "}
            <Link href="/forgot-password" className="font-medium underline">Ask for a new one</Link>.
          </Alert>
        )}
      </div>
    </main>
  );
}
