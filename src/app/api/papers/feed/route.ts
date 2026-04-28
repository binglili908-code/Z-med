import { createFeedRouteHandler } from "@/server/routes/papers-feed-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = createFeedRouteHandler();
