"use client";

import React, { useEffect, useState } from "react";

import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem("ol-sidebar") === "collapsed");
    } catch {
      /* non-fatal */
    }
  }, []);

  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("ol-sidebar", next ? "collapsed" : "expanded");
      } catch {
        /* non-fatal */
      }
      return next;
    });
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <Sidebar collapsed={collapsed} onToggle={toggle} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="min-h-0 flex-1 overflow-y-auto" style={{ background: "var(--bg-primary)" }}>
          {children}
        </main>
      </div>
    </div>
  );
}
