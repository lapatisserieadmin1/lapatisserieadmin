import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { strayResetLink } from "@/lib/password-reset";

const PROTECTED_PREFIXES = ["/admin", "/print", "/kitchen"];

// Refreshes the Supabase session cookie on every request and sends signed-out
// visitors to /login. Role checks happen in the admin layout and pages.
export async function proxy(request: NextRequest) {
  // A password-reset link that Supabase sent to the home page (its Site URL) instead of /auth/callback.
  const resetLink = strayResetLink(request.nextUrl.pathname, request.nextUrl.searchParams);
  if (resetLink) return NextResponse.redirect(new URL(resetLink, request.url));

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
          Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
        },
      },
    },
  );

  // Do not add code between client creation and getClaims(); it refreshes the token.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);

  const path = request.nextUrl.pathname;
  if (!signedIn && PROTECTED_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(path)}`;
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|site/|api/site/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif)$).*)"],
};
