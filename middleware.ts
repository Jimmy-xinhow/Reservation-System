import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

/** 刷新 session 並擋下未登入者進入 /admin(/admin/login 例外)。 */
export async function middleware(req: NextRequest) {
  let res = NextResponse.next({ request: req });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(list: { name: string; value: string; options: CookieOptions }[]) {
          for (const { name, value } of list) req.cookies.set(name, value);
          res = NextResponse.next({ request: req });
          for (const { name, value, options } of list) res.cookies.set({ name, value, ...options });
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = req.nextUrl.pathname;
  const isLogin = path.startsWith("/admin/login");
  if (path.startsWith("/admin") && !isLogin && !user) {
    const url = req.nextUrl.clone();
    url.pathname = "/admin/login";
    return NextResponse.redirect(url);
  }
  if (isLogin && user) {
    const url = req.nextUrl.clone();
    url.pathname = "/admin";
    return NextResponse.redirect(url);
  }
  return res;
}

export const config = {
  matcher: ["/admin/:path*"],
};
