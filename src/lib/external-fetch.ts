type NextFetchInit = RequestInit & {
  next?: {
    revalidate?: number | false;
    tags?: string[];
  };
};

type ExternalFetchOptions = NextFetchInit & {
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  retryOnStatuses?: number[];
  label?: string;
};

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_RETRY_STATUSES = [408, 425, 429, 500, 502, 503, 504];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAbortLikeError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

function withLabel(label: string | undefined, message: string) {
  return label ? `${label}: ${message}` : message;
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  options: ExternalFetchOptions = {},
) {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, label, ...init } = options;
  const controller = new AbortController();
  const parentSignal = init.signal;
  let parentAbortListener: (() => void) | null = null;

  if (parentSignal) {
    if (parentSignal.aborted) {
      controller.abort(parentSignal.reason);
    } else {
      parentAbortListener = () => controller.abort(parentSignal.reason);
      parentSignal.addEventListener("abort", parentAbortListener, { once: true });
    }
  }

  const timeout = setTimeout(() => {
    controller.abort(new Error(withLabel(label, `request timed out after ${timeoutMs}ms`)));
  }, timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (isAbortLikeError(error)) {
      throw new Error(withLabel(label, `request timed out after ${timeoutMs}ms`));
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    if (parentSignal && parentAbortListener) {
      parentSignal.removeEventListener("abort", parentAbortListener);
    }
  }
}

export async function fetchWithRetry(
  input: RequestInfo | URL,
  options: ExternalFetchOptions = {},
) {
  const {
    retries = 0,
    retryDelayMs = 350,
    retryOnStatuses = DEFAULT_RETRY_STATUSES,
    label,
    ...init
  } = options;
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetchWithTimeout(input, { ...init, label });
      const shouldRetry =
        attempt < retries && retryOnStatuses.includes(response.status);
      if (!shouldRetry) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
      if (attempt >= retries) break;
    }

    await sleep(retryDelayMs * (attempt + 1));
  }

  const message = lastError instanceof Error ? lastError.message : "Unknown request error";
  throw new Error(withLabel(label, `request failed after ${retries + 1} attempt(s): ${message}`));
}

export async function tryFetchWithRetry(
  input: RequestInfo | URL,
  options: ExternalFetchOptions = {},
) {
  try {
    return await fetchWithRetry(input, options);
  } catch {
    return null;
  }
}
