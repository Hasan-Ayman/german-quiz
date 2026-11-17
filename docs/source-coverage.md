# Source coverage

| Source role | Physical PDF pages | Pages with extracted text |
| --- | ---: | ---: |
| A1+ textbook | 276 | 273 |
| A2+ textbook | 292 | 289 |
| A1 vocabulary | 62 | 62 |
| A2 vocabulary | 50 | 50 |
| Total | 680 | 674 |

All 680 pages opened and rendered. The audit preserves every page position, including six textbook pages with no extractable text. It also retains the original machine-extracted text for private review. Machine-extracted chapter-body text and page marker matches are candidates for review.

Run scripts/audit_study_sources.py with Python and pypdfium2. Pass the folder of the four originals using --sources and a folder outside the checkout using --output.

The private v2 vocabulary bank retains 1,575 source rows and 1,433 study entries. The 199 reviewed and 1,234 automatically validated entries retain their existing status. The current app exposes 699 eligible A1 entries and 1,432 cumulative A1+A2 entries when the expanded bank is enabled. Two unresolved source rows remain outside scored vocabulary.

The study pack has 185 scored questions, 24 authored reading passages, 24 self-assessed writing tasks and 24 sentence flashcards. Existing safe vocabulary facts provide additional private practice. Six pages had no text layer. OCR imperfections and unreviewed textbook excerpts remain in the private archive.
