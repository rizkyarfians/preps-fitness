import { createAuthClient } from "better-auth/react";
import type { Me } from "./contracts";
export const apiOrigin = (
  import.meta.env.VITE_API_ORIGIN || window.location.origin
).replace(/\/$/, "");
export const auth = createAuthClient({
  baseURL: apiOrigin,
  basePath: "/api/v1/auth",
});
export class ApiError extends Error {
  constructor(
    public status: number,
    public reasonCode: string,
    public requestId?: string,
  ) {
    super(reasonCode);
  }
}
export async function request<T>(
  path: string,
  signal?: AbortSignal,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${apiOrigin}/api/v1${path}`, {
      credentials: "include",
      signal,
      cache: "no-store",
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiError(0, "NETWORK_ERROR");
  }
  const body = await response.json().catch(() => null);
  if (!response.ok)
    throw new ApiError(
      response.status,
      body?.error?.reasonCode || "SERVICE_UNAVAILABLE",
      body?.error?.requestId,
    );
  if (!body?.data) throw new ApiError(502, "INVALID_RESPONSE");
  return body.data as T;
}
export const getMe = (signal?: AbortSignal) => request<Me>("/me", signal);
export const getBranch = (id: string, signal?: AbortSignal) =>
  request<{ id: string; name: string }>(
    `/branches/${encodeURIComponent(id)}`,
    signal,
  );
export function errorText(error: unknown): string {
  if (!(error instanceof ApiError))
    return "Terjadi kendala. Silakan coba lagi.";
  if (error.status === 401) return "Sesi berakhir. Silakan masuk kembali.";
  if (error.status === 403)
    return "Akses tidak tersedia. Hubungi admin gym untuk memeriksa izin akun atau cabang.";
  if (error.status === 404) return "Cabang tidak ditemukan. Hubungi admin gym.";
  if (error.status === 0)
    return "Koneksi terputus. Periksa internet lalu coba lagi.";
  return "Layanan belum dapat dihubungi. Silakan coba lagi.";
}
