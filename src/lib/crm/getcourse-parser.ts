export interface GcCall {
  id: string
  date: string
  type: string
  subject: string
  managerName: string
  audioUrl: string | null
  clientPhone: string | null
  transcription: string | null
}

export interface GcUser {
  id: string
  email: string
  name: string
  phone: string | null
  type: string
}

export async function fetchGcCalls(
  accountUrl: string,
  cookie: string
): Promise<GcCall[]> {
  const res = await fetch(`${accountUrl}/pl/user/contact/index`, {
    headers: { Cookie: cookie },
  })
  const html = await res.text()
  return parseCallsTable(html)
}

export async function fetchGcCallDetail(
  accountUrl: string,
  cookie: string,
  callId: string
): Promise<GcCall> {
  const res = await fetch(
    `${accountUrl}/user/control/contact/update/id/${callId}`,
    { headers: { Cookie: cookie } }
  )
  const html = await res.text()
  return parseCallCard(html, callId)
}

export async function fetchGcUsers(
  accountUrl: string,
  cookie: string
): Promise<GcUser[]> {
  const res = await fetch(`${accountUrl}/pl/user/user/index`, {
    headers: { Cookie: cookie },
  })
  const html = await res.text()
  return parseUsersTable(html)
}

function parseCallsTable(html: string): GcCall[] {
  const calls: GcCall[] = []
  const rowRegex = /contact\/update\/id\/(\d+)/g
  let match
  while ((match = rowRegex.exec(html)) !== null) {
    calls.push({
      id: match[1],
      date: "",
      type: "",
      subject: "",
      managerName: "",
      audioUrl: null,
      clientPhone: null,
      transcription: null,
    })
  }
  return [...new Map(calls.map((c) => [c.id, c])).values()]
}

function parseCallCard(html: string, callId: string): GcCall {
  let transcription: string | null = null
  const noteMatch = html.match(/note-editable[^>]*>([\s\S]*?)<\/div>/)
  if (noteMatch) {
    transcription = noteMatch[1].replace(/<[^>]+>/g, " ").trim()
  }

  const audioMatch = html.match(/(https?:\/\/[^\s"]+\.(?:mp3|wav|ogg))/)
  const audioUrl = audioMatch ? audioMatch[1] : null

  const titleMatch = html.match(/Contact_title[^>]*value="([^"]*)"/)
  const subject = titleMatch ? titleMatch[1] : ""

  return {
    id: callId,
    date: "",
    type: "call",
    subject,
    managerName: "",
    audioUrl,
    clientPhone: null,
    transcription,
  }
}

function parseUsersTable(html: string): GcUser[] {
  const users: GcUser[] = []
  const emailRegex = /[\w.+-]+@[\w-]+\.[\w.]+/g
  const idRegex = /user\/update\/id\/(\d+)/g

  const emails = [...new Set(html.match(emailRegex) || [])]
  const ids = [...new Set([...html.matchAll(idRegex)].map((m) => m[1]))]

  for (let i = 0; i < Math.min(emails.length, ids.length); i++) {
    users.push({
      id: ids[i],
      email: emails[i],
      name: "",
      phone: null,
      type: "student",
    })
  }
  return users
}
