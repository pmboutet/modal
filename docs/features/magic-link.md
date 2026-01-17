# Configuration des Magic Links et Tokens

## Architecture

Le système de magic links utilise des **URLs basées sur le chemin** (path-based) pour préserver les tokens/keys lors du flow OAuth. Cette approche a été adoptée car Supabase supprimait les paramètres de requête (`?token=xxx`) des URLs `emailRedirectTo`.

### Routes de callback

```
/auth/callback                     # Callback générique (legacy + OAuth providers)
/auth/callback/token/[token]       # Callback avec participant token
/auth/callback/key/[key]           # Callback avec ask key
```

### Fichiers clés

- `src/lib/auth/magicLink.ts` - Génération des URLs et envoi des emails
- `src/app/auth/callback/route.ts` - Callback OAuth générique
- `src/app/auth/callback/token/[token]/route.ts` - Callback path-based pour tokens
- `src/app/auth/callback/key/[key]/route.ts` - Callback path-based pour keys
- `src/middleware.ts` - Autorise toutes les routes `/auth/callback/*`

## Flux d'authentification

### Flux avec participant token (recommandé)

```
1. Admin envoie un email → sendMagicLink() appelé
2. sendMagicLink() génère: emailRedirectTo = /auth/callback/token/[token]
3. Supabase envoie un email avec lien vers son domaine + code
4. Utilisateur clique → Supabase authentifie
5. Supabase redirige vers: /auth/callback/token/[token]?code=XXX
6. Callback échange le code pour une session
7. Callback crée le profil utilisateur si nécessaire
8. Callback redirige vers: /?token=[token]
9. L'utilisateur accède à l'ASK
```

### Flux avec ask key (backward compatible)

```
1. Admin envoie un email → sendMagicLink() appelé (sans participantToken)
2. sendMagicLink() génère: emailRedirectTo = /auth/callback/key/[key]
3. Supabase envoie un email avec lien vers son domaine + code
4. Utilisateur clique → Supabase authentifie
5. Supabase redirige vers: /auth/callback/key/[key]?code=XXX
6. Callback échange le code pour une session
7. Callback redirige vers: /?key=[key]
8. L'utilisateur accède à l'ASK
```

### Flux avec lien direct (copié-collé)

```
1. Admin copie le lien /?token=xxx depuis l'interface
2. Utilisateur colle le lien → Accès direct
3. Si l'ASK est anonyme: accès immédiat
4. Sinon: authentification requise pour participer
```

## Configuration

### Variables d'environnement

```env
# En production (Vercel)
NEXT_PUBLIC_APP_URL=https://app-modal.com

# En développement local
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

**Note:** La fonction `getBaseUrl()` supprime automatiquement les trailing slashes pour éviter les double slashes dans les URLs générées.

### Configuration Supabase Dashboard

1. Allez sur https://supabase.com/dashboard/project/[VOTRE_PROJECT]/auth/url-configuration
2. Dans "Site URL", configurez votre URL de production :
   ```
   https://app-modal.com
   ```
3. Dans "Redirect URLs", ajoutez les URLs autorisées :
   ```
   https://app-modal.com/**
   http://localhost:3000/**
   ```

**Important:** Le wildcard `/**` est requis pour autoriser les routes path-based `/auth/callback/token/*` et `/auth/callback/key/*`.

## API Reference

### generateMagicLinkUrl

Génère une URL directe (pour copier-coller, sans authentification Supabase).

```typescript
import { generateMagicLinkUrl } from "@/lib/auth/magicLink";

// Avec participant token (recommandé)
const url = generateMagicLinkUrl("user@example.com", "my-ask-key", "participant-token-123");
// → https://app-modal.com/?token=participant-token-123

// Avec ask key uniquement (backward compatible)
const url = generateMagicLinkUrl("user@example.com", "my-ask-key");
// → https://app-modal.com/?key=my-ask-key
```

### generateEmailRedirectUrl

Génère l'URL de callback pour le flow OAuth (utilisée par `sendMagicLink`).

```typescript
import { generateEmailRedirectUrl } from "@/lib/auth/magicLink";

// Avec participant token
const url = generateEmailRedirectUrl("my-ask-key", "participant-token-123");
// → https://app-modal.com/auth/callback/token/participant-token-123

// Avec ask key uniquement
const url = generateEmailRedirectUrl("my-ask-key");
// → https://app-modal.com/auth/callback/key/my-ask-key
```

### sendMagicLink

Envoie un email magic link via Supabase Auth.

```typescript
import { sendMagicLink } from "@/lib/auth/magicLink";

const result = await sendMagicLink(
  "user@example.com",
  "my-ask-key",
  "project-id-optional",
  "participant-token-optional"
);

if (result.success) {
  console.log("Magic link sent!");
} else {
  console.error("Error:", result.error);
}
```

## Middleware

Le middleware autorise toutes les routes commençant par `/auth/callback` sans vérification d'authentification :

```typescript
// src/middleware.ts
if (pathname.startsWith('/auth/callback')) {
  console.log('[Middleware] Auth callback route - allowing through')
  return response
}
```

Cela permet aux routes `/auth/callback/token/[token]` et `/auth/callback/key/[key]` de traiter le code OAuth sans être redirigées.

## Problèmes connus et solutions

### 1. "No email on record"

**Explication :** Ce message apparaît quand un participant n'a pas d'email enregistré dans son profil. Cela n'empêche **pas** la génération d'un lien avec token.

**Solution :** C'est normal et informatif. Le lien peut quand même être copié et utilisé.

### 2. Le magic link redirige vers Vercel au lieu du domaine

**Solutions :**
- Vérifiez `NEXT_PUBLIC_APP_URL` dans Vercel (doit pointer vers votre domaine de production)
- Vérifiez la configuration dans Supabase Dashboard (Site URL et Redirect URLs avec `/**`)
- Redéployez après modification des variables

### 3. Supabase supprime les query params

**Problème résolu :** Supabase supprimait les `?token=xxx` des URLs `emailRedirectTo`.

**Solution implémentée :** Utilisation de routes path-based (`/auth/callback/token/[token]`) au lieu de query params.

### 4. Double slashes dans les URLs

**Problème résolu :** Si `NEXT_PUBLIC_APP_URL` avait un trailing slash, les URLs générées contenaient `//`.

**Solution implémentée :** `getBaseUrl()` supprime automatiquement les trailing slashes.

## Debugging

Pour tracer le flow magic link, chercher dans les logs :

```bash
# Logs d'envoi
[MagicLink] Sending magic link to user@example.com with redirectUrl: ...

# Logs de callback
[Callback/Token] ========== OAuth Callback Started ==========
[Callback/Token] Participant token from path: xxx
[Callback/Token] Exchanging code for session...
[Callback/Token] Session created for: user@example.com
[Callback/Token] Redirecting to: /?token=xxx
```

