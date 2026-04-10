# Smart Analyze

AI-powered sales analytics platform. Analyzes CRM deals (text chats + audio calls), finds success/failure patterns, rates managers, and provides actionable recommendations.

## Core Features

1. **Dashboard** — sales funnel, conversion rates, revenue potential, key metrics
2. **Manager Rating** — performance table with drill-down per manager
3. **Deal Analysis** — AI analysis of each deal with specific quotes and recommendations
4. **Pattern Library** — success vs failure patterns with metrics (strength, impact, reliability, coverage)
5. **CRM Integration** — Bitrix24 (primary), extensible to other CRMs
6. **Audio Transcription** — speech-to-text for call recordings

## Tech Stack

- **Frontend:** Next.js + TypeScript + shadcn/ui + Tremor (charts)
- **Backend:** Next.js API routes + PostgreSQL
- **AI:** Claude API (deal analysis, pattern extraction, recommendations)
- **Transcription:** WhisperX
- **CRM:** Bitrix24 REST API (@2bad/bitrix)

## Status

Project kickoff — requirements gathering phase.
