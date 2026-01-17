# Database Schema - Supabase

> This document describes the current database schema. The canonical schema is stored in [`migrations/001_initial_schema.sql`](../../migrations/001_initial_schema.sql) and subsequent migrations in the `migrations/` folder. Always run `npm run db:migrate:up` to apply new migrations.

## Table of Contents

- [Core Tables](#core-tables)
  - [profiles](#profiles)
  - [clients](#clients)
  - [client_members](#client_members)
  - [projects](#projects)
  - [project_members](#project_members)
  - [challenges](#challenges)
- [ASK System Tables](#ask-system-tables)
  - [ask_sessions](#ask_sessions)
  - [ask_participants](#ask_participants)
  - [ask_prompt_templates](#ask_prompt_templates)
- [Conversation Tables](#conversation-tables)
  - [conversation_threads](#conversation_threads)
  - [messages](#messages)
  - [ask_conversation_plans](#ask_conversation_plans)
  - [ask_conversation_plan_steps](#ask_conversation_plan_steps)
- [Insights System](#insights-system)
  - [insight_types](#insight_types)
  - [insights](#insights)
  - [insight_authors](#insight_authors)
  - [insight_keywords](#insight_keywords)
  - [insight_syntheses](#insight_syntheses)
  - [kpi_estimations](#kpi_estimations)
  - [challenge_insights](#challenge_insights)
  - [challenge_foundation_insights](#challenge_foundation_insights)
- [Knowledge Graph & Claims](#knowledge-graph--claims)
  - [knowledge_entities](#knowledge_entities)
  - [knowledge_graph_edges](#knowledge_graph_edges)
  - [claims](#claims)
  - [claim_entities](#claim_entities)
  - [project_syntheses](#project_syntheses)
- [AI System Tables](#ai-system-tables)
  - [ai_model_configs](#ai_model_configs)
  - [ai_agents](#ai_agents)
  - [ai_agent_logs](#ai_agent_logs)
  - [ai_insight_jobs](#ai_insight_jobs)
- [Security Tables](#security-tables)
  - [security_detections](#security_detections)
  - [security_monitoring_queue](#security_monitoring_queue)
- [Other Tables](#other-tables)
  - [documents](#documents)
- [Indexes & Performance](#indexes--performance)
- [Key RLS Functions](#key-rls-functions)
- [Environment Variables](#environment-variables)

---

## Core Tables

### profiles

User profiles linked to Supabase Auth (`auth.users`).

**Functional Description:**
- **Purpose:** Central user identity table containing all registered users in the system
- **Created when:** A new user signs up via Supabase Auth (trigger `handle_new_user` auto-creates profile)
- **Updated when:** User updates their profile information, logs in (updates `last_login`), or is quarantined for security reasons
- **Created by:** System (automatically via database trigger on auth.users insert)
- **Workflow:** Every authenticated user has exactly one profile. The profile determines their global role and access level. Users can be members of multiple clients and projects through junction tables.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | uuid_generate_v4() | Primary key |
| email | varchar | NO | | User email (unique identifier) |
| first_name | varchar | YES | | |
| last_name | varchar | YES | | |
| full_name | varchar | YES | | Computed or manually set |
| role | profile_role | YES | 'participant' | ENUM: full_admin, client_admin, facilitator, manager, participant |
| avatar_url | text | YES | | Profile picture URL |
| is_active | boolean | YES | true | Soft delete flag |
| last_login | timestamptz | YES | | Last authentication timestamp |
| created_at | timestamptz | YES | now() | |
| updated_at | timestamptz | YES | now() | |
| auth_id | uuid | YES | | FK to auth.users(id) - Supabase Auth user ID |
| job_title | varchar | YES | | Global job title |
| deleted_at | timestamptz | YES | | Soft delete timestamp |
| is_quarantined | boolean | YES | false | Security quarantine flag |
| quarantined_at | timestamptz | YES | | When quarantine was applied |
| quarantined_reason | text | YES | | Reason for quarantine |
| description | text | YES | | User bio/description for AI context |

---

### clients

Client organizations in the system.

**Functional Description:**
- **Purpose:** Represents client companies/organizations that own projects and have user memberships
- **Created when:** An administrator creates a new client organization
- **Updated when:** Client information is modified or status changes
- **Created by:** Full administrators or system during onboarding
- **Workflow:** Clients are the top-level organizational unit. Each client has projects, and users are linked to clients via `client_members`. All data (projects, challenges, ASK sessions, insights) ultimately belongs to a client.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | uuid_generate_v4() | Primary key |
| name | varchar | NO | | Client organization name |
| status | varchar | NO | 'active' | active, inactive |
| email | varchar | YES | | Contact email |
| company | varchar | YES | | Company name (may differ from client name) |
| industry | varchar | YES | | Industry sector |
| created_at | timestamptz | YES | now() | |
| updated_at | timestamptz | YES | now() | |

---

### client_members

Junction table linking users to clients with specific roles.

**Functional Description:**
- **Purpose:** Defines which users belong to which clients and their role within that client organization
- **Created when:** A user is invited to or joins a client organization
- **Updated when:** User's role or job title within the client changes
- **Created by:** Client administrators or full administrators
- **Workflow:** A user must be a client member to access any of the client's projects. The role here can override the user's global role for client-specific permissions.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | uuid_generate_v4() | Primary key |
| client_id | uuid | NO | | FK clients(id) ON DELETE CASCADE |
| user_id | uuid | NO | | FK profiles(id) ON DELETE CASCADE |
| job_title | varchar | YES | | Client-specific job title |
| created_at | timestamptz | YES | now() | |
| updated_at | timestamptz | YES | now() | |
| role | varchar | YES | 'participant' | client_admin, facilitator, manager, participant |

**Unique Constraint:** (client_id, user_id)

---

### projects

Projects belong to clients and contain challenges and ASK sessions.

**Functional Description:**
- **Purpose:** Represents a strategic initiative or research project within a client organization
- **Created when:** A client administrator or facilitator creates a new project
- **Updated when:** Project details change, AI generates challenge suggestions, or status updates
- **Created by:** Facilitators, managers, or administrators
- **Workflow:** Projects are containers for strategic work. They have date ranges, can have custom AI system prompts, and contain challenges and ASK sessions. The `graph_rag_scope` determines if knowledge graph queries are scoped to this project or the entire client.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | uuid_generate_v4() | Primary key |
| name | varchar | NO | | Project name |
| description | text | YES | | Project description |
| start_date | timestamptz | NO | | Project start date |
| end_date | timestamptz | NO | | Project end date |
| status | varchar | NO | 'active' | active, completed, archived |
| client_id | uuid | NO | | FK clients(id) ON DELETE CASCADE |
| created_by | uuid | YES | | FK profiles(id) ON DELETE SET NULL |
| created_at | timestamptz | YES | now() | |
| updated_at | timestamptz | YES | now() | |
| system_prompt | text | YES | | AI system prompt for project context |
| graph_rag_scope | varchar | NO | 'project' | 'project' or 'client' - scope for knowledge graph |
| ai_challenge_builder_results | jsonb | YES | | Cached AI suggestions for challenges |

---

### project_members

Junction table linking users to projects with roles.

**Functional Description:**
- **Purpose:** Defines which users have access to which projects and their role within that project
- **Created when:** A user is added to a project team
- **Updated when:** User's role, job title, or description within the project changes
- **Created by:** Project owners, facilitators, or administrators
- **Workflow:** Project membership is required to access project data. The `description` field provides AI context about the user's role in the project (useful for personalized AI interactions).

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | uuid_generate_v4() | Primary key |
| project_id | uuid | NO | | FK projects(id) ON DELETE CASCADE |
| user_id | uuid | NO | | FK profiles(id) ON DELETE CASCADE |
| role | varchar | YES | 'member' | member, facilitator, owner |
| created_at | timestamptz | YES | now() | |
| job_title | varchar | YES | | Project-specific job title |
| description | text | YES | | Project-specific description for AI context |

**Unique Constraint:** (project_id, user_id)

---

### challenges

Strategic challenges linked to projects.

**Functional Description:**
- **Purpose:** Represents strategic questions, problems, or opportunities that the organization wants to explore through ASK sessions
- **Created when:** A facilitator creates a challenge manually or via AI suggestions from the challenge builder
- **Updated when:** Status changes, AI generates ASK suggestions, or details are modified
- **Created by:** Facilitators, managers, or AI (via challenge builder)
- **Workflow:** Challenges are the central organizing concept. Each challenge can have multiple ASK sessions to gather insights. Challenges can have parent-child relationships for hierarchical organization. The `ai_ask_suggestions` stores AI-generated recommendations for ASK sessions.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | uuid_generate_v4() | Primary key |
| name | varchar | NO | | Challenge title |
| description | text | YES | | Detailed description |
| status | varchar | NO | 'open' | open, in_progress, resolved, closed |
| priority | varchar | YES | 'medium' | low, medium, high, critical |
| category | varchar | YES | | operational, strategic, cultural, technical |
| project_id | uuid | YES | | FK projects(id) ON DELETE CASCADE |
| created_by | uuid | YES | | FK profiles(id) ON DELETE SET NULL |
| assigned_to | uuid | YES | | FK profiles(id) ON DELETE SET NULL |
| due_date | timestamptz | YES | | Target resolution date |
| created_at | timestamptz | YES | now() | |
| updated_at | timestamptz | YES | now() | |
| parent_challenge_id | uuid | YES | | FK challenges(id) - for sub-challenges |
| system_prompt | text | YES | | Challenge-specific AI prompt |
| ai_ask_suggestions | jsonb | YES | | AI-generated ASK session suggestions |

---

## ASK System Tables

### ask_sessions

Interactive conversation sessions for gathering insights.

**Functional Description:**
- **Purpose:** Represents an interactive session where participants answer questions and provide insights via conversation with an AI facilitator
- **Created when:** A facilitator creates a new ASK session, typically linked to a challenge
- **Updated when:** Session status changes, configuration is modified, or metadata is updated
- **Created by:** Facilitators or administrators
- **Workflow:** ASK sessions are the primary data collection mechanism. Participants join via invite links (`invite_token`) or public links (if `allow_auto_registration` is true). The AI conducts conversations based on the `question` and `system_prompt`. Various modes control how conversations work (individual vs. collaborative, voice vs. text, etc.).

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | uuid_generate_v4() | Primary key |
| ask_key | varchar | NO | | UNIQUE - External-facing key for URLs |
| name | varchar | NO | | Session title |
| question | text | NO | | Main question/topic to explore |
| description | text | YES | | Detailed description |
| start_date | timestamptz | NO | | Session start date |
| end_date | timestamptz | NO | | Session end date |
| status | varchar | NO | 'active' | active, completed, archived |
| allow_auto_registration | boolean | YES | false | When TRUE, users can self-register via public ASK link (/?ask=key) |
| max_participants | integer | YES | | Maximum participant limit |
| challenge_id | uuid | YES | | FK challenges(id) ON DELETE SET NULL |
| project_id | uuid | YES | | FK projects(id) ON DELETE CASCADE |
| created_by | uuid | YES | | FK profiles(id) ON DELETE SET NULL |
| ai_config | jsonb | YES | | AI configuration (personality, style) |
| metadata | jsonb | YES | | Additional flexible data |
| created_at | timestamptz | YES | now() | |
| updated_at | timestamptz | YES | now() | |
| delivery_mode | varchar | YES | 'digital' | 'physical' or 'digital' |
| audience_scope | varchar | YES | 'individual' | 'individual' or 'group' |
| response_mode | varchar | YES | 'collective' | 'collective' or 'simultaneous' |
| system_prompt | text | YES | | Custom AI prompt for this session |
| conversation_mode | varchar | NO | 'collaborative' | See Conversation Modes below |
| expected_duration_minutes | integer | YES | 8 | Expected duration (1-30 minutes) for pacing |

**Conversation Modes** (`conversation_mode`):
- `individual_parallel`: Multiple people respond individually, no cross-visibility
- `collaborative`: Multi-voice conversation, everyone sees everything
- `group_reporter`: Group contributes, one reporter consolidates
- `consultant`: AI listens and suggests questions to consultant, no TTS

---

### ask_participants

Junction table for participants in ASK sessions.

**Functional Description:**
- **Purpose:** Tracks who is participating in each ASK session and their engagement metrics
- **Created when:** A user joins an ASK session (via invite link, public registration, or facilitator addition)
- **Updated when:** Participant activity occurs, role changes, or time tracking updates
- **Created by:** System (automatically when joining) or facilitators (when pre-inviting)
- **Workflow:** Each participant gets a unique `invite_token` for authentication. The token allows access without full user login. `elapsed_active_seconds` tracks engagement time. Facilitators can designate spokespersons for group sessions.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | uuid_generate_v4() | Primary key |
| ask_session_id | uuid | NO | | FK ask_sessions(id) ON DELETE CASCADE |
| user_id | uuid | YES | | FK profiles(id) - NULL for anonymous/external participants |
| participant_name | varchar | YES | | Display name |
| participant_email | varchar | YES | | Contact email |
| role | varchar | YES | 'participant' | participant, facilitator, spokesperson |
| joined_at | timestamptz | YES | now() | When participant joined |
| last_active | timestamptz | YES | now() | Last activity timestamp |
| is_spokesperson | boolean | YES | false | Group spokesperson flag |
| invite_token | varchar | YES | | UNIQUE - Auto-generated token for invite links |
| elapsed_active_seconds | integer | YES | 0 | Accumulated active session time |
| timer_reset_at | timestamptz | YES | NULL | Timestamp of last timer reset (e.g., via purge). Client uses this to detect resets and clear localStorage cache. |

**Unique Constraint:** (ask_session_id, user_id)

**Trigger:** `trigger_generate_invite_token` auto-generates `invite_token` on INSERT if NULL.

---

### ask_prompt_templates

Reusable system prompts for ASK sessions.

**Functional Description:**
- **Purpose:** Stores reusable AI prompt templates that can be applied to ASK sessions
- **Created when:** An administrator or facilitator creates a reusable prompt template
- **Updated when:** Template is modified
- **Created by:** Administrators or facilitators
- **Workflow:** Templates provide consistent AI behavior across multiple ASK sessions. They can be selected when creating new sessions to ensure standardized facilitation approaches.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | uuid_generate_v4() | Primary key |
| name | varchar | NO | | Template name |
| description | text | YES | | Template description |
| system_prompt | text | NO | | The prompt template content |
| created_by | uuid | YES | | FK profiles(id) |
| created_at | timestamptz | YES | now() | |
| updated_at | timestamptz | YES | now() | |

---

## Conversation Tables

### conversation_threads

Isolated conversation threads within ASK sessions.

**Functional Description:**
- **Purpose:** Separates conversations within an ASK session, allowing individual threads per participant or shared collaborative threads
- **Created when:** A participant starts a conversation in an ASK session, or a shared thread is created for collaborative mode
- **Updated when:** Generally immutable after creation
- **Created by:** System (automatically when first message is sent)
- **Workflow:** In `individual_parallel` mode, each participant gets their own thread. In `collaborative` mode, there's typically one shared thread. Messages, conversation plans, and insights are linked to specific threads.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | uuid_generate_v4() | Primary key |
| ask_session_id | uuid | NO | | FK ask_sessions(id) ON DELETE CASCADE |
| user_id | uuid | YES | | FK profiles(id) - NULL for shared threads |
| is_shared | boolean | YES | false | Visible to all participants |
| created_at | timestamptz | YES | now() | |

**Unique Constraint:** (ask_session_id, user_id)

---

### messages

Conversation messages.

**Functional Description:**
- **Purpose:** Stores all messages exchanged in ASK sessions between users and the AI
- **Created when:** A user sends a message or the AI responds
- **Updated when:** Rarely - messages are typically immutable
- **Created by:** Users (sender_type='user'), AI (sender_type='ai'), or System (sender_type='system')
- **Workflow:** Messages form the conversation history. They can be linked to conversation plan steps for structured discussions. The `content_embedding` enables semantic search. Messages can have parent-child relationships for threading.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | uuid_generate_v4() / gen_random_uuid() | Primary key |
| topic | text | NO | | Legacy - Message topic |
| extension | text | NO | | Legacy - Message extension |
| ask_session_id | uuid | NO | | FK ask_sessions(id) ON DELETE CASCADE |
| user_id | uuid | YES | | FK profiles(id) ON DELETE SET NULL |
| payload | jsonb | YES | | Legacy - Additional payload data |
| sender_type | varchar | NO | 'user' | 'user', 'ai', 'system' |
| event | text | YES | | Legacy - Event type |
| content | text | NO | | Message content |
| private | boolean | YES | false | Private message flag |
| updated_at | timestamp | NO | now() | |
| message_type | varchar | YES | 'text' | text, audio, image, document |
| metadata | jsonb | YES | | File info, audio duration, etc. |
| inserted_at | timestamp | NO | now() | Legacy - Insert timestamp |
| parent_message_id | uuid | YES | | FK messages(id) - for threaded replies |
| created_at | timestamptz | YES | now() | |
| content_embedding | vector(1024) | YES | | For semantic search |
| conversation_thread_id | uuid | YES | | FK conversation_threads(id) |
| plan_step_id | uuid | YES | | FK ask_conversation_plan_steps(id) |

---

### ask_conversation_plans

Guided conversation plans for structured discussions.

**Functional Description:**
- **Purpose:** Defines a structured conversation flow with multiple steps/phases for a thread
- **Created when:** AI generates a conversation plan at the start of a structured ASK session
- **Updated when:** Step progress changes (via trigger) or plan status updates
- **Created by:** AI (automatically when conversation starts in structured mode)
- **Workflow:** The plan provides structure to conversations. Each plan has multiple steps with objectives. As steps complete, `completed_steps` is auto-updated. The `current_step_id` tracks active progress.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | uuid_generate_v4() | Primary key |
| conversation_thread_id | uuid | NO | | UNIQUE - FK conversation_threads(id) ON DELETE CASCADE |
| plan_data | jsonb | NO | | Legacy: Full plan structure |
| current_step_id | varchar | YES | | Current active step identifier |
| created_at | timestamptz | YES | now() | |
| updated_at | timestamptz | YES | now() | |
| title | text | YES | | Plan title |
| objective | text | YES | | Overall objective |
| total_steps | integer | YES | 0 | Total number of steps |
| completed_steps | integer | YES | 0 | Auto-updated by trigger |
| status | varchar | YES | 'active' | 'active', 'completed', 'abandoned' |

---

### ask_conversation_plan_steps

Individual steps in conversation plans.

**Functional Description:**
- **Purpose:** Represents a single phase/step within a conversation plan with its own objective
- **Created when:** A conversation plan is generated (all steps created together)
- **Updated when:** Step is activated, completed, or summary is generated
- **Created by:** AI (as part of plan generation)
- **Workflow:** Steps guide the conversation through phases. Each step has an objective that the AI works toward. When completed, an AI-generated summary captures key points from that phase. The `elapsed_active_seconds` tracks time spent on each step.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | uuid_generate_v4() | Primary key |
| plan_id | uuid | NO | | FK ask_conversation_plans(id) ON DELETE CASCADE |
| step_identifier | varchar | NO | | e.g., "step_1", "step_2" |
| step_order | integer | NO | | 1-based index |
| title | text | NO | | Step title |
| objective | text | NO | | Step objective |
| status | varchar | NO | 'pending' | pending, active, completed, skipped |
| summary | text | YES | | AI-generated summary when completed |
| created_at | timestamptz | YES | now() | |
| activated_at | timestamptz | YES | | When status changed to 'active' |
| completed_at | timestamptz | YES | | When status changed to 'completed' |
| summary_error | text | YES | | Error message if summary generation failed |
| elapsed_active_seconds | integer | YES | 0 | Time spent on this step |

**Unique Constraints:** (plan_id, step_identifier), (plan_id, step_order)

**Trigger:** `trigger_update_plan_progress` auto-updates plan counters when step status changes.

---

## Insights System

### insight_types

Lookup table for insight categories.

**Functional Description:**
- **Purpose:** Defines the taxonomy of insight types available in the system
- **Created when:** System initialization or when new insight categories are added
- **Updated when:** Rarely - types are generally static
- **Created by:** System administrators
- **Workflow:** Every insight must have a type. Standard types include: pain, gain, opportunity, risk, signal, idea. The type helps categorize and filter insights for analysis.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | uuid_generate_v4() | Primary key |
| name | text | NO | | UNIQUE - pain, gain, opportunity, risk, signal, idea |
| created_at | timestamptz | YES | now() | |

---

### insights

Extracted insights from conversations.

**Functional Description:**
- **Purpose:** Captures valuable insights, observations, and findings from ASK session conversations
- **Created when:** AI extracts an insight from conversation, or a facilitator manually creates one
- **Updated when:** Status changes, categorization is refined, or embeddings are updated
- **Created by:** AI (via insight extraction agent) or facilitators (manual creation)
- **Workflow:** Insights are the key output of ASK sessions. They capture pains, gains, opportunities, and other valuable observations. Each insight links back to its source (session, thread, message, step). Vector embeddings enable semantic search and clustering for synthesis.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | uuid_generate_v4() | Primary key |
| ask_session_id | uuid | NO | | FK ask_sessions(id) ON DELETE CASCADE |
| user_id | uuid | YES | | FK profiles(id) - who expressed the insight |
| challenge_id | uuid | YES | | FK challenges(id) - related challenge |
| content | text | NO | | Full insight text |
| summary | text | YES | | Short summary |
| category | varchar | YES | | communication, process, technology, culture |
| priority | varchar | YES | 'medium' | low, medium, high, critical |
| status | varchar | YES | 'new' | new, reviewed, implemented, archived |
| source_message_id | uuid | YES | | FK messages(id) - originating message |
| ai_generated | boolean | YES | false | True if AI-extracted |
| created_at | timestamptz | YES | now() | |
| updated_at | timestamptz | YES | now() | |
| ask_id | uuid | YES | | Alias for ask_session_id |
| related_challenge_ids | uuid[] | YES | '{}' | Array of related challenge IDs |
| insight_type_id | uuid | NO | | FK insight_types(id) |
| content_embedding | vector(1024) | YES | | For semantic search |
| summary_embedding | vector(1024) | YES | | Summary embedding |
| embedding_updated_at | timestamptz | YES | | When embeddings were last updated |
| conversation_thread_id | uuid | YES | | FK conversation_threads(id) |
| plan_step_id | uuid | YES | | FK ask_conversation_plan_steps(id) |

---

### insight_authors

Multi-author support for insights.

**Functional Description:**
- **Purpose:** Tracks multiple contributors to a single insight (when insights are co-created or attributed to groups)
- **Created when:** An insight is created with author attribution
- **Updated when:** Rarely - authors are typically set at creation
- **Created by:** System (during insight creation)
- **Workflow:** Allows insights to be attributed to multiple people, useful in collaborative sessions where insights emerge from group discussion.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | uuid_generate_v4() | Primary key |
| insight_id | uuid | NO | | FK insights(id) ON DELETE CASCADE |
| user_id | uuid | YES | | FK profiles(id) - NULL for anonymous |
| display_name | text | YES | | Display name if user_id is NULL |
| created_at | timestamptz | YES | now() | |

---

### insight_keywords

Links insights to knowledge entities (keywords/concepts).

**Functional Description:**
- **Purpose:** Creates relationships between insights and extracted keywords/concepts for analysis and search
- **Created when:** AI extracts keywords from insights or manual tagging occurs
- **Updated when:** Relevance scores are refined
- **Created by:** AI (via keyword extraction) or facilitators (manual tagging)
- **Workflow:** Enables filtering and grouping insights by keywords. The `relevance_score` indicates how central the keyword is to the insight.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | uuid_generate_v4() | Primary key |
| insight_id | uuid | NO | | FK insights(id) |
| entity_id | uuid | NO | | FK knowledge_entities(id) |
| relevance_score | real | YES | 0.5 | 0.0-1.0 relevance |
| extraction_method | varchar | YES | 'ai' | ai, manual |
| created_at | timestamptz | YES | now() | |

---

### insight_syntheses

AI-generated syntheses combining multiple insights.

**Functional Description:**
- **Purpose:** Stores AI-generated summaries that synthesize multiple related insights into coherent findings
- **Created when:** AI synthesis process runs on a collection of insights
- **Updated when:** Synthesis is regenerated
- **Created by:** AI (synthesis agent)
- **Workflow:** Takes multiple insights and creates a unified narrative or summary. Used to reduce information overload and surface key patterns. The `source_insight_ids` tracks which insights were combined.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | uuid_generate_v4() | Primary key |
| project_id | uuid | YES | | FK projects(id) |
| challenge_id | uuid | YES | | FK challenges(id) |
| synthesized_text | text | NO | | The synthesis content |
| source_insight_ids | uuid[] | NO | '{}' | Array of source insight IDs |
| key_concepts | uuid[] | YES | '{}' | Array of key concept entity IDs |
| embedding | vector(1024) | YES | | For semantic search |
| created_at | timestamptz | YES | now() | |
| updated_at | timestamptz | YES | now() | |

---

### kpi_estimations

KPI estimations linked to insights.

**Functional Description:**
- **Purpose:** Stores quantitative estimations and metrics associated with insights (e.g., estimated impact, cost, effort)
- **Created when:** A facilitator or AI adds KPI estimates to an insight
- **Updated when:** Estimates are refined
- **Created by:** Facilitators, experts, or AI
- **Workflow:** Transforms qualitative insights into quantifiable metrics. The `metric_data` JSON allows flexible KPI structures. Useful for prioritization and business case development.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | uuid_generate_v4() | Primary key |
| insight_id | uuid | NO | | FK insights(id) ON DELETE CASCADE |
| name | varchar | NO | | KPI name (e.g., "Cost Savings", "Time Reduction") |
| description | text | YES | | KPI description |
| metric_data | jsonb | NO | | Flexible KPI structure (value, unit, range, etc.) |
| estimation_source | varchar | YES | | ai, expert, historical_data |
| confidence_level | integer | YES | 50 | 0-100 confidence percentage |
| created_at | timestamptz | YES | now() | |
| updated_at | timestamptz | YES | now() | |

---

### challenge_insights

Many-to-many relationship between challenges and insights.

**Functional Description:**
- **Purpose:** Links insights to challenges they address or relate to (beyond the primary challenge link)
- **Created when:** An insight is associated with additional challenges
- **Updated when:** Relationship type changes
- **Created by:** AI or facilitators during analysis
- **Workflow:** An insight may address multiple challenges. This table allows flexible many-to-many relationships with typed associations.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | uuid_generate_v4() | Primary key |
| challenge_id | uuid | NO | | FK challenges(id) ON DELETE CASCADE |
| insight_id | uuid | NO | | FK insights(id) ON DELETE CASCADE |
| relationship_type | varchar | YES | | addresses, relates_to, conflicts_with |
| created_at | timestamptz | YES | now() | |

**Unique Constraint:** (challenge_id, insight_id)

---

### challenge_foundation_insights

Prioritized foundational insights for challenges.

**Functional Description:**
- **Purpose:** Marks certain insights as foundational/critical for understanding a challenge
- **Created when:** A facilitator or AI identifies an insight as foundational to a challenge
- **Updated when:** Priority or reasoning changes
- **Created by:** Facilitators or AI analysis
- **Workflow:** Some insights are more important than others for understanding a challenge. This table elevates key insights with priority and reasoning, helping focus attention on the most important findings.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | uuid_generate_v4() | Primary key |
| challenge_id | uuid | NO | | FK challenges(id) ON DELETE CASCADE |
| insight_id | uuid | NO | | FK insights(id) ON DELETE CASCADE |
| priority | varchar | NO | 'medium' | low, medium, high |
| reason | text | YES | | Why this insight is foundational |
| created_at | timestamptz | YES | now() | |
| updated_at | timestamptz | YES | now() | |

---

## Knowledge Graph & Claims

### knowledge_entities

Entities extracted from conversations (people, organizations, concepts).

**Functional Description:**
- **Purpose:** Stores named entities and concepts extracted from conversations for knowledge graph construction
- **Created when:** AI extracts entities from messages or insights
- **Updated when:** Frequency counts update or descriptions are enriched
- **Created by:** AI (entity extraction)
- **Workflow:** Forms the nodes of the knowledge graph. Entities can be people, organizations, concepts, keywords, etc. The `embedding` enables semantic similarity search. `frequency` tracks how often the entity appears.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | uuid_generate_v4() | Primary key |
| name | varchar | NO | | Entity name |
| type | varchar | NO | 'keyword' | person, organization, concept, keyword, etc. |
| description | text | YES | | Entity description |
| embedding | vector(1024) | YES | | For semantic search |
| frequency | integer | YES | 1 | Occurrence count |
| created_at | timestamptz | YES | now() | |
| updated_at | timestamptz | YES | now() | |

---

### knowledge_graph_edges

Relationships between entities and other objects.

**Functional Description:**
- **Purpose:** Stores relationships/edges in the knowledge graph connecting entities, insights, and claims
- **Created when:** AI identifies relationships between entities or objects
- **Updated when:** Relationship strength/confidence is updated
- **Created by:** AI (relationship extraction)
- **Workflow:** Forms the edges of the knowledge graph. Connects any combination of entities, insights, and claims. Relationship types define the semantic meaning. Scores indicate strength and confidence.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | uuid_generate_v4() | Primary key |
| source_id | uuid | NO | | Source node ID |
| source_type | varchar | NO | | 'entity', 'insight', 'claim' |
| target_id | uuid | NO | | Target node ID |
| target_type | varchar | NO | | 'entity', 'insight', 'claim' |
| relationship_type | varchar | NO | | See Relationship Types below |
| similarity_score | real | YES | | Semantic similarity (0-1) |
| confidence | real | YES | | Relationship confidence (0-1) |
| metadata | jsonb | YES | | Additional relationship data |
| created_at | timestamptz | YES | now() | |
| updated_at | timestamptz | YES | now() | |

**Unique Constraint:** (source_id, target_id, relationship_type)

**Relationship Types:**
- `SIMILAR_TO`, `RELATED_TO`, `CONTAINS`, `SYNTHESIZES`
- `MENTIONS`, `HAS_TYPE`, `CO_OCCURS`
- `SUPPORTS`, `CONTRADICTS`, `ADDRESSES`, `EVIDENCE_FOR` (claim-related)

---

### claims

Claims extracted from insights for synthesis.

**Functional Description:**
- **Purpose:** Stores structured claims (findings, hypotheses, recommendations) derived from insights
- **Created when:** AI extracts claims from insights during synthesis
- **Updated when:** Evidence strength or confidence is updated
- **Created by:** AI (claims extraction agent)
- **Workflow:** Claims represent the distilled knowledge from insights in a structured format. They have types (finding, hypothesis, recommendation, observation) and confidence scores. Claims can be linked to supporting insights and entities for provenance tracking.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | gen_random_uuid() | Primary key |
| project_id | uuid | NO | | FK projects(id) ON DELETE CASCADE |
| challenge_id | uuid | YES | | FK challenges(id) ON DELETE SET NULL |
| statement | text | NO | | The claim text |
| claim_type | text | NO | | finding, hypothesis, recommendation, observation |
| evidence_strength | numeric(3,2) | YES | | 0.00-1.00 strength of evidence |
| confidence | numeric(3,2) | YES | | 0.00-1.00 confidence level |
| source_insight_ids | uuid[] | YES | '{}' | Array of source insight IDs |
| embedding | vector(1024) | YES | | For semantic search |
| created_at | timestamptz | YES | now() | |
| updated_at | timestamptz | YES | now() | |

---

### claim_entities

Junction table linking claims to entities.

**Functional Description:**
- **Purpose:** Links claims to the entities (concepts, people, organizations) they reference
- **Created when:** A claim is created and its entities are identified
- **Updated when:** Relevance scores are refined
- **Created by:** AI (during claim extraction)
- **Workflow:** Enables navigation between claims and the entities they discuss. The `relevance_score` indicates how central each entity is to the claim.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | gen_random_uuid() | Primary key |
| claim_id | uuid | NO | | FK claims(id) ON DELETE CASCADE |
| entity_id | uuid | NO | | FK knowledge_entities(id) ON DELETE CASCADE |
| relevance_score | numeric(3,2) | YES | 0.5 | 0.00-1.00 relevance |
| created_at | timestamptz | YES | now() | |

**Unique Constraint:** (claim_id, entity_id)

---

### project_syntheses

Generated narrative syntheses for projects.

**Functional Description:**
- **Purpose:** Stores comprehensive narrative reports synthesizing all insights from a project or challenge
- **Created when:** A facilitator triggers narrative synthesis generation
- **Updated when:** Synthesis is regenerated (version increments)
- **Created by:** AI (narrative synthesis agent)
- **Workflow:** The final output of the analysis process. Takes all insights, claims, and knowledge graph data to generate a comprehensive Markdown report. Can be scoped to entire project or specific challenge. Metadata includes statistics, thematic groups, and section information.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | gen_random_uuid() | Primary key |
| project_id | uuid | NO | | FK projects(id) ON DELETE CASCADE |
| challenge_id | uuid | YES | | FK challenges(id) - NULL for project-wide |
| markdown_content | text | NO | | Generated Markdown report |
| metadata | jsonb | NO | '{}' | Stats, sections, thematic groups |
| version | integer | NO | 1 | Report version number |
| generated_at | timestamptz | NO | now() | When generation completed |
| created_at | timestamptz | NO | now() | |
| updated_at | timestamptz | NO | now() | |

**Unique Index:** (project_id, COALESCE(challenge_id, '00000000-...')) - One synthesis per scope

---

## AI System Tables

### ai_model_configs

AI model provider configurations.

**Functional Description:**
- **Purpose:** Stores configuration for different AI models and providers (LLMs, voice agents, STT, TTS)
- **Created when:** A new AI model is added to the system
- **Updated when:** Model configuration changes
- **Created by:** System administrators
- **Workflow:** Defines which AI models are available and how to connect to them. Supports multiple providers (Anthropic, OpenAI, Mistral, etc.) and voice agent configurations (Deepgram, Speechmatics, ElevenLabs). The `is_default` and `is_fallback` flags control automatic model selection.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | uuid_generate_v4() | Primary key |
| code | varchar | NO | | UNIQUE - Model code identifier |
| name | varchar | NO | | Display name |
| provider | varchar | NO | | anthropic, openai, mistral, etc. |
| model | varchar | NO | | Model name (e.g., claude-3-5-sonnet) |
| base_url | text | YES | | Custom API endpoint |
| api_key_env_var | varchar | NO | | Env var name for API key |
| additional_headers | jsonb | YES | | Custom headers |
| is_default | boolean | YES | false | Default model flag |
| is_fallback | boolean | YES | false | Fallback model flag |
| created_at | timestamptz | YES | now() | |
| updated_at | timestamptz | YES | now() | |
| deepgram_voice_agent_model | varchar | YES | | Deepgram voice agent model |
| deepgram_stt_model | varchar | YES | | STT model (nova-2, nova-3) |
| deepgram_tts_model | varchar | YES | | TTS model |
| deepgram_llm_provider | varchar | YES | | anthropic, openai |
| elevenlabs_voice_id | varchar | YES | | ElevenLabs voice ID |
| elevenlabs_model_id | varchar | YES | | ElevenLabs model |
| elevenlabs_api_key_env_var | varchar | YES | | ElevenLabs API key env var |
| speechmatics_stt_language | varchar | YES | | STT language |
| speechmatics_stt_operating_point | varchar | YES | | STT operating point |
| speechmatics_stt_max_delay | numeric | YES | 2.0 | Max STT delay |
| speechmatics_stt_enable_partials | boolean | YES | true | Enable partial transcripts |
| speechmatics_llm_provider | varchar | YES | | LLM provider for Speechmatics |
| speechmatics_llm_model | varchar | YES | | LLM model for Speechmatics |
| speechmatics_api_key_env_var | varchar | YES | 'SPEECHMATICS_API_KEY' | |
| voice_agent_provider | varchar | YES | | deepgram-voice-agent, speechmatics-voice-agent |
| enable_thinking | boolean | YES | false | Claude extended thinking mode |
| thinking_budget_tokens | integer | YES | 10000 | Min: 1024 |
| speechmatics_diarization | varchar | YES | | Speaker diarization mode |
| speechmatics_speaker_sensitivity | numeric | YES | | Speaker detection sensitivity |
| speechmatics_prefer_current_speaker | boolean | YES | true | |
| speechmatics_max_speakers | integer | YES | | Maximum speaker count |

---

### ai_agents

AI agent configurations with prompts.

**Functional Description:**
- **Purpose:** Defines specialized AI agents with specific prompts and behaviors for different tasks
- **Created when:** A new AI capability is added to the system
- **Updated when:** Agent prompts or configuration changes
- **Created by:** System administrators
- **Workflow:** Each agent is specialized for a task (conversation facilitation, insight extraction, synthesis, etc.). Agents have system and user prompts with variable substitution support. The `voice` flag indicates voice-enabled agents. Agents can have primary and fallback models.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | uuid_generate_v4() | Primary key |
| slug | varchar | NO | | UNIQUE - Agent identifier (e.g., "insight-extractor") |
| name | varchar | NO | | Display name |
| description | text | YES | | Agent description |
| model_config_id | uuid | YES | | FK ai_model_configs(id) - Primary model |
| fallback_model_config_id | uuid | YES | | FK ai_model_configs(id) - Fallback model |
| system_prompt | text | NO | | System prompt template |
| user_prompt | text | NO | | User prompt template with variables |
| available_variables | text[] | YES | '{}' | Allowed template variables |
| metadata | jsonb | YES | | Additional configuration |
| created_at | timestamptz | YES | now() | |
| updated_at | timestamptz | YES | now() | |
| voice | boolean | NO | false | Voice-enabled agent |

---

### ai_agent_logs

Logs of AI interactions.

**Functional Description:**
- **Purpose:** Tracks all AI agent invocations for debugging, monitoring, and cost tracking
- **Created when:** An AI agent is invoked
- **Updated when:** Response is received or error occurs
- **Created by:** System (automatically during AI calls)
- **Workflow:** Every AI call is logged with full request/response payloads. Useful for debugging issues, monitoring performance (latency), and tracking usage. The `tool_calls` field captures any tool use by the AI.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | uuid_generate_v4() | Primary key |
| agent_id | uuid | YES | | FK ai_agents(id) |
| model_config_id | uuid | YES | | FK ai_model_configs(id) |
| ask_session_id | uuid | YES | | FK ask_sessions(id) |
| message_id | uuid | YES | | FK messages(id) |
| interaction_type | varchar | NO | | Type of interaction |
| request_payload | jsonb | NO | | Full request sent to AI |
| response_payload | jsonb | YES | | Full response from AI |
| status | varchar | NO | 'pending' | pending, processing, completed, failed |
| error_message | text | YES | | Error details if failed |
| latency_ms | integer | YES | | Response time in milliseconds |
| created_at | timestamptz | YES | now() | |
| tool_calls | jsonb | YES | | Tool calls made by AI |

---

### ai_insight_jobs

Queue for insight detection processing.

**Functional Description:**
- **Purpose:** Job queue for asynchronous insight extraction from messages
- **Created when:** A message is received that needs insight extraction
- **Updated when:** Job status changes through processing
- **Created by:** System (automatically for new messages)
- **Workflow:** Implements async job processing for insight extraction. Jobs are queued, picked up by workers, processed, and marked complete/failed. Supports retries with attempt tracking.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | uuid_generate_v4() | Primary key |
| ask_session_id | uuid | NO | | FK ask_sessions(id) |
| message_id | uuid | YES | | FK messages(id) |
| agent_id | uuid | YES | | FK ai_agents(id) |
| model_config_id | uuid | YES | | FK ai_model_configs(id) |
| status | varchar | NO | 'pending' | pending, processing, completed, failed |
| attempts | integer | NO | 0 | Retry attempt count |
| last_error | text | YES | | Last error message |
| started_at | timestamptz | YES | | Processing start time |
| finished_at | timestamptz | YES | | Processing end time |
| created_at | timestamptz | YES | now() | |
| updated_at | timestamptz | YES | now() | |

---

## Security Tables

### security_detections

Detected security issues in messages.

**Functional Description:**
- **Purpose:** Logs security threats detected in user messages (prompt injection, XSS, spam, etc.)
- **Created when:** Security analysis identifies a potential threat
- **Updated when:** Detection is reviewed by an admin
- **Created by:** Security analysis system
- **Workflow:** All messages are scanned for security threats. Detections are logged with severity and matched patterns. Admins can review and mark as resolved or false positive.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | uuid_generate_v4() | Primary key |
| message_id | uuid | NO | | FK messages(id) ON DELETE CASCADE |
| profile_id | uuid | YES | | FK profiles(id) - user who sent message |
| detection_type | varchar | NO | | injection, xss, spam, length, command_injection |
| severity | varchar | NO | 'medium' | low, medium, high, critical |
| matched_patterns | jsonb | YES | | Pattern match details |
| status | varchar | NO | 'pending' | pending, reviewed, resolved, false_positive |
| reviewed_by | uuid | YES | | FK profiles(id) - reviewer |
| reviewed_at | timestamptz | YES | | Review timestamp |
| created_at | timestamptz | YES | now() | |

---

### security_monitoring_queue

Queue for messages pending security analysis.

**Functional Description:**
- **Purpose:** Job queue for asynchronous security scanning of messages
- **Created when:** A new message is received
- **Updated when:** Security analysis completes or fails
- **Created by:** System (automatically for new messages)
- **Workflow:** All messages are queued for security analysis. Workers process the queue, running threat detection. Supports retries for failed analyses.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | uuid_generate_v4() | Primary key |
| message_id | uuid | NO | | FK messages(id) ON DELETE CASCADE |
| status | varchar | NO | 'pending' | pending, processing, completed, failed |
| attempts | integer | NO | 0 | Retry attempt count |
| last_error | text | YES | | Last error message |
| started_at | timestamptz | YES | | Processing start time |
| finished_at | timestamptz | YES | | Processing end time |
| created_at | timestamptz | YES | now() | |

---

## Other Tables

### documents

Generic document storage (legacy).

**Functional Description:**
- **Purpose:** Generic storage for documents with metadata (legacy table)
- **Created when:** A document is uploaded
- **Updated when:** Document content or metadata changes
- **Created by:** Users or system
- **Workflow:** Legacy table for document storage. May be used for RAG (Retrieval Augmented Generation) or general file storage.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | bigint | NO | nextval('documents_id_seq') | Primary key (serial) |
| content | text | YES | | Document content |
| metadata | jsonb | YES | | Document metadata |
| ts | timestamptz | YES | now() | Timestamp |

---

## Indexes & Performance

Key indexes for query performance:

```sql
-- Core lookups
CREATE INDEX idx_profiles_auth_id ON profiles(auth_id);
CREATE INDEX idx_profiles_email ON profiles(email);

-- Project/Client access
CREATE INDEX idx_project_members_user ON project_members(user_id);
CREATE INDEX idx_project_members_project ON project_members(project_id);
CREATE INDEX idx_client_members_user ON client_members(user_id);

-- ASK sessions
CREATE INDEX idx_ask_sessions_ask_key ON ask_sessions(ask_key);
CREATE INDEX idx_ask_sessions_project ON ask_sessions(project_id);
CREATE INDEX idx_ask_sessions_status ON ask_sessions(status);
CREATE INDEX idx_ask_participants_token ON ask_participants(invite_token) WHERE invite_token IS NOT NULL;

-- Messages & Threads
CREATE INDEX idx_messages_ask_session ON messages(ask_session_id);
CREATE INDEX idx_messages_thread ON messages(conversation_thread_id);
CREATE INDEX idx_messages_created_at ON messages(created_at);

-- Insights
CREATE INDEX idx_insights_ask_session ON insights(ask_session_id);
CREATE INDEX idx_insights_challenge ON insights(challenge_id);
CREATE INDEX idx_insights_type ON insights(insight_type_id);

-- Vector search (HNSW)
CREATE INDEX idx_insights_embedding ON insights USING hnsw (content_embedding vector_cosine_ops);
CREATE INDEX idx_claims_embedding ON claims USING hnsw (embedding vector_cosine_ops);
CREATE INDEX idx_entities_embedding ON knowledge_entities USING hnsw (embedding vector_cosine_ops);
```

---

## Key RLS Functions

These helper functions are used in RLS policies:

```sql
-- Get current user's profile ID from auth.uid()
public.current_user_id() RETURNS UUID

-- Check if current user is full_admin
public.is_full_admin() RETURNS BOOLEAN

-- Check if current user has access to a project
public.has_project_access(project_uuid UUID) RETURNS BOOLEAN

-- Check if current user can participate in an ASK session
-- Returns TRUE if:
--   1. Session has allow_auto_registration=true AND user is logged in, OR
--   2. User is in ask_participants table for this session
public.is_ask_participant(ask_session_uuid UUID) RETURNS BOOLEAN
```

### Token-Based Access Functions (SECURITY DEFINER)

These functions bypass RLS for token-based anonymous access:

```sql
-- Get session by invite token
public.get_ask_session_by_token(p_token VARCHAR) RETURNS TABLE(...)

-- Get participants by invite token
public.get_ask_participants_by_token(p_token VARCHAR) RETURNS TABLE(...)

-- Get messages by invite token
public.get_ask_messages_by_token(p_token VARCHAR) RETURNS TABLE(...)

-- Get insights by invite token
public.get_ask_insights_by_token(p_token VARCHAR) RETURNS TABLE(...)

-- Get session by ask_key (for public info)
public.get_ask_session_by_key(p_key text) RETURNS TABLE(...)
```

---

## Environment Variables

```env
# Supabase credentials
SUPABASE_URL=your-supabase-project-url
SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
SUPABASE_JWT_SECRET=your-supabase-jwt-secret

# Public (browser-accessible)
NEXT_PUBLIC_SUPABASE_URL=your-supabase-project-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key

# Direct Postgres (for migrations/tooling)
DATABASE_URL=postgresql://user:password@host:6543/postgres
POSTGRES_URL_NON_POOLING=postgresql://user:password@host:5432/postgres

# AI providers
ANTHROPIC_API_KEY=sk-ant-...
MISTRAL_API_KEY=sk-mistral-...
OPENAI_API_KEY=sk-...
```

---

## Migration History (Recent)

| Migration | Description |
|-----------|-------------|
| 127 | Create project_syntheses table for narrative reports |
| 128 | Create narrative_synthesis_agent |
| 129 | Rename rapport agents |
| **130** | **Rename is_anonymous to allow_auto_registration** |
| 131 | Security fixes: Enable RLS, fix function search_path |
| 132 | Enable RLS on claims tables |
| 133 | Fix handle_new_user reject existing email |

To apply migrations:
```bash
npm run db:migrate:up
```

---

## Entity Relationship Summary

```
clients
  └── client_members ──► profiles
  └── projects
        └── project_members ──► profiles
        └── challenges
        │     └── challenge_insights ──► insights
        │     └── challenge_foundation_insights ──► insights
        │     └── ask_sessions
        │     └── claims
        └── ask_sessions
        │     └── ask_participants ──► profiles
        │     └── conversation_threads ──► profiles
        │     │     └── messages
        │     │     └── ask_conversation_plans
        │     │           └── ask_conversation_plan_steps
        │     └── insights
        │           └── insight_authors ──► profiles
        │           └── insight_keywords ──► knowledge_entities
        │           └── kpi_estimations
        └── project_syntheses
        └── insight_syntheses
        └── claims
              └── claim_entities ──► knowledge_entities

ai_agents ──► ai_model_configs
ai_agent_logs ──► ai_agents, ai_model_configs, ask_sessions, messages
ai_insight_jobs ──► ai_agents, ai_model_configs, ask_sessions, messages

knowledge_graph_edges (source/target: entities, insights, claims)

security_detections ──► messages, profiles
security_monitoring_queue ──► messages
```

---

## Test Data

See CLAUDE.md for test credentials and example queries.

```bash
# Verify allow_auto_registration column exists
source .env.local && PGGSSENCMODE=disable psql "$DATABASE_URL" -c "
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'ask_sessions'
AND column_name = 'allow_auto_registration';
"
```
