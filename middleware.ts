import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/auth/callback", "/api/cron", "/unavailable"];

/** Longest the sign-in check may wait for Supabase before showing the "waking up" page. */
const AUTH_TIMEOUT_MS = 5_000;

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet) => {
          for (const { name, value } of toSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
        },
      },
    },
  );
  const path = request.nextUrl.pathname;
  if (path.startsWith("/unavailable") || path.startsWith("/api/cron")) return response;

  // If the database is paused or unreachable, show a clear page instead of hanging until Vercel times out.
  const result = await Promise.race([
    supabase.auth.getUser().then((r) => ({ ok: true as const, user: r.data.user })),
    new Promise<{ ok: false }>((resolve) => setTimeout(() => resolve({ ok: false }), AUTH_TIMEOUT_MS)),
  ]).catch(() => ({ ok: false as const }));
  if (!result.ok) {
    const url = request.nextUrl.clone();
    url.pathname = "/unavailable";
    url.search = "";
    return NextResponse.rewrite(url, { status: 503 });
  }
  const data = { user: result.user };
  if (!data.user && !PUBLIC_PATHS.some((p) => path.startsWith(p))) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|ico|webp|jpe?g|gif)$).*)"],
};
