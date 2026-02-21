export const BASE_URL = "https://gcp-8101.cicy.de5.net";
export const TOKEN_KEY = "ELECTRON_MCP_TOKEN";

export const getToken = () => localStorage.getItem(TOKEN_KEY) || "";
export const setToken = (token: string) => localStorage.setItem(TOKEN_KEY, token);
export const removeToken = () => localStorage.removeItem(TOKEN_KEY);

export async function rpc(tool: string, args: Record<string, any> = {}) {
  const token = getToken();
  const res = await fetch(`${BASE_URL}/rpc/${tool}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(args),
  });

  if (res.status === 401) {
    removeToken();
    throw new Error("Unauthorized");
  }

  return res;
}

export async function rpcJson<T = any>(tool: string, args: Record<string, any> = {}): Promise<T> {
  const res = await rpc(tool, args);
  if (!res.ok) {
    throw new Error(`rpc/${tool} → ${res.status}`);
  }
  const data = await res.json();
  // The original code expects the result to be in data.result.content[0].text and JSON parsed
  // We need to be careful if the API returns something else.
  // Based on the provided HTML: JSON.parse(data.result.content[0].text);
  if (data.result && Array.isArray(data.result.content) && data.result.content[0]?.text) {
     return JSON.parse(data.result.content[0].text);
  }
  return data as T; 
}

export function getSnapshotUrl(winId: number, quality: number, scale: number) {
  const token = getToken();
  return `${BASE_URL}/ui/snapshot?win_id=${winId}&quality=${quality}&scale=${scale}&token=${encodeURIComponent(token)}`;
}
