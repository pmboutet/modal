# Configuration des Magic Links et Tokens

## Problèmes identifiés et solutions

### 1. "No email on record" 

**Explication :** Ce message apparaît quand un participant n'a pas d'email enregistré dans son profil. Cela n'empêche **pas** la génération d'un lien avec token - le lien est généré même sans email.

**Solution :** C'est normal et informatif. Le lien peut quand même être copié et utilisé.

### 2. Le lien avec token redirige vers /admin ou /login

**Problème :** La page d'accueil (`page.tsx`) ne détectait que le paramètre `key`, pas `token`.

**Solution :** ✅ Corrigé - `page.tsx` détecte maintenant `key` OU `token`.

### 3. Le magic link Supabase redirige vers Vercel au lieu de votre domaine

**Problème :** Supabase utilise l'URL configurée dans son dashboard comme URL de redirection par défaut, même si vous passez `emailRedirectTo`.

**Solutions :**

#### Option A : Configurer l'URL dans Supabase Dashboard (Recommandé)

1. Allez sur https://supabase.com/dashboard/project/[VOTRE_PROJECT]/auth/url-configuration
2. Dans "Site URL", configurez votre URL de production :
   ```
   https://app-modal.com
   ```
   Ou pour le développement local :
   ```
   http://localhost:3000
   ```
3. Dans "Redirect URLs", ajoutez les URLs autorisées :
   ```
   https://app-modal.com/**
   http://localhost:3000/**
   ```

#### Option B : Utiliser les variables d'environnement

Assurez-vous que `NEXT_PUBLIC_APP_URL` est configuré correctement :

```env
# En production (Vercel)
NEXT_PUBLIC_APP_URL=https://app-modal.com

# En développement local
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

**Important :** La variable `NEXT_PUBLIC_APP_URL` doit être définie dans Vercel :
1. Allez sur votre projet Vercel
2. Settings → Environment Variables
3. Vérifiez que `NEXT_PUBLIC_APP_URL` est défini avec la valeur `https://app-modal.com` (ou votre domaine de production)
4. Redéployez après modification

### 4. Comment fonctionnent les magic links maintenant

#### Flux avec token (recommandé) :
1. Admin envoie un email → `sendMagicLink()` est appelé
2. Supabase envoie un email avec un lien vers son propre domaine
3. L'utilisateur clique → Supabase l'authentifie
4. Supabase redirige vers `/?token=xxx` (avec l'URL configurée dans Supabase)
5. L'utilisateur accède à l'ASK

#### Flux avec lien direct (copié-collé) :
1. Admin copie le lien `/?token=xxx` depuis l'interface
2. L'utilisateur colle le lien → Accès direct (même sans authentification si l'ASK est anonyme)
3. L'utilisateur peut voir l'ASK mais devra s'authentifier pour participer activement

## Vérification

Pour tester que tout fonctionne :

1. **Vérifiez les variables d'environnement en production :**
   ```bash
   # Dans Vercel Dashboard → Settings → Environment Variables
   NEXT_PUBLIC_APP_URL=https://app-modal.com
   ```

2. **Vérifiez la configuration Supabase :**
   - Site URL : `https://app-modal.com`
   - Redirect URLs : `https://app-modal.com/**`

3. **Testez un lien avec token :**
   - Le lien `/?token=xxx` devrait fonctionner directement
   - Si l'utilisateur n'est pas authentifié, il devrait voir l'ASK mais peut-être avec des limitations

4. **Testez un magic link par email :**
   - L'email devrait contenir un lien Supabase
   - Après clic, redirection vers votre domaine avec le token

## Dépannage

### Le lien redirige toujours vers Vercel
- Vérifiez `NEXT_PUBLIC_APP_URL` dans Vercel (doit pointer vers votre domaine de production)
- Vérifiez la configuration dans Supabase Dashboard (Site URL et Redirect URLs)
- Redéployez après modification des variables

### Le lien avec token redirige vers /admin
- Vérifiez que `page.tsx` a été mis à jour (détecte `token` en plus de `key`)
- Vérifiez que le token est bien présent dans l'URL : `/?token=xxx`

### "No email on record" mais le lien fonctionne
- C'est normal ! Le participant n'a juste pas d'email enregistré
- Le lien avec token fonctionne quand même

