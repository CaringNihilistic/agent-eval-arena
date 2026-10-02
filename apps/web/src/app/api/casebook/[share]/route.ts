import { respond } from "@/server/http";
import { sharedCasebook } from "@/server/round-service";
import { store } from "@/server/store";

/** A Casebook by its share id. Anyone with the link may read it. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ share: string }> },
): Promise<Response> {
  return respond(async () => sharedCasebook(store(), (await params).share));
}
