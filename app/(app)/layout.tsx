import { redirect } from "next/navigation";
import { getSessionProfile, type Role } from "@/lib/auth";
import { NavLinks } from "@/components/NavLinks";
import { displayName } from "@/lib/usernames";

const NAV: { href: string; label: string; roles: Role[] }[] = [
  { href: "/queue", label: "Review queue", roles: ["planner"] },
  { href: "/upload", label: "Upload", roles: ["planner"] },
  { href: "/runs", label: "Runs", roles: ["planner"] },
  { href: "/procurement", label: "Procurement", roles: ["planner", "procurement"] },
  { href: "/backtest", label: "Backtest", roles: ["planner"] },
  { href: "/dashboard", label: "Dashboard", roles: ["planner", "viewer"] },
  { href: "/settings", label: "Settings", roles: ["planner"] },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  const links = NAV.filter((n) => n.roles.includes(session.role)).map(({ href, label }) => ({ href, label }));
  return (
    <div className="min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:rounded focus:bg-white focus:px-3 focus:py-2">
        Skip to content
      </a>
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <span className="font-semibold text-brand-800">Freshroots Planning</span>
          <NavLinks links={links} />
          <div className="ml-auto flex items-center gap-3 text-sm text-neutral-600">
            <span className="hidden sm:inline">
              {displayName(session.email)} · <span className="capitalize">{session.role}</span>
            </span>
            <form action="/auth/signout" method="post">
              <button className="rounded px-2 py-1 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-brand-700">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-7xl px-4 py-8">
        {children}
      </main>
    </div>
  );
}
