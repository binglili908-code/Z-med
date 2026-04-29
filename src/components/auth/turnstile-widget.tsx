"use client";

import * as React from "react";

const TURNSTILE_SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

type TurnstileRenderOptions = {
  sitekey: string;
  theme?: "auto" | "light" | "dark";
  callback?: (token: string) => void;
  "expired-callback"?: () => void;
  "error-callback"?: () => void;
};

type TurnstileApi = {
  render: (container: HTMLElement, options: TurnstileRenderOptions) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let turnstileScriptPromise: Promise<void> | null = null;

function loadTurnstileScript() {
  if (typeof window === "undefined") {
    return Promise.resolve();
  }

  if (window.turnstile) {
    return Promise.resolve();
  }

  if (!turnstileScriptPromise) {
    turnstileScriptPromise = new Promise((resolve, reject) => {
      const existingScript = document.querySelector<HTMLScriptElement>(
        `script[src="${TURNSTILE_SCRIPT_SRC}"]`,
      );

      const handleLoad = () => resolve();
      const handleError = () => reject(new Error("Turnstile failed to load"));

      if (existingScript) {
        existingScript.addEventListener("load", handleLoad, { once: true });
        existingScript.addEventListener("error", handleError, { once: true });
        return;
      }

      const script = document.createElement("script");
      script.src = TURNSTILE_SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      script.addEventListener("load", handleLoad, { once: true });
      script.addEventListener("error", handleError, { once: true });
      document.head.appendChild(script);
    });
  }

  return turnstileScriptPromise;
}

type TurnstileWidgetProps = {
  siteKey: string;
  onVerify: (token: string) => void;
  onExpire: () => void;
  onError: () => void;
  resetSignal: number;
  className?: string;
};

export function TurnstileWidget({
  siteKey,
  onVerify,
  onExpire,
  onError,
  resetSignal,
  className,
}: TurnstileWidgetProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const widgetIdRef = React.useRef<string | null>(null);
  const didMountResetRef = React.useRef(false);
  const [loadError, setLoadError] = React.useState(false);

  const callbacksRef = React.useRef({ onVerify, onExpire, onError });
  callbacksRef.current = { onVerify, onExpire, onError };

  React.useEffect(() => {
    let cancelled = false;

    async function renderWidget() {
      setLoadError(false);
      await loadTurnstileScript();

      if (cancelled || !containerRef.current || !window.turnstile) {
        return;
      }

      if (widgetIdRef.current) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }

      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        theme: "auto",
        callback: (token) => callbacksRef.current.onVerify(token),
        "expired-callback": () => callbacksRef.current.onExpire(),
        "error-callback": () => callbacksRef.current.onError(),
      });
    }

    renderWidget().catch(() => {
      if (!cancelled) {
        setLoadError(true);
        callbacksRef.current.onError();
      }
    });

    return () => {
      cancelled = true;

      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }

      if (containerRef.current) {
        containerRef.current.innerHTML = "";
      }
    };
  }, [siteKey]);

  React.useEffect(() => {
    if (!didMountResetRef.current) {
      didMountResetRef.current = true;
      return;
    }

    if (widgetIdRef.current && window.turnstile) {
      window.turnstile.reset(widgetIdRef.current);
      callbacksRef.current.onExpire();
    }
  }, [resetSignal]);

  return (
    <div className={className}>
      <div ref={containerRef} />
      {loadError ? (
        <p className="mt-2 text-sm text-rose-600">人机验证加载失败，请刷新后重试。</p>
      ) : null}
    </div>
  );
}
