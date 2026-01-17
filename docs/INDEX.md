# Technical Documentation - Agentic Design Flow

> **For AI tools**: This is the entry point. Read this file first.

## What is this project?

An AI-powered insight collection platform. Users create "ASK sessions" where an AI agent conducts interviews with participants to gather qualitative feedback.

**Tech stack**: Next.js 14 (App Router), Supabase (PostgreSQL + Auth), OpenAI, ElevenLabs

## Quick Navigation

| I want to... | Read |
|--------------|------|
| Understand the database schema | [architecture/database-schema.md](architecture/database-schema.md) |
| Configure an AI agent | [ai-system/agent-configuration.md](ai-system/agent-configuration.md) |
| Understand RLS permissions | [security/rls-guide.md](security/rls-guide.md) |
| Understand voice mode architecture | [features/voice-mode-architecture.md](features/voice-mode-architecture.md) |
| Set up ElevenLabs TTS | [features/voice-elevenlabs.md](features/voice-elevenlabs.md) |
| Deploy the application | [architecture/deployment.md](architecture/deployment.md) |

## Project Structure

```
/src/
├── app/           # Next.js App Router pages and API routes
├── components/    # React components
├── lib/           # Utilities (Supabase clients, API helpers)
├── hooks/         # Custom React hooks
├── types/         # TypeScript type definitions
└── context/       # React context providers

/migrations/       # SQL migration files
/docs/             # This documentation
```

---

## Documentation by Topic

### Architecture

| File | Description |
|------|-------------|
| [database-schema.md](architecture/database-schema.md) | Complete Supabase schema, tables, relationships |
| [database-migrations.md](architecture/database-migrations.md) | Migration system and procedures |
| [deployment.md](architecture/deployment.md) | Deployment guidelines (Vercel) |
| [supabase-auth.md](architecture/supabase-auth.md) | Authentication setup and migration |

### Security

| File | Description |
|------|-------------|
| [rls-guide.md](security/rls-guide.md) | Row Level Security implementation |
| [rls-permissions-matrix.md](security/rls-permissions-matrix.md) | Permission matrix by role |
| [participant-auth.md](security/participant-auth.md) | Participant authentication flow |
| [google-oauth.md](security/google-oauth.md) | Google OAuth setup |
| [security-audit.md](security/security-audit.md) | Security audit findings |

### AI System

| File | Description |
|------|-------------|
| [agent-configuration.md](ai-system/agent-configuration.md) | Agent configuration with template variables |
| [conversation-agent-reference.md](ai-system/conversation-agent-reference.md) | Complete agent reference (comprehensive) |
| [challenge-builder.md](ai-system/challenge-builder.md) | Challenge builder V2 architecture |
| [challenge-builder-quickstart.md](ai-system/challenge-builder-quickstart.md) | Quick start for challenge builder |
| [ask-generator.md](ai-system/ask-generator.md) | ASK generation prompt docs |
| [prompts-chaining.md](ai-system/prompts-chaining.md) | Prompt chaining and slug management |

### Features

| File | Description |
|------|-------------|
| [text-chat-mode.md](features/text-chat-mode.md) | **Text chat mode** - main conversation system |
| [voice-mode-architecture.md](features/voice-mode-architecture.md) | **Voice mode** - real-time speech conversation architecture |
| [consultant-mode.md](features/consultant-mode.md) | Consultant mode for AI-assisted interviews |
| [step-completion-system.md](features/step-completion-system.md) | Step completion system for guided conversations |
| [conversation-threads.md](features/conversation-threads.md) | Conversation threads and session isolation |
| [voice-elevenlabs.md](features/voice-elevenlabs.md) | ElevenLabs voice synthesis setup |
| [magic-link.md](features/magic-link.md) | Magic link authentication |
| [handlebars-templates.md](features/handlebars-templates.md) | Handlebars templating guide |
| [date-pickers.md](features/date-pickers.md) | Date picker component docs |

### Troubleshooting

| File | Description |
|------|-------------|
| [conversation-system-bugs.md](troubleshooting/conversation-system-bugs.md) | **Bug audit** - Known bugs in conversation system (text/voice/consultant modes) |

### Guides

| File | Description |
|------|-------------|
| [coding-standards.md](guides/coding-standards.md) | Development standards and coding philosophy |

### SQL Utilities

| File | Description |
|------|-------------|
| [prompts-order-query.sql](sql/prompts-order-query.sql) | SQL query for prompt ordering |

---

## Archive (Deprecated)

Old documentation kept for reference. **Do not use for new development.**

| File | Status |
|------|--------|
| [challenge-builder-v1.md](archive/challenge-builder-v1.md) | Superseded by V2 |
| [challenge-builder-optimized.md](archive/challenge-builder-optimized.md) | Superseded by V2 |
| [challenge-builder-migration.md](archive/challenge-builder-migration.md) | One-time migration |
| [agent-migration.md](archive/agent-migration.md) | One-time migration |
| [conversation-plan-migration.md](archive/conversation-plan-migration.md) | One-time migration |
| [conversation-plan-testing.md](archive/conversation-plan-testing.md) | Legacy testing docs |

---

## Key Concepts

### ASK Sessions
The core entity - a conversation session where an AI agent interviews participants.

### Challenges
Structured interview guides with steps and prompts that define what questions the agent asks.

### Participants
External users who join ASK sessions via invite links to provide feedback.

### Profiles
Internal users (admins, moderators) who create and manage ASK sessions.

---

## Related Root Files

- **README.md** - Project overview and setup instructions
- **CLAUDE.md** - Development workflow and AI agent instructions
- **PRODUCT.md** - Product positioning and personas
