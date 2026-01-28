# Worklog Monorepo Support - Specification

**Version:** Draft 1.0
**Date:** 2026-01-26

## Objectif

Permettre à `wl` de gérer plusieurs `.worklog` dans un monorepo, en liant des tâches à des workspaces spécifiques tout en minimisant les tokens nécessaires pour claude-code.

## Concepts

| Terme | Définition |
|-------|------------|
| **Scope** | Un `.worklog` identifié par son chemin relatif depuis la racine git |
| **Scope ID** | Identifiant affiché (par défaut = path, customisable) |
| **Parent** | Le `.worklog` à la racine git |
| **Enfant** | Un `.worklog` dans un sous-dossier |

## Structure

```
monorepo/                      # racine git
├── .worklog/                  # scope parent
│   ├── scope.json
│   ├── index.json
│   └── tasks/
├── packages/
│   ├── api/
│   │   └── .worklog/          # scope enfant
│   │       ├── scope.json
│   │       ├── index.json
│   │       └── tasks/
│   └── ui/
│       └── .worklog/          # scope enfant
│           └── ...
```

## scope.json

### Parent (racine)

```json
{
  "children": [
    { "path": "packages/api", "id": "packages/api" },
    { "path": "packages/ui", "id": "ui" }
  ]
}
```

- `path` : chemin relatif depuis la racine git
- `id` : identifiant affiché (défaut = path, customisable pour raccourcir)

### Enfant

```json
{
  "parent": "../.."
}
```

- `parent` : chemin relatif vers le dossier contenant le `.worklog` parent

## Découverte des scopes

### Algorithme

1. Remonter du CWD jusqu'à la racine git (limite haute)
2. Scanner récursivement les sous-dossiers jusqu'à `WORKLOG_DEPTH_LIMIT`
3. Collecter tous les dossiers contenant un `.worklog/`
4. Construire la hiérarchie parent/enfants

### Déclenchement

Le scan et la mise à jour de `scope.json` se produisent :
- Si `scope.json` n'existe pas
- Via `wl scopes --refresh`

### Variable d'environnement

| Variable | Défaut | Description |
|----------|--------|-------------|
| `WORKLOG_DEPTH_LIMIT` | 5 | Profondeur maximale de scan |

## Résolution du scope actif

Ordre de priorité :

1. Flag explicite `--scope <path|id>`
2. `.worklog` le plus proche en remontant depuis le CWD
3. `.worklog` à la racine git (si aucun trouvé en remontant)

Le `--scope` accepte :
- Le path complet (`packages/api`)
- L'id custom (`ui` si configuré)
- Priorité au path en cas d'ambiguïté

## Commandes

### wl scopes

Liste les scopes découverts.

```
wl scopes [--refresh]
```

| Flag | Description |
|------|-------------|
| `--refresh` | Force le rescan et met à jour scope.json |

**Sortie exemple :**
```
Scopes:
  (root)        .worklog/
  packages/api  packages/api/.worklog/
  ui            packages/ui/.worklog/
```

### wl list (modifié)

```
wl list [--all] [--scope=<scope>] [--all-scopes]
```

| Flag | Description |
|------|-------------|
| `--scope=X` | Filtre sur un scope spécifique |
| `--all-scopes` | Affiche tous les scopes |

### Comportement d'affichage

| CWD | Commande | Tâches affichées | Préfixes |
|-----|----------|------------------|----------|
| `monorepo/` | `wl list` | root + enfants | `[api]`, `[ui]` (pas root) |
| `monorepo/` | `wl list --scope=packages/api` | packages/api | aucun |
| `packages/api/` | `wl list` | packages/api | aucun |
| `packages/api/` | `wl list --all-scopes` | tous | tous y compris `[packages/api]` |

**Règle des préfixes :**
- Scope courant : pas de préfixe
- `--scope=X` : pas de préfixe (on sait déjà quel scope)
- `--all-scopes` : tous les préfixes
- Sinon : préfixe pour les enfants uniquement

### wl move

Déplace toutes les tâches d'un scope vers un autre.

```
wl move --scope <scope> --to <path>
```

| Flag | Description |
|------|-------------|
| `--scope` | Scope source (obligatoire) |
| `--to` | Chemin cible (crée le .worklog si besoin) |

**Comportement :**
- Déplace toutes les tâches du scope source
- Utilise le mécanisme d'import existant (gestion UUID, collisions)
- Met à jour les `scope.json` après déplacement
- Supprime le `.worklog` source s'il est vide

**Cas d'usage :**
- Réorganiser après création d'un nouveau package
- Consolider des tâches dispersées vers la racine
- Créer un nouveau scope enfant à partir de tâches existantes

### Autres commandes

Les commandes existantes (`add`, `trace`, `logs`, `checkpoint`, `done`) opèrent sur le scope actif (résolu selon les règles ci-dessus).

| Commande | Scope utilisé |
|----------|---------------|
| `wl add --desc "..."` | Scope actif |
| `wl trace <id> <msg>` | Déduit de l'ID ou scope actif |
| `wl logs <id>` | Déduit de l'ID |

## Format de sortie

### Vue filtrée (un seul scope)

```
Active tasks:
  260126a  Fix auth bug
  260126b  Add rate limiting
```

### Vue multi-scope

```
Active tasks:
  [api]  260126a  Fix auth bug
  [api]  260126b  Add rate limiting
  [ui]   260126c  Update button styles
         260125a  Update CI config
```

Note : la dernière tâche (root) n'a pas de préfixe car c'est le scope courant.

## Implémentation

### Fichiers à modifier

- `cli.ts` : ajouter résolution de scope, modifier `cmdList`
- `types.ts` : ajouter `ScopeConfig`, `ScopeEntry`

### Nouvelles fonctions

```typescript
// Découverte
function findGitRoot(cwd: string): string | null
function discoverScopes(gitRoot: string, depthLimit: number): ScopeEntry[]
function loadOrCreateScopeJson(worklogPath: string): ScopeConfig
function saveScopeJson(worklogPath: string, config: ScopeConfig): void

// Résolution
function resolveActiveScope(cwd: string, flagScope?: string): string
function resolveScopeFromId(id: string, parentConfig: ScopeConfig): string | null

// Commandes
function cmdScopes(refresh: boolean): void
function cmdMove(sourceScope: string, targetPath: string): void
```

### Types

```typescript
interface ScopeEntry {
  path: string;  // chemin relatif depuis git root
  id: string;    // identifiant affiché
}

interface ScopeConfigParent {
  children: ScopeEntry[];
}

interface ScopeConfigChild {
  parent: string;  // chemin relatif vers le parent
}

type ScopeConfig = ScopeConfigParent | ScopeConfigChild;
```

## Cas limites

### Pas de racine git

Si aucune racine git n'est trouvée :
- Comportement actuel (single .worklog)
- Pas de support monorepo
- Warning si `--all-scopes` ou `--scope` utilisé

### scope.json corrompu ou incohérent

- Régénérer via `wl scopes --refresh`
- Warning si le scan détecte des .worklog non référencés

### Tâche avec ID ambigu

Si le même ID existe dans plusieurs scopes :
- Erreur avec liste des scopes possibles
- Demander de préciser via `--scope`

## Évolutions futures (hors scope v1)

- `wl move <id> --to <path>` : déplacer une tâche individuelle
- Héritage de config entre parent et enfants
- Synchronisation automatique des scope.json
