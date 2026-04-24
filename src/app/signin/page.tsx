import { Suspense } from "react";

import { SignInContent } from "./signin-content";

export default function SignInPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-5xl items-center px-6 py-12">
          <div className="w-full rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">
            正在加载登录页...
          </div>
        </main>
      }
    >
      <SignInContent />
    </Suspense>
  );
}
