import { NextResponse } from "next/server";

import {
  authorizeCronRequest,
  type CronActor,
} from "@/server/cron/authorize-cron-request";

type CronRouteContext = {
  actor: CronActor;
  devBypassAuth: boolean;
};

type CronRouteResult = Record<string, unknown>;

type CronRouteOptions = {
  successKey?: "ok" | "success";
};

export class CronRouteError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = "CronRouteError";
    this.status = status;
  }
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

function getErrorStatus(error: unknown) {
  return error instanceof CronRouteError ? error.status : 500;
}

export async function runCronRoute(
  req: Request,
  handler: (context: CronRouteContext) => Promise<CronRouteResult>,
  options: CronRouteOptions = {},
) {
  const auth = await authorizeCronRequest(req);
  if (!auth.authorized) {
    return auth.response;
  }

  const successKey = options.successKey ?? "ok";

  try {
    const result = await handler({
      actor: auth.actor,
      devBypassAuth: auth.devBypassAuth,
    });

    return NextResponse.json({
      [successKey]: true,
      actor: auth.actor,
      devBypassAuth: auth.devBypassAuth,
      ...result,
    });
  } catch (error) {
    return NextResponse.json(
      {
        [successKey]: false,
        error: getErrorMessage(error),
      },
      { status: getErrorStatus(error) },
    );
  }
}
