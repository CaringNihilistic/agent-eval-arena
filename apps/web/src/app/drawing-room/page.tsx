import type { Metadata } from "next";

import { ModePage } from "@/components/game/mode-page";

export const metadata: Metadata = { title: "The Drawing Room · Poison Pen" };

export default function DrawingRoomPage() {
  return (
    <ModePage mode="drawing_room">
      Two AI models answered the task below. Their names are hidden. Say which letter answers it
      better, call them equal, or trust neither, then see who wrote each. About one round in eight
      is a trick: the same model wrote both. Accuse it for fifty points if you are right, thirty
      lost if you are not.
    </ModePage>
  );
}
