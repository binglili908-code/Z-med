import { NextResponse } from "next/server";

import { getDailyPubmedPapers } from "@/lib/pubmed";

export const runtime = "nodejs";
export const revalidate = 86400;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const limitRaw = searchParams.get("limit");
  const q = searchParams.get("q") ?? undefined;

  const limit = limitRaw ? Number(limitRaw) : undefined;
  const data = await getDailyPubmedPapers({
    limit: Number.isFinite(limit) ? limit : undefined,
    query: q,
  });

  return NextResponse.json(data, {
    headers: {
      "Cache-Control": "public, max-age=0, s-maxage=86400, stale-while-revalidate=3600",
    },
  });
}
