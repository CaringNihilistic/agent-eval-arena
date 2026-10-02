import { existsSync } from "node:fs";
import { join } from "node:path";

import { EXPRESSIONS, GUEST_IDS } from "@/lib/guests";
import { respond } from "@/server/http";

/** File types a portrait may be, best first: a dropped-in illustration beats the built-in drawing. */
const FORMATS = ["png", "svg"] as const;

/**
 * Which portrait file exists for each guest and expression, so an illustration
 * saved as public/guests/<id>/<expression>.png replaces the SVG with no code change.
 */
export async function GET(): Promise<Response> {
  return respond(async () => {
    const root = join(process.cwd(), "public", "guests");
    return Object.fromEntries(
      GUEST_IDS.map((guest) => [
        guest,
        Object.fromEntries(
          EXPRESSIONS.map((expression) => {
            const format = FORMATS.find((ext) =>
              existsSync(join(root, guest, `${expression}.${ext}`)),
            );
            return [expression, format ? `/guests/${guest}/${expression}.${format}` : null];
          }),
        ),
      ]),
    );
  });
}
