import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_TIMEZONE } from "@/lib/time";

export const getBusinessTimezone = cache(async (): Promise<string> => {
  const supabase = await createClient();
  const { data } = await supabase.from("business_settings").select("timezone").maybeSingle();
  return data?.timezone ?? DEFAULT_TIMEZONE;
});
