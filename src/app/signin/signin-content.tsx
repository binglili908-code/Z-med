"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { TurnstileWidget } from "@/components/auth/turnstile-widget";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  buildForgotPasswordPath,
  buildSignUpPath,
  getSafeRedirect,
} from "@/lib/auth-navigation";
import { formatSupabaseAuthError } from "@/lib/supabase/auth-error";
import { getBrowserSupabaseClient } from "@/lib/supabase/browser";

function getActionMessage(action: string | null, email: string | null) {
  switch (action) {
    case "registered":
      return email
        ? `注册成功，验证邮件已发送到 ${email}，请验证后再登录。`
        : "注册成功，请先完成邮箱验证后再登录。";
    case "confirmed":
      return "邮箱验证成功，现在可以登录了。";
    case "password-reset":
      return "密码已重置成功，请使用新密码登录。";
    default:
      return null;
  }
}

export function SignInContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = React.useMemo(
    () => getSafeRedirect(searchParams.get("redirect")),
    [searchParams],
  );
  const action = searchParams.get("action");
  const callbackError = searchParams.get("error");
  const callbackEmail = searchParams.get("email");

  const [email, setEmail] = React.useState(callbackEmail ?? "");
  const [password, setPassword] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [captchaToken, setCaptchaToken] = React.useState<string | null>(null);
  const [captchaResetSignal, setCaptchaResetSignal] = React.useState(0);

  const supabase = React.useMemo(() => getBrowserSupabaseClient(), []);
  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() ?? "";
  const captchaEnabled = Boolean(turnstileSiteKey);
  const actionMessage = React.useMemo(
    () => getActionMessage(action, callbackEmail),
    [action, callbackEmail],
  );

  const resetCaptcha = React.useCallback(() => {
    if (!captchaEnabled) {
      return;
    }

    setCaptchaToken(null);
    setCaptchaResetSignal((value) => value + 1);
  }, [captchaEnabled]);

  React.useEffect(() => {
    async function checkSession() {
      if (!supabase) {
        return;
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (session) {
        router.replace(redirectTo);
      }
    }

    void checkSession();
  }, [redirectTo, router, supabase]);

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!supabase) {
      setError("缺少 Supabase 环境变量配置。");
      return;
    }

    if (captchaEnabled && !captchaToken) {
      setError("请先完成人机验证。");
      return;
    }

    setLoading(true);
    setError(null);

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
      options: {
        ...(captchaToken ? { captchaToken } : {}),
      },
    });

    if (signInError) {
      setError(formatSupabaseAuthError(signInError.message));
      setLoading(false);
      resetCaptcha();
      return;
    }

    router.replace(redirectTo);
    router.refresh();
  };

  return (
    <main className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-xl items-center px-6 py-12">
      <Card className="w-full border-slate-200 shadow-lg shadow-slate-200/60">
        <CardHeader>
          <CardTitle className="text-2xl text-slate-900">登录账号</CardTitle>
          <CardDescription>
            登录后可管理订阅、接收首页精选周邮件并使用个性化功能。
          </CardDescription>
        </CardHeader>
        <CardContent>
          {actionMessage ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              {actionMessage}
            </div>
          ) : null}

          {callbackError ? (
            <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {decodeURIComponent(callbackError)}
            </div>
          ) : null}

          {!supabase ? (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
              缺少 NEXT_PUBLIC_SUPABASE_URL 或 Supabase publishable key，当前无法登录。
            </div>
          ) : null}

          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <div className="space-y-2">
              <label htmlFor="signin-email" className="text-sm font-semibold text-slate-700">
                邮箱
              </label>
              <Input
                id="signin-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <label
                  htmlFor="signin-password"
                  className="text-sm font-semibold text-slate-700"
                >
                  密码
                </label>
                <Link
                  href={buildForgotPasswordPath(redirectTo, {
                    email: email.trim(),
                  })}
                  className="text-sm text-slate-500 hover:text-slate-700"
                >
                  忘记密码？
                </Link>
              </div>
              <Input
                id="signin-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="请输入密码"
                required
              />
            </div>

            {captchaEnabled ? (
              <TurnstileWidget
                siteKey={turnstileSiteKey}
                resetSignal={captchaResetSignal}
                onVerify={(token) => {
                  setCaptchaToken(token);
                  setError(null);
                }}
                onExpire={() => setCaptchaToken(null)}
                onError={() => {
                  setCaptchaToken(null);
                  setError("人机验证加载失败，请刷新后重试。");
                }}
              />
            ) : null}

            {error ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {error}
              </div>
            ) : null}

            <Button
              type="submit"
              variant="primary"
              className="w-full"
              disabled={loading || !supabase || (captchaEnabled && !captchaToken)}
            >
              {loading ? "登录中..." : "登录"}
            </Button>
          </form>

          <div className="mt-6 flex items-center justify-between gap-3 border-t border-slate-100 pt-4 text-sm">
            <span className="text-slate-500">还没有账号？</span>
            <div className="flex items-center gap-4">
              <Link
                href={buildSignUpPath(redirectTo)}
                className="font-semibold text-slate-900 hover:text-slate-700"
              >
                去注册
              </Link>
              <Link href="/" className="text-slate-500 hover:text-slate-700">
                返回首页
              </Link>
            </div>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
