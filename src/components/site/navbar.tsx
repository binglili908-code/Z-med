"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Brain, Search, Stethoscope } from "lucide-react";
import {
  buildRedirectTarget,
  buildSignInPath,
  buildSignUpPath,
  isAuthPagePath,
} from "@/lib/auth-navigation";
import { getBrowserSupabaseClient } from "@/lib/supabase/browser";

export function Navbar() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [loading, setLoading] = React.useState(true);
  const [email, setEmail] = React.useState<string | null>(null);
  const supabase = React.useMemo(() => getBrowserSupabaseClient(), []);
  const authRedirect = React.useMemo(() => {
    if (isAuthPagePath(pathname)) {
      return "/";
    }
    return buildRedirectTarget(pathname, searchParams.toString());
  }, [pathname, searchParams]);

  React.useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setEmail(data.session?.user?.email ?? null);
      setLoading(false);
    });
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      setEmail(session?.user?.email ?? null);
      setLoading(false);
    });
    return () => {
      mounted = false;
      subscription.subscription.unsubscribe();
    };
  }, [supabase]);

  const signOut = React.useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    setEmail(null);
    router.push(buildSignInPath(authRedirect));
    router.refresh();
  }, [authRedirect, router, supabase]);

  return (
    <nav className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-200">
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-3">
          <div className="flex -space-x-2">
            <div className="w-8 h-8 rounded-full bg-slate-900 flex items-center justify-center z-10 border-2 border-white">
              <Brain className="w-4 h-4 text-white" />
            </div>
            <div className="w-8 h-8 rounded-full bg-teal-600 flex items-center justify-center z-0 border-2 border-white">
              <Stethoscope className="w-4 h-4 text-white" />
            </div>
          </div>
          <span className="font-bold text-xl tracking-tight text-slate-900">
            Z-lab <span className="text-teal-600">med</span>
          </span>
          <span className="hidden md:inline-block ml-4 px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-500 text-xs font-medium">
            Workspace Beta
          </span>
        </Link>

        <div className="hidden md:flex items-center gap-8 text-sm font-medium text-slate-600">
          <Link href="/" className="text-slate-900 flex items-center gap-1.5">
            <Search className="w-4 h-4" /> 发现
          </Link>
          <Link href="/literature-trends" className="hover:text-slate-900 transition-colors">
            文献库
          </Link>
          <Link href="/datasets" className="hover:text-slate-900 transition-colors">
            数据集
          </Link>
          <Link href="/model-hub" className="hover:text-slate-900 transition-colors">
            模型 Hub
          </Link>
        </div>

        <div className="flex items-center gap-4">
          {!loading && email ? (
            <>
              <span className="hidden rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600 md:inline">
                {email}
              </span>
              <Link
                href="/settings"
                className="text-sm font-medium text-slate-600 hover:text-slate-900"
              >
                个人设置
              </Link>
              <button
                type="button"
                onClick={signOut}
                className="text-sm font-medium text-slate-600 hover:text-slate-900"
              >
                登出
              </button>
            </>
          ) : loading ? (
            <span className="hidden h-9 w-24 animate-pulse rounded-full bg-slate-100 md:inline-block" />
          ) : (
            <>
              <Link
                href={buildSignInPath(authRedirect)}
                className="text-sm font-medium text-slate-600 hover:text-slate-900"
              >
                登录
              </Link>
              <Link
                href={buildSignUpPath(authRedirect)}
                className="text-sm font-medium text-slate-600 hover:text-slate-900"
              >
                注册
              </Link>
            </>
          )}
          <Link
            href={email ? "/settings" : buildSignInPath(authRedirect)}
            className="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-800 transition-colors"
          >
            {email ? "进入工作台" : "开始使用"}
          </Link>
        </div>
      </div>
    </nav>
  );
}
