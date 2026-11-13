import type { Metadata } from "next";
import Link from "next/link";
import { Alert, Brand } from "@/components/ui";
import { ForgotForm } from "./forms";

export const metadata: Metadata = { title: "Forgot password" };

export default async function ForgotPasswordPage({ searchParams }: PageProps<"/forgot-password">) {
  const { problem } = await searchParams;
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <Brand />
          <h1 className="mt-8 text-2xl font-semibold">Forgot your password?</h1>
          <p className="mt-1 text-sm text-muted">We&apos;ll email you a link to set a new one.</p>
        </div>
        {typeof problem === "string" && (
          <div className="mb-4">
            <Alert tone="warn" title="That link did not work">{problem}</Alert>
          </div>
        )}
        <div className="rounded-2xl border border-line bg-surface p-6 shadow-[0_8px_30px_-16px_rgba(176,58,94,0.28)]">
          <ForgotForm />
        </div>
        <p className="mt-6 text-center text-sm">
          <Link href="/login" className="font-medium text-brand-strong hover:underline">← Back to sign in</Link>
        </p>
        <p className="mt-3 text-center text-xs text-muted">No email arriving? An admin can also set a new password on the Staff page.</p>
      </div>
    </main>
  );
}
