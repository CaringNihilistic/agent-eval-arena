import type { NextConfig } from "next";

// Inside Docker Desktop, file change events do not cross the Windows bind mount.
// The compose file sets NEXT_DEV_POLL so the dev server polls there; on the host it does not.
const pollInContainer = process.env.NEXT_DEV_POLL === "1";

const nextConfig: NextConfig = {
  transpilePackages: ["@arena/schema"],
  ...(pollInContainer ? { watchOptions: { pollIntervalMs: 1000 } } : {}),
};

export default nextConfig;
