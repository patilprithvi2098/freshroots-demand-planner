import { redirect } from "next/navigation";
import { LogOut, Sprout } from "lucide-react";
import { getSessionProfile, type Role } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { displayName } from "@/lib/usernames";
import { NavLinks, type NavIcon } from "@/components/NavLinks";

const NAV: { href: string; label: string; icon: NavIcon; roles: Role[]; also?: string[] }[] = [
  { href: "/overview", label: "Overview", icon: "overview", roles: ["planner"] },
  { href: "/queue", label: "Review", icon: "review", roles: ["planner"] },
  { href: "/procurement", label: "Orders", icon: "orders", roles: ["planner", "procurement"] },
  { href: "/data", label: "Data", icon: "data", roles: ["planner"], also: ["/upload", "/runs"] },
  { href: "/dashboard", label: "Performance", icon: "performance", roles: ["planner", "viewer"], also: ["/backtest"] },
  { href: "/settings", label: "Rules", icon: "settings", roles: ["planner"] },
];

async function pendingCount(): Promise<number> {
  const db = await createClient();
  const { data: run } = await db.from("runs").select("id").eq("status", "completed").order("run_date", { ascending: false }).limit(1).maybeSingle();
  if (!run) return 0;
  const { count } = await db
    .from("recommendations")
    .select("id", { count: "exact", head: true })
    .eq("run_id", run.id)
    .eq("status", "pending")
    .or("flag.neq.no_action,is_exception.eq.true");
  return count ?? 0;
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  const pending = session.role === "planner" ? await pendingCount() : 0;
  const links = NAV.filter((n) => n.roles.includes(session.role)).map(({ href, label, icon, also }) => ({
    href,
    label,
    icon,
    also,
    badge: href === "/queue" ? pending : undefined,
  }));
  const name = displayName(session.email);

  return (
    <div className="min-h-screen lg:flex">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">
        Skip to content
      </a>
      <aside className="border-b border-neutral-200 bg-white lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-60 lg:shrink-0 lg:flex-col lg:border-r lg:border-b-0">
        <div className="flex items-center gap-2 px-4 pt-4 pb-3 lg:px-5 lg:pt-6 lg:pb-6">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-700 text-white">
            <Sprout aria-hidden className="h-4.5 w-4.5" />
          </span>
          <div className="leading-tight">
            <p className="text-sm font-semibold">Freshroots</p>
            <p className="text-xs text-neutral-600">Demand planning</p>
          </div>
          <form action="/auth/signout" method="post" className="ml-auto lg:hidden">
            <button className="rounded-lg p-2 text-neutral-600 hover:bg-neutral-100" aria-label="Sign out">
              <LogOut className="h-4 w-4" />
            </button>
          </form>
        </div>
        <div className="px-3 pb-3 lg:flex-1 lg:pb-0">
          <NavLinks links={links} />
        </div>
        <div className="hidden border-t border-neutral-200 px-5 py-4 lg:block">
          <p className="text-sm font-medium capitalize">{name}</p>
          <p className="text-xs capitalize text-neutral-600">{session.role}</p>
          <form action="/auth/signout" method="post" className="mt-2">
            <button className="flex items-center gap-1.5 rounded-md text-sm text-neutral-700 hover:text-neutral-950 focus-visible:outline-2 focus-visible:outline-emerald-700">
              <LogOut aria-hidden className="h-4 w-4" /> Sign out
            </button>
          </form>
        </div>
      </aside>
      <main id="main" className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
