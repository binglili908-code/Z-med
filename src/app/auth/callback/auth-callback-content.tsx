"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";

import {
  buildResetPasswordPath,
  buildSignInPath,
  getSafeRedirect,
} from "@/lib/auth-navigation";
import { formatSupabaseAuthError } from "@/lib/supabase/auth-error";
import { getBrowserSupabaseClient } from "@/lib/supabase/browser";

export function AuthCallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = React.useMemo(
    () => getSafeRedirect(searchParams.get("redirect")),
    [searchParams],
  );
  const mode = searchParams.get("mode");
  const code = searchParams.get("code");
  const error = searchParams.get("error");
  const errorDescription = searchParams.get("error_description");
  const errorCode = searchParams.get("error_code");
  const supabase = React.useMemo(() => getBrowserSupabaseClient(), []);
  const [message, setMessage] = React.useState("正在处理邮件回调...");

  React.useEffect(() => {
    async function handleCallback() {
      if (!supabase) {
        setMessage("缺少 Supabase 环境变量配置，无法完成邮箱回调。");
        return;
      }

      if (error || errorDescription) {
        const detail = formatSupabaseAuthError(
          decodeURIComponent(errorDescription ?? error ?? errorCode ?? "认证失败"),
        );

        if (mode === "recovery") {
          router.replace(
            buildResetPasswordPath(redirectTo, {
              error_description: detail,
            }),
          );
          return;
        }

        router.replace(
          buildSignInPath(redirectTo, {
            action: "error",
            error: detail,
          }),
        );
        return;
      }

      if (!code) {
        router.replace(
          buildSignInPath(redirectTo, {
            action: "error",
            error: "缺少认证参数，邮件链接可能已失效。",
          }),
        );
        return;
      }

      const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

      if (exchangeError) {
        const detail = formatSupabaseAuthError(exchangeError.message);

        if (mode === "recovery") {
          router.replace(
            buildResetPasswordPath(redirectTo, {
              error_description: detail,
            }),
          );
          return;
        }

        router.replace(
          buildSignInPath(redirectTo, {
            action: "error",
            error: detail,
          }),
        );
        return;
      }

      if (mode === "recovery") {
        setMessage("验证成功，正在进入密码重置页面...");
        router.replace(buildResetPasswordPath(redirectTo));
        router.refresh();
        return;
      }

      await supabase.auth.signOut();
      setMessage("邮箱验证成功，正在返回登录页...");
      router.replace(
        buildSignInPath(redirectTo, {
          action: "confirmed",
        }),
      );
      router.refresh();
    }

    void handleCallback();
  }, [
    code,
    error,
    errorCode,
    errorDescription,
    mode,
    redirectTo,
    router,
    supabase,
  ]);

  return (
    <main className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-xl items-center px-6 py-12">
      <div className="w-full rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
        {message}
      </div>
    </main>
  );
}
