"use client";

import * as React from "react";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";

export default function SettingsPage() {
  const [loading, setLoading] = React.useState(true);
  const [email, setEmail] = React.useState<string | null>(null);

  const supabase = React.useMemo(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anon) return null;
    return createClient(url, anon);
  }, []);

  React.useEffect(() => {
    async function init() {
      if (!supabase) {
        setLoading(false);
        return;
      }
      const {
        data: { session },
      } = await supabase.auth.getSession();
      setEmail(session?.user?.email ?? null);
      setLoading(false);
    }
    void init();
  }, [supabase]);

  if (loading) {
    return (
      <main className="max-w-4xl mx-auto px-6 pt-10 pb-20">
        <p className="text-slate-500">加载中...</p>
      </main>
    );
  }

  if (!email) {
    return (
      <main className="max-w-4xl mx-auto px-6 pt-10 pb-20">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">Settings</h1>
        <p className="mt-4 text-slate-600">请先登录后再访问个人设置。</p>
        <Link href="/signin" className="mt-4 inline-block text-sm font-semibold text-slate-900 underline">
          前往登录
        </Link>
      </main>
    );
  }

  return (
    <main className="max-w-4xl mx-auto px-6 pt-10 pb-20">
      <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">Settings</h1>
      <p className="mt-3 text-slate-600">当前登录账号：{email}</p>
      <p className="mt-2 text-slate-500">AI 设置与研究方向订阅入口将在这里持续完善。</p>
    </main>
  );
}
