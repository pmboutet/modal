# Enchaînement Logique des Prompts via les Slugs

## Vue d'ensemble

Le système utilise des **slugs** (identifiants uniques lisibles) pour référencer les agents AI dans la base de données. Ces slugs permettent un enchaînement logique des prompts selon des workflows spécifiques.

## Intérêt des Slugs

### 1. **Identification Unique et Lisible**
- Au lieu d'utiliser des UUID (ex: `a1b2c3d4-e5f6-7890-abcd-ef1234567890`), on utilise des slugs lisibles (ex: `challenge-revision-planner`)
- Facilite la compréhension du code et la maintenance
- Permet de référencer les agents de manière claire et explicite

### 2. **Configuration via Variables d'Environnement**
```typescript
const PLANNER_AGENT_SLUG = process.env.CHALLENGE_PLANNER_AGENT_SLUG ?? "challenge-revision-planner";
```
- Permet de changer facilement l'agent utilisé sans modifier le code
- Facilite les tests et le déploiement dans différents environnements

### 3. **Séparation des Préoccupations**
- Le code référence les agents par slug, pas par leurs prompts
- Les prompts peuvent être mis à jour dans la base de données sans toucher au code
- Facilite l'évolution et l'optimisation des prompts

### 4. **Traçabilité et Logging**
- Les slugs permettent d'identifier clairement quel agent a été utilisé dans les logs
- Facilite le debugging et l'analyse des performances

## Enchaînement Logique : Exemple avec Challenge Builder V2

### Architecture en Phases

Le système **Challenge Builder V2** illustre parfaitement l'enchaînement logique :

```
┌─────────────────────────────────────────────────────────┐
│ Phase 0: Graph RAG Enrichment (pas un agent)           │
│ - Clustering sémantique des insights                    │
│ - Synthèse des concepts dominants                      │
└─────────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────────┐
│ Phase 1: PLANNING (séquentiel)                         │
│ Agent: challenge-revision-planner                      │
│ Rôle: Analyse globale du projet                        │
│ Sortie: Plan d'actions (updates, créations, no-change) │
└─────────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────────┐
│ Phase 2: EXECUTION (parallèle)                         │
│ ├─ challenge-detailed-updater                          │
│ │  └─ Met à jour les challenges existants              │
│ │                                                      │
│ └─ challenge-detailed-creator                         │
│    └─ Crée de nouveaux challenges                     │
└─────────────────────────────────────────────────────────┘
```

### Détail de l'Enchaînement

#### Phase 1 : Planning
**Slug**: `challenge-revision-planner`
- **Input**: Contexte global du projet (challenges, insights, ASKs, Graph RAG)
- **Processus**: Analyse l'ensemble du projet et décide des actions à prendre
- **Output**: Plan structuré avec :
  - `updates`: Liste des challenges à mettre à jour
  - `creations`: Liste des nouveaux challenges à créer
  - `noChangeNeeded`: Challenges qui ne nécessitent pas de modification

#### Phase 2 : Execution (Parallèle)
**Slug**: `challenge-detailed-updater`
- **Input**: Contexte d'un challenge spécifique + plan de mise à jour
- **Processus**: Génère les détails de mise à jour pour un challenge existant
- **Output**: Suggestions détaillées de modification

**Slug**: `challenge-detailed-creator`
- **Input**: Contexte du projet + plan de création
- **Processus**: Génère les détails de nouveaux challenges à créer
- **Output**: Suggestions détaillées de nouveaux challenges

### Avantages de cet Enchaînement

1. **Performance** (×6 plus rapide)
   - Phase 1 : Un seul appel pour planifier
   - Phase 2 : Appels parallèles pour les exécutions

2. **Cohérence** (+30%)
   - Vision globale en phase 1
   - Décisions coordonnées

3. **Coût** (-56% de tokens)
   - Skip des challenges inchangés
   - Planification efficace

## Enchaînement Logique : Workflow ASK (Conversation + Insights)

Le système **ASK** utilise un workflow en deux étapes pour les sessions de conversation :

