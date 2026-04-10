import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { getToken } from "next-auth/jwt"

export async function proxy(request: NextRequest) {
  const token = await getToken({ req: request })
  const { pathname } = request.nextUrl

  // Allow auth pages and API routes
  const isAuthPage = pathname === "/login" || pathname === "/register"
  const isAuthApi = pathname.startsWith("/api/auth")

  if (!token && !isAuthPage && !isAuthApi) {
    const loginUrl = new URL("/login", request.url)
    return NextResponse.redirect(loginUrl)
  }

  // Redirect authenticated users away from auth pages
  if (token && isAuthPage) {
    return NextResponse.redirect(new URL("/", request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    "/((?!_next|favicon\\.ico|sitemap\\.xml|robots\\.txt).*)",
  ],
}
