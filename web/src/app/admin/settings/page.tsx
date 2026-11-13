import type { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Alert, Card, PageHeader } from "@/components/ui";
import { SettingsForm } from "./settings-form";
import { ClosureForm, HoursForm, RemoveClosureButton } from "./hours-forms";
import { getBusinessTimezone } from "@/lib/settings";
import { formatDayHeading, zonedDayKey } from "@/lib/time";
import { formatClock } from "@/lib/capacity";
import { CategoryCapsForm, DateOverrideForm, RemoveOverrideButton, WeekdayWindowsForm } from "./capacity-forms";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  await requireRole(["admin"]);
  const supabase = await createClient();
  const tz = await getBusinessTimezone();
  const today = zonedDayKey(new Date(), tz);
  const [{ data: settings, error }, { data: hours }, { data: closures }, { data: windows }, { data: categories }, { data: caps }, { data: overrides }] =
    await Promise.all([
      supabase.from("business_settings").select("*").single(),
      supabase.from("business_hours").select("*").order("weekday"),
      supabase.from("closures").select("*").gte("closed_on", today).order("closed_on"),
      supabase.from("pickup_windows").select("weekday, starts_at, ends_at, max_orders"),
      supabase.from("categories").select("id, name").eq("is_active", true).order("sort_order").order("name"),
      supabase.from("category_daily_caps").select("category_id, max_orders"),
      supabase.from("capacity_overrides").select("id, on_date, kind, starts_at, ends_at, max_orders, note, categories(name)").gte("on_date", today).order("on_date").order("starts_at"),
    ]);
  const overrideDays = [...new Set((overrides ?? []).map((o) => o.on_date))];

  return (
    <>
      <PageHeader title="Settings" description="Business details used on bills and the calendar." />
      {error || !settings ? (
        <Alert tone="danger" title="Could not load settings">{error?.message}</Alert>
      ) : (
        <div className="flex flex-col gap-6">
          <Card>
            <SettingsForm settings={settings} />
          </Card>
          <Card>
            <h2 className="text-lg font-semibold">Fixed for the first release</h2>
            <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted">Timezone</dt>
                <dd className="font-medium">{settings.timezone}</dd>
              </div>
              <div>
                <dt className="text-muted">Currency</dt>
                <dd className="font-medium">{settings.currency}</dd>
              </div>
            </dl>
          </Card>
          <Card>
            <h2 className="text-lg font-semibold">Opening hours</h2>
            <p className="mb-3 mt-1 text-sm text-muted">Pickup times outside these hours are refused unless an admin overrides with a reason.</p>
            <HoursForm hours={hours ?? []} />
          </Card>
          <Card>
            <h2 className="text-lg font-semibold">Closures</h2>
            <p className="mb-4 mt-1 text-sm text-muted">Holidays and one-off closed days. No pickups can be booked on these dates.</p>
            <ClosureForm />
            {closures && closures.length > 0 && (
              <ul className="mt-4 divide-y divide-line">
                {closures.map((c) => (
                  <li key={c.closed_on} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span>
                      <span className="font-medium">{formatDayHeading(c.closed_on)}</span> · {c.reason}
                    </span>
                    <RemoveClosureButton closedOn={c.closed_on} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <h2 className="text-lg font-semibold">Pickup windows</h2>
            <p className="mb-4 mt-1 text-sm text-muted">
              Time windows customers can pick up in, with the most orders each window takes. A day with no windows accepts any time within opening hours. Full windows can only be booked by an admin with a reason.
            </p>
            <WeekdayWindowsForm windows={windows ?? []} />
          </Card>
          <Card>
            <h2 className="text-lg font-semibold">Daily category caps</h2>
            <p className="mb-4 mt-1 text-sm text-muted">Most orders per day that include this category, e.g. 8 custom cakes. Leave blank for no cap.</p>
            {categories && categories.length > 0 ? (
              <CategoryCapsForm categories={categories} caps={Object.fromEntries((caps ?? []).map((c) => [c.category_id, c.max_orders]))} />
            ) : (
              <p className="text-sm text-muted">Add categories in Products first.</p>
            )}
          </Card>
          <Card>
            <h2 className="text-lg font-semibold">Festival and special days</h2>
            <p className="mb-4 mt-1 text-sm text-muted">Replace one date&apos;s windows, or change one category&apos;s cap for that date. Use Closures for days the bakery is shut.</p>
            <DateOverrideForm categories={categories ?? []} minDate={today} />
            {overrideDays.length > 0 && (
              <ul className="mt-4 divide-y divide-line">
                {overrideDays.map((day) => {
                  const rows = (overrides ?? []).filter((o) => o.on_date === day);
                  const windowRows = rows.filter((o) => o.kind === "window");
                  return (
                    <li key={day} className="flex flex-col gap-1 py-2 text-sm">
                      <span className="font-medium">{formatDayHeading(day)}</span>
                      {windowRows.length > 0 && (
                        <div className="flex items-center justify-between gap-3">
                          <span>
                            {windowRows[0].note}: windows{" "}
                            {windowRows.map((w) => `${formatClock(w.starts_at!.slice(0, 5))}–${formatClock(w.ends_at!.slice(0, 5))}${w.max_orders === null ? "" : ` (${w.max_orders})`}`).join(", ")}
                          </span>
                          <RemoveOverrideButton onDate={day} kind="window" />
                        </div>
                      )}
                      {rows.filter((o) => o.kind === "category").map((c) => (
                        <div key={c.id} className="flex items-center justify-between gap-3">
                          <span>{c.note}: {c.categories?.name} cap {c.max_orders}</span>
                          <RemoveOverrideButton onDate={day} kind="category" id={c.id} />
                        </div>
                      ))}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