```
┌─────────────────────────────────────────────────────────┐
│ Étape 1: CONVERSATION (séquentiel)                      │
│ Agent: ask-conversation-response                        │
│ Rôle: Génère une réponse conversationnelle à l'utilisateur │
│ Input: Historique des messages, contexte ASK, insights │
│ Output: Réponse AI dans la conversation                │
└─────────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────────┐
│ Étape 2: DÉTECTION D'INSIGHTS (asynchrone)             │
│ Agent: ask-insight-detection                            │
│ Rôle: Analyse la conversation et détecte les insights  │
│ Input: Messages de conversation, réponse AI générée     │
│ Output: Insights structurés (pains, idées, opportunités, etc.) │
└─────────────────────────────────────────────────────────┘
```

### Détail du Workflow ASK

#### Étape 1 : Conversation
**Slug**: `ask-conversation-response`
- **Trigger**: Message utilisateur dans une session ASK
- **Input**: 
  - Historique complet des messages
  - Contexte de la session ASK (question, description)
  - Insights existants
  - Participants et leurs rôles
- **Processus**: Génère une réponse conversationnelle adaptée au contexte
- **Output**: Réponse AI envoyée à l'utilisateur

#### Étape 2 : Détection d'Insights
**Slug**: `ask-insight-detection`
- **Trigger**: Automatique après chaque réponse AI (ou manuel via `/respond`)
- **Input**: 
  - Tous les messages de la conversation
  - Dernière réponse AI générée
  - Insights existants (pour éviter les doublons)
  - Types d'insights à détecter (pain, idea, solution, opportunity, risk, etc.)
- **Processus**: Analyse la conversation et extrait des insights structurés
- **Output**: Insights persistés en base de données avec métadonnées (type, priorité, catégorie, etc.)

### Enchaînement ASK Generator

**Slug**: `ask-generator`
- **Trigger**: Action manuelle "Generate ASKs with AI" depuis un challenge
- **Rôle**: Analyse un challenge et propose de nouvelles sessions ASK pertinentes
- **Input**: 
  - Contexte du challenge
  - Insights existants liés au challenge
  - ASKs déjà planifiées
- **Output**: Suggestions de nouvelles sessions ASK avec description, participants recommandés, etc.

## Ordre d'Exécution Logique Global

### Workflow Challenge Builder V2
1. **challenge-revision-planner** (Phase 1 - Planning)
2. **challenge-detailed-updater** (Phase 2 - Execution, parallèle)
3. **challenge-detailed-creator** (Phase 2 - Execution, parallèle)

