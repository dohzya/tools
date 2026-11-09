# REX — Release wl v0.8.0 + md v0.7.0 (2026-02-19)

## Contexte

Release combinée de deux outils partageant le même package JSR (`@dohzya/tools`), avec mise à jour du plugin Claude Code associé.

- **wl** : `0.7.0` → `0.8.0` (nouvelles features : `wl run`, `wl claude`, `WORKLOG_TASK_ID`, cross-scope resolution)
- **md** : `0.6.0` → `0.7.0` (refactoring hexagonal interne)
- **JSR** : `0.7.1` → `0.7.2` (bump partagé)

---

## Incidents

### 1. CI échouée — formatting markdown non appliqué

**Cause** : Plusieurs fichiers `.md` (`README.md`, `AGENTS.md`, `ARCHI.md`) avaient des problèmes de formatting pré-existants. De plus, un paragraphe ajouté dans `SKILL.md` avait un saut de ligne que `deno fmt` reformate en une seule ligne.

**Détection** : CI sur GitHub Actions, étape "Check formatting".

**Fix** : `deno fmt` en local + commit `style: fix markdown formatting`.

**Prévention** → Ajout dans `AGENTS.md` :

```bash
# After editing any .md file:
deno fmt        # MANDATORY — CI checks markdown formatting too
```

### 2. `deno publish` dans le mauvais répertoire

**Cause** : `deno publish` lancé depuis la racine du repo au lieu de `packages/tools/`.

**Détection** : Release workflow GitHub Actions → `Could not find version of '@dohzya/tools'
that matches specified version constraint '0.7.2'`.

**Fix** : `deno publish` relancé depuis `packages/tools/`, puis `gh run rerun` sur les deux workflows.

**Prévention** : Le `RELEASE.md` est déjà explicite (`cd packages/tools && deno publish`). Pas de changement nécessaire — vigilance suffisante.

### 3. SSH — push refusé pour `FR010123123_EYGS`

**Cause** : La config SSH utilisait la clé GitHub professionnelle (`FR010123123_EYGS`) au lieu de la clé personnelle. Affectait `dohzya/tools` et `dohzya/homebrew-tools`.

**Détection** : `git push` → `Permission denied`.

**Fix** : Correction de la config SSH par l'utilisateur (`github-perso:` alias).

**Prévention** : Config SSH corrigée de façon durable.

### 4. Plugin — champ `agents` invalide dans `plugin.json`

**Cause** : `plugin.json` contenait un champ `"agents": "./agents/"` qui n'est plus dans le schéma valide du plugin loader Claude Code.

**Détection** : `/plugin` → `Validation errors: agents: Invalid input`.

**Fix** : Suppression du champ `agents` de `plugin.json` + bump version `0.7.0` → `0.7.1` pour invalider le cache.

**Prévention** → `task validate-plugin` ajouté (`claude plugin validate`) + étape `0b` dans `RELEASE.md`.

### 5. Plugin — conflit `skills` entre `marketplace.json` et `plugin.json`

**Cause** : `marketplace.json` déclarait une liste `skills` en doublon de `plugin.json`. Le plugin loader interprète cela comme un conflit de manifestes.

**Détection** : `/plugin` → `Plugin tools has conflicting manifests`.

**Fix** : Suppression de la liste `skills` (et `strict: false`) depuis `marketplace.json` — `plugin.json` est la source canonique pour les composants.

**Prévention** → `task validate-plugin` détecte ce conflit. Règle :

- **`marketplace.json`** = métadonnées de découverte uniquement (name, source, description, version, license)
- **`plugin.json`** = définition des composants (skills, agents, etc.)

---

## Ce qui a bien fonctionné

- **Release combinée wl+md avec un seul bump JSR** : les deux `bump-prepare` avec `JSR_VERSION=0.7.2` sont idempotents — le second ne re-bumpe pas JSR.
- **`gh run rerun`** : permet de relancer un workflow sans recréer le tag — gain de temps significatif.
- **Bundle mise-tools** : le backend est 100% dynamique (lit les tags GitHub via API), aucun fichier à modifier. La bundle release `v0.7.2` suffit.
- **update-tap wl** : le commit local existait déjà quand le push md a été fait, les deux commits sont partis ensemble.

---

## Learnings

1. **`deno fmt` après tout edit de `.md`** — le CI vérifie le formatting de tous les fichiers, pas seulement le code TypeScript.

2. **`deno publish` depuis `packages/tools/`** — le repo est un monorepo, le package JSR est dans un sous-dossier. `deno publish` à la racine ne fait rien d'utile.

3. **Séparation manifestes plugin** — `marketplace.json` pour la découverte, `plugin.json` pour les composants. Ne pas dupliquer les `skills` entre les deux.

4. **Bump version plugin pour invalider le cache** — même correction de fichier sans changement de version = cache non invalidé = erreur persistante.
