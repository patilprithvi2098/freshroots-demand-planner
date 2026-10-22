"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLinks({ links }: { links: { href: string; label: string }[] }) {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="flex flex-wrap gap-1 text-sm">
      {links.map((l) => {
        const active = path === l.href || path.startsWith(`${l.href}/`);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-md px-2.5 py-1.5 focus-visible:outline-2 focus-visible:outline-brand-700 ${active ? "bg-brand-50 font-medium text-brand-800" : "text-neutral-700 hover:bg-neutral-100"}`}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
