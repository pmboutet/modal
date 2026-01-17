# Guide des Templates Handlebars pour les Prompts IA

Ce guide explique comment utiliser le système de templates Handlebars pour créer des prompts IA puissants et flexibles.

## Table des matières

1. [Introduction](#introduction)
2. [Vibe Coding avec Handlebars](#vibe-coding-avec-handlebars)
3. [Compatibilité avec l'ancien système](#compatibilité-avec-lancien-système)
4. [Syntaxe de base](#syntaxe-de-base)
5. [Conditions](#conditions)
6. [Boucles](#boucles)
7. [Helpers personnalisés](#helpers-personnalisés)
8. [Exemples pratiques](#exemples-pratiques)
9. [Bonnes pratiques](#bonnes-pratiques)

## Introduction

Le système de templates a été migré vers Handlebars.js pour offrir des capacités avancées tout en maintenant une compatibilité totale avec les templates existants.

**Avantages de Handlebars :**
- ✅ Conditions (`if/else/unless`)
- ✅ Boucles (`each`)
- ✅ Helpers personnalisés pour formater les données
- ✅ Pas d'échappement HTML (adapté aux prompts texte)
- ✅ Compatibilité 100% avec la syntaxe existante `{{variable}}`

## Vibe Coding avec Handlebars

Le système utilise une approche **"Vibe Coding"** où toutes les variables sont compilées directement dans les prompts via Handlebars. Aucune variable n'apparaît dans un champ JSON externe.

### Principe de fonctionnement

1. **Variables dans les templates** : Vous utilisez `{{variable}}` dans vos prompts
2. **Compilation automatique** : Le système remplace automatiquement les placeholders par les valeurs réelles
3. **Prompts finaux** : Le LLM reçoit uniquement les prompts compilés, sans variables externes

### Exemple avant/après

**Avant (ancien système)** :
```json
{
  "system_prompt": "Tu es un assistant.",
  "user_prompt": "Réponds à l'utilisateur. Dernier message : ",
  "variables": {
    "last_message": "Bonjour"
  }
}
```

**Après (système actuel - Vibe Coding)** :

Vous écrivez dans l'interface admin :
```handlebars
System prompt: Tu es un assistant.

User prompt: Réponds à l'utilisateur. Dernier message : {{latest_user_message}}
```

Le système compile automatiquement :
```javascript
// En interne, Handlebars remplace les variables
const compiledUserPrompt = renderTemplate(userPrompt, { 
  latest_user_message: "Bonjour" 
});
// Résultat: "Réponds à l'utilisateur. Dernier message : Bonjour"
```

Le LLM reçoit finalement :
```json
{
  "system_prompt": "Tu es un assistant.",
  "user_prompt": "Réponds à l'utilisateur. Dernier message : Bonjour"
}
```

### Avantages du Vibe Coding

✅ **Simplicité** : Pas de gestion manuelle des variables  
✅ **Lisibilité** : Les prompts contiennent directement le contexte  
✅ **Puissance** : Utilisation de conditions et boucles Handlebars  
✅ **Auto-documentation** : Les variables utilisées sont automatiquement détectées  

### Variables auto-détectées

L'interface admin détecte automatiquement les variables utilisées dans vos prompts :

```handlebars
Tu es un assistant pour {{project_name}}.

{{#if system_prompt_project}}
Context: {{system_prompt_project}}
{{/if}}

{{#each participants_list}}
- {{name}} ({{role}})
{{/each}}
```

Variables détectées : `project_name`, `system_prompt_project`, `participants_list`

### Pas d'activation/désactivation

⚠️ **Important** : Il n'y a plus de système d'activation/désactivation des variables. Si une variable existe dans le système et que vous l'utilisez dans votre template avec `{{variable}}`, elle sera automatiquement remplacée si une valeur est disponible. Sinon, elle restera vide.

## Compatibilité avec l'ancien système

**Tous vos templates existants continuent de fonctionner sans modification.**

```handlebars
Ancien format (toujours valide) :
Tu es un assistant pour {{project_name}}.
Question : {{ask_question}}
Description : {{ask_description}}
```

Les valeurs `null` et `undefined` sont automatiquement converties en chaînes vides, comme avant.

## Syntaxe de base

### Substitution simple de variables

```handlebars
{{variable_name}}
```

**Exemple :**
```handlebars
Bonjour {{participant_name}}, bienvenue dans le projet {{project_name}}.
```

Avec les variables :
```javascript
{
  participant_name: "Alice",
  project_name: "Innovation 2025"
}
```

**Résultat :**
```
Bonjour Alice, bienvenue dans le projet Innovation 2025.
```

### Variables avec espaces

```handlebars
{{ variable_name }}  // Équivalent à {{variable_name}}
```

## Conditions

### If / Else

Afficher du contenu seulement si une variable est définie (non vide) :

```handlebars
{{#if system_prompt_project}}
System prompt projet : {{system_prompt_project}}
{{/if}}
```

**Exemple avec else :**
```handlebars
{{#if participant_name}}
Bonjour {{participant_name}} !
{{else}}
Bonjour participant !
{{/if}}
```

### Unless

Afficher du contenu seulement si une variable est vide ou absente :

```handlebars
{{#unless has_description}}
Aucune description fournie.
{{/unless}}
```

### Conditions imbriquées

```handlebars
{{#if system_prompt_ask}}
{{system_prompt_ask}}

{{#if system_prompt_project}}
Context projet : {{system_prompt_project}}
{{/if}}
{{/if}}
```

### Exemple pratique : Prompt avec sections conditionnelles

```handlebars
Tu es un assistant IA spécialisé.

Contexte de la session :
- Question ASK : {{ask_question}}
{{#if ask_description}}
- Description : {{ask_description}}
{{/if}}

{{#if system_prompt_project}}
System prompt projet : {{system_prompt_project}}
{{/if}}

{{#if system_prompt_challenge}}
System prompt challenge : {{system_prompt_challenge}}
{{/if}}

{{#unless participants}}
Note : Aucun participant n'est encore enregistré.
{{/unless}}
```

## Boucles

### Each - Itérer sur un tableau

```handlebars
{{#each items}}
- {{this}}
{{/each}}
```

**Exemple avec participants :**
```handlebars
Participants de la session :
{{#each participants}}
- {{name}} ({{role}})
{{/each}}
```

Avec les variables :
```javascript
{
  participants: [
    { name: "Alice", role: "Manager" },
    { name: "Bob", role: "Developer" },
    { name: "Carol", role: "Designer" }
  ]
}
```

**Résultat :**
```
Participants de la session :
- Alice (Manager)
- Bob (Developer)
- Carol (Designer)
```

### Variables spéciales dans les boucles

#### @index - Index courant (commence à 0)

```handlebars
{{#each suggestions}}
{{@index}}. {{title}}
{{/each}}
```

#### @first et @last - Premier et dernier élément

```handlebars
{{#each items}}
{{#if @first}}--- DÉBUT ---{{/if}}
{{this}}
{{#if @last}}--- FIN ---{{/if}}
{{/each}}
```

#### @key - Clé de l'objet (pour itération sur objets)

```handlebars
{{#each stats}}
{{@key}}: {{this}}
{{/each}}
```

### Else pour tableaux vides

```handlebars
{{#each participants}}
- {{name}}
{{else}}
Aucun participant pour le moment.
{{/each}}
```

## Helpers personnalisés

Des helpers personnalisés sont disponibles pour les cas d'usage courants dans les prompts IA.

### default - Valeur par défaut

Affiche une valeur par défaut si la variable est vide :

```handlebars
{{default participant_name "Utilisateur anonyme"}}
```

**Exemple :**
```handlebars
Bonjour {{default participant_name "Participant"}}, 
votre rôle est {{default participant_role "Non défini"}}.
```

### notEmpty - Vérifier si non vide

Vérifie si une variable, un tableau ou une chaîne n'est pas vide :

```handlebars
{{#if (notEmpty participants)}}
Il y a {{length participants}} participant(s).
{{/if}}
```

### length - Longueur d'un tableau ou chaîne

```handlebars
Nombre de participants : {{length participants}}
Longueur du message : {{length message}}
```

### jsonParse - Parser du JSON

Utile pour parser des variables JSON stockées en chaînes :

```handlebars
{{#with (jsonParse insights_json)}}
  {{#each insights}}
  - {{title}}: {{description}}
  {{/each}}
{{/with}}
```

**Note :** Retourne `null` si le JSON est invalide, permettant de gérer les erreurs :

```handlebars
{{#if (jsonParse data)}}
Données valides
{{else}}
Données invalides ou absentes
{{/if}}
```

### formatDate - Formater une date ISO

```handlebars
Date courte : {{formatDate analysis_date "short"}}
Date complète : {{formatDate analysis_date}}
```

**Exemples :**
- `"short"` → `2025-01-15`
- Par défaut → `15 janvier 2025`

### uppercase / lowercase - Transformation de casse

```handlebars
{{uppercase project_status}}  // ACTIVE
{{lowercase challenge_name}}  // optimisation des processus
```

### truncate - Tronquer une chaîne

```handlebars
{{truncate description 100}}  // Tronque à 100 caractères + "..."
```

### json - Stringify pour debug

Affiche un objet en JSON formaté (utile pour le développement) :

```handlebars
Debug data:
{{json metadata}}
```

## Exemples pratiques

### Exemple 1 : Prompt de conversation agent avec fusion de prompts

**Template :**
```handlebars
Tu es un assistant IA spécialisé dans la facilitation de conversations.

{{#if system_prompt_ask}}
Instructions spécifiques : {{system_prompt_ask}}
{{/if}}

Contexte de la session :
- Question ASK : {{ask_question}}
{{#if ask_description}}
- Description : {{ask_description}}
{{/if}}

{{#if system_prompt_project}}
Contexte projet :
{{system_prompt_project}}
{{/if}}

{{#if system_prompt_challenge}}
Contexte challenge :
{{system_prompt_challenge}}
{{/if}}

{{#if (notEmpty participants)}}
Participants ({{length participants}}) :
{{#each participants}}
- {{name}}{{#if role}} ({{role}}){{/if}}
{{/each}}
{{/if}}

Ton objectif est d'analyser les messages et de faire émerger des insights.
```

**Variables :**
```javascript
{
  ask_question: "Comment améliorer notre processus?",
  ask_description: "Optimisation des workflows",
  system_prompt_ask: "Sois créatif et innovant.",
  system_prompt_project: "Projet de transformation digitale.",
  system_prompt_challenge: "",
  participants: [
    { name: "Alice", role: "Manager" },
    { name: "Bob", role: "Developer" }
  ]
}
```

**Résultat :** Les sections vides (`system_prompt_challenge`) ne sont pas affichées, les participants sont listés automatiquement.

### Exemple 2 : Génération de suggestions ASK

**Template :**
```handlebars
Voici les suggestions générées :

{{#each suggestions}}
## Suggestion {{@index}}

**Titre** : {{title}}
**Question** : {{question}}
{{#if description}}
**Description** : {{description}}
{{/if}}
**Confiance** : {{default confidence "moyenne"}}
**Urgence** : {{default urgency "moyenne"}}

{{#if (notEmpty recommended_participants)}}
Participants recommandés :
{{#each recommended_participants}}
- {{name}} ({{role}})
{{/each}}
{{/if}}

{{#unless @last}}
---
{{/unless}}
{{/each}}
```

### Exemple 3 : Challenge Builder avec insights groupés

**Template :**
```handlebars
# Challenge: {{parent_challenge_name}}

{{parent_challenge_description}}

## Sous-challenges proposés

{{#each proposed_challenges}}
### {{title}}

**Résumé** : {{summary}}

{{#if (notEmpty pains)}}
**Points de douleur identifiés** :
{{#each pains}}
- {{description}}
{{/each}}
{{/if}}

{{#if (notEmpty ideas)}}
**Idées proposées** :
{{#each ideas}}
- {{description}}
{{/each}}
{{/if}}

{{#if (notEmpty solutions)}}
**Solutions suggérées** :
{{#each solutions}}
- {{description}}
{{/each}}
{{/if}}

**Confiance** : {{confidence}}

{{/each}}

{{#if (notEmpty unclustered_insights)}}
## Insights non classés

{{#each unclustered_insights}}
- {{reason}}
{{/each}}
{{/if}}
```

### Exemple 4 : Gestion de l'historique de messages

**Template :**
```handlebars
Historique de la conversation :

{{#if (notEmpty messages_json)}}
{{#with (jsonParse messages_json)}}
{{#each this}}
**{{role}}** ({{formatDate timestamp "short"}}) :
{{content}}

{{/each}}
{{/with}}
{{else}}
Aucun message dans l'historique. C'est le début de la conversation.
{{/else}}
```

## Bonnes pratiques

### 1. Utiliser les conditions pour nettoyer les sections vides

**Mauvais :**
```handlebars
System prompt projet : {{system_prompt_project}}
System prompt challenge : {{system_prompt_challenge}}
```
→ Affiche des lignes vides si les variables sont absentes.

**Bon :**
```handlebars
{{#if system_prompt_project}}
System prompt projet : {{system_prompt_project}}
{{/if}}
{{#if system_prompt_challenge}}
System prompt challenge : {{system_prompt_challenge}}
{{/if}}
```

### 2. Utiliser `notEmpty` pour vérifier les tableaux

**Mauvais :**
```handlebars
{{#if participants}}
Participants : {{#each participants}}...{{/each}}
{{/if}}
```
→ Un tableau vide `[]` est considéré comme truthy.

**Bon :**
```handlebars
{{#if (notEmpty participants)}}
Participants : {{#each participants}}...{{/each}}
{{/if}}
```

### 3. Fournir des valeurs par défaut

```handlebars
Statut : {{default status "Non défini"}}
Rôle : {{default role "Participant"}}
```

### 4. Utiliser `else` dans les boucles

```handlebars
{{#each items}}
- {{this}}
{{else}}
Aucun élément disponible.
{{/each}}
```

### 5. Limiter la complexité des templates

Si un template devient trop complexe, envisagez de :
- Préparer les données côté code avant de passer au template
- Créer des helpers personnalisés pour la logique métier complexe
- Diviser le template en plusieurs sections

### 6. Tester les templates avec des données variées

Assurez-vous de tester vos templates avec :
- Variables présentes et absentes
- Tableaux vides et remplis
- Valeurs null/undefined
- Chaînes vides

## Ajouter des helpers personnalisés

Si vous avez besoin d'un helper spécifique, vous pouvez l'ajouter dans `src/lib/ai/templates.ts` :

```typescript
import { getHandlebarsInstance } from '@/lib/ai/templates';

const handlebars = getHandlebarsInstance();

handlebars.registerHelper('myCustomHelper', function(value: string) {
  // Votre logique ici
  return value.toUpperCase();
});
```

Ensuite, utilisez-le dans vos templates :

```handlebars
{{myCustomHelper text}}
```

## Migration des templates existants

**Aucune migration n'est nécessaire** : tous les templates existants avec `{{variable}}` fonctionnent sans modification.

Pour profiter des nouvelles fonctionnalités, vous pouvez progressivement enrichir vos templates :

1. Ajoutez des conditions pour les sections optionnelles
2. Utilisez des boucles pour les listes dynamiques
3. Appliquez les helpers pour formater les données

## Ressources

- [Documentation officielle Handlebars](https://handlebarsjs.com/)
- [Guide des built-in helpers](https://handlebarsjs.com/guide/builtin-helpers.html)
- Tests unitaires : `src/lib/ai/__tests__/templates.test.ts`

## Variables disponibles pour les prompts

### Variables standard

| Variable | Type | Description |
|----------|------|-------------|
| `ask_key` | string | Clé unique de la session ASK |
| `ask_question` | string | Question de la session ASK |
| `ask_description` | string | Description de la session ASK |
| `system_prompt_ask` | string | System prompt de la session ASK |
| `system_prompt_project` | string | System prompt du projet |
| `system_prompt_challenge` | string | System prompt du challenge |
| `messages_json` | string (JSON) | Historique des messages au format JSON |
| `latest_user_message` | string | Dernier message utilisateur |

### Variables pour les participants

| Variable | Type | Description | Status |
|----------|------|-------------|--------|
| `participants` | string | Format: "Alice (Manager), Bob (Dev)" | ⚠️ Obsolète |
| `participants_list` | array | Format: `[{name, role}, ...]` | ✅ **Recommandé** |

**Important:** Utilisez `participants_list` (array) avec `{{#each}}` plutôt que `participants` (string).

**Exemple avec `participants_list`:**
```handlebars
{{#if (notEmpty participants_list)}}
Participants ({{length participants_list}}) :
{{#each participants_list}}
- {{name}}{{#if role}} ({{role}}){{/if}}
{{/each}}
{{/if}}
```

Structure de chaque participant:
```typescript
{
  name: string;          // Nom du participant
  role?: string | null;  // Rôle (optionnel)
}
```

## Support

Pour toute question ou suggestion d'amélioration du système de templates, consultez :
- Les tests unitaires pour des exemples concrets
- Le fichier `src/lib/ai/templates.ts` pour l'implémentation
- La documentation des agents : `docs/AGENT_CONFIGURATION_GUIDE.md`
- **Nouveau:** Guide de migration : `HANDLEBARS_MIGRATION_PARTICIPANTS.md`

