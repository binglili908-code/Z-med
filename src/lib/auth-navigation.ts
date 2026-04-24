type AuthQueryValue = string | null | undefined;

type AuthQueryRecord = Record<string, AuthQueryValue>;

const AUTH_PAGE_PATHS = new Set([
  "/signin",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/auth/callback",
]);

export function getSafeRedirect(raw: string | null | undefined, fallback = "/") {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) {
    return fallback;
  }

  return raw;
}

export function isAuthPagePath(pathname: string | null | undefined) {
  return AUTH_PAGE_PATHS.has(getSafeRedirect(pathname, "/"));
}

export function buildRedirectTarget(
  pathname: string | null | undefined,
  search?: string | null,
) {
  const safePathname = getSafeRedirect(pathname, "/");

  if (!search) {
    return safePathname;
  }

  const normalizedSearch = search.startsWith("?") ? search.slice(1) : search;

  if (!normalizedSearch) {
    return safePathname;
  }

  return `${safePathname}?${normalizedSearch}`;
}

function buildPath(basePath: string, query: AuthQueryRecord) {
  const params = new URLSearchParams();

  Object.entries(query).forEach(([key, value]) => {
    if (value) {
      params.set(key, value);
    }
  });

  const search = params.toString();
  return search ? `${basePath}?${search}` : basePath;
}

export function buildSignInPath(
  redirectTo: string | null | undefined,
  query: AuthQueryRecord = {},
) {
  return buildPath("/signin", {
    ...query,
    redirect: getSafeRedirect(redirectTo, "/"),
  });
}

export function buildSignUpPath(
  redirectTo: string | null | undefined,
  query: AuthQueryRecord = {},
) {
  return buildPath("/signup", {
    ...query,
    redirect: getSafeRedirect(redirectTo, "/"),
  });
}

export function buildForgotPasswordPath(
  redirectTo: string | null | undefined,
  query: AuthQueryRecord = {},
) {
  return buildPath("/forgot-password", {
    ...query,
    redirect: getSafeRedirect(redirectTo, "/"),
  });
}

export function buildResetPasswordPath(
  redirectTo: string | null | undefined,
  query: AuthQueryRecord = {},
) {
  return buildPath("/reset-password", {
    ...query,
    redirect: getSafeRedirect(redirectTo, "/"),
  });
}

export function buildAuthCallbackPath(
  mode: "confirmed" | "recovery",
  redirectTo: string | null | undefined,
  query: AuthQueryRecord = {},
) {
  return buildPath("/auth/callback", {
    ...query,
    mode,
    redirect: getSafeRedirect(redirectTo, "/"),
  });
}

export function buildAuthCallbackUrl(
  origin: string,
  mode: "confirmed" | "recovery",
  redirectTo: string | null | undefined,
  query: AuthQueryRecord = {},
) {
  return `${origin}${buildAuthCallbackPath(mode, redirectTo, query)}`;
}
