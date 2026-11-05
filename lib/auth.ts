import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type Role = "planner" | "procurement" | "viewer";

export interface SessionProfile {
  userId: string;
  email: string;
  role: Role;
}

export const HOME_BY_ROLE: Record<Role, string> = {
  planner: "/overview",
  procurement: "/procurement",
  viewer: "/dashboard",
};

/**
 * Who is signed in. Wrapped in React's cache so the layout and the page share one lookup per request
 * instead of each asking Supabase again.
 */
export const getSessionProfile = cache(async (): Promise<SessionProfile | null> => {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data: profile } = await supabase.from("profiles").select("role, email").eq("id", auth.user.id).maybeSingle();
  if (!profile) return null;
  return { userId: auth.user.id, email: profile.email, role: profile.role as Role };
});

/** For pages: redirect to login, or to the user's home when the role is not allowed. */
export async function requireRole(allowed: Role[]): Promise<SessionProfile> {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  if (!allowed.includes(session.role)) redirect(HOME_BY_ROLE[session.role]);
  return session;
}

/** For server actions and route handlers: throw instead of redirecting. */
export async function assertRole(allowed: Role[]): Promise<SessionProfile> {
  const session = await getSessionProfile();
  if (!session || !allowed.includes(session.role)) throw new Error("Not allowed");
  return session;
}
