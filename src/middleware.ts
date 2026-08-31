import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value);
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  // Refresh the session (important for keeping users logged in)
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Routes that bypass SESSION auth. Not unauthenticated — each one below
  // authenticates its own caller, because none of them has a browser session
  // to check:
  //
  //   /api/inbound     Postmark's webhook. HTTP Basic against
  //                    INBOUND_WEBHOOK_BASIC, plus an optional IP allowlist.
  //   /api/cron/*      pg_cron calling back into the app. Bearer CRON_SECRET.
  //   /api/health      no auth by design; reports booleans, never values.
  //
  // Leaving these out is not a safe default — it is a silent outage. The
  // middleware redirects them to /login with a 307, which Postmark records as
  // a delivery failure and pg_cron as a no-op, and neither surfaces as an
  // error anywhere. Caught exactly that way on the first live deploy.
  //
  // /api/ingest is deliberately NOT here: it is the authenticated manual-paste
  // endpoint and derives user_id from the session.
  const publicPaths = [
    "/login",
    "/signup",
    "/auth/callback",
    "/api/health",
    "/api/inbound",
    "/api/cron",
  ];
  const isPublic = publicPaths.some((p) => request.nextUrl.pathname.startsWith(p));

  // If not logged in and trying to access protected route, redirect to login
  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // If logged in and trying to access login/signup, redirect to dashboard
  if (user && (request.nextUrl.pathname === "/login" || request.nextUrl.pathname === "/signup")) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    // Run middleware on all routes except static files and images
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
