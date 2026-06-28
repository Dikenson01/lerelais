"use client";

import { usePathname } from "next/navigation";
import { Sidebar } from "./Sidebar";
import { AuthProvider } from "./AuthProvider";

export function DashboardLayoutWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAuthPage = pathname === '/login' || pathname === '/register';

  if (isAuthPage) {
    return <AuthProvider>{children}</AuthProvider>;
  }

  return (
    <AuthProvider>
      <div className="flex flex-col md:flex-row h-full w-full relative">
        <Sidebar />
        <main className="flex-1 flex flex-col min-w-0 bg-white pb-16 md:pb-0 overflow-hidden relative">
          {children}
        </main>
      </div>
    </AuthProvider>
  );
}
