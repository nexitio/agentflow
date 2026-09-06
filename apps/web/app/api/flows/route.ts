import { proxyToApi } from "../../../lib/proxy";

export async function GET(request: Request): Promise<Response> {
  return proxyToApi(request, "/api/flows");
}

export async function POST(request: Request): Promise<Response> {
  return proxyToApi(request, "/api/flows");
}
