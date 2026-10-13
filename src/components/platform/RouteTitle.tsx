"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { getRouteTitle } from "@/lib/route-title";

export default function RouteTitle() {
  const pathname = usePathname();

  useEffect(() => {
    document.title = getRouteTitle(pathname);
  }, [pathname]);

  return null;
}
