# German Quiz implementation progress

## Phase 0 — Baseline and recovery

- Baseline release: `60ddc29`. Development uses the local `codex/four-source-study` branch in the isolated checkout.
- Verified all four PDFs in place. All 680 pages render. The two vocabulary PDFs match the earlier extraction inputs by SHA-256.
- Saved a local archive of the baseline app and verified byte-identical backups of the existing v1 and v2 transfer files. Private recovery files are outside the repository.
- The browser checks used a disposable profile. The user's current vocabulary database, saved rounds, and settings were left intact.
- Existing app: React/Vite static PWA, local file import, versioned vocabulary validation, IndexedDB vocabulary, local quiz settings, bilingual feedback, 31 quiz types and offline shell.
- Baseline tests: 62 passed. Production build and browser smoke passed with the complete private v2 bank, including v1 migration, IndexedDB reload, offline use and mobile layout.

## Next

Phase 1 inventories the authoritative source pages and pairs printed chapter boundaries with physical PDF pages. Private curricular text stays in the local audit folder.

## Phase 1 — Four-source curriculum map

- Mapped 24 chapters and accounted for all 680 physical PDF pages. The private audit stores 674 text-bearing pages and six textless pages.
- Paired printed contents and overview anchors, retained title variants, and indexed review and exam sections.
- Added the source audit tool, curriculum checks, and public-safe coverage reports.
- Tests: 53 passed in the release checkout with the full v2 file and source map, 10 older private-fixture tests ran during the Phase 0 baseline. Production build and browser regression passed.
- Chapter-body OCR and candidate skill markers remain machine-extracted evidence. Phase 2 builds checked study material from reviewed source anchors.