### Workflow ASK Conversation
1. **ask-conversation-response** (Génération de réponse)
2. **ask-insight-detection** (Détection automatique d'insights)

### Workflow ASK Generator
1. **ask-generator** (Génération de nouvelles sessions ASK)

## Liste Complète des Agents du Système

### Agents Conversationnels
- **ask-conversation-response**: Réponses dans les sessions ASK (agent principal de conversation)

### Agents d'Analyse et Détection
- **ask-insight-detection**: Détection automatique d'insights dans les conversations ASK
- **insight-entity-extraction**: Extraction d'entités des insights (pour Graph RAG)
- **insight-synthesis**: Synthèse d'insights similaires (pour Graph RAG)

### Agents de Génération
- **ask-generator**: Génération de nouvelles sessions ASK à partir d'un challenge
- **challenge-builder**: Ancien agent legacy (remplacé par le V2 en 3 phases)

### Agents Challenge Builder V2
- **challenge-revision-planner**: Planification globale des revisions
- **challenge-detailed-updater**: Mise a jour detaillee des challenges
- **challenge-detailed-creator**: Creation detaillee de nouveaux challenges

### Agents Rapport & Synthese
- **rapport-narrative-synthesis**: Generation de syntheses narratives Markdown pour projets
- **rapport-claim-extraction**: Extraction de claims (findings, recommendations, etc.) depuis les insights
- **rapport-claim-comparison**: Comparaison de deux claims (SUPPORTS/CONTRADICTS/NEUTRAL)
- **rapport-participant-claims**: Extraction globale des claims d'un participant (tous insights)

## Enchaînement Logique : Workflow Synthese Narrative

Le systeme de **Synthese Narrative** genere des rapports Markdown structures a partir des donnees du projet.

```
┌─────────────────────────────────────────────────────────────┐
│ Etape 1: COLLECTE DES DONNEES                               │
│ - Fetch claims, insights, participants                      │
│ - Build knowledge graph (graphology)                        │
│ - Detect communities (Louvain algorithm)                    │
└─────────────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────────────┐
│ Etape 2: ANALYSE & STRUCTURATION                            │
│ - buildProblemSpace() : Problemes et risques                │
│ - buildFindings() : Decouvertes cles (avec convergence)     │
│ - buildSolutions() : Recommandations priorisees             │
│ - buildTensions() : Points de desaccord entre participants  │
└─────────────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────────────┐
│ Etape 3: GENERATION AI                                      │
│ Agent: rapport-narrative-synthesis                          │
│ Role: Generer resume executif, points cles, aperçus section │
│ Input: Stats, summaries de chaque section                   │
│ Output: JSON {executive_summary, key_takeaways, ...}        │
└─────────────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────────────┐
│ Etape 4: ASSEMBLAGE MARKDOWN                                │
│ - Combine AI summaries + structured data                    │
│ - Generate tables, lists, stats                             │
│ - Save to project_syntheses table                           │
└─────────────────────────────────────────────────────────────┘
```

### Detail du Workflow

**Fichier principal**: `src/lib/graphRAG/narrativeSynthesis.ts`

**Fonction**: `generateNarrativeSynthesis(projectId, challengeId?)`

1. **Collecte**: Fetch claims, insights, participants count
2. **Graph**: Build graphology graph, detect communities via Louvain
3. **Convergence**: Build map of claim support (cross-participant agreement)
4. **Sections**: Build problem space, findings, solutions, tensions, risks
5. **AI Summary**: Call `rapport-narrative-synthesis` agent
6. **Markdown**: Assemble final document with stats, tables, summaries

**Particularites**:
- **Convergence boosting**: Evidence strength augmentee de +10% par claim supportant
- **Community detection**: Claims groupes par theme via algorithme Louvain
- **Severity calculation**: Problemes priorises par evidence strength
- **Tension detection**: Edges CONTRADICTS entre claims identifies

## Enchaînement Logique : Workflow Extraction Claims

Le systeme extrait des **claims** (affirmations structurees) depuis les insights.

```
┌─────────────────────────────────────────────────────────────┐
│ Trigger: Nouvel insight cree ou interview terminee          │
└─────────────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────────────┐
│ EXTRACTION (par insight ou par participant)                 │
│ Agent: rapport-claim-extraction (single insight)            │
│    OU: rapport-participant-claims (all insights at once)    │
│ Input: Content, context (project, challenge, ask question)  │
│ Output: claims[], claim_relations[], key_entities[]         │
└─────────────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────────────┐
│ STOCKAGE                                                    │
│ - Store claims in `claims` table with embeddings            │
│ - Link claims to entities via `claim_entities`              │
│ - Create internal edges (SUPPORTS, CONTRADICTS)             │
└─────────────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────────────┐
│ COMPARAISON CROSS-PARTICIPANTS                              │
│ Agent: rapport-claim-comparison                             │
│ Process: Pre-filter by embedding similarity (>0.6)          │
│          Then AI analysis for relationship type             │
│ Output: SUPPORTS/CONTRADICTS edges in knowledge_graph_edges │
└─────────────────────────────────────────────────────────────┘
```

### Types de Claims

| Type | Description |
|------|-------------|
| `finding` | Constat factuel observe |
| `hypothesis` | Supposition a valider |
| `recommendation` | Suggestion d'action |
| `observation` | Note generale |

### Fichiers Cles

- `src/lib/graphRAG/extractClaims.ts`: Extraction single-insight
- `src/lib/graphRAG/generateParticipantGraph.ts`: Extraction participant complet
- `src/lib/graphRAG/compareClaimsCross.ts`: Comparaison cross-participant

