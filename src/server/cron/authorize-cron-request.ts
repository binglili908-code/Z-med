import { NextResponse } from "next/server";

import { DEV_PANEL_EMAIL, isDevPanelEmail } from "@/lib/dev-admin";
import { isDevBypassAuthEnabled } from "@/lib/supabase/env";
import { createUserSupabaseClient } from "@/lib/supabase/user";

export type CronActor = {
  mode: "cron-secret" | "email" | "dev-bypass";
  userId: string | null;
  email: string | null;
};

type CronAuthorizationResult =
  | {
      authorized: true;
      actor: CronActor;
      devBypassAuth: boolean;
    }
  | {
      authorized: false;
      response: NextResponse;
    };

function getBearerToken(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const matched = auth.match(/^Bearer\s+(.+)$/i);
  return matched?.[1]?.trim() ?? null;
}

function isCronSecretToken(token: string | null) {
  const secret = process.env.CRON_SECRET?.trim();
  return Boolean(secret && token && token === secret);
}

export async function authorizeCronRequest(req: Request): Promise<CronAuthorizationResult> {
  const token = getBearerToken(req);
  const devBypassAuth = isDevBypassAuthEnabled();

  if (isCronSecretToken(token)) {
    return {
      authorized: true,
      actor: {
        mode: "cron-secret",
        userId: null,
        email: null,
      },
      devBypassAuth,
    };
  }

  if (token) {
    const userClient = createUserSupabaseClient(token);
    const {
      data: { user },
      error,
    } = await userClient.auth.getUser();

    if (!error && user && isDevPanelEmail(user.email)) {
      return {
        authorized: true,
        actor: {
          mode: "email",
          userId: user.id,
          email: user.email ?? null,
        },
        devBypassAuth,
      };
    }

    if (!devBypassAuth) {
      return {
        authorized: false,
        response: NextResponse.json(
          {
            error: `Forbidden: only CRON_SECRET, ${DEV_PANEL_EMAIL}, or dev bypass may call this endpoint`,
          },
          { status: user ? 403 : 401 },
        ),
      };
    }
  }

  if (devBypassAuth) {
    return {
      authorized: true,
      actor: {
        mode: "dev-bypass",
        userId: null,
        email: null,
      },
      devBypassAuth,
    };
  }

  return {
    authorized: false,
    response: NextResponse.json(
      {
        error: token
          ? `Forbidden: only CRON_SECRET, ${DEV_PANEL_EMAIL}, or dev bypass may call this endpoint`
          : "Missing bearer token",
      },
      { status: token ? 403 : 401 },
    ),
  };
}
