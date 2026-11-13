"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/database.types";

// The signed-in staff member's client in the browser (row-level security and storage policies apply).
// Used only to upload photos straight to Storage: they are too large to pass through a server action.
let client: ReturnType<typeof createBrowserClient<Database>> | null = null;

export function browserClient() {
  client ??= createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
  return client;
}
