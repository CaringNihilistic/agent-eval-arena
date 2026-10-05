import { expect, test, type Page } from "@playwright/test";

// Every test plays as a fresh visitor whose id marks it as the test's, so its
// decisions can be removed from a real database afterwards (scripts/db.mjs).
const E2E_VOTER_PREFIX = "e2e00000-0000-4000-8000-";

test.beforeEach(async ({ page }) => {
  const suffix = Array.from({ length: 12 }, () => Math.floor(Math.random() * 16).toString(16));
  await page.addInitScript(
    (voterId) => window.localStorage.setItem("arena-voter-id", voterId),
    E2E_VOTER_PREFIX + suffix.join(""),
  );
});

const MODEL_NAMES = /claude|opus|sonnet|haiku/i;
const verdict = (page: Page) => page.getByRole("button", { name: "Give your verdict" });
const reveal = (page: Page) => page.getByRole("region", { name: "The reveal" });

/** Fail the test on any error the page logs or throws. */
function watchForErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

/**
 * Before a decision: no author named, every guest keeping a straight face, and
 * no working or step count, which would tell Haiku from the others.
 */
async function expectBlind(page: Page): Promise<void> {
  const letters = page.getByRole("article");
  await expect(letters.first()).toBeVisible();
  for (const letter of await letters.all()) {
    expect(await letter.innerText()).not.toMatch(MODEL_NAMES);
    await expect(letter.locator("img")).toHaveAttribute("data-expression", "neutral");
    await expect(letter.locator("details")).toHaveCount(0);
    await expect(letter).not.toContainText(/How it was written|Written in one sitting/);
  }
}

test("the lobby says what the site is and leads straight to the game", async ({ page }) => {
  const errors = watchForErrors(page);
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Poison Pen", level: 1 })).toBeVisible();
  // In plain words, before any of the fiction: three AI models, names hidden.
  await expect(page.getByText("A blind taste test of three AI models")).toBeVisible();
  await expect(page.getByText(/Claude Haiku 4\.5, Sonnet 5\.5, and Opus 5\.5/)).toBeVisible();
  for (const step of ["Read two answers", "Say which is better", "See who wrote them"]) {
    await expect(page.getByRole("heading", { name: step })).toBeVisible();
  }
  // Two rooms are open, and the three that closed are not offered.
  for (const mode of ["The Drawing Room", "A Weekend at Wrenfield"]) {
    await expect(page.getByRole("heading", { name: mode })).toBeVisible();
  }
  for (const closed of ["The Library Gathering", "Does the Timetable Hold?", "The Morning Post"]) {
    await expect(page.getByText(closed)).toHaveCount(0);
  }
  // A first-time visitor is not shown a rank or a list of distinctions.
  await expect(page.getByRole("img", { name: "Colonel Archibald Pike" })).toBeVisible();
  await expect(page.locator("img[data-expression]")).toHaveCount(6);
  await expect(page.getByTestId("rank")).toHaveCount(0);
  await expect(page.getByText("Spotted the Impostor")).toHaveCount(0);

  // The picture of the Hall is a way in: pointing at a part names the room.
  const westWindow = page.getByRole("link", { name: "The west window: A Weekend at Wrenfield" });
  await westWindow.hover();
  await expect(page.getByTestId("hall-caption")).toContainText("The west window");
  // A guest in the lobby brightens and speaks when pointed at.
  const pike = page.getByRole("button", { name: /Colonel Archibald Pike/ });
  await pike.hover();
  await expect(page.getByTestId("guest-line")).toContainText("Facts, man! Facts! Then dinner.");
  await expect(pike.locator("img")).toHaveAttribute("data-expression", "happy");

  // One click from the front page to two letters on the table.
  await page.getByRole("link", { name: "Play now" }).click();
  await expect(page).toHaveURL(/\/drawing-room$/);
  await expect(page.getByRole("article")).toHaveCount(2);
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link")).toHaveText([
    "Poison Pen",
    "Play",
    "Results",
    "My Casebook",
    "About",
  ]);
  expect(errors).toEqual([]);
});

test("the Hall's two ways in can be reached and used by keyboard alone", async ({ page }) => {
  const errors = watchForErrors(page);
  await page.goto("/");
  const spots = page.locator("a.spot");
  await expect(spots).toHaveCount(2);
  const names = ["The front door: The Drawing Room", "The west window: A Weekend at Wrenfield"];

  // Tab from the last control before the picture: the two parts come next, in this order.
  await page.getByRole("link", { name: "Or try the ten-round challenge" }).focus();
  for (const name of names) {
    await page.keyboard.press("Tab");
    const focused = page.locator(":focus");
    await expect(focused).toHaveAttribute("aria-label", name);
    // The focus indicator is the halo drawn around the part, fully opaque and thick.
    const halo = focused.locator(".halo");
    await expect(halo).toHaveCSS("opacity", "1");
    await expect(halo).toHaveCSS("stroke-width", "4px");
    await expect(page.getByTestId("hall-caption")).toContainText(name.split(": ")[1]);
  }
  // A part that does not have the focus shows no halo.
  await expect(spots.first().locator(".halo")).toHaveCSS("opacity", "0");

  // Enter on a focused part goes to its room.
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/weekend/);
  expect(errors).toEqual([]);
});

