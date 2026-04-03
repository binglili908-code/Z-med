import fs from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function tryReadLogo() {
  const candidates = [
    path.join(process.cwd(), "智医研logo(1).png"),
    path.join(process.cwd(), "zlab-web", "智医研logo(1).png"),
  ];
  for (const file of candidates) {
    try {
      const buf = await fs.readFile(file);
      return buf;
    } catch {
      continue;
    }
  }
  return null;
}

export async function GET() {
  const data = await tryReadLogo();
  if (!data) {
    return NextResponse.json({ error: "Logo not found" }, { status: 404 });
  }
  const bytes = new Uint8Array(data);
  return new NextResponse(bytes, {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
