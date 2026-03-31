"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@supabase/supabase-js";

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const supabase = React.useMemo(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anon) return null;
    return createClient(url, anon);
  }, []);

  React.useEffect(() => {
    async function checkSession() {
      if (!supabase) return;
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session) {
        router.replace("/");
      }
    }
    void checkSession();
  }, [router, supabase]);

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!supabase) {
      setError("缺少 Supabase 环境变量配置");
      return;
    }
    setLoading(true);
    setError(null);
    const { data, error: signInErr } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (signInErr) {
      setError(signInErr.message);
      setLoading(false);
      return;
    }
    if (data.session) {
      router.push("/");
      router.refresh();
      return;
    }
    setLoading(false);
    setError("登录失败，请检查账号或密码");
  };

  return (
    <main className="max-w-md mx-auto px-6 pt-12 pb-20">
      <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">
        Sign in
      </h1>
      <p className="mt-2 text-sm text-slate-500">使用邮箱和密码登录</p>

      <form onSubmit={onSubmit} className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <label className="block text-sm font-semibold text-slate-700">邮箱</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-900"
          placeholder="you@example.com"
        />

        <label className="mt-4 block text-sm font-semibold text-slate-700">密码</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-900"
          placeholder="请输入密码"
        />

        {error ? <div className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}

        <button
          type="submit"
          disabled={loading}
          className="mt-6 w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "登录中..." : "登录"}
        </button>

        <p className="mt-4 text-xs text-slate-500">
          还没有账号？联系管理员获取。{" "}
          <Link href="/" className="text-slate-700 underline">
            返回首页
          </Link>
        </p>
      </form>
    </main>
  );
}
