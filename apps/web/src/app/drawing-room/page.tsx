import type { Metadata } from "next";

import { ModePage } from "@/components/game/mode-page";

export const metadata: Metadata = { title: "The Drawing Room · Poison Pen" };

export default function DrawingRoomPage() {
  return (
    <ModePage mode="drawing_room">
      Two letters on one matter. Trust the better one, call them equal, or trust neither. If you
      think one author wrote both, accuse: fifty points if you are right, thirty lost if you are
      not. A preference earns no points; it goes on the Official Record.
    </ModePage>
  );
}
