import { NextResponse } from "next/server"
import { z } from "zod"
import bcrypt from "bcryptjs"
import { db } from "@/lib/db"

const registerSchema = z.object({
  companyName: z.string().min(1, "Company name is required"),
  email: z.string().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
})

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const result = registerSchema.safeParse(body)

    if (!result.success) {
      return NextResponse.json(
        { error: result.error.issues[0].message },
        { status: 400 },
      )
    }

    const { companyName, email, password } = result.data

    const existingUser = await db.user.findUnique({
      where: { email },
    })

    if (existingUser) {
      return NextResponse.json(
        { error: "User with this email already exists" },
        { status: 409 },
      )
    }

    const hashedPassword = await bcrypt.hash(password, 12)

    await db.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: companyName,
        },
      })

      await tx.user.create({
        data: {
          email,
          password: hashedPassword,
          role: "OWNER",
          tenantId: tenant.id,
        },
      })
    })

    return NextResponse.json(
      { message: "Account created successfully" },
      { status: 201 },
    )
  } catch {
    return NextResponse.json(
      { error: "Something went wrong" },
      { status: 500 },
    )
  }
}
