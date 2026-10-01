"use client";

import { useQuery } from "@tanstack/react-query";

import { Badge } from "@/components/ui/badge";
import { fetchHealth, type SandboxStatus } from "@/lib/api";

const SANDBOX_LABEL: Record<SandboxStatus, string> = {
  ok: "Sandbox reachable",
  unreachable: "Sandbox unreachable",
  not_configured: "Sandbox not configured",
};

export function ApiStatus() {
  const { data, isPending, isError } = useQuery({
    queryKey: ["health"],
    queryFn: ({ signal }) => fetchHealth(signal),
    refetchInterval: 15_000,
  });

  if (isPending) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Checking the API…
      </p>
    );
  }

  if (isError) {
    return (
      <div role="status" className="flex flex-wrap items-center gap-2">
        <Badge variant="destructive">API unreachable</Badge>
        <span className="text-sm text-muted-foreground">
          Start the backend with <code className="font-mono">docker compose up</code>.
        </span>
      </div>
    );
  }

  return (
    <div role="status" className="flex flex-wrap items-center gap-2">
      <Badge>API online</Badge>
      <Badge variant={data.sandbox === "ok" ? "secondary" : "destructive"}>
        {SANDBOX_LABEL[data.sandbox]}
      </Badge>
      <span className="font-mono text-sm text-muted-foreground">v{data.version}</span>
    </div>
  );
}
