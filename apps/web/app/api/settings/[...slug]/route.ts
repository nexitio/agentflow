import { proxyToApi } from "../../../../lib/proxy";

function slugPath(slug: string[]): string {
  return `/api/settings/${slug.join("/")}`;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string[] }> },
): Promise<Response> {
  const { slug } = await params;
  return proxyToApi(request, slugPath(slug));
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string[] }> },
): Promise<Response> {
  const { slug } = await params;
  return proxyToApi(request, slugPath(slug));
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ slug: string[] }> },
): Promise<Response> {
  const { slug } = await params;
  return proxyToApi(request, slugPath(slug));
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ slug: string[] }> },
): Promise<Response> {
  const { slug } = await params;
  return proxyToApi(request, slugPath(slug));
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ slug: string[] }> },
): Promise<Response> {
  const { slug } = await params;
  return proxyToApi(request, slugPath(slug));
}
