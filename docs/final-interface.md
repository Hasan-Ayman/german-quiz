# German Quiz local study interface

The green homepage links to tests, mistake review, the question browser, and
personal analytics. The test has one expandable chapter selector. The A1 and
A2 shortcuts add chapters without dropping the other level. The normal
launcher uses every eligible fact, with the existing source and grading checks.
Legacy chapter lessons, practice and saved sessions remain compatible.

The canonical import and export filename is `german-quiz-final-complete.json`.
It is a self-contained version 1 education envelope containing vocabulary,
study activities and embedded question feedback. Feedback uses exact question,
prompt and accepted-answer bindings. An optional wrong-option note also has
to match an actual wrong option. Original educational records and older
version 1 imports retain their format. Offline preprocessing adds Arabic notes
from known grammar and admitted facts. The audit records where a richer note
could not be supported. The browser does not generate explanations.

`scripts/consolidate-learning-content.mjs` takes the original package, historical
enriched package, external canonical output path and external audit path, in
that order. Keep the output and audit outside the repository. Use
`scripts/audit_source_expansion.mjs` to compare the canonical package against
the original records and scan tracked files, working files and production assets.
The dev server also denies the canonical filename.

## Local history

Study answers use append-only `answer-event:` records in the existing IndexedDB
store. Each new answer and its session position are written in one transaction.
Earlier `progress` records remain readable and merge by event ID at load time.
Older frozen quiz grades contribute to totals once per saved session. Missing
dates and missing chapter references stay unknown. A legacy answer submitted
after the update receives its actual timestamp. Older practice records may have
grades even when no completed-test summary was stored. Chart and trend metrics
use dated grades only and omit trends from sparse samples.

Completed primary tests and new chapter assessments retain summaries. The three
recent detailed results are a display limit. Existing frozen sessions, archives
and imported education remain in the same stores. The mistake notebook and
analytics derive mastery from two consecutive correct graded answers. Viewing
the question browser or analytics writes no answer or mastery event.

Use `npm test` and `npm run build`. Set `GERMAN_QUIZ_CANONICAL_FILE` to the
private final file, and the existing `GERMAN_QUIZ_FINAL_UI_BASE` fixture to the
original package, for the full-content tests. Browser tests run from the
production build in isolated Chrome profiles:

```powershell
npm run test:browser -- <original-private-json> <canonical-private-json> <external-report-folder>
npm run test:browser:legacy-sessions -- <older-private-json> <canonical-private-json> <external-report-file>
```

Start a local preview with `npm run dev -- --host 127.0.0.1` and open the URL
printed by Vite. Analytics and imported content stay local and work offline
after initialization of the production service worker.
