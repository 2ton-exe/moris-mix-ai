export function createRequestId(): string {
  return crypto.randomUUID();
}

export function withRequestId(response: Response, requestId: string): Response {
  const headers = new Headers(response.headers);
  headers.set("X-Request-ID", requestId);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function logRequestFailure(
  requestId: string,
  endpoint: string,
  status: number,
): void {
  console.error(JSON.stringify({
    event: "request_failed",
    request_id: requestId,
    endpoint,
    status,
  }));
}
