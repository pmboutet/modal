# Dépannage: Boucle infinie "Vérification des accès..." en production

## Symptômes

- Après connexion en production, l'écran affiche "Vérification des accès..."
- Un message apparaît brièvement puis disparaît
- Le cycle recommence indéfiniment

## Diagnostic

### Problème identifié

Le problème est causé par une **boucle infinie** entre plusieurs états de l'application:

1. **État initial**: `status = "loading"` → `accessState = "checking"`
   - Affiche "Vérification des accès..."

2. **Timeout de 5 secondes**: [AdminDashboard.tsx:2110-2117](../src/components/admin/AdminDashboard.tsx#L2110-L2117)
   - `hasLoadingTimeout = true`

3. **Changement d'état**: [AdminDashboard.tsx:2133-2135](../src/components/admin/AdminDashboard.tsx#L2133-L2135)
   - `accessState = "signed-out"`

4. **Redirection**: [AdminDashboard.tsx:2211-2218](../src/components/admin/AdminDashboard.tsx#L2211-L2218)
   - Redirige vers `/auth/login?redirectTo=/admin`

5. **Retour à l'étape 1** si l'authentification réussit mais que le profil ne peut pas être chargé

### Causes probables en production

#### 1. Problème de permissions RLS (Row Level Security)

Le problème le plus probable est que **les politiques RLS empêchent l'utilisateur de lire son propre profil**.

**Politiques RLS pertinentes** (voir [migrations/014_enable_rls_security.sql](../migrations/014_enable_rls_security.sql)):

```sql
-- Ligne 188-190: L'utilisateur DOIT pouvoir lire son propre profil
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING (auth_id = auth.uid());
```

**Points de vérification**:

- ✅ La colonne `auth_id` dans `profiles` doit correspondre à l'ID d'authentification Supabase
- ✅ La fonction `auth.uid()` doit retourner l'ID correct de l'utilisateur connecté
- ✅ Le profil de l'utilisateur doit exister dans la table `profiles`

#### 2. Profil inexistant

Si l'utilisateur s'est authentifié via Supabase Auth mais n'a **pas de profil créé dans la table `profiles`**:

- Le fetch du profil échouera même avec les bonnes permissions RLS
- L'application affichera l'état "profile-missing"

#### 3. Timeout réseau

Avec un timeout de **8 secondes** pour le fetch du profil ([AuthProvider.tsx:90](../src/components/auth/AuthProvider.tsx#L90)), un réseau lent peut causer des timeouts répétés.

## Solutions implémentées

### 1. Logs de debug détaillés

Des logs ont été ajoutés pour identifier exactement où le problème se produit:

**Dans AuthProvider.tsx**:
- Log au début du fetch de profil avec `auth_id` et email
- Log détaillé des erreurs RLS (code, details, hint)
- Log du résultat final avec compteur d'échecs

**Dans AdminDashboard.tsx**:
- Log de chaque tentative de redirection
- Protection contre plus de 3 redirections infinies

### 2. Messages d'erreur améliorés

**État "profile-missing"**: Nouveau message détaillé qui explique:
- Problèmes de permissions RLS possibles
- Profil non créé
- Problème réseau
- Affiche l'email de l'utilisateur connecté
- Bouton "Se déconnecter" pour sortir de la boucle

**État "forbidden/inactive"**: Message amélioré avec:
- Différenciation entre compte inactif et accès refusé
- Affichage du rôle actuel
- Bouton de déconnexion

### 3. Protection contre la boucle infinie

Un compteur de redirections a été ajouté qui arrête les redirections après 3 tentatives.

## Commandes de vérification

### Vérifier les politiques RLS actives

```sql
-- Voir toutes les politiques sur la table profiles
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE tablename = 'profiles';
```

### Vérifier qu'un profil existe pour un utilisateur

```sql
-- Remplacer 'USER_EMAIL' par l'email de l'utilisateur
SELECT
  id,
  auth_id,
  email,
  role,
  is_active,
  client_id
FROM profiles
WHERE email = 'USER_EMAIL';
```

### Vérifier que auth_id correspond

```sql
-- Vérifier que auth_id dans profiles correspond à l'ID dans auth.users
SELECT
  u.id as auth_user_id,
  u.email,
  p.id as profile_id,
  p.auth_id as profile_auth_id,
  p.role,
  p.is_active
FROM auth.users u
LEFT JOIN public.profiles p ON p.auth_id = u.id
WHERE u.email = 'USER_EMAIL';
```

### Tester l'accès RLS en tant qu'utilisateur

```sql
-- Se connecter en tant qu'utilisateur spécifique pour tester RLS
-- Remplacer 'AUTH_USER_ID' par l'ID de auth.users
BEGIN;
SET LOCAL role TO authenticated;
SET LOCAL request.jwt.claims TO '{"sub": "AUTH_USER_ID"}';

-- Tester la lecture du profil
SELECT * FROM profiles WHERE auth_id = 'AUTH_USER_ID';

ROLLBACK;
```

## Script de diagnostic automatique

Un script SQL de diagnostic a été créé: `scripts/diagnose-auth-rls.sql`

Exécuter avec:
```bash
psql $DATABASE_URL -f scripts/diagnose-auth-rls.sql
```

## Actions recommandées

### En production

1. **Activer les logs dans la console du navigateur**
   - Les nouveaux logs commencent par `[AuthProvider]` et `[AdminDashboard]`
   - Chercher les erreurs de type "Error fetching profile"

2. **Vérifier dans Supabase Dashboard**
   - Table Editor → `profiles` → Vérifier que le profil existe
   - Authentication → Users → Vérifier l'ID de l'utilisateur
   - SQL Editor → Exécuter les requêtes de vérification ci-dessus

3. **Si le profil n'existe pas**
   - Créer manuellement le profil avec le bon `auth_id`
   - Ou utiliser le script d'initialisation des profils

4. **Si les politiques RLS bloquent l'accès**
   - Vérifier que la migration 014 a bien été exécutée
   - Vérifier qu'il n'y a pas de conflit avec d'autres politiques

### Pour éviter ce problème à l'avenir

1. **Automatiser la création de profils**
   - Ajouter un trigger sur `auth.users` pour créer automatiquement un profil
   - Voir exemple dans `migrations/010_migrate_to_auth_profiles.sql`

2. **Améliorer le onboarding**
   - Rediriger les nouveaux utilisateurs sans profil vers une page d'onboarding
   - Permettre la création de profil self-service

3. **Monitoring**
   - Ajouter des alertes sur les échecs répétés de fetch de profil
   - Logger les erreurs RLS dans un service de monitoring

## Références

- [AuthProvider.tsx](../src/components/auth/AuthProvider.tsx) - Gestion de l'authentification
- [AdminDashboard.tsx](../src/components/admin/AdminDashboard.tsx) - Contrôle d'accès
- [Migration 014](../migrations/014_enable_rls_security.sql) - Politiques RLS
- [Migration 011](../migrations/011_enable_rls_policies.sql) - Politiques RLS initiales
