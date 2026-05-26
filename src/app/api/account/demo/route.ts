import { NextResponse } from "next/server";
import { getClientSiteData } from "@/lib/client-site-api";

export async function GET() {
  return NextResponse.json(getClientSiteData().ACCOUNT);
}
