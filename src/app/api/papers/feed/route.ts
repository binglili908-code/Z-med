import { createFeedRouteHandler } from "@/server/routes/papers-feed-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = createFeedRouteHandler();
