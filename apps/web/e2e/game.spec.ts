import { expect, test, type Page } from "@playwright/test";

const MODEL_NAMES = /claude|opus|sonnet|haiku/i;
const verdict = (page: Page) => page.getByRole("button", { name: "Give your verdict" });
const reveal = (page: Page) => page.getByRole("region", { name: "The Gathering in the Library" });

/** Fail the test on any error the page logs or throws. */
function watchForErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

/** Before a decision: no author named, and every guest keeping a straight face. */
async function expectBlind(page: Page): Promise<void> {
  const letters = page.getByRole("article");
  await expect(letters.first()).toBeVisible();
  for (const letter of await letters.all()) {
    expect(await letter.innerText()).not.toMatch(MODEL_NAMES);
    await expect(letter.locator("img")).toHaveAttribute("data-expression", "neutral");
  }
}

/** Answer whatever kind of round is on the table, then give the verdict. */
async function answerAnyRound(page: Page): Promise<void> {
  const author = page.getByRole("button", { name: "Haiku 4.5" });
  const holds = page.getByRole("button", { name: "It holds" });
  const trust = page.getByRole("button", { name: "Trust letter A" });
  await expect(author.or(holds).or(trust)).toBeVisible();
  if (await author.isVisible()) {
    await author.click();
  } else if (await holds.isVisible()) {
    const skip = page.getByRole("button", { name: "Skip to the end" });
    if (await skip.isVisible()) await skip.click();
    await holds.click();
  } else {
    await trust.click();
  }
  await page.getByRole("button", { name: "A hunch" }).click();
  await verdict(page).click();
  await expect(reveal(page)).toBeVisible();
}

test("the lobby shows every mode, the player's rank, and the six guests", async ({ page }) => {
  const errors = watchForErrors(page);
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Poison Pen", level: 1 })).toBeVisible();
  for (const mode of [
    "A Weekend at Wrenfield",
    "The Drawing Room",
    "The Library Gathering",
    "Does the Timetable Hold?",
    "The Morning Post",
  ]) {
    await expect(page.getByRole("heading", { name: mode })).toBeVisible();
  }
  await expect(page.getByTestId("rank")).toHaveText("Guest");
  await expect(page.getByTestId("points")).toHaveText("0 points");
  await expect(page.getByText("Spotted the Impostor")).toBeVisible();
  await expect(page.getByRole("img", { name: "Colonel Archibald Pike" })).toBeVisible();
  await expect(page.locator("img[data-expression]")).toHaveCount(6);
  expect(errors).toEqual([]);
});

test("The Drawing Room: two letters, a blind choice, then the reveal", async ({ page }) => {
  const errors = watchForErrors(page);
  await page.goto("/drawing-room");

  await expect(page.getByRole("article")).toHaveCount(2);
  await expectBlind(page);
  await expect(page.getByRole("button", { name: "Accuse: one author, two seats" })).toBeVisible();
  await expect(verdict(page)).toBeDisabled();

  await page.getByRole("button", { name: "Trust letter A" }).click();
  await expect(verdict(page)).toBeDisabled();
  await page.getByRole("button", { name: "Fairly sure" }).click();
  await verdict(page).click();

  await expect(reveal(page)).toBeVisible();
  // A preference earns no points, whether or not the round was a trap.
  await expect(page.getByTestId("points-gained")).toContainText("0 points");
  await expect(page.getByText("You're among the first to dine here.")).toBeVisible();
  await expect(page.getByRole("article").first()).toContainText(/claude-(opus|sonnet|haiku)/);
  await expect(page.getByRole("article").first().locator("img")).toHaveAttribute(
    "data-expression",
    "happy",
  );
  await expect(page.getByRole("heading", { name: "Official benchmarks" })).toBeVisible();
  await expect(page.getByText("These measure different tasks from ours")).toBeVisible();
  expect(errors).toEqual([]);
});

test("The Library Gathering: three letters ranked", async ({ page }) => {
  const errors = watchForErrors(page);
  await page.goto("/library");

  await expect(page.getByRole("article")).toHaveCount(3);
  await expectBlind(page);
  for (const seat of ["B", "A", "C"]) {
    await page.getByRole("button", { name: `Letter ${seat}`, exact: true }).click();
  }
  await expect(page.getByText("Your order: B, A, C.")).toBeVisible();
  await page.getByRole("button", { name: "Certain" }).click();
  await verdict(page).click();

  await expect(reveal(page)).toBeVisible();
  await expect(reveal(page)).toContainText("You ranked them B, A, C.");
  const authors = await reveal(page)
    .getByText(/^Written by/)
    .allInnerTexts();
  expect(new Set(authors.map((text) => /claude-\w+-[\d-]+/.exec(text)?.[0])).size).toBe(3);
  expect(errors).toEqual([]);
});

test("Does the Timetable Hold?: a paused run and a call", async ({ page }) => {
  const errors = watchForErrors(page);
  await page.goto("/timetable");

  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByText("Sealed", { exact: true })).toBeVisible();
  await expectBlind(page);
  await expect(page.getByRole("button", { name: "Accuse: one author, two seats" })).toHaveCount(0);
  await page.getByRole("button", { name: "Skip to the end" }).click();
  await page.getByRole("button", { name: "It holds" }).click();
  await page.getByRole("button", { name: "A hunch" }).click();
  await verdict(page).click();

  await expect(reveal(page)).toBeVisible();
  await expect(page.getByTestId("points-gained")).toContainText(/\+40 points|^0 points/);
  await expect(reveal(page)).toContainText(/Quite right\.|Not so\./);
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
  await page.getByRole("button", { name: "Opus 5.5" }).click();
  await page.getByRole("button", { name: "A hunch" }).click();
  await verdict(page).click();
  await expect(reveal(page)).toBeVisible();
  await expect(page.getByTestId("points-gained")).toContainText(/\+100 points|^0 points/);

  await page.getByRole("button", { name: "The next letter" }).click();
  await expect(page.getByText("Round 2 of 10")).toBeVisible();

  // Reloading the address resumes the same game at the same round.
  await page.reload();
  await expect(page.getByText("Round 2 of 10")).toBeVisible();
  expect(errors).toEqual([]);
});

test("The Morning Post: five rounds and a result to share", async ({ page }) => {
  const errors = watchForErrors(page);
  await page.goto("/morning-post");

  await expect(page.getByText(/Morning Post No\. \d+/).first()).toBeVisible();
  for (let round = 0; round < 5; round += 1) {
    await expectBlind(page);
    await answerAnyRound(page);
    await page
      .getByRole("button", { name: round === 4 ? "See how it ended" : "The next letter" })
      .click();
  }

  await expect(page.getByTestId("share-text")).toHaveText(
    /^Poison Pen · Morning Post No\. \d+ [■□]{5}$/,
  );
  // The game is over for today, however often the page is opened.
  await page.reload();
  await expect(page.getByTestId("share-text")).toBeVisible();
  expect(errors).toEqual([]);
});

test("The Official Record and the Casebook reflect what was played", async ({ page }) => {
  const errors = watchForErrors(page);
  await page.goto("/record");

  await expect(page.getByRole("heading", { name: "Three rankings" })).toBeVisible();
  await expect(page.getByTestId("bias-pending")).toContainText("after 30 two-letter votes");
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
