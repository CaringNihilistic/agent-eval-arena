// The six guests at Wrenfield Hall. A guest is a costume a letter is shown in;
// it says nothing about which model wrote the letter.

export const GUEST_IDS = ["constance", "pike", "ambrose", "ivy", "julian", "pell"] as const;
export type GuestId = (typeof GUEST_IDS)[number];

export const EXPRESSIONS = ["neutral", "happy", "shocked", "flustered"] as const;
export type Expression = (typeof EXPRESSIONS)[number];

export interface Guest {
  id: GuestId;
  name: string;
  role: string;
  description: string;
  quote: string;
}

export const GUESTS: readonly Guest[] = [
  {
    id: "constance",
    name: "Lady Constance Wrenfield",
    role: "The Dowager",
    description: "Mistress of the Hall for fifty years, and of every conversation in it.",
    quote: "In my day, a letter had a proper beginning, middle and end.",
  },
  {
    id: "pike",
    name: "Colonel Archibald Pike",
    role: "The Retired Colonel",
    description: "Thirty years in the service, and no patience for a sentence that wanders.",
    quote: "Facts, man! Facts! Then dinner.",
  },
  {
    id: "ambrose",
    name: "Dr. Felix Ambrose",
    role: "The Village Doctor",
    description: "Sees everyone in the county at their worst, and writes none of it down.",
    quote: "I merely observe. The conclusions are yours.",
  },
  {
    id: "ivy",
    name: "Miss Ivy Hartley",
    role: "The Companion",
    description: "Reads aloud to Lady Constance, and misses nothing said over the top of the book.",
    quote: "Oh, I wouldn't know. Though I did happen to notice...",
  },
  {
    id: "julian",
    name: "Mr. Julian Vane",
    role: "The Charming Nephew",
    description: "Down from town for the weekend, with debts he does not mention.",
    quote: "Darling, I'd never write anything so dull. Probably.",
  },
  {
    id: "pell",
    name: "Mrs. Dorcas Pell",
    role: "The Housekeeper",
    description: "Holds every key in the house and the history of every room.",
    quote: "I keep the house, sir. I don't gossip about it.",
  },
];

export function guest(id: GuestId): Guest {
  const found = GUESTS.find((item) => item.id === id);
  if (!found) throw new Error(`No guest ${id}`);
  return found;
}

export function isGuestId(value: unknown): value is GuestId {
  return typeof value === "string" && (GUEST_IDS as readonly string[]).includes(value);
}
