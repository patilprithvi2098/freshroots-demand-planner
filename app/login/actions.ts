"use server";

import { z } from "zod";
import { HOME_BY_ROLE, type Role } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { emailForUsername, normaliseUsername, USERNAME_PATTERN } from "@/lib/usernames";

const schema = z.object({
  username: z.string().transform(normaliseUsername).pipe(z.string().regex(USERNAME_PATTERN)),
  password: z.string().min(1).max(200),
});

const WRONG = "Incorrect username or password.";

export async function signInAction(input: { username: string; password: string }): Promise<{ ok: true; home: string } | { ok: false; error: string }> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: WRONG };
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: emailForUsername(parsed.data.username),
    password: parsed.data.password,
  });
  if (error || !data.user) {
    if (error?.status === 429) return { ok: false, error: "Too many attempts. Wait a minute and try again." };
    return { ok: false, error: WRONG };
  }
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", data.user.id).maybeSingle();
  if (!profile) {
    await supabase.auth.signOut();
    return { ok: false, error: "This account has no role yet. Ask your administrator." };
  }
  return { ok: true, home: HOME_BY_ROLE[profile.role as Role] };
}
