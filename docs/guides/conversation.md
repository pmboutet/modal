# Conversations (ASK) : functional guide

## scenarios

Il ya plusieurs scénarios :
- Conversations individuelles en parallèle noté "@Ind//"
  - @speetch
  - @text
- Conversation de groupe avec un rapporteur noté "@groupRapporteur" (COMME @Ind// sauf pour insights détection)
  - @speetch
  - @text
- Conversations de groupe en simultanées noté "@group"
  - @speetch
  - @text
- Conversation en mode consultant noté "@consultant"
  - @speetch
  - @text

## FLOW d'une conversation ASK

### A - Accès aux conversations ASK

Il existe une seule manière de se connecter : via un lien `token=XXXX`

Le token est une clé unique (32 chars hex) permettant de retrouver l'ask et l'userId en base de données.

Si un lien avec `ask=xxx` est fourni alors :
1. On demande l'email
2. Si email existe → send mail magic link contenant token
3. Si email n'existe pas → on demande ses infos puis on envoie le token

**Note :** Le flag `allow_auto_registration` dans `ask_sessions` contrôle si de nouveaux users peuvent s'inscrire via `ask=xxx`.

---

### B - Thread

1. En mode "@Ind//"
   - Principe : on crée un Thread @threadId par user
   - IDENTIQUE @speetch ou @voice
   - Check si Thread existe pour ce @userId → si oui on get, sinon on crée
   - On continue avec ce @threadId

2. En mode "Group ou consultant"
   - IDENTIQUE @speetch ou @voice
   - On check si le @thread existe (pas de filtre par @userId, uniquement par @askId)
   - Si n'existe pas on crée
   - On continue avec ce @threadID
   - **Note :** Le consultant partage le même thread que les personnes qu'il conseille

---

### C - Plan

Quelque soit le mode (@ind//, @groupe, @consultant) et le canal (@text @speetch) :
- SI PAS DE PLAN pour ce @threadID → on crée le @ask.plan.generation
- Si le @plan existe on continue

---

### D - Message d'initialisation

En canal @speetch et @texte ET pour les modes @ind// et @group :
- Si pas de message en base de donnée on crée un message d'initialisation
- **Pas de message d'initialisation pour @consultant** (interface vide au démarrage)

---

### E - Questions suggérées

- Si le user connecté est marqué comme `is_spokesperson` et que le mode est @consultant → suggérer les questions

**Note :** `is_spokesperson` = consultant en mode @consultant. Ce flag est aussi utilisé en mode @group (DRY).

---

### F - Attente de message user et réponse

**En mode @ind// (canal @speetch ou @text) :**
- Trigger réponse agent @ask.chat.response **2 secondes** après le post du message SI la personne n'est pas en train de taper
- Si la personne tape et s'arrête **5 secondes** → appeler @ask.chat.response
- Si la personne recommence à taper → annuler l'appel et attendre à nouveau

**En mode @group :**
- Pareil que @ind// sauf que les délais s'appliquent à tous les users
- Si l'un d'eux tape → l'agent ne répond à aucun
- **Contrôleur unique** : `is_spokesperson` contrôle l'agent
- Si `is_spokesperson` pas connecté → premier user connecté devient contrôleur
- Failover automatique si contrôleur déconnecte

**En mode @consultant :**
- PAS DE REPONSE de l'agent

---

### G - Step complete

Quelque soit le mode, si `STEP_COMPLETE` est parsé dans le message :
- On fait un @ask.step.summary de la discussion
- On update l'avancement pour le @planId

Le @canal n'a pas d'impact, le fonctionnement est le même.

---

### H - Insights detection

La détection d'insights se fait quelque soit le mode et le canal.

**Filtrage :** Les insights sont toujours filtrés par @threadId (sélection, affichage, persistance).

**Attribution selon le mode :**
- **@consultant** : Insights attribués à l'utilisateur qui a posté le message (PAS au consultant/is_spokesperson)
- **@group** : Insight assigné à celui qui l'a apporté au débat
- **@groupRapporteur** : Insight attribué à celui qui l'énonce

**Note :** La diarisation en mode voice identifie les speakers.

*FONCTIONNALITÉ FUTURE : Tool pour chercher insights similaires et fusionner (plusieurs users attachés au même insight)*

---

### I - Fin d'interview

- On lance la génération du graph (Knowledge Graph en arrière-plan)
- Visualisation disponible pour les admins dans `/admin/projects/[id]/synthesis`
- **Pas de visualisation pour les participants**

---

## CORRECTIONS APPLIQUÉES (Session du 18/01/2026)

| Section | Correction | Fichiers modifiés |
|---------|------------|-------------------|
| A | Mode `?key=xxx` supprimé | HomePage.tsx, page.tsx, magicLink.ts, routes |
| A | Documentation mise à jour | docs/features/magic-link.md |
| B | Migration contrainte unique threads | migrations/138_add_shared_thread_unique_constraint.sql |
| B | Migration 080 corrigée | migrations/080_add_consultant_conversation_mode.sql |
| B | Documentation mise à jour | docs/features/consultant-mode.md |
| C | Spec mise à jour | Ce fichier |
| D | Consultant exclu du message init | route.ts, voice-agent/init/route.ts |
| F | Délais ajustés (2s/5s) | HomePage.tsx |
| F | BUG-022 corrigé : onSpeakerChange câblé | HomePage.tsx |
| H | Attribution consultant corrigée | respond/route.ts |
| I | BUG-GRAPH-001 corrigé : graph pour tous auth | stream/route.ts |

---

## AMÉLIORATIONS FUTURES (non bloquantes)

| Item | Priorité | Description |
|------|----------|-------------|
| BUG-PS-001 | 🟡 | Race condition step completion (ajouter état `completing`) |
| BUG-PS-006 | 🟡 | Locking DB sur completions simultanées |
| Synchro @group | 🟡 | Hook `useTypingBroadcast` pour mode @group multi-utilisateurs |
| Migration 138 | 🟢 | Doublon de migration 134 (technical debt) |

---

## PLAN SYNCHRO @GROUP (Section F)

Un plan détaillé a été créé pour implémenter la synchronisation multi-utilisateurs en mode @group :

**Nouveau hook à créer :** `src/hooks/useTypingBroadcast.ts`
- Utilise Supabase Realtime Broadcast pour les événements "typing"
- Utilise Supabase Realtime Presence pour tracker les users connectés
- Logique de contrôleur : `is_spokesperson` prioritaire, sinon premier connecté
- Failover automatique si contrôleur déconnecte

**Fichiers à modifier :** `src/app/HomePage.tsx` (intégration avec le nouveau hook)

**À implémenter ultérieurement.**
