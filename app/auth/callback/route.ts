import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getSessionProfile, HOME_BY_ROLE } from "@/lib/auth";

// Handles both the PKCE code from the email link and token_hash links.
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const supabase = await createClient();
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = (url.searchParams.get("type") ?? "magiclink") as EmailOtpType;

  const { error } = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : tokenHash
      ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
      : { error: new Error("missing code") };
  if (error) return NextResponse.redirect(new URL("/login?error=link", url.origin));

  const session = await getSessionProfile();
  return NextResponse.redirect(new URL(session ? HOME_BY_ROLE[session.role] : "/login", url.origin));
}
