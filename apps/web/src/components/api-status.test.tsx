import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiStatus } from "@/components/api-status";
import type { Health } from "@/lib/api";

function renderStatus() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ApiStatus />
    </QueryClientProvider>,
  );
}

function respondWith(health: Health) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(health)),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ApiStatus", () => {
  it("shows the API and sandbox as healthy", async () => {
    respondWith({ status: "ok", version: "0.1.0", sandbox: "ok" });

    renderStatus();

    expect(await screen.findByText("API online")).toBeInTheDocument();
    expect(screen.getByText("Sandbox reachable")).toBeInTheDocument();
    expect(screen.getByText("v0.1.0")).toBeInTheDocument();
  });

  it("flags an unreachable sandbox while the API is up", async () => {
    respondWith({ status: "ok", version: "0.1.0", sandbox: "unreachable" });

    renderStatus();

    expect(await screen.findByText("Sandbox unreachable")).toBeInTheDocument();
    expect(screen.getByText("API online")).toBeInTheDocument();
  });

  it("says the API is unreachable when the request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network down");
      }),
    );

    renderStatus();

    expect(await screen.findByText("API unreachable")).toBeInTheDocument();
  });

  it("says the API is unreachable on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("boom", { status: 500 })),
    );

    renderStatus();

    expect(await screen.findByText("API unreachable")).toBeInTheDocument();
  });

  it("requests the health endpoint on the API origin", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ status: "ok", version: "0.1.0", sandbox: "ok" } satisfies Health),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderStatus();
    await screen.findByText("API online");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8000/api/health",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});
