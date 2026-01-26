# Code Review Global: Speechmatics Voice Engine

**Date**: 2026-01-26
**Scope**: ~7,000+ lignes de code dans 15+ fichiers
**Reviewers**: 6 agents parallèles (Claude)

---

## Executive Summary

| Catégorie | Critical | High | Medium | Low | Total |
|-----------|----------|------|--------|-----|-------|
| Core Engine | 0 | 5 | 11 | 7 | 23 |
| Audio Processing | 2 | 0 | 7 | 9 | 18 |
| Transcription | 0 | 5 | 9 | 11 | 25 |
| Error Handling | 6 | 6 | 5 | 3 | 20 |
| API Endpoints | 2 | 5 | 5 | 4 | 16 |
| Tests & Types | 0 | 3 | 5 | 4 | 12 |
| **Total** | **10** | **24** | **42** | **38** | **114** |

---

## Issues CRITICAL (10)

### 1. Sentry Integration Manquante (Error Handling)
- **Fichiers**: Tous les speechmatics-*.ts
- **Impact**: Erreurs voice complètement invisibles en production
- **Action**: Ajouter Sentry.captureException sur tous les catch blocks

### 2. API Keys Exposées (API Endpoints)
- **Fichier**: `src/app/api/speechmatics-token/route.ts:18`
- **Impact**: Clé API Speechmatics accessible publiquement
- **Action**: Supprimer endpoint ou ajouter auth

### 3. API Keys Exposées (API Endpoints)
- **Fichier**: `src/app/api/elevenlabs-token/route.ts:18`
- **Impact**: Clé API ElevenLabs accessible publiquement
- **Action**: Supprimer endpoint ou ajouter auth

### 4. WebSocket Errors Non Trackées (Error Handling)
- **Fichier**: `speechmatics-websocket.ts:304-313`
- **Impact**: Erreurs de connexion silencieuses en prod
- **Action**: Sentry.captureException avec contexte WS

### 5. Quota Errors Non Trackées (Error Handling)
- **Fichier**: `speechmatics-websocket.ts:337-351`
- **Impact**: Impossible de détecter les problèmes de quota
- **Action**: Sentry.captureException avec tags business

### 6. LLM API Errors Non Trackées (Error Handling)
- **Fichier**: `speechmatics-llm.ts:58-61`
- **Impact**: Échecs LLM invisibles
- **Action**: Sentry avec status_code, provider, model

### 7. Auth Failures Non Trackées (Error Handling)
- **Fichier**: `speechmatics-auth.ts:52-55`
- **Impact**: Problèmes auth invisibles
- **Action**: Sentry.captureException

### 8. AGC Coefficients Incorrects (Audio Processing)
- **Fichier**: `public/speechmatics-audio-processor.js:81-82`
- **Impact**: AGC 128x plus lent que prévu
- **Action**: Corriger calcul pour buffer-based processing

### 9. Pas de Fallback AudioWorklet (Audio Processing)
- **Fichier**: `speechmatics-audio.ts:203-208`
- **Impact**: Échec total sur browsers anciens
- **Action**: Implémenter fallback ScriptProcessorNode

### 10. JSON.parse Sans Try-Catch (API Endpoints)
- **Fichier**: `start-of-turn/route.ts:168, 255`
- **Impact**: Crash sur réponse AI malformée
- **Action**: Wrap dans try-catch

---

## Issues HIGH (24)

### Core Engine (5)
1. **Queue sans limite** - `speechmatics.ts:100-101` - Peut grandir indéfiniment
2. **Race condition partials** - `speechmatics.ts:564-567` - Flag reset non atomique
3. **Token validation tardive** - `speechmatics.ts:279-289` - Check après connect
4. **Memory leak TranscriptionManager** - `speechmatics.ts:886` - Pas de null après cleanup
5. **Memory leak timers** - `speechmatics-websocket.ts:631-643` - setInterval non-cleared

### Transcription (5)
1. **Pas de timeout max** - `speechmatics-transcription.ts:400-415` - Si EndOfUtterance jamais reçu
2. **Pas de timeout speaker confirmation** - `speechmatics-transcription.ts:62` - Système bloqué
3. **Pas de timeout server Mistral** - `api/semantic-turn/route.ts:54-67` - Request peut hang
4. **JSON.parse sans try-catch Anthropic** - `start-of-turn/route.ts:168`
5. **JSON.parse sans try-catch OpenAI** - `start-of-turn/route.ts:255`

### Error Handling (6)
1. **TTS playback errors** - `speechmatics-audio.ts:720-728` - Silent en prod
2. **Start-of-turn AI errors** - `speechmatics-audio.ts:1018-1021` - Silent
3. **AudioWorklet load fail** - `speechmatics-audio.ts:203-207` - No Sentry
4. **User message errors** - `speechmatics-transcription.ts:509-529` - No Sentry
5. **Speechmatics API errors** - `speechmatics.ts:494-516` - No Sentry
6. **No max retry** - `speechmatics-websocket.ts` - Infinite reconnection possible

