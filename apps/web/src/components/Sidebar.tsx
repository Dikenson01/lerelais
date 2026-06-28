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
    <aside className="fixed bottom-0 left-0 right-0 h-16 md:relative md:w-64 md:h-full flex-shrink-0 border-t md:border-t-0 md:border-r border-slate-200 bg-slate-50 flex flex-row md:flex-col z-50">
      <div className="hidden md:flex h-16 items-center justify-center md:justify-start px-4 border-b border-slate-200">
        <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center flex-shrink-0">
          <span className="text-white font-bold text-xl">L</span>
        </div>
        <span className="ml-3 font-bold text-slate-800">LeRelais</span>
      </div>

      <nav className="flex-1 overflow-y-auto overflow-x-hidden md:py-4">
        <ul className="flex flex-row md:flex-col justify-around md:justify-start h-full md:space-y-1 md:px-2">
          {links.map((link) => {
            const Icon = link.icon;
            const isActive = pathname === link.href;

            return (
              <li key={link.name} className="flex-1 md:flex-none">
                <Link
                  href={link.href}
                  className={clsx(
                    "flex flex-col md:flex-row items-center justify-center md:justify-start px-2 py-2 md:px-3 md:py-2.5 h-full md:h-auto md:rounded-lg transition-colors group",
                    isActive
                      ? "bg-blue-50 text-blue-700 md:bg-blue-50"
                      : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                  )}
                >
                  <Icon className={clsx("w-6 h-6 md:w-5 md:h-5 flex-shrink-0", isActive ? "text-blue-700" : "text-slate-500 group-hover:text-slate-700")} />
                  <span className={clsx("text-[10px] md:text-base font-medium mt-1 md:mt-0 md:ml-3 md:block", isActive ? "block font-bold text-blue-700" : "hidden")}>{link.name}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="hidden md:block p-4 border-t border-slate-200">
        <button className="flex items-center text-slate-600 hover:text-slate-900 w-full px-2 py-2 rounded-lg hover:bg-slate-100 transition-colors">
          <HelpCircle className="w-5 h-5 text-slate-500" />
          <span className="ml-3 font-medium">Help & Support</span>
        </button>
      </div>
    </aside>
  );
}
