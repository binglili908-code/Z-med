"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  buildAuthCallbackUrl,
  buildSignInPath,
  buildSignUpPath,
  getSafeRedirect,
} from "@/lib/auth-navigation";
import { formatSupabaseAuthError } from "@/lib/supabase/auth-error";
import { getBrowserSupabaseClient } from "@/lib/supabase/browser";

function ForgotPasswordContent() {
  const searchParams = useSearchParams();
  const redirectTo = React.useMemo(
    () => getSafeRedirect(searchParams.get("redirect")),
    [searchParams],
  );

  const [email, setEmail] = React.useState(searchParams.get("email") ?? "");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);

  const supabase = React.useMemo(() => getBrowserSupabaseClient(), []);

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!supabase) {
      setError("缺少 Supabase 环境变量配置。");
      return;
    }

    setLoading(true);
    setError(null);
    setMessage(null);

    const emailValue = email.trim();
    const resetRedirectTo =
      typeof window !== "undefined"
        ? buildAuthCallbackUrl(window.location.origin, "recovery", redirectTo)
        : undefined;

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      emailValue,
      {
        redirectTo: resetRedirectTo,
      },
    );

    if (resetError) {
      setError(formatSupabaseAuthError(resetError.message));
      setLoading(false);
      return;
    }

    setLoading(false);
    setMessage("重置邮件已发送，请查收邮箱并按邮件中的链接完成密码重设。");
  };

  return (
    <main className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-xl items-center px-6 py-12">
      <Card className="w-full border-slate-200 shadow-lg shadow-slate-200/60">
        <CardHeader>
          <CardTitle className="text-2xl text-slate-900">找回密码</CardTitle>
          <CardDescription>
            输入注册邮箱，我们会通过 Supabase 发送密码重置邮件。
          </CardDescription>
        </CardHeader>
        <CardContent>
          {message ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              {message}
            </div>
          ) : null}

          {!supabase ? (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
              缺少 NEXT_PUBLIC_SUPABASE_URL 或 Supabase publishable key，当前无法发送重置邮件。
            </div>
          ) : null}

          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <div className="space-y-2">
              <label
                htmlFor="forgot-password-email"
                className="text-sm font-semibold text-slate-700"
              >
                注册邮箱
              </label>
              <Input
                id="forgot-password-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
              />
            </div>

            {error ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {error}
              </div>
            ) : null}

            <Button
              type="submit"
              variant="primary"
              className="w-full"
              disabled={loading || !supabase}
            >
              {loading ? "发送中..." : "发送重置邮件"}
            </Button>
          </form>

          <div className="mt-6 flex items-center justify-between gap-3 border-t border-slate-100 pt-4 text-sm">
            <span className="text-slate-500">想起密码了？</span>
            <div className="flex items-center gap-4">
              <Link
                href={buildSignInPath(redirectTo, {
                  email: email.trim(),
                })}
                className="font-semibold text-slate-900 hover:text-slate-700"
              >
                返回登录
              </Link>
              <Link
                href={buildSignUpPath(redirectTo)}
                className="text-slate-500 hover:text-slate-700"
              >
                去注册
              </Link>
            </div>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}

export default function ForgotPasswordPage() {
  return (
    <React.Suspense
      fallback={
        <main className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-xl items-center px-6 py-12">
          <div className="w-full rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">
            正在加载找回密码页...
          </div>
        </main>
      }
    >
      <ForgotPasswordContent />
    </React.Suspense>
  );
}
