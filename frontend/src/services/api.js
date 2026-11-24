export async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  const body = await response.json();
  if (!response.ok)
    throw new Error(
      body.error?.message || `Request failed (${response.status})`,
    );
  return body;
}
export function control(path, method, body, token) {
  return api(path, {
    method,
    headers: { Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
}
export function params(values) {
  return new URLSearchParams(
    Object.entries(values).filter(
      ([, v]) => v !== "" && v !== null && v !== undefined,
    ),
  ).toString();
}
export const format = (n, d = 1) =>
  n === null || n === undefined
    ? "—"
    : Number(n).toLocaleString(undefined, { maximumFractionDigits: d });
export const time = (v) =>
  v
    ? new Date(v).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "Awaiting data";
