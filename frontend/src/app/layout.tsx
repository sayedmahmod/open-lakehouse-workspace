import type { Metadata } from "next";
import React from "react";

import { AppShell } from "@/components/shell/AppShell";
import { ThemeProvider } from "@/components/shell/ThemeProvider";
import { ToastProvider } from "@/components/ui";
import "./globals.css";

export const metadata: Metadata = {
  title: "open-lakehouse",
  description: "Workspace for Unity Catalog, Spark and Delta Lake",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Applied before paint so the theme and accent never flash the defaults. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              `(function(){try{` +
              `var t=localStorage.getItem('ol-theme');` +
              `if(t==='dark'||t==='light'){document.documentElement.setAttribute('data-theme',t);}` +
              `var c=localStorage.getItem('ol-accent-css');` +
              `if(c){var s=document.createElement('style');s.id='ol-accent-style';s.textContent=c;document.head.appendChild(s);}` +
              `}catch(e){}})();`,
          }}
        />
      </head>
      <body>
        <ThemeProvider>
          <ToastProvider>
            <AppShell>{children}</AppShell>
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
