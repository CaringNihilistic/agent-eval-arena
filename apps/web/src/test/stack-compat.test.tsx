// Guards the Next.js 16 / React 19 decision: every UI library in the stack must
// import and render under the installed React. If an upgrade breaks one, this fails.
import type { TraceEvent } from "@arena/schema";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { ReactFlow, type Edge, type Node } from "@xyflow/react";
import { Line, LineChart, XAxis } from "recharts";
import { describe, expect, it } from "vitest";

import { Button } from "@/components/ui/button";

describe("stack compatibility", () => {
  it("renders a shadcn/ui component", () => {
    render(<Button>Vote</Button>);

    expect(screen.getByRole("button", { name: "Vote" })).toBeInTheDocument();
  });

  it("resolves a TanStack Query", async () => {
    function Answer() {
      const { data } = useQuery({ queryKey: ["answer"], queryFn: async () => 42 });
      return <p>{data === undefined ? "loading" : `answer ${data}`}</p>;
    }

    render(
      <QueryClientProvider client={new QueryClient()}>
        <Answer />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("answer 42")).toBeInTheDocument();
  });

  it("renders a React Flow graph", () => {
    const nodes: Node[] = [
      { id: "llm", position: { x: 0, y: 0 }, data: { label: "llm_call" } },
      { id: "tool", position: { x: 0, y: 100 }, data: { label: "tool_call" } },
    ];
    const edges: Edge[] = [{ id: "llm-tool", source: "llm", target: "tool" }];

    const { container } = render(
      <div style={{ width: 400, height: 300 }}>
        <ReactFlow nodes={nodes} edges={edges} />
      </div>,
    );

    expect(container.querySelector(".react-flow")).not.toBeNull();
    expect(screen.getByText("llm_call")).toBeInTheDocument();
  });

  it("renders a Recharts chart", () => {
    const data = [
      { step: 1, cost: 0.001 },
      { step: 2, cost: 0.003 },
    ];

    const { container } = render(
      <LineChart width={300} height={200} data={data}>
        <XAxis dataKey="step" />
        <Line dataKey="cost" isAnimationActive={false} />
      </LineChart>,
    );

    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("narrows generated trace event types by `type`", () => {
    const event: TraceEvent = {
      run_id: "run_01",
      side: "left",
      seq: 3,
      type: "tool_result",
      timestamp: "2026-10-01T12:00:00Z",
      redacted: false,
      payload: {
        step: 1,
        call_id: "c1",
        tool: "calculator",
        output: "4",
        truncated: false,
        success: true,
        latency_ms: 3,
        error: null,
      },
    };

    // Compiles only if the union is discriminated on `type`.
    const output = event.type === "tool_result" ? event.payload.output : null;

    expect(output).toBe("4");
  });
});
