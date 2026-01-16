import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AuthProvider } from "@/components/auth/AuthProvider";
import { DevUserSwitcher } from "@/components/dev/DevUserSwitcher";
import { DevUserSwitcherSpacer } from "@/components/dev/DevUserSwitcherSpacer";

export const metadata: Metadata = {
  title: "insido.ai",
  description: "Collective idea emergence and specification system with AI-driven chat and challenge management",
  keywords: ["ai", "chat", "collaboration", "design", "agentic", "webhooks", "insido"],
  authors: [{ name: "pmboutet" }],
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

/**
 * Root layout component for the application
 * Sets up global styling and metadata
 */
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Saira+Extra+Condensed:wght@700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="font-sans antialiased">
        <AuthProvider>
          <DevUserSwitcher />
          <DevUserSwitcherSpacer />
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
