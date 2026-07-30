'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

/**
 * The course tab bar, with two things the plain server-rendered links
 * could not give: which tab you are on, and which tab you are waiting
 * for.
 *
 * The pending mark matters most on Attainment, which recomputes the ten
 * steps from every mark in the course. Without it, clicking the tab looks
 * like nothing happened until the whole page swaps.
 *
 * `useLinkStatus` would be the direct way to do this, but in this Next
 * version it is not reachable from the public `next/link` entry point.
 * The pathname serves instead: a click records the tab we are heading
 * for, and the arrival of ANY new pathname clears it — so a redirect or
 * a failed navigation cannot leave a tab spinning for ever.
 */
export interface CourseTab {
  href: string;
  label: string;
}

export function CourseTabs({ tabs, basePath }: { tabs: CourseTab[]; basePath: string }) {
  const pathname = usePathname();
  const [target, setTarget] = useState<string | null>(null);

  useEffect(() => {
    setTarget(null);
  }, [pathname]);

  const isActive = (href: string) =>
    href === basePath ? pathname === basePath : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav className="border-b border-gray-300 flex gap-1">
      {tabs.map((tab) => {
        const active = isActive(tab.href);
        const pending = target === tab.href && !active;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            aria-busy={pending || undefined}
            onClick={() => {
              if (!active) setTarget(tab.href);
            }}
            className={`px-3 py-1.5 border border-b-0 rounded-t flex items-center gap-1.5 ${
              active
                ? 'border-gray-300 bg-blue-50 text-blue-800 font-medium'
                : 'border-gray-300 bg-white text-gray-700 hover:text-blue-700'
            }`}
          >
            {tab.label}
            {/*
              The spinner occupies a reserved slot whether or not it is
              spinning, so the tab bar cannot reflow mid-click.
            */}
            <span aria-hidden="true" className="inline-block h-3 w-3">
              {pending ? (
                <span className="block h-3 w-3 rounded-full border-2 border-gray-300 border-t-blue-700 animate-spin" />
              ) : null}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
