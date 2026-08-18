/**
 * Shared proxy helper — forwards requests from Next.js (port 3010) to the
 * Hono API (port 3001), relaying cookies bidirectionally.
 *
 * In production, Caddy handles this (same origin). In dev, the browser can't
 * call port 3001 directly because auth cookies must be set on the origin
 * the browser talks to.
 */

const API_URL = process.env.API_URL ?? "http://localhost:3001";

export async function proxyToApi(
  request: Request,
  apiPath: string,
): Promise<Response> {
  const url = new URL(request.url);
  const targetUrl = `${API_URL}${apiPath}${url.search}`;

  const headers = new Headers();
  for (const [key, value] of request.headers.entries()) {
    if (key !== "host" && key !== "connection") {
      headers.set(key, value);
    }
  }

  const init: RequestInit = {
    method: request.method,
    headers,
    redirect: "manual",
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = await request.arrayBuffer();
  }

  const response = await fetch(targetUrl, init);

  const responseHeaders = new Headers();
  for (const [key, value] of response.headers.entries()) {
    if (key === "set-cookie") {
      responseHeaders.append(key, value);
    } else if (key !== "transfer-encoding") {
      responseHeaders.set(key, value);
    }
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
}
