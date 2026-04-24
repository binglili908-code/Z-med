import { NextResponse } from "next/server";

import { DEV_PANEL_EMAIL, isDevPanelEmail } from "@/lib/dev-admin";
import { isDevBypassAuthEnabled } from "@/lib/supabase/env";
import { createUserSupabaseClient } from "@/lib/supabase/user";

type AuthorizedDeveloperActor = {
  mode: "email" | "dev-bypass";
  userId: string | null;
  email: string | null;
};

type DeveloperAuthorizationResult =
  | {
      authorized: true;
      actor: AuthorizedDeveloperActor;
    }
  | {
      authorized: false;
      response: NextResponse;
    };

function getBearerToken(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const matched = auth.match(/^Bearer\s+(.+)$/i);
  return matched?.[1] ?? null;
}

export async function authorizeDeveloperRequest(req: Request): Promise<DeveloperAuthorizationResult> {
  const token = getBearerToken(req);
  const devBypassEnabled = isDevBypassAuthEnabled();

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
      };
    }

    if (!devBypassEnabled) {
      return {
        authorized: false,
        response: NextResponse.json(
          {
            error: `Forbidden: only ${DEV_PANEL_EMAIL} or dev bypass may call this endpoint`,
          },
          { status: user ? 403 : 401 },
        ),
      };
    }
  }

  if (devBypassEnabled) {
    return {
      authorized: true,
      actor: {
        mode: "dev-bypass",
        userId: null,
        email: null,
      },
    };
  }

  return {
    authorized: false,
    response: NextResponse.json(
      {
        error: token
          ? `Forbidden: only ${DEV_PANEL_EMAIL} or dev bypass may call this endpoint`
          : "Missing bearer token",
      },
      { status: token ? 403 : 401 },
    ),
  };
}
