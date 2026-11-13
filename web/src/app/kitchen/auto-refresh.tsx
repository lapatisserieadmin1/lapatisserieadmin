"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const EVERY_MS = 60_000;

// Reloads the chef screen every minute (new and changed orders) and says when it last did.
export function AutoRefresh({ loadedAt, tz }: { loadedAt: string; tz: string }) {
  const router = useRouter();
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const tick = () => {
      if (navigator.onLine) router.refresh();
    };
    const id = window.setInterval(tick, EVERY_MS);
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    window.addEventListener("focus", tick);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      window.removeEventListener("focus", tick);
    };
  }, [router]);

  const time = new Intl.DateTimeFormat("en-IN", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(loadedAt));
  return (
    <p role="status" className={offline ? "whitespace-nowrap rounded-full bg-danger-soft px-3 py-1 text-sm font-medium text-danger" : "whitespace-nowrap text-sm text-muted"}>
      {offline ? `Offline · showing ${time}` : <>Updated {time}<span className="hidden sm:inline"> · refreshes every minute</span></>}
    </p>
  );
}
