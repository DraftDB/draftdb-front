# CLAUDE.md

## Projet
DraftDB (front) : éditeur web de diagrammes de bases de données, importé de ChartDB v1.20.1
(licence AGPL-3.0, le `package.json` s'appelle encore `chartdb`). Import de schéma via une « Smart Query »,
édition visuelle, export SQL/DBML (export DDL assisté par IA en option). Fonctionne sans backend :
les données sont stockées dans le navigateur (IndexedDB via Dexie).

## Stack
- React 18 + TypeScript, Vite 7, React Router 7 (routes chargées en lazy dans `src/router.tsx`)
- Tailwind CSS 3 + composants shadcn/ui (style new-york) sur Radix UI, icônes `lucide-react`
- `@xyflow/react` (canevas), Monaco (éditeur de code), `@dbml/core`, `node-sql-parser`
- Dexie (IndexedDB), i18next (22 langues), Vercel AI SDK (`ai`, `@ai-sdk/openai`), zod
- Tests : Vitest + happy-dom + Testing Library ; Node 24 (`.nvmrc`)

## Dossiers importants
- `src/pages/` : pages routées (`editor-page` = éditeur principal, templates, examples…)
- `src/components/` : composants UI réutilisables, un dossier par composant (`button/button.tsx`)
- `src/context/` : état global, un dossier par contexte (`xxx-context.tsx` + `xxx-provider.tsx`) ;
  `chartdb-context` = diagramme courant, `storage-context` = persistance Dexie
- `src/hooks/` : hooks `use-*.ts(x)` (souvent simples accès aux contextes)
- `src/dialogs/` : boîtes de dialogue (import, export SQL/image, création de diagramme…)
- `src/lib/domain/` : modèle métier (diagram, db-table, db-field, db-relationship…)
- `src/lib/data/` : import/export SQL (`sql-import`, `sql-export`), types de données
- `src/lib/dbml/` : import/export DBML ; `src/lib/env.ts` : variables d'environnement
- `src/i18n/locales/` : traductions (`en.ts` est la référence) ; `src/templates-data/` : modèles
- `src/test/setup.ts` : setup Vitest ; Docker : `Dockerfile`, `default.conf.template` (nginx), `entrypoint.sh`

## Commandes
```bash
npm install          # installation (npm ci en CI)
npm run dev          # serveur de dev Vite
npm run build        # lint + tsc -b + vite build
npm run lint         # ESLint, 0 warning toléré (lint:fix pour corriger)
npm test             # Vitest en mode watch
npm run test:ci      # Vitest une fois (utilisé en CI)
npm run preview      # prévisualiser le build
```
IA optionnelle : `VITE_OPENAI_API_KEY`, ou `VITE_OPENAI_API_ENDPOINT` + `VITE_LLM_MODEL_NAME`.
Docker : `docker build -t draftdb . && docker run -p 8080:80 draftdb`.

## Conventions
- Noms de fichiers et dossiers en kebab-case ; composants React en PascalCase, exports nommés
- Imports absolus via l'alias `@/` (→ `src/`) ; `import type` obligatoire pour les types
  (`@typescript-eslint/consistent-type-imports`)
- Prettier : 4 espaces, quotes simples, point-virgule, `trailingComma: es5`
- Styles en classes Tailwind, fusion via `cn()` de `@/lib/utils` ; variantes avec `class-variance-authority`
  dans un fichier `*-variants.tsx` séparé
- Tests dans des dossiers `__tests__/` à côté du code, fichiers `*.test.ts(x)`
- Tout texte affiché passe par i18next (`useTranslation`) ; ajouter la clé au moins dans `en.ts`
- Hook husky pre-commit : `npm run lint` doit passer
- CI GitHub (`.github/workflows/ci.yaml`) sur PR vers `main` : lint, build, test:ci
