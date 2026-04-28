import { createMedicalQueryPlannerDebugRouteHandler } from "@/server/routes/medical-query-planner-debug-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = createMedicalQueryPlannerDebugRouteHandler();
