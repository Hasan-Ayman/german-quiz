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
