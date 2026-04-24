import { Suspense } from "react";

import { AuthCallbackContent } from "./auth-callback-content";

export default function AuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-xl items-center px-6 py-12">
          <div className="w-full rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">
            正在加载认证回调页...
          </div>
        </main>
      }
    >
      <AuthCallbackContent />
    </Suspense>
  );
}
