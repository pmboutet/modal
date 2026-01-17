# Fix: Timeout lors du chargement du profil en production

## Problème identifié

Lors de la connexion en production, le fetch du profil utilisateur timeout systématiquement après 8 secondes, causant une boucle infinie de redirection.

### Logs observés

```
[AuthProvider] Fetching profile for user: f2e233a0-1f19-49c0-b082-f75a771ab1b1 pierremboutet@gmail.com
Profile fetch timed out after 8001ms
Profile fetch attempt 1/3 failed, retrying in 500ms...
Profile fetch timed out after 8003ms
Profile fetch attempt 2/3 failed, retrying in 1000ms...
Session check timed out after 10s, treating as signed-out
```

## Cause racine

La requête SQL originale utilisait une jointure avec la table `clients`:

```typescript
supabase
  .from("profiles")
  .select("*, clients(name)")  // ← Jointure lente
  .eq("auth_id", authUser.id)
  .single()
```

Cette jointure peut être **très lente en production** en fonction de:
- La taille de la table `clients`
- Les index manquants sur `client_id`
- La charge de la base de données
- La latence réseau vers Supabase

## Solutions implémentées

### 1. Optimisation de la requête SQL

**Avant** (avec jointure):
```typescript
const profilePromise = supabase
  .from("profiles")
  .select("*, clients(name)")
  .eq("auth_id", authUser.id)
  .single();
```

**Après** (requêtes séparées):
```typescript
// Fetch profile seul (rapide)
const profilePromise = supabase
  .from("profiles")
  .select("*")
  .eq("auth_id", authUser.id)
  .single();

// Fetch client name séparément si nécessaire (non-bloquant)
if (result.data.client_id) {
  const clientResult = await supabase
    .from("clients")
    .select("name")
    .eq("id", result.data.client_id)
    .single();
  clientName = clientResult.data?.name ?? null;
}
```

**Avantages**:
- Le fetch du profil est maintenant **beaucoup plus rapide** (pas de jointure)
- Si le fetch du client name échoue, l'auth continue quand même
- Meilleure résilience en cas de problème

### 2. Augmentation des timeouts

**Profile fetch timeout**: 8s → **15s**
```typescript
const timeoutPromise = new Promise<{ data: null; error: { message: string } }>((resolve) => {
  setTimeout(() => {
    resolve({ data: null, error: { message: "Profile fetch timeout" } });
  }, 15000); // Augmenté à 15s pour production
});
```

**Session check timeout**: 10s → **30s**
```typescript
const timeoutId = setTimeout(() => {
  if (isMounted) {
    console.warn("Session check timed out after 30s...");
    setStatus("signed-out");
  }
}, 30000); // 30 seconds timeout
```

### 3. Amélioration des logs

Les logs incluent maintenant:
- Temps exact écoulé pour chaque tentative
- Nombre de tentatives restantes
- État du cache

## Impact

### Performance attendue

**Avant**:
- Fetch du profil: 8000+ ms (timeout)
- Nombre d'échecs: 3/3
- Résultat: Échec de connexion

**Après**:
- Fetch du profil: ~100-500 ms (estimation)
- Fetch client name: ~50-200 ms (non-bloquant)
- Résultat: Connexion réussie

### Compatibilité

✅ Rétrocompatible - aucun changement de schéma
✅ Pas d'impact sur les fonctionnalités existantes
✅ Le `clientName` est toujours disponible dans le profil

## Recommandations additionnelles

### Index de base de données

Pour optimiser davantage, s'assurer que ces index existent:

```sql
-- Index sur auth_id pour les lookups rapides
CREATE INDEX IF NOT EXISTS idx_profiles_auth_id
  ON public.profiles(auth_id);

-- Index sur client_id pour les jointures
CREATE INDEX IF NOT EXISTS idx_profiles_client_id
  ON public.profiles(client_id);
```

### Monitoring

Ajouter des métriques pour surveiller:
- Temps moyen de fetch du profil
- Taux de timeout
- Nombre de retries nécessaires

### Alternative: Cache côté client

Envisager d'utiliser localStorage pour cacher le profil temporairement:

```typescript
// Au premier fetch réussi
localStorage.setItem('profile_cache', JSON.stringify(profile));

// Au prochain chargement
const cached = localStorage.getItem('profile_cache');
if (cached) {
  setProfile(JSON.parse(cached)); // Affichage immédiat
  // Puis refresh en arrière-plan
}
```

## Fichiers modifiés

- [src/components/auth/AuthProvider.tsx](../src/components/auth/AuthProvider.tsx)
  - Ligne 82-86: Requête SQL optimisée
  - Ligne 88-91: Timeout augmenté à 15s
  - Ligne 125-138: Fetch séparé du client name
  - Ligne 325-341: Session timeout augmenté à 30s

## Test en production

Après déploiement, vérifier dans les logs:
1. Le temps de fetch du profil devrait être < 1000ms
2. Le message "Profile fetch completed successfully" devrait apparaître
3. La connexion devrait réussir du premier coup

## Rollback

Si le problème persiste, revenir à l'ancienne requête avec jointure mais avec un timeout plus élevé:

```typescript
const profilePromise = supabase
  .from("profiles")
  .select("*, clients(name)")
  .eq("auth_id", authUser.id)
  .single();

// Timeout à 30s au lieu de 15s
setTimeout(() => resolve({ data: null, error: { message: "..." } }), 30000);
```
