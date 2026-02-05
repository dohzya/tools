# Guidelines for AI Agents

## TL;DR

```bash
# 1. Créer une worktask AVANT de commencer
wl task create "Description du travail"

# 2. Tracer les actions significatives
wl trace <id> "Action effectuée"

# 3. Tester avec le code LOCAL (pas les binaires installés!)
deno -A packages/tools/worklog/cli.ts <command>
deno -A packages/tools/markdown-surgeon/cli.ts <command>

# 4. TOUJOURS valider avant de dire "c'est fini"
task validate

# 5. Marquer la worktask comme terminée
wl done <id> "Changes" "Learnings"

# 6. Pour release → voir RELEASE.md
```

---

## Core Workflow

**L'ordre à suivre pour TOUT travail sur ce projet :**

| Étape | Action | Commande |
|-------|--------|----------|
| 1 | Créer worktask | `wl task create "..."` |
| 2 | Travailler + tracer | `wl trace <id> "..."` |
| 3 | Tester localement | `deno -A packages/tools/<tool>/cli.ts ...` |
| 4 | Valider | `task validate` |
| 5 | Commit (si applicable) | `git add ... && git commit ...` |
| 6 | Terminer worktask | `wl done <id> "changes" "learnings"` |
| 7 | Release? | Voir [RELEASE.md](RELEASE.md) |

**CRITIQUE :** Ne JAMAIS dire "j'ai terminé" sans avoir exécuté `task validate`.

---

## Worklog (OBLIGATOIRE)

**Pour TOUTE session de travail, tu DOIS :**

### 1. Créer une worktask au début

```bash
wl task create "Description du travail à faire"
# Retourne un ID (ex: 260202n)
```

### 2. Tracer chaque action significative

```bash
wl trace <id> "Lu le fichier X pour comprendre Y"
wl trace <id> "Modifié X: ajouté fonctionnalité Y"
wl trace <id> "Tests échoués: cause=Z, piste=essayer W"
wl trace <id> "task validate OK"
```

**Bonnes traces = avec causes & pistes :**
- ✅ `"Essayé X - échec (cause: validator attend Y), piste: pattern Z"`
- ❌ `"Essayé X"` / `"Ça marche pas"`

### 3. Consulter le contexte

```bash
wl show <id>    # Info + traces depuis dernier checkpoint
wl traces <id>  # Toutes les traces
```

### 4. Terminer la worktask

```bash
wl done <id> "Résumé des changements" "Ce qu'on a appris (REX)"
```

**Important :** `done` APRÈS le commit, pas avant.

### Le répertoire .worklog/

Le répertoire `.worklog/` est local et ne doit JAMAIS être commité (déjà dans `.gitignore`).

---

## Project Setup

**Première installation :** `bash setup.sh` installe mise et Deno.

**Commandes disponibles :**

```bash
task fmt       # Formater le code
task test      # Lancer les tests
task check     # Vérifier (format + type + lint)
task validate  # TOUT vérifier (fmt + check + lint + test)
```

---

## Development

### Tester les modifications CLI

**⚠️ CRITIQUE : Les binaires installés (`wl`, `md`) utilisent les versions JSR publiées, PAS ton code local !**

**TOUJOURS utiliser Deno directement :**

```bash
# Pour worklog - FAIRE CECI, PAS 'wl'
deno -A packages/tools/worklog/cli.ts <command> [args]
deno -A packages/tools/worklog/cli.ts list
deno -A packages/tools/worklog/cli.ts trace <id> "message"

# Pour markdown-surgeon - FAIRE CECI, PAS 'md'
deno -A packages/tools/markdown-surgeon/cli.ts <command> [args]
deno -A packages/tools/markdown-surgeon/cli.ts meta file.md
```

**Pourquoi :**
- `wl` et `md` installés via Homebrew/mise utilisent `jsr:@dohzya/tools@X.Y.Z`
- Tes modifications locales ne seront pas visibles tant que tu n'as pas publié sur JSR
- `deno -A packages/tools/.../cli.ts` exécute ton code local directement

**Alias pratiques (optionnel) :**
```bash
alias wl-dev='deno -A packages/tools/worklog/cli.ts'
alias md-dev='deno -A packages/tools/markdown-surgeon/cli.ts'
```

### Tests automatisés

```bash
task test:md   # Tests markdown-surgeon
task test:wl   # Tests worklog
task test      # Tous les tests (+ compat-tests)
```

Les tests CLI appellent `main()` directement et utilisent `captureOutput()`.

### Écrire des tests

**NE PAS créer de fichiers/répertoires temporaires manuellement** (ex: `/tmp/test-vault`).

**Utiliser les helpers existants :**

```typescript
// Fichier unique
const file = await createTempFile(`---\ntags: [foo]\n---\n# Test`);
try {
  const output = await captureOutput(() =>
    main(["meta", "--aggregate", "tags", file])
  );
  assertEquals(output.trim(), "foo");
} finally {
  await Deno.remove(file);
}

// Plusieurs fichiers
const file1 = await createTempFile(`---\ntags: [foo]\n---\n# File 1`);
const file2 = await createTempFile(`---\ntags: [bar]\n---\n# File 2`);
try {
  // Test...
} finally {
  await Deno.remove(file1);
  await Deno.remove(file2);
}

// Patterns glob
const tmpDir = await Deno.makeTempDir();
try {
  await Deno.writeTextFile(`${tmpDir}/a.md`, `---\ntags: [foo]\n---\n# A`);
  await Deno.writeTextFile(`${tmpDir}/b.md`, `---\ntags: [bar]\n---\n# B`);
  // Test avec `${tmpDir}/*.md`
} finally {
  await Deno.remove(tmpDir, { recursive: true });
}
```

---

## TypeScript Best Practices

### Type Safety et Validation

**JAMAIS de casts unsafe** comme `as unknown as T`.

**Utiliser Zod 4 Mini pour la validation runtime :**

```typescript
import { z } from "zod/mini";

const schema = z.object({
  id: z.string(),
  status: z.enum(["active", "done"]),
});

const validated = schema.parse(data); // Throw si invalide
```

- Import depuis `"zod/mini"` (bundle plus petit)
- Définir des schémas pour les données externes (fichiers, APIs, input utilisateur)
- Laisser les erreurs de validation remonter - elles indiquent de vrais bugs

---

## Creating Releases

**→ Voir [RELEASE.md](RELEASE.md)** pour le processus complet.

**Points clés :**
- JSR publish AVANT de créer le tag (les binaires téléchargent depuis JSR)
- `task bump TOOL=wl VERSION=X.Y.Z` met à jour tous les fichiers
- `task update-tap` calcule les checksums depuis les binaires GitHub

**Vérifier les versions avant un bundle release :**

```bash
gh release list -R dohzya/tools | awk -F'\t' '$3 ~ /^wl-v/ {print $3; exit}'
gh release list -R dohzya/tools | awk -F'\t' '$3 ~ /^md-v/ {print $3; exit}'
```

---

## CHANGELOG.md

Maintenir `packages/tools/CHANGELOG.md` lors des modifications.

**Règles :**

1. **JAMAIS modifier les entrées existantes** - l'historique est immutable
2. **SEULEMENT ajouter** de nouvelles entrées au début
3. Lors d'un bump, utiliser `task bump` qui met à jour tous les fichiers
