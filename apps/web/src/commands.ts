import { ApiError, apiOrigin } from "./api";
export type Command = {
  path: string;
  method: string;
  body: object;
  key: string;
};
export class Failure extends ApiError {
  fields: { field: string; code: string }[];
  constructor(
    status: number,
    e: {
      reasonCode?: string;
      requestId?: string;
      fieldErrors?: { field: string; code: string }[];
    },
  ) {
    super(status, e.reasonCode || "SERVICE_UNAVAILABLE", e.requestId);
    this.fields = e.fieldErrors || [];
  }
}
export async function call<T>(
  path: string,
  signal: AbortSignal,
  command?: Command,
  body?: object,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${apiOrigin}/api/v1${path}`, {
      credentials: "include",
      cache: "no-store",
      signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
      method: command?.method || (body ? "POST" : "GET"),
      headers:
        command || body
          ? {
              "Content-Type": "application/json",
              ...(command ? { "Idempotency-Key": command.key } : {}),
            }
          : undefined,
      body: command || body ? JSON.stringify(command?.body || body) : undefined,
    });
  } catch (e) {
    if (signal.aborted) throw e;
    throw new Failure(0, { reasonCode: "NETWORK_ERROR" });
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Failure(response.status, data?.error || {});
  if (!data?.data) throw new Failure(502, { reasonCode: "INVALID_RESPONSE" });
  return data.data;
}