### API Endpoints (5)
1. **No auth speechmatics-jwt** - Génération tokens illimitée
2. **No auth speechmatics-llm** - LLM calls illimités
3. **No auth semantic-turn** - Mistral calls illimités
4. **No auth start-of-turn** - Anthropic/OpenAI calls illimités
5. **No input validation** - speechmatics-llm pas de Zod schema

### Tests (3)
1. **speechmatics-websocket.ts** - Aucun test
2. **speechmatics-audio.ts** - Aucun test
3. **speechmatics.ts** - Aucun test d'intégration

---

## Issues MEDIUM (42)

### Core Engine (11)
- Disconnect state inconsistency (speechmatics.ts:326-334)
- Premature return in disconnect (speechmatics-websocket.ts:401-406)
- Queue processing inconsistent (speechmatics.ts:746-759)
- Generation state desync (speechmatics.ts:95-110)
- DRY: speaker filtering duplicated (speechmatics.ts:407-419, 448-460)
- DRY: history update duplicated (speechmatics.ts:576-582, 691-698)
- RecognitionStarted race (speechmatics-websocket.ts:151-385)
- Partial during generation (speechmatics.ts:366-370)
- Orphan SemanticTurnDetector (speechmatics.ts:123-124)
- WS close not awaited (speechmatics.ts:833-916)
- disconnectPromise ownership (speechmatics-websocket.ts:63)

### Audio Processing (7)
- Spectral energy flawed (speechmatics-audio.ts:792-803)
- Fuzzy threshold 25% trop aggressive (speechmatics-audio.ts:1076)
- 600ms validation timeout (speechmatics-audio.ts:58)
- Downsampling aliasing (speechmatics-audio-processor.js:154-165)
- Memory allocation hot path (speechmatics-audio-processor.js:216-220)
- AudioContext close race (speechmatics-audio.ts:418-419)
- No adaptive barge-in timeout

### Transcription (9)
- Timeouts hardcodés (speechmatics-transcription.ts:79-81)
- Speaker filtering duplicated
- Boundary dedup 6 words max (speechmatics-segment-store.ts:178)
- removeStale() never called
- SegmentStore key precision (toFixed(3))
- Multiple EndOfUtterance
- Binary probability oversimplistic
- Mutable conversationHistory
- semanticHoldStartedAt unused

### Error Handling (5)
- TTS error doesn't remove from history (speechmatics.ts:719-730)
- Quota delay 10s insuffisant
- No exponential backoff
- Invalid segments silently skipped
- devLog keeps voice errors dev-only

### API Endpoints (5)
- No rate limiting anywhere
- Unused params semantic-turn
- JSON.parse risks
- thinkingBudgetTokens no validation
- Inconsistent error formats

### Tests (5)
- No WebSocket failure tests
- No quota error recovery tests
- No barge-in timeout tests
- conversationHistory mutable not tested
- processingLock not tested

---

## Issues LOW (38)

*(Détails dans les rapports individuels)*

---

## Plan d'Action Recommandé

### Phase 1: Immédiat (1-2 jours)
1. Supprimer/protéger `speechmatics-token` et `elevenlabs-token`
2. Ajouter Sentry aux 6 points critiques identifiés
3. Fixer AGC coefficients dans AudioWorklet
4. Wrap JSON.parse dans try-catch

### Phase 2: Court terme (1 semaine)
1. Ajouter auth à tous les API endpoints voice
2. Ajouter rate limiting
3. Implémenter max retries WebSocket
4. Ajouter timeouts manquants (speaker confirmation, absolute failsafe)
5. Fixer AudioWorklet fallback

### Phase 3: Moyen terme (2 semaines)
1. Écrire tests pour speechmatics-websocket.ts
2. Écrire tests pour speechmatics-audio.ts
3. Refactor DRY violations (speaker filtering, history updates)
4. Standardiser error responses API
5. Ajouter Zod schemas

### Phase 4: Long terme
1. Implémenter exponential backoff
2. Améliorer types (JSDoc, stricter WebSocket types)
3. Performance: JWT caching
4. Cleanup code mort (speechmatics-ws-proxy)

---

## Métriques de Code

| Fichier | Lignes | Complexité | Tests |
|---------|--------|------------|-------|
| speechmatics.ts | 1,291 | Haute | Non |
| speechmatics-audio.ts | 1,270 | Très haute | Non |
| speechmatics-websocket.ts | 648 | Moyenne | Non |
| speechmatics-transcription.ts | 1,022 | Haute | Partiel |
| speechmatics-segment-store.ts | ~300 | Moyenne | Oui |
| speechmatics-auth.ts | 94 | Basse | Oui |
| speechmatics-llm.ts | ~100 | Basse | Partiel |
| speechmatics-audio-dedupe.ts | ~60 | Basse | Oui |
| speechmatics-audio-processor.js | 250 | Moyenne | Non |

---

## Rapport Généré Par

6 agents Claude en parallèle:
- Agent 1: Core Engine Review
- Agent 2: Audio Processing Review
- Agent 3: Transcription & Turn Detection Review
- Agent 4: Error Handling & Observability Review
- Agent 5: API Endpoints Review
- Agent 6: Tests & Types Review

Temps total: ~5 minutes (vs ~3h15 en séquentiel)
