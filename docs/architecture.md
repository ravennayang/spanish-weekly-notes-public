# Architecture

Mi Cuaderno Español is a browser-first learning app with a small serverless API layer.

In one sentence: **Vercel frontend + Vercel API route + Supabase Auth/Database + OpenAI organization + browser OCR/localStorage backup**.

## System Overview

```mermaid
flowchart TD
    U["User<br/>Desktop / mobile browser"] --> V["Vercel site<br/>index.html"]

    V --> UI["Space-themed frontend UI"]
    UI --> OCR["Tesseract.js OCR<br/>Browser-side image text extraction"]
    UI --> LS["localStorage<br/>Local backup"]

    UI --> AUTH["Supabase Auth<br/>Email magic link sign-in"]
    AUTH --> TOKEN["Supabase access token"]

    UI --> DB["Supabase Database<br/>public.notes"]
    DB --> RLS["Row Level Security<br/>Users can only access their own notes"]

    UI --> API["Vercel Serverless API<br/>/api/organize"]
    TOKEN --> API

    API --> CHECK["Verify Supabase token<br/>Check ALLOWED_AI_EMAILS"]
    CHECK --> OAI["OpenAI Responses API<br/>gpt-5.5"]

    OAI --> JSON["Organized JSON<br/>topic / vocab / sentences / grammar"]
    JSON --> UI
    UI --> DB
    UI --> MD["Markdown export<br/>Vocabulary / sentences / grammar"]
```

## AI Organization Flow

```mermaid
sequenceDiagram
    participant User
    participant App as Vercel frontend
    participant Supa as Supabase
    participant API as /api/organize
    participant OpenAI as OpenAI API

    User->>App: Upload class screenshots
    App->>App: Run Tesseract.js OCR
    User->>App: Sign in with email magic link
    App->>Supa: Get session and access token
    User->>App: Click AI organize
    App->>API: POST OCR text + Supabase token
    API->>Supa: Verify token and email allowlist
    API->>OpenAI: Request OCR organization
    OpenAI-->>API: Return structured JSON
    API-->>App: topic / vocab / sentences / grammar
    App->>Supa: Save note to public.notes
    App->>App: Keep localStorage backup
```

## Data Storage

- `public.notes`: primary cloud note storage protected by Supabase Row Level Security.
- `localStorage`: browser-side backup for offline or not-yet-signed-in usage.
- Markdown export: manual offline export created by the user.

## Security Boundaries

- The OpenAI API key is only read from server-side environment variables.
- The browser never receives the OpenAI API key.
- `/api/organize` requires a valid Supabase access token.
- `ALLOWED_AI_EMAILS` can restrict AI usage to selected email addresses.
- Supabase RLS policies limit users to their own notes.
- Supabase anon keys are public by design, but this project loads them from environment variables to keep the repository reusable.
