import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getStaff, homeFor } from "@/lib/auth";
import Image from "next/image";
import Link from "next/link";
import { Wordmark } from "@/components/ui";
import { SHOP_NAME } from "@/lib/brand";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Staff sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const staff = await getStaff();
  if (staff) redirect(homeFor(staff.role));

  const { next } = await searchParams;

  return (
    <main className="relative isolate flex flex-1 items-center justify-center px-5 py-10 sm:py-16">
      {/* The icing drip fills the screen; the sign-in card sits on its cream centre. Unoptimized: the file is
          already an upscaled 3840×2160 WebP, and re-encoding it softens the drips. */}
      <div aria-hidden className="fixed inset-0 -z-10 bg-cream">
        <Image src="/brand/drip-bg.webp" alt="" fill priority unoptimized className="object-cover object-center" />
      </div>

      <div className="relative w-full max-w-md px-6 py-8 sm:px-10 sm:py-10 [&_input]:border-[#efe2d6] [&_input]:bg-[#fef9f3]/80">
        {/* A glow in the picture's own cream (#fef9f3) that fades out, so the form has no box edge. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-x-[30%] -inset-y-[18%] -z-10 bg-[radial-gradient(closest-side,rgba(254,249,243,0.95)_0%,rgba(254,249,243,0.75)_55%,rgba(254,249,243,0)_100%)]"
        />
        <h1 className="sr-only">{SHOP_NAME} staff sign in</h1>
        <div className="flex justify-center">
          <Wordmark />
        </div>
        <div className="mt-6 text-center">
          <p className="font-caps text-[11px] uppercase tracking-[0.3em] text-accent-strong">Staff portal</p>
          <p className="mt-2 font-display text-3xl">Welcome back</p>
        </div>
        <div className="mt-7">
          <LoginForm next={typeof next === "string" ? next : undefined} />
        </div>
        <p className="mt-6 text-center text-sm">
          <Link href="/forgot-password" className="font-medium text-brand-strong hover:underline">Forgot password?</Link>
        </p>
      </div>
    </main>
  );
}
