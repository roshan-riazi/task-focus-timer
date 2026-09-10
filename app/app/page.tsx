import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Workspace } from "@/components/tasks/workspace";
import { getSession } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Focus — FocusFlow" };

/**
 * Focus workspace (spec §9.2–§9.3, issue 08): task list + timer slot.
 * Signed-out visitors go to /login — tasks are per-user and the API would
 * 401 anyway (spec §11.5), so the gate keeps the URL honest.
 */
export default async function FocusPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  return <Workspace />;
}
