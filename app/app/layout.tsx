import type { ReactNode } from "react";

// Authenticated segment (spec §9.2): every page under /app gates on the
// session, so nothing here may be statically prerendered. Besides being
// semantically wrong (per-user content), prerendering opens the Prisma
// client at build time — and the Docker image builds with no DATABASE_URL.
export const dynamic = "force-dynamic";

export default function AppSegmentLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <>{children}</>;
}
