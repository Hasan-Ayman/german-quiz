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

## Phase 2 — Private study material

- Built the initial private pack from all 24 mapped textbook chapters. It contains 24 original bilingual grammar lessons and 167 authored activities, including 119 scored practice items, 24 reading tasks and 24 writing tasks. Reading and writing records are short original practice.
- Authored material carries the actual chapter overview reference and a separate editorial-check status. Machine-extracted page text and unreviewed content remain in the private archive. The original v1/v2 files are unchanged.
- Checks: 54 release-checkout tests passed with the real source and vocabulary files, 10 baseline-only snapshot tests skipped. Production build and existing browser regression passed.
- The pack has one reviewed lesson per chapter. A comprehensive question bank for every indexed grammar topic still requires additional editorial coverage.

## Phase 3 — Private content engine

- Added versioned study-pack validation and local answer checking. Existing v1/v2 vocabulary format and IndexedDB schema are untouched.
- Study data uses a separate IndexedDB database. The browser test verified isolated writes, a failed transaction preserving its previous record, and five serialized concurrent writes.
- Tests: 57 passed with the real files, 10 baseline-only fixture tests skipped. Production build and browser regression passed.

## Phase 4 — Chapter and free-practice navigation

- Added a separate study route, private pack import, chapter overviews and level, chapter, skill, and topic filters. Existing vocabulary routes remain available.
- Tests: 57 passed with real fixtures, 10 baseline-only fixtures skipped. Production build and offline mobile browser checks passed, including both a chapter selection and free-practice filtering.

## Phase 5 — Vocabulary, flashcards, sentence and verb exercises

- Connected selectable sessions, bilingual immediate feedback and typed or multiple-choice completion. Verb exercises use checked source-linked material. Seven directions and form views for flashcards use the existing private bank or the authored sentence-card pool.
- Tests: 57 passed with the real files, 10 baseline-only fixture tests skipped. Production build and offline browser tests passed for a typed answer, both text directions and a revealed flashcard.

## Phase 6 — Grammar and sentence editing

- Added active grammar and case exercises, tapped word ordering with a typed alternative, wrong-word identification and correction, and sentence transformation in both answer formats.
- Tests: 57 passed with real fixtures, 10 baseline-only fixture tests skipped. Production build and offline browser flows passed for ordering and correcting a real item.

## Phase 7 — Reading, writing and pronunciation

- Activated original bilingual reading exercises and writing tasks for all chapters. Writing uses a model, checklist and self-assessment, while reading has scored answer checking.
- Chapter pages show pronunciation topics and candidate listening pages. The source folder contains no recordings. The app labels textbook audio and dictation unavailable, and offers synthetic pronunciation only through a local German voice.
- Tests: 57 passed with real fixtures, 10 baseline-only fixture tests skipped. Production build and offline browser checks for reading, writing and unavailable textbook audio passed.
