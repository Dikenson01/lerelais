"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MessageSquare, Users, Settings, Megaphone, HelpCircle } from "lucide-react";
import { clsx } from "clsx";

export function Sidebar() {
  const pathname = usePathname();

  const links = [
    { name: "Inbox", href: "/", icon: MessageSquare },
    { name: "Contacts", href: "/contacts", icon: Users },
    { name: "Campaigns", href: "/campaigns", icon: Megaphone },
    { name: "Settings", href: "/settings", icon: Settings },
  ];

  return (
    <aside className="w-16 md:w-64 flex-shrink-0 border-r border-slate-200 bg-slate-50 flex flex-col h-full">
      <div className="h-16 flex items-center justify-center md:justify-start px-4 border-b border-slate-200">
        <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center flex-shrink-0">
          <span className="text-white font-bold text-xl">L</span>
        </div>
        <span className="ml-3 font-bold text-slate-800 hidden md:block">LeRelais</span>
      </div>

      <nav className="flex-1 py-4 overflow-y-auto">
        <ul className="space-y-1 px-2">
          {links.map((link) => {
            const Icon = link.icon;
            const isActive = pathname === link.href;

            return (
              <li key={link.name}>
                <Link
                  href={link.href}
                  className={clsx(
                    "flex items-center px-3 py-2.5 rounded-lg transition-colors group",
                    isActive
                      ? "bg-blue-50 text-blue-700"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  )}
                >
                  <Icon className={clsx("w-5 h-5 flex-shrink-0", isActive ? "text-blue-700" : "text-slate-500 group-hover:text-slate-700")} />
                  <span className="ml-3 font-medium hidden md:block">{link.name}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="p-4 border-t border-slate-200">
        <button className="flex items-center text-slate-600 hover:text-slate-900 w-full px-2 py-2 rounded-lg hover:bg-slate-100 transition-colors">
          <HelpCircle className="w-5 h-5 text-slate-500" />
          <span className="ml-3 font-medium hidden md:block">Help & Support</span>
        </button>
      </div>
    </aside>
  );
}
