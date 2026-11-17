# Final test report

- Full regression environment with the existing private fixtures and the new study pack: 71 of 71 automated tests passed. This includes 528 seeded legacy quiz rounds and 72 ten-item chapter assessments across the 24 chapters.
- Isolated release checkout using the real v2 vocabulary and private study pack: 61 passed. Ten older private review-fixture checks were skipped here and passed in the full environment.
- Both TypeScript/Vite production builds passed.
- Chromium smoke checks passed using the complete datasets in disposable browser profiles. They covered v1 migration, failure rollback, exact v2 export and re-import, current quiz flows, private study import, offline operation and reload, all study interactions, chapter filters, bilingual feedback, review, backup restoration, service-worker updates, and desktop/mobile layout checks.
- A separate Chromium test verified IndexedDB transaction isolation, abort rollback, and concurrent updates. The actual user browser database was untouched. Mobile checks used emulation.

The curriculum checks cover all 680 page positions, 24 chapters and 90 indexed grammar topics, including stable references and exactly one valid answer per multiple-choice item. Language checks compare the German text with the four-source corpus and the private editorial review of two derived inflections. Layout/OCR candidate indexing is not an independent visual review of every original textbook exercise.
