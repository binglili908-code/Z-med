import { NextResponse } from "next/server";

import { createUserSupabaseClient } from "@/lib/supabase/user";
import {
  getUserSubscription,
  saveUserSubscription,
} from "@/server/repositories/profiles";
import type {
  UserSubscription,
  UserSubscriptionSaveResponse,
} from "@/shared/contracts/subscriptions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getBearerToken(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const matched = auth.match(/^Bearer\s+(.+)$/i);
  return matched?.[1];
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unexpected subscription error";
}

export async function GET(req: Request) {
  const token = getBearerToken(req);
  if (!token) {
    return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });
  }

  const userClient = createUserSupabaseClient(token);
  const {
    data: { user },
    error: userErr,
  } = await userClient.auth.getUser();
  if (userErr || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const payload = await getUserSubscription(userClient, user.id);
    return NextResponse.json(payload satisfies UserSubscription);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const token = getBearerToken(req);
  if (!token) {
    return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });
  }

  const userClient = createUserSupabaseClient(token);
  const {
    data: { user },
    error: userErr,
  } = await userClient.auth.getUser();
  if (userErr || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: UserSubscription;
  try {
    body = (await req.json()) as UserSubscription;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const payload = await saveUserSubscription(userClient, user.id, body);
    return NextResponse.json(payload satisfies UserSubscriptionSaveResponse);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
