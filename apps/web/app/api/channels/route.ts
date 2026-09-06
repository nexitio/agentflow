import { proxyToApi } from "../../../lib/proxy";

export async function GET(request: Request): Promise<Response> {
  return proxyToApi(request, "/api/channels");
}
