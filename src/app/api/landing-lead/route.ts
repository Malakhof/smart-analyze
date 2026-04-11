import { NextRequest, NextResponse } from "next/server"

const AMO_SUBDOMAIN = process.env.AMOCRM_SUBDOMAIN || "malakhoffkiri"
const AMO_TOKEN = process.env.AMOCRM_ACCESS_TOKEN || ""

export async function POST(request: NextRequest) {
  // CORS headers
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  }

  try {
    const body = await request.json()
    const { name, phone, company } = body

    if (!name || !phone) {
      return NextResponse.json(
        { error: "name and phone are required" },
        { status: 400, headers }
      )
    }

    const payload = [
      {
        name: `SalesGuru: ${name}${company ? " — " + company : ""}`,
        _embedded: {
          contacts: [
            {
              name,
              custom_fields_values: [
                { field_code: "PHONE", values: [{ value: phone }] },
              ],
            },
          ],
          tags: [{ name: "salesguru-landing" }],
        },
      },
    ]

    const res = await fetch(
      `https://${AMO_SUBDOMAIN}.amocrm.ru/api/v4/leads/complex`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${AMO_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }
    )

    if (!res.ok) {
      const text = await res.text()
      console.error("amoCRM error:", res.status, text)
      return NextResponse.json(
        { error: "amoCRM error", status: res.status },
        { status: 502, headers }
      )
    }

    const data = await res.json()
    return NextResponse.json({ ok: true, data }, { headers })
  } catch (err) {
    console.error("Landing lead error:", err)
    return NextResponse.json(
      { error: "Internal error" },
      { status: 500, headers }
    )
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  })
}
