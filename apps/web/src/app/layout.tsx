import { SocketProvider } from "@/lib/socket";
import { DashboardLayoutWrapper } from "@/components/DashboardLayoutWrapper";
import "./globals.css";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased bg-white text-slate-900 h-screen overflow-hidden flex">
        <SocketProvider>
          <DashboardLayoutWrapper>
            {children}
          </DashboardLayoutWrapper>
        </SocketProvider>
      </body>
    </html>
  );
}
