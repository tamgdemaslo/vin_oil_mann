"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const InternalPlatformChrome = dynamic(() => import("./InternalPlatformChrome"));

export default function PlatformChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/client-site" || pathname.startsWith("/client-site/")) return children;
  return <InternalPlatformChrome>{children}</InternalPlatformChrome>;
}
