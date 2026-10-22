"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Database, Gauge, LayoutDashboard, ListChecks, Settings, Truck } from "lucide-react";

const ICONS = {
  overview: LayoutDashboard,
  review: ListChecks,
  orders: Truck,
  data: Database,
  performance: Gauge,
  settings: Settings,
};

export type NavIcon = keyof typeof ICONS;

export function NavLinks({ links }: { links: { href: string; label: string; icon: NavIcon; badge?: number; also?: string[] }[] }) {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
      {links.map((l) => {
        const active = [l.href, ...(l.also ?? [])].some((h) => path === h || path.startsWith(`${h}/`));
        const Icon = ICONS[l.icon];
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={`flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-emerald-700 ${
              active ? "bg-emerald-50 text-emerald-900" : "text-neutral-700 hover:bg-neutral-100"
            }`}
          >
            <Icon aria-hidden className={`h-4 w-4 ${active ? "text-emerald-700" : "text-neutral-500"}`} />
            <span>{l.label}</span>
            {l.badge ? (
              <span className="ml-auto rounded-full bg-emerald-700 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white" aria-label={`${l.badge} to decide`}>
                {l.badge}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
