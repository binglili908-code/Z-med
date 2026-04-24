"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

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
  buildForgotPasswordPath,
  buildSignInPath,
  getSafeRedirect,
} from "@/lib/auth-navigation";
import { formatSupabaseAuthError } from "@/lib/supabase/auth-error";
import { getBrowserSupabaseClient } from "@/lib/supabase/browser";

type RecoveryState = "checking" | "ready" | "invalid";

async function waitForRecoverySession() {
  const supabase = getBrowserSupabaseClient();

  if (!supabase) {
    return { session: null, error: "缺少 Supabase 环境变量配置。" };
  }

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (session) {
      return { session, error: null };
    }

    await new Promise((resolve) => {
      window.setTimeout(resolve, 250);
    });
  }

  return { session: null, error: null };
}

function ResetPasswordContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = React.useMemo(
    () => getSafeRedirect(searchParams.get("redirect")),
    [searchParams],
  );
  const code = searchParams.get("code");
  const errorDescription = searchParams.get("error_description");

  const [password, setPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [email, setEmail] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<RecoveryState>("checking");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const supabase = React.useMemo(() => getBrowserSupabaseClient(), []);

  React.useEffect(() => {
    if (!supabase) {
      setStatus("invalid");
      setError("缺少 Supabase 环境变量配置。");
      return;
    }

    const client = supabase;
    let cancelled = false;

    const { data: subscription } = client.auth.onAuthStateChange(
      (event, session) => {
        if (cancelled) {
          return;
        }

        if ((event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") && session) {
          setEmail(session.user.email ?? null);
          setStatus("ready");
          setError(null);
        }
      },
    );

    async function bootstrap() {
      if (errorDescription) {
        setStatus("invalid");
        setError(decodeURIComponent(errorDescription));
        return;
      }

      if (code) {
        const { error: exchangeError } =
          await client.auth.exchangeCodeForSession(code);

        if (exchangeError) {
          setStatus("invalid");
          setError(formatSupabaseAuthError(exchangeError.message));
          return;
        }
      }

      const result = await waitForRecoverySession();

      if (cancelled) {
        return;
      }

      if (result.error) {
        setStatus("invalid");
        setError(result.error);
        return;
      }

      if (result.session) {
        setEmail(result.session.user.email ?? null);
        setStatus("ready");
        return;
      }

      const hasTokenInHash =
        typeof window !== "undefined" &&
        window.location.hash.includes("access_token");

      if (hasTokenInHash) {
        setError("正在解析重置链接，请稍后刷新页面重试。");
      } else {
        setError("当前重置链接已失效，请重新发起找回密码。");
      }

      setStatus("invalid");
    }

    void bootstrap();

    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
    };
  }, [code, errorDescription, supabase]);

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!supabase) {
      setError("缺少 Supabase 环境变量配置。");
      return;
    }

    if (password.length < 6) {
      setError("密码至少需要 6 位。");
      return;
    }

    if (password !== confirmPassword) {
      setError("两次输入的密码不一致。");
      return;
    }

    setLoading(true);
    setError(null);

    const { error: updateError } = await supabase.auth.updateUser({
      password,
    });

    if (updateError) {
      setError(formatSupabaseAuthError(updateError.message));
      setLoading(false);
      return;
    }

    await supabase.auth.signOut();
    router.replace(buildSignInPath(redirectTo, { action: "password-reset" }));
    router.refresh();
  };

  return (
    <main className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-xl items-center px-6 py-12">
      <Card className="w-full border-slate-200 shadow-lg shadow-slate-200/60">
        <CardHeader>
          <CardTitle className="text-2xl text-slate-900">重置密码</CardTitle>
          <CardDescription>
            {email
              ? `当前将为 ${email} 设置新密码。`
              : "请通过邮箱中的重置链接进入本页完成密码更新。"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {status === "checking" ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              正在校验重置链接...
            </div>
          ) : null}

          {error ? (
            <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          ) : null}

          {status === "ready" ? (
            <form onSubmit={onSubmit} className="mt-6 space-y-4">
              <div className="space-y-2">
                <label
                  htmlFor="reset-password"
                  className="text-sm font-semibold text-slate-700"
                >
                  新密码
                </label>
                <Input
                  id="reset-password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="至少 6 位"
                  required
                />
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="reset-password-confirm"
                  className="text-sm font-semibold text-slate-700"
                >
                  确认新密码
                </label>
                <Input
                  id="reset-password-confirm"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="请再次输入新密码"
                  required
                />
              </div>

              <Button
                type="submit"
                variant="primary"
                className="w-full"
                disabled={loading}
              >
                {loading ? "提交中..." : "保存新密码"}
              </Button>
            </form>
          ) : null}

          <div className="mt-6 flex items-center justify-between gap-3 border-t border-slate-100 pt-4 text-sm">
            <span className="text-slate-500">需要重新发起流程？</span>
            <div className="flex items-center gap-4">
              <Link
                href={buildForgotPasswordPath(redirectTo)}
                className="font-semibold text-slate-900 hover:text-slate-700"
              >
                重新发送邮件
              </Link>
              <Link
                href={buildSignInPath(redirectTo)}
                className="text-slate-500 hover:text-slate-700"
              >
                返回登录
              </Link>
            </div>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}

export default function ResetPasswordPage() {
  return (
    <React.Suspense
      fallback={
        <main className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-xl items-center px-6 py-12">
          <div className="w-full rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">
            正在加载重置密码页...
          </div>
        </main>
      }
    >
      <ResetPasswordContent />
    </React.Suspense>
  );
}
