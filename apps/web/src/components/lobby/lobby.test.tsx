import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { GuestRow } from "@/components/lobby/guest-row";
import { HallScene } from "@/components/lobby/hall-scene";
import { Reveal } from "@/components/lobby/reveal";
import { ROOMS } from "@/lib/rooms";
import { PLAYABLE_MODES } from "@/lib/types";

vi.mock("@/lib/client-api", () => ({ fetchArt: async () => ({}) }));

function show(ui: ReactElement) {
  return render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
}

describe("the picture of Wrenfield Hall", () => {
  it("has a part of the Hall that leads to every open room, and to no closed one", () => {
    show(<HallScene />);

    expect(ROOMS.map((room) => room.mode)).toEqual([...PLAYABLE_MODES]);
    const links = screen.getAllByRole("link");
    // In the order Tab reaches them: the main game first, then the challenge.
    expect(links.map((link) => link.getAttribute("aria-label"))).toEqual([
      "The front door: The Drawing Room",
      "The west window: A Weekend at Wrenfield",
    ]);
    expect(links.map((link) => link.getAttribute("href"))).toEqual(ROOMS.map((room) => room.href));
  });

  it("says where a part leads when it is pointed at or reached by keyboard", async () => {
    const user = userEvent.setup();
    show(<HallScene />);
    const caption = screen.getByTestId("hall-caption");
    const window = screen.getByRole("link", { name: "The west window: A Weekend at Wrenfield" });

    expect(caption).toHaveTextContent("Try the front door");
    await user.hover(window);
    expect(caption).toHaveTextContent("The west window");
    expect(caption).toHaveTextContent("A Weekend at Wrenfield");
    expect(window).toHaveAttribute("data-active", "true");
    await user.unhover(window);
    expect(caption).toHaveTextContent("Try the front door");

    // The first stop for a keyboard is the front door, which is the main game.
    await user.tab();
    expect(caption).toHaveTextContent("The Drawing Room");
    await user.tab();
    expect(caption).toHaveTextContent("A Weekend at Wrenfield");
  });

  it("describes the picture to someone who cannot see it", () => {
    show(<HallScene />);

    expect(screen.getByRole("group", { name: /Wrenfield Hall at night/ })).toBeInTheDocument();
  });
});

describe("the guests in the lobby", () => {
  it("keep a straight face until one is pointed at, who then brightens and speaks", async () => {
    const user = userEvent.setup();
    show(<GuestRow />);
    const pike = screen.getByRole("button", { name: /Colonel Archibald Pike/ });
    const line = screen.getByTestId("guest-line");

    expect(screen.getAllByRole("img")).toHaveLength(6);
    for (const portrait of screen.getAllByRole("img")) {
      expect(portrait).toHaveAttribute("data-expression", "neutral");
    }
    expect(line).toHaveTextContent("Point at a guest");

    await user.hover(pike);
    expect(within(pike).getByRole("img")).toHaveAttribute("data-expression", "happy");
    expect(line).toHaveTextContent("Facts, man! Facts! Then dinner.");

    await user.unhover(pike);
    expect(within(pike).getByRole("img")).toHaveAttribute("data-expression", "neutral");
    expect(line).toHaveTextContent("Point at a guest");
  });

  it("keeps a guest talking once clicked, and lets them go on a second click", async () => {
    const user = userEvent.setup();
    show(<GuestRow />);
    const ivy = screen.getByRole("button", { name: /Miss Ivy Hartley/ });

    await user.click(ivy);
    await user.unhover(ivy);
    expect(ivy).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("guest-line")).toHaveTextContent("I did happen to notice");

    await user.click(ivy);
    await user.unhover(ivy);
    expect(ivy).toHaveAttribute("aria-pressed", "false");
  });
});

describe("motion", () => {
  it("shows revealed content at once where the browser cannot watch scrolling", () => {
    // jsdom has no IntersectionObserver, like an old browser.
    render(<Reveal>Here</Reveal>);

    expect(screen.getByText("Here")).toHaveAttribute("data-shown", "true");
  });

  it("is switched off for readers who ask for reduced motion", () => {
    const css = readFileSync(join(process.cwd(), "src", "app", "globals.css"), "utf8");
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));

    expect(reduced).toContain("animation: none");
    for (const name of [
      ".rise",
      ".reveal",
      ".lift",
      ".scene .ink",
      ".scene .pen",
      ".scene .hand",
    ]) {
      expect(reduced).toContain(name);
    }
    // Every animated class is covered: none animates outside the reduced-motion rule.
    const animated = [
      ...css.matchAll(/^ {2}(\.[\w .-]+) \{\n(?: {4}[^\n]*\n)*? {4}animation:/gm),
    ].map((match) => match[1]);
    expect(animated.length).toBeGreaterThan(6);
    for (const selector of animated) expect(reduced).toContain(selector);
  });
});
