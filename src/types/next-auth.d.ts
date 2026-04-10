import { UserRole } from "@/generated/prisma"
import { DefaultSession } from "next-auth"

declare module "next-auth" {
  interface Session {
    user: {
      id: string
      tenantId: string
      role: UserRole
    } & DefaultSession["user"]
  }

  interface User {
    tenantId: string
    role: UserRole
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string
    tenantId: string
    role: UserRole
  }
}
