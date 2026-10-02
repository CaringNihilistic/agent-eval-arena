// Shared pieces of the route handlers.

import { ServiceError } from "@/server/match-service";
import { StoreNotConfiguredError } from "@/server/store";

/** The caller's address as the proxy reports it. Used only as a keyed hash. */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "local";
}

/** Run a handler and turn its errors into JSON responses. Never cached. */
export async function respond(handler: () => Promise<unknown>, status = 200): Promise<Response> {
  const headers = { "Cache-Control": "no-store" };
  try {
    return Response.json(await handler(), { status, headers });
  } catch (error) {
    if (error instanceof ServiceError) {
      return Response.json({ error: error.message }, { status: error.status, headers });
    }
    if (error instanceof StoreNotConfiguredError) {
      return Response.json({ error: error.message }, { status: 503, headers });
    }
    console.error(error);
    return Response.json(
      { error: "Something went wrong on the server." },
      { status: 500, headers },
    );
  }
}

export async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await request.json();
    if (body !== null && typeof body === "object" && !Array.isArray(body)) {
      return body as Record<string, unknown>;
    }
  } catch {
    // Fall through to the error below.
  }
  throw new ServiceError(400, "The request body must be a JSON object.");
}
