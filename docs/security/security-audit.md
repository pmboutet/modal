# Security Audit Report

## Overview
This document captures the key findings from a targeted security review of the public ASK-related APIs in this repository. The assessment focused on risks related to injection attacks, cross-site scripting (XSS), and broader access-control weaknesses that could expose sensitive data or allow unauthorized modifications.

## Findings

### 1. ASK session lookup accepted fuzzy/partial keys
* **Risk**: High (authorization bypass / data exposure)
* **Details**: The helper `getAskSessionByKey` previously fell back to `ILIKE` searches with prefix/suffix wildcards whenever an exact match on `ask_key` failed. Because the supplied key string was user-controlled and accepted after minimal validation, an attacker could supply only a fragment of a real key (e.g., the first character) and the query would still return a matching ASK session. Combined with the service-role Supabase client used in public endpoints, this effectively allowed unauthenticated enumeration of ASK sessions and their data.
* **Remediation**: The lookup now trims the provided key, rejects empty values, and performs a single exact equality match, eliminating wildcard-based discovery paths.【F:src/lib/asks.ts†L1-L37】
* **Status**: Remediated.

### 2. Public ASK API routes ran with service-role privileges and no authentication
* **Risk**: Critical (full read/write of protected data)
* **Details**: The public route handlers under `/api/ask/[key]` relied on `getAdminSupabaseClient`, which uses the Supabase service-role key. Combined with fuzzy key matching, unauthenticated callers could retrieve complete session transcripts, participants, insights, and could insert arbitrary messages.
* **Remediation**: Both GET and POST handlers now execute with the RLS-respecting server client, require an authenticated Supabase user, verify ASK participant membership, and translate permission denials into 401/403 responses rather than defaulting to administrator-level access in production. Development environments may deliberately bypass authentication by setting `IS_DEV=true`, mirroring earlier workflows while retaining the hardened defaults for deployed instances.【F:src/app/api/ask/[key]/route.ts†L118-L520】
* **Status**: Remediated.

### 3. Challenge update endpoint was exposed without authentication
* **Risk**: High (unauthorized modifications)
* **Details**: The `/api/challenges/[key]` `PUT` handler reused the ASK key lookup plus the service-role client to update challenge records. Without any authentication, any caller who could guess an ASK key could arbitrarily modify challenge metadata.
* **Remediation**: The endpoint now requires an authenticated administrator (via `requireAdmin`) and operates through the standard server client so that RLS policies remain in force. Permission errors are surfaced as 401/403 responses instead of silently succeeding with service-role privileges.【F:src/app/api/challenges/[key]/route.ts†L1-L163】
* **Status**: Remediated.

### 4. Streaming endpoint reused service-role access for AI prompts
* **Risk**: Critical (session transcript exfiltration & unauthorized AI actions)
* **Details**: The ASK streaming route at `/api/ask/[key]/stream` previously executed entirely with the service-role client, exposing transcript history, participant rosters, and downstream AI actions without authenticating the caller.
* **Remediation**: The route now authenticates the caller, validates their membership in the ASK session, routes all Supabase queries through the RLS-aware server client, and gracefully handles permission denials. AI-generated message inserts and follow-up insight detection reuse the caller’s session instead of elevated credentials. As with the REST handlers, development builds can opt into the legacy bypass by setting `IS_DEV=true` while production continues to enforce authentication.【F:src/app/api/ask/[key]/stream/route.ts†L1-L720】
* **Status**: Remediated.

## Positive Observations
* React components render user-generated message content using JSX interpolation, which is escaped by default, mitigating straightforward XSS attempts in chat transcripts.【F:src/components/chat/ChatComponent.tsx†L420-L470】
* Input validation and sanitation utilities exist for admin-oriented endpoints (`zod` schemas and `sanitizeText`), reducing the likelihood of injection when those routes are properly gated.【F:src/app/api/admin/profiles/route.ts†L1-L103】【F:src/lib/sanitize.ts†L1-L11】

## Summary
The primary risks that originally stemmed from exposing service-role Supabase operations through unauthenticated public APIs have been mitigated. ASK lookups now demand exact keys, routes enforce Supabase authentication and participant membership (or administrator approval), and the streaming endpoint executes with least privilege. Continued attention to rate limiting, monitoring for brute-force key attempts, and reviewing AI provider integrations (e.g., Deepgram streaming requirements) remains recommended as follow-up hardening.
