# Configuration Google OAuth pour Supabase

## ✅ Interface Implémentée !

Le code est **prêt** ! Il ne reste plus qu'à configurer Google Cloud et Supabase.

## 🎯 Ce qui a été ajouté

✅ Fonction `signInWithGoogle()` dans AuthProvider  
✅ Bouton "Continue with Google" dans LoginForm  
✅ Bouton "Continue with Google" dans SignupForm  
✅ Page de callback OAuth `/auth/callback`  
✅ Dépendance `@supabase/ssr` utilisée (déjà présente)  

## 🔧 Configuration Requise (10 minutes)

### Étape 1 : Google Cloud Console

1. **Créer un projet** : https://console.cloud.google.com/
   - Nom : "Agentic Design Flow" (ou autre)
   - Pas de carte bancaire requise

2. **Activer Google+ API** :
   - Menu → "APIs & Services" → "Library"
   - Rechercher "Google+ API" → "Enable"

3. **Configurer l'écran de consentement** :
   - "APIs & Services" → "OAuth consent screen"
   - User Type : **External**
   - App name : "Agentic Design Flow"
   - User support email : votre email
   - Developer contact : votre email
   - Scopes : Ajoutez `email`, `profile` et `openid`

4. **Créer OAuth Client ID** :
   - "APIs & Services" → "Credentials"
   - "Create Credentials" → "OAuth client ID"
   - Application type : **Web application**
   - Name : "Agentic Design Flow"
   - **Authorized redirect URIs** (IMPORTANT) :
     ```
     https://lsqiqrxxzhgikhvkgpbh.supabase.co/auth/v1/callback
     http://localhost:3000/auth/callback
     ```
   
5. **Copier les credentials** :
   - Client ID : `123456789-abc123...apps.googleusercontent.com`
   - Client Secret : `GOCSPX-abc123...`

### Étape 2 : Configuration Supabase (2 minutes)

1. **Aller sur** : https://supabase.com/dashboard/project/lsqiqrxxzhgikhvkgpbh/auth/providers

2. **Trouver "Google"** dans la liste des providers

3. **Activer** :
   - Toggle "Enable Sign in with Google"
   
4. **Coller les credentials** :
   - Client ID (de Google Cloud)
   - Client Secret (de Google Cloud)

5. **Vérifier la Redirect URL** :
   - Elle devrait être : `https://lsqiqrxxzhgikhvkgpbh.supabase.co/auth/v1/callback`
   - C'est cette URL que vous avez mise dans Google Cloud

6. **Save**

### Étape 3 : Installation des dépendances

```bash
npm install
```

### Étape 4 : Test

```bash
NODE_TLS_REJECT_UNAUTHORIZED=0 npm run dev
```

Puis :
1. Allez sur http://localhost:3000/auth/login
2. Cliquez sur "Continue with Google"
3. Connectez-vous avec votre compte Google
4. Vous êtes redirigé vers `/admin` et connecté ! ✅

## 🎨 Interface Créée

### LoginForm et SignupForm

Les deux pages ont maintenant un bouton Google stylisé avec :
- ✅ Logo Google officiel (4 couleurs)
- ✅ Séparateur "Or continue with"
- ✅ Design cohérent avec le reste de l'UI
- ✅ États disabled pendant le loading

### Flow OAuth

```
User clique "Continue with Google"
         ↓
   Popup Google (auth.google.com)
         ↓
   User autorise l'application
         ↓
   Redirect vers /auth/callback?code=...
         ↓
   Échange du code pour une session
         ↓
   Redirect vers /admin
         ↓
   User connecté ! ✅
```

## 🚀 Ce qui se passe automatiquement

1. **User se connecte avec Google**
2. **Supabase Auth crée l'utilisateur** dans `auth.users`
3. **Le trigger `handle_new_user()`** crée automatiquement le profil dans `public.profiles`
4. **L'utilisateur est connecté** avec toutes ses infos
5. **Les permissions RLS** s'appliquent automatiquement

## 💡 Avantages

✅ **Gratuit** jusqu'à millions d'utilisateurs  
✅ **Pas de gestion de passwords** pour l'user  
✅ **Plus sécurisé** (OAuth 2.0)  
✅ **Inscription en 1 clic**  
✅ **Compatible mobile**  
✅ **Email vérifié automatiquement**  

## 🔐 Sécurité

- ✅ OAuth 2.0 standard
- ✅ PKCE flow (protection CSRF)
- ✅ Tokens cryptés
- ✅ Session sécurisée
- ✅ Pas de mot de passe stocké

## 📝 Notes Importantes

### Pour le développement local

Ajoutez dans Google Cloud Console :
```
http://localhost:3000/auth/callback
```

### Pour la production

Ajoutez votre domaine de production :
```
https://votredomaine.com/auth/callback
```

### Variables d'environnement

Aucune variable supplémentaire ! Tout est configuré via Supabase Dashboard.

## 🆘 Troubleshooting

### Erreur "redirect_uri_mismatch"

➡️ Vérifiez que l'URL de callback dans Google Cloud Console **correspond exactement** à :
```
https://lsqiqrxxzhgikhvkgpbh.supabase.co/auth/v1/callback
```

### Erreur "Invalid client"

➡️ Vérifiez que Client ID et Client Secret sont corrects dans Supabase Dashboard

### Bouton Google ne fait rien

➡️ Vérifiez que Google OAuth est **activé** dans Supabase Dashboard

### Redirect en boucle

➡️ Vérifiez que la page `/auth/callback` existe et fonctionne

## ✨ Prochaines Étapes (Optionnel)

Vous pouvez ajouter d'autres providers de la même manière :

- 🔵 GitHub : https://supabase.com/dashboard/project/lsqiqrxxzhgikhvkgpbh/auth/providers
- 🟦 Microsoft : Même process
- 🟪 Discord : Même process
- 🟩 Spotify : Même process

Le code est déjà compatible ! Il suffit de :
1. Ajouter `signInWithGitHub()`, etc. dans AuthProvider
2. Ajouter les boutons correspondants
3. Configurer les providers dans leurs dashboards respectifs

---

**Status** : ✅ Code prêt, attend configuration Google Cloud + Supabase  
**Temps estimé** : 10 minutes  
**Coût** : Gratuit