test("The Drawing Room: two letters, a blind choice, then the reveal", async ({ page }) => {
  const errors = watchForErrors(page);
  await page.goto("/drawing-room");

  await expect(page.getByRole("article")).toHaveCount(2);
  await expectBlind(page);
  await expect(page.getByText(/Two AI models answered the task below/)).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Which letter answers the task better?" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Accuse: the same model wrote both" }),
  ).toBeVisible();
  await expect(verdict(page)).toBeDisabled();

  await page.getByRole("button", { name: "Trust letter A" }).click();
  await expect(verdict(page)).toBeDisabled();
  await page.getByRole("button", { name: "Fairly sure" }).click();
  await verdict(page).click();

  await expect(reveal(page)).toBeVisible();
  // A preference earns no points, whether or not the round was a trap.
  await expect(page.getByTestId("points-gained")).toContainText("0 points");
  await expect(page.getByText("You are among the first to judge this pair.")).toBeVisible();
  await expect(page.getByRole("article").first()).toContainText(/claude-(opus|sonnet|haiku)/);
  // The working arrives with the reveal.
  await expect(page.getByRole("article").first()).toContainText(
    /How it was written \(\d+ steps?\)|Written in one sitting/,
  );
  await expect(page.getByRole("article").first().locator("img")).toHaveAttribute(
    "data-expression",
    "happy",
  );
  await expect(page.getByRole("heading", { name: "Official benchmarks" })).toBeVisible();
  await expect(page.getByText("These measure different tasks from ours")).toBeVisible();

  // Having played, the visitor now has a standing on the front page.
  await page.goto("/");
  await expect(page.getByTestId("rank")).toHaveText("Guest");
  await expect(page.getByTestId("points")).toHaveText("0 points");
  await expect(page.getByText("Spotted the Impostor")).toBeVisible();
  await expect(page.getByText("Master of the Library")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("the three closed rooms lead to the Drawing Room and deal nothing", async ({ page }) => {
  const errors = watchForErrors(page);
  for (const path of ["/library", "/timetable", "/morning-post"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/drawing-room$/);
  }
  await expect(page.getByRole("article")).toHaveCount(2);

  // The server refuses to deal a round in a closed room, whatever the page does.
  for (const mode of ["library", "timetable", "morning_post"]) {
    const response = await page.request.post("/api/rounds/next", {
      headers: { "X-Voter-Id": `${E2E_VOTER_PREFIX}000000000000` },
      data: { mode },
    });
    expect(response.status()).toBe(410);
  }
  expect(errors).toEqual([]);
});

test("A Weekend at Wrenfield: a seeded game that resumes from its address", async ({ page }) => {
  const errors = watchForErrors(page);
  await page.goto("/weekend");

  await expect(page.getByText("Round 1 of 10")).toBeVisible();
  await expect(page.getByRole("img", { name: "3 of 3 candles lit" })).toBeVisible();
  await expect(page).toHaveURL(/\/weekend\?seed=[a-z0-9]{10}$/);
  await expectBlind(page);

  // The first round asks who wrote one letter.
  await expect(
    page.getByRole("heading", { name: "Which AI model wrote this letter?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Opus 5.5" }).click();
  await page.getByRole("button", { name: "A hunch" }).click();
  await verdict(page).click();
  await expect(reveal(page)).toBeVisible();
  await expect(page.getByTestId("points-gained")).toContainText(/\+100 points|^0 points/);

  await page.getByRole("button", { name: "Next round" }).click();
  await expect(page.getByText("Round 2 of 10")).toBeVisible();

  // Reloading the address resumes the same game at the same round.
  await page.reload();
  await expect(page.getByText("Round 2 of 10")).toBeVisible();
  expect(errors).toEqual([]);
});

test("The Official Record and the Casebook reflect what was played", async ({ page }) => {
  const errors = watchForErrors(page);
  await page.goto("/record");

  await expect(page.getByRole("heading", { name: "Three rankings" })).toBeVisible();
  await expect(page.getByTestId("bias-pending")).toContainText("after 30 two-letter votes");
  await expect(page.getByTestId("ranking-pending")).toContainText(
    /Not enough votes yet \(\d+\/30\)/,
  );
  await page.getByRole("button", { name: "Code", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Our scorer" })).toBeVisible();

  await page.goto("/casebook");
  await expect(page.getByText("Your Casebook is not open yet.")).toBeVisible();
  await page.goto("/guests");
  await expect(page.getByRole("heading", { name: "Mrs. Dorcas Pell" })).toBeVisible();
  await page.goto("/about");
  await expect(page.getByText(/inspired by golden-age detective fiction/).first()).toBeVisible();
  expect(errors).toEqual([]);
});
