/** Read-only availability gate, not a substitute for any pipeline health check. */
export type DatabaseHealthProbe = {
  ok: boolean;
  reason: "reachable" | "timeout" | "query_failed" | "transport_failed" | "invalid_response";
  code: string | null;
  elapsedMs: number;
};

type ReadResult = { data: unknown; error: unknown };

export async function probeDatabaseHealth(
  read: (signal: AbortSignal) => PromiseLike<ReadResult>,
  timeoutMs = 8_000,
): Promise<DatabaseHealthProbe> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = Symbol("database-health-timeout");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const result = (reason: DatabaseHealthProbe["reason"], code: string | null = null) => ({
    ok: reason === "reachable", reason, code, elapsedMs: Math.max(0, Date.now() - startedAt),
  });

  try {
    const response = await Promise.race([
      // The race also bounds a broken/non-cooperative transport. Abort the real
      // request as well; do not leave a timed-out probe running in the background.
      Promise.resolve().then(() => read(controller.signal)),
      new Promise<typeof timeout>((resolve) => {
        timer = setTimeout(() => { resolve(timeout); controller.abort(); }, timeoutMs);
      }),
    ]);
    if (response === timeout || controller.signal.aborted) return result("timeout");
    if (response.error) {
      const code = typeof response.error === "object" && "code" in response.error
        ? String(response.error.code ?? "") : "";
      // Never publish upstream HTML, SQL text, credentials or arbitrary errors.
      return result("query_failed", /^(?:[A-Z0-9]{5}|PGRST\d{3})$/.test(code) ? code : null);
    }
    return result(Array.isArray(response.data) ? "reachable" : "invalid_response");
  } catch {
    return result(controller.signal.aborted ? "timeout" : "transport_failed");
  } finally {
    clearTimeout(timer);
  }
}
