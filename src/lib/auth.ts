import { AuthOptions } from "next-auth"
import { getServerSession } from "next-auth"
import CredentialsProvider from "next-auth/providers/credentials"
import bcrypt from "bcryptjs"
import { db } from "@/lib/db"

export const authOptions: AuthOptions = {
  // NOTE: PrismaAdapter removed — conflicts with CredentialsProvider
  // Session/user management handled manually via JWT callbacks
  session: {
    strategy: "jwt",
  },
  pages: {
    signIn: "/login",
  },
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        try {
          if (!credentials?.email || !credentials?.password) {
            console.log("[AUTH] Missing credentials")
            return null
          }

          console.log("[AUTH] Attempting login for:", credentials.email)

          const user = await db.user.findUnique({
            where: { email: credentials.email },
          })

          if (!user) {
            console.log("[AUTH] User not found:", credentials.email)
            return null
          }

          console.log("[AUTH] User found, checking password")

          const isPasswordValid = await bcrypt.compare(
            credentials.password,
            user.password,
          )

          if (!isPasswordValid) {
            console.log("[AUTH] Invalid password")
            return null
          }

          console.log("[AUTH] Login successful for:", user.email)
          return {
            id: user.id,
            email: user.email,
            name: user.name,
            tenantId: user.tenantId,
            role: user.role,
          }
        } catch (error) {
          console.error("[AUTH] Error in authorize:", error)
          return null
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.tenantId = user.tenantId
        token.role = user.role
      }
      return token
    },
    async session({ session, token }) {
      if (token) {
        session.user.id = token.id
        session.user.tenantId = token.tenantId
        session.user.role = token.role
      }
      return session
    },
  },
}

/**
 * Require an authenticated session. Throws if not authenticated.
 */
export async function requireAuth() {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    throw new Error("Unauthorized")
  }
  return session
}

/**
 * Require an authenticated session and return the tenant ID. Throws if not authenticated or no tenant.
 */
export async function requireTenantId(): Promise<string> {
  const session = await requireAuth()
  const tenantId = session.user.tenantId
  if (!tenantId) {
    throw new Error("Unauthorized: no tenant")
  }
  return tenantId
}
