import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

/** 刷新 session 並擋下未登入者進入 /admin(/admin/login 例外)。 */
export async function middleware(req: NextRequest) {
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-admin-path", req.nextUrl.pathname);
  let res = NextResponse.next({ request: { headers: requestHeaders } });
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    // 讓登入頁在尚未設定環境時仍可顯示；實際資料頁仍由 requireMember() 以 server-side 設定守門。
    return res;
  }

  const supabase = createServerClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(list: { name: string; value: string; options: CookieOptions }[]) {
          for (const { name, value } of list) req.cookies.set(name, value);
          res = NextResponse.next({ request: { headers: requestHeaders } });
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
  // 登入頁不能只憑 session 判定工作區；有效帳號可能已被移除所有後台權限。
  // 實際品牌／系統權限由登入後的 server route 與各頁 guard 驗證。
  return res;
}

export const config = {
  matcher: ["/admin/:path*"],
};
