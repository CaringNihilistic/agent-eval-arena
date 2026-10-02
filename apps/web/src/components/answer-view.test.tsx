import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AnswerView, diagramCode } from "@/components/answer-view";

const mermaid = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(),
}));
vi.mock("mermaid", () => ({ default: mermaid }));

beforeEach(() => {
  mermaid.initialize.mockReset();
  mermaid.render.mockReset();
});

describe("a model's answer rendered as markdown", () => {
  it("renders ordinary markdown", () => {
    render(<AnswerView category="writing" answer={"**Subject:** hello\n\n- one\n- two"} />);

    expect(screen.getByText("Subject:").tagName).toBe("STRONG");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("shows a <script> tag as plain text and never as an element", () => {
    const { container } = render(
      <AnswerView
        category="explanation"
        answer={"Before <script>window.hacked = true</script> after"}
      />,
    );

    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("<script>window.hacked = true</script>");
    expect((window as unknown as { hacked?: boolean }).hacked).toBeUndefined();
  });

  it("shows an onerror attribute as plain text and creates no image for it", () => {
    const { container } = render(
      <AnswerView category="writing" answer={'<img src="x" onerror="window.hacked = true">'} />,
    );

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("[onerror]")).toBeNull();
    expect(container.textContent).toContain('onerror="window.hacked = true"');
  });

  it("does not turn a javascript: link into a working link", () => {
    const { container } = render(
      <AnswerView category="writing" answer={"[click](javascript:alert(1))"} />,
    );

    const href = container.querySelector("a")?.getAttribute("href") ?? "";
    expect(href).not.toContain("javascript:");
  });

  it("keeps HTML inside a fenced block as text too", () => {
    const { container } = render(
      <AnswerView category="code" answer={"```html\n<script>alert(1)</script>\n```"} />,
    );

    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("<script>alert(1)</script>");
  });

  it("says so when there is no answer", () => {
    render(<AnswerView category="agent" answer={null} />);

    expect(screen.getByText("No answer was given.")).toBeInTheDocument();
  });
});

describe("a model's diagram", () => {
  const code = "flowchart TD\n  A[Start] --> B[End]";

  it("is drawn by Mermaid at the strict security level", async () => {
    mermaid.render.mockResolvedValue({ svg: '<svg data-testid="drawn"></svg>' });

    render(<AnswerView category="diagram" answer={`\`\`\`mermaid\n${code}\n\`\`\``} />);

    await waitFor(() => expect(screen.getByTestId("drawn")).toBeInTheDocument());
    expect(mermaid.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ securityLevel: "strict", startOnLoad: false }),
    );
    expect(mermaid.render.mock.calls[0][1]).toBe(code);
  });

  it("falls back to the source as plain text when it cannot be drawn", async () => {
    mermaid.render.mockRejectedValue(new Error("Parse error"));
    const broken = 'flowchart TD\n  A["<img src=x onerror=alert(1)>"] --> ';

    const { container } = render(<AnswerView category="diagram" answer={broken} />);

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("could not be drawn"));
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<img src=x onerror=alert(1)>");
  });

  it("is shown as text when the answer is not Mermaid at all", () => {
    render(<AnswerView category="diagram" answer="I cannot draw that." />);

    expect(screen.getByText("I cannot draw that.")).toBeInTheDocument();
    expect(mermaid.render).not.toHaveBeenCalled();
  });

  it("takes the code out of a fence", () => {
    expect(diagramCode("```mermaid\nflowchart TD\n  A --> B\n```")).toBe("flowchart TD\n  A --> B");
    expect(diagramCode("  sequenceDiagram\n  A->>B: hi ")).toBe("sequenceDiagram\n  A->>B: hi");
  });
});
