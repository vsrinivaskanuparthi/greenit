/** Same-origin requests only. Diagnostics deliberately exclude bodies and user text. */
export async function api(
  url: string,
  init: RequestInit = {},
  action = "load data",
) {
  const method = init.method ?? "GET";
  const endpoint = url.replace(/\/[0-9a-f-]{36}(?=\/|$)/g, "/:id");
  let response: Response;
  try {
    response = await fetch("/api" + url, {
      ...init,
      signal: init.signal
        ? AbortSignal.any([init.signal, AbortSignal.timeout(15000)])
        : AbortSignal.timeout(15000),
    });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    console.warn("[API connection]", {
      method,
      endpoint,
      kind: error instanceof Error ? error.name : "UnknownError",
    });
    const caution =
      method === "POST"
        ? " Check Overview before trying again; the request may have reached the server."
        : " Check that the application is running, then retry.";
    throw new Error(
      `Unable to ${action}. The server could not be reached.${caution}`,
    );
  }
  if (response.status === 204) return null;
  let data;
  try {
    data = await response.json();
  } catch {
    console.warn("[API response]", {
      method,
      endpoint,
      status: response.status,
      kind: "InvalidJSON",
    });
    throw new Error(
      `Unable to ${action}. The server returned an unreadable response. Retry after restarting the application.`,
    );
  }
  if (!response.ok) {
    console.warn("[API response]", {
      method,
      endpoint,
      status: response.status,
    });
    throw new Error(
      `Unable to ${action}. ${typeof data.error === "string" ? data.error : "Please retry."}`,
    );
  }
  return data;
}
