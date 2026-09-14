"use client";

import type { ReactNode } from "react";
import { MessengerProvider } from "@/components/messenger/MessengerProvider";
import { MessengerWidget } from "@/components/messenger/MessengerUi";
import PlatformShell from "@/components/platform/PlatformShell";
import RouteTitle from "@/components/platform/RouteTitle";

export default function InternalPlatformChrome({ children }: { children: ReactNode }) {
  return (
    <MessengerProvider>
      <RouteTitle />
      <PlatformShell />
      {children}
      <MessengerWidget />
    </MessengerProvider>
  );
}
