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
  buildAuthCallbackUrl,
  buildSignInPath,
  getSafeRedirect,
} from "@/lib/auth-navigation";
import { formatSupabaseAuthError } from "@/lib/supabase/auth-error";
import { getBrowserSupabaseClient } from "@/lib/supabase/browser";

function SignUpContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = React.useMemo(
    () => getSafeRedirect(searchParams.get("redirect")),
    [searchParams],
  );

  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);

  const supabase = React.useMemo(() => getBrowserSupabaseClient(), []);

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
    setMessage(null);

    const emailValue = email.trim();
    const emailRedirectTo =
      typeof window !== "undefined"
        ? buildAuthCallbackUrl(window.location.origin, "confirmed", redirectTo)
        : undefined;

    const { data, error: signUpError } = await supabase.auth.signUp({
      email: emailValue,
      password,
      options: {
        emailRedirectTo,
      },
    });

    if (signUpError) {
      setError(formatSupabaseAuthError(signUpError.message));
      setLoading(false);
      return;
    }

    if (data.session) {
      router.replace(redirectTo);
      router.refresh();
      return;
    }

    setLoading(false);
    setMessage("注册成功，请查收邮箱并点击验证链接后再登录。");
    router.replace(
      buildSignInPath(redirectTo, {
        action: "registered",
        email: emailValue,
      }),
    );
  };

  return (
    <main className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-xl items-center px-6 py-12">
      <Card className="w-full border-slate-200 shadow-lg shadow-slate-200/60">
        <CardHeader>
          <CardTitle className="text-2xl text-slate-900">创建账号</CardTitle>
          <CardDescription>
            使用 Supabase 邮箱密码模式完成最小可用注册流程。
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
              缺少 NEXT_PUBLIC_SUPABASE_URL 或 NEXT_PUBLIC_SUPABASE_ANON_KEY，当前无法注册。
            </div>
          ) : null}

          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <div className="space-y-2">
              <label htmlFor="signup-email" className="text-sm font-semibold text-slate-700">
                邮箱
              </label>
              <Input
                id="signup-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="signup-password" className="text-sm font-semibold text-slate-700">
                密码
              </label>
              <Input
                id="signup-password"
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
                htmlFor="signup-confirm-password"
                className="text-sm font-semibold text-slate-700"
              >
                确认密码
              </label>
              <Input
                id="signup-confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="请再次输入密码"
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
              {loading ? "注册中..." : "创建账号"}
            </Button>
          </form>

          <div className="mt-6 flex items-center justify-between gap-3 border-t border-slate-100 pt-4 text-sm">
            <span className="text-slate-500">已经有账号？</span>
            <div className="flex items-center gap-4">
              <Link
                href={buildSignInPath(redirectTo)}
                className="font-semibold text-slate-900 hover:text-slate-700"
              >
                去登录
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

export default function SignUpPage() {
  return (
    <React.Suspense
      fallback={
        <main className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-xl items-center px-6 py-12">
          <div className="w-full rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">
            正在加载注册页...
          </div>
        </main>
      }
    >
      <SignUpContent />
    </React.Suspense>
  );
}
