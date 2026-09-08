import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ensureRequestId, REQUEST_ID_HEADER } from "./lib/request-id";

/**
 * Issues (or propagates) the request ID for API traffic so structured logs
 * and scrubbed error reports correlate without carrying user content.
 * The ID is set on both the forwarded request headers (so route handlers
 * observe the same ID they log under) and the response (so clients can
 * quote it in bug reports).
 */
export function middleware(request: NextRequest): NextResponse {
  const requestId = ensureRequestId(request.headers.get(REQUEST_ID_HEADER));
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(REQUEST_ID_HEADER, requestId);
  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}

export const config = {
  matcher: "/api/:path*",
};
