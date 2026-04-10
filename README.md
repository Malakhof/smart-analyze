# Smart Analyze

AI-powered sales analytics platform. Analyzes CRM deals (text chats + audio calls), finds success/failure patterns, rates managers, and provides actionable recommendations with specific quotes.

## Tech Stack

- **Frontend:** Next.js 15 + TypeScript + shadcn/ui + Tremor (charts) + Tailwind CSS
- **Backend:** Next.js API routes + Prisma + PostgreSQL
- **AI:** DeepSeek V3 API (OpenAI-compatible)
- **Transcription:** Whisper API (MVP), WhisperX self-hosted (post-payment)
- **CRM:** Bitrix24 + amoCRM (adapter pattern)
- **Auth:** NextAuth.js
- **Deploy:** Docker + Timeweb server

## Getting Started

```bash
cp .env.example .env        # fill in values
docker compose up -d postgres
npm install
npx prisma migrate dev
npm run dev
```

## Docs

- `docs/briefs/` — feature briefs
- `docs/plans/` — implementation plans
- `docs/ui-specification.md` — full UI spec from reference product
- `prototype-final.html` — approved design prototype (open in browser)
