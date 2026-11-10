# german-quiz

مفردات is an Arabic-language German vocabulary quiz for A1 and A2. The app starts with an empty library. Import a personal vocabulary JSON file to study on that browser. IndexedDB stores the vocabulary, and the browser stores the theme, settings, and current round locally.

## Run the quiz

Install Node.js 24 with npm. From the project directory, run:

```sh
npm ci
npm run build
npm run preview -- --host 127.0.0.1 --port 4173 --strictPort
```

Open [the Windows preview](http://127.0.0.1:4173/german-quiz/). Choose **اختر ملف المفردات** and select your personal JSON file. Use **تنزيل ملف المفردات** on the home screen to save a transfer copy. Keep that copy in a local folder. To regenerate it from the private working bank, run the command below with the actual local destination. The destination file must be new.

```powershell
npm run export:vocabulary -- "$env:USERPROFILE\Downloads\german-quiz-personal-vocabulary-v1.json"
```

The quiz skips translation facts without three distinct, compatible distractors. It checks for overlapping Arabic glosses, German synonyms, and close meanings carried in the personal file. Retrying a round keeps each missed question and reshuffles its original choices.

The setup offers 10, 20, 30, or 50 questions and saves both the question count and level on the device. A1 uses entries with an A1 source. A2 combines both levels and counts shared entries once. If the verified pilot has fewer eligible entries than requested, the quiz shows the actual round length.

After answering, the quiz displays the preferred approved example for the selected level when the file contains one. Reviewed and automatically validated vocabulary remain separate choices.

## Install on mobile or Windows

Once Pages is published, open the [GitHub Pages address](https://hasan-ayman.github.io/german-quiz/) while online.

- On Android, open the site in Chrome and use **⋮ → Install and create shortcut → Install**. Open the installed app and import the JSON from the device’s Files app. [Chrome Help](https://support.google.com/chrome/answer/9658361?co=GENIE.Platform%3DAndroid&hl=en-2)
- On iPhone, open the site in Safari and use **Share → Add to Home Screen**. Turn on **Open as Web App** if offered, then tap **Add**. Open the Home Screen app and import the JSON from Files. [Apple Support](https://support.apple.com/en-eg/guide/iphone/iphea86e5236/ios)
- On Windows, use the install icon in Chrome or Edge when offered, then open the installed app and import the JSON. The loopback preview and the Pages address have separate browser storage. [PWA installation guide](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)

Transfer the file yourself to each device before importing it. Open the app online once to cache the shell. When the browser retains that cache and the personal library, quizzes work offline. If site data is cleared, open the site online and import the file again.

## Phase 3 local review and preview

This section records the workflow for the private extraction checkout. The Pages checkout contains the application, its build and export tools, and test support. The source extraction tools, PDFs, and review data belong in the private working copy.

Run the Phase 1 extractor from the checkout to reconcile the source files, then run these commands with the local Phase 3 review decisions and authored proposal files present.

```sh
python scripts/expand_vocabulary.py
python scripts/activate_local_vocabulary.py
node scripts/report_quiz_eligibility.mjs
```

The expansion script reads the Phase 1 snapshots and verifies each decision against the extracted row fingerprint. It writes the corrected source rows, combined dataset and compact quiz projection to `data/`. The reports in `reports/` record original and corrected Arabic, duplicate groups, example provenance and the pending queue. Use `--output-root` if the Windows checkout is read-only for your interpreter.

The local `data/phase3-authored-approved.json` ledger records explicit user reviews and the extraction fingerprints of their source entries. Regeneration exports that ledger to `data/phase3-local-authored.json`. The proposal file holds the next batch, and PDF examples retain priority. Publication rights for the source-derived vocabulary and examples have not been cleared.

Run the offline classifier with the [LibreOffice German Hunspell dictionary](https://github.com/LibreOffice/dictionaries/tree/master/de). The dictionary path is the common base of the `.aff` and `.dic` files.

```sh
python -m pip install -r scripts/requirements-review.txt
python scripts/review_vocabulary.py --dictionary data/review-dictionary/de_DE_frami
```

The classifier writes `reports/phase3-scalable-review.json` with separate review and local-approval fields, reason counts, and deterministic samples by source level, chapter, and word type. Dictionary misses are review signals. The classifier makes no corrections or changes to the active quiz. The next authored batch is stored in `data/phase3-authored-proposal.json` and listed in `reports/phase3-authored-batch-3.md`.

The import defaults to reviewed vocabulary. Its reliability selector can include the automatically validated entries authorized for local testing. `data/phase3-local-activation.json` pins the approved snapshot and candidate count. Regeneration refuses a changed snapshot until local authorization is reconciled. The activation and eligibility reports list records with no safe question and equivalent quiz records represented by one entry.

### Phase 3.5 example review

The local review sheet is `reports/phase35/pilot-review.md`. Copy `reports/phase35/pilot-review-template.json` to an editable decisions file before adding decisions. To review a subset, export by level or status.

```sh
node scripts/example_review.mjs export pilot --level A1 --status automated_checked --output reports/phase35/pilot-decisions.json
node scripts/example_review.mjs review pilot reports/phase35/pilot-decisions.json
```

Keep the entry ID and fingerprint. Set `decision` to `approve`, `edit`, or `reject` and fill in `reviewer` and `reason`. Approval requires all five `checks` to be explicitly true. For a PDF association awaiting visual review or an authored fallback for an existing PDF candidate, compare the source and set `checkedPdf` with the reason. Use `editedGerman` and/or `editedArabic` to edit. Printed German is immutable. After an edit, use the new fingerprint to review the updated text.

`automated_checked` means the script found usable structure and target-word evidence. It never means human approval. `needs_manual_review` marks uncertain target use, source association, or validation errors. Invalid source or text must be corrected before approval. The word-form rules recognize common inflections but can miss uncommon or irregular forms, and the optional dictionary checks spelling only. Grammar, naturalness, CEFR, Arabic accuracy, and intended meaning require editorial review and explicit approval. The local preview reads only the approval export. It preserves existing examples and identifies newly authored Arabic translations of printed sentences.

To reproduce the pilot audit, use the ignored snapshot and draft file from this checkout.

```sh
python scripts/audit_example_sources.py
python scripts/check_example_spelling.py reports/phase35/pilot-drafts.json --dictionary data/review-dictionary/de_DE_frami --output reports/phase35/pilot-spelling.json
node scripts/example_review.mjs plan reports/phase35/pilot-drafts.json
node scripts/example_review.mjs validate pilot reports/phase35/pilot-drafts.json --spelling reports/phase35/pilot-spelling.json
```

The plan locks vocabulary IDs and prioritizes printed examples. Later batches contain up to 100 entries and stay locked until explicit pilot-method approval. Once approval is recorded with `approve-method`, use `prepare batch-001 --output <brief.json>` to list outstanding jobs, their source forms, and their original example candidates. Draft or recover sentences using that brief and submit them with `validate batch-001 <drafts.json>`. The workflow accepts partial submissions, checkpoints completed drafts atomically, and logs invalid records without discarding prior work. Keep batch files and review data local.

The personal-study authorization is separate from human review. The automatic checkpoint folder is `reports/phase35/automatic/`. The local file `data/phase35-local-auto-examples.json` is an input to the personal export. Each exported example requires evidence for the exact text, structural and target checks, and a German–Arabic language review. An automatic Arabic addition to a previously approved PDF example must match the exact original row and can only fill a missing translation.

The completed local batches used a bilingual Codex review, offline German spelling checks, and source and structure checks. The local report records the sample and remaining exclusions. No automatic approval counts as human verification.

The optional offline model runner requires a compatible local chat endpoint and refuses to process batches unless it passes the preflight. The Qwen3 4B model tested here did not pass; it did not approve any examples. Resume an interrupted model batch with the same model and snapshot.

```sh
node scripts/process_local_examples.mjs run --endpoint http://127.0.0.1:8096/ --model <installed-model>
```

## GitHub Pages after approval

Select **GitHub Actions** under **Settings → Pages**. Once the workflow is present on GitHub and deployment is approved, run **Deploy German Quiz to GitHub Pages** manually from `main`. The workflow builds and verifies the public shell from a checkout with no private files. Only the verified `dist/` directory is used as the Pages artifact. [GitHub Pages workflow documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)

Run `npm test` for the unit and rendering tests. With Chrome installed, run `npm run build` followed by `npm run test:browser` for the local browser check. To test an existing personal file, append `-- "C:\path\to\german-quiz-personal-vocabulary-v1.json"` to the browser test command.

## Phase 1 extraction

Phase 1 extracts and validates German–Arabic vocabulary from the local A1 and A2 PDFs.

### Regenerate the local data

Place the PDFs at `source-pdfs/A1.pdf` and `source-pdfs/A2.pdf`. From the repository root, use Python 3.10 or later.

```sh
python -m pip install -r scripts/requirements.txt
python scripts/extract_vocabulary.py
```

The command extracts both levels, runs validation, and regenerates the JSON files in `data/` and the results in `reports/`. The PDFs and generated content are Git-ignored.

| Output | Contents |
|---|---|
| `data/a1-vocabulary.json`, `data/a2-vocabulary.json` | One record per numbered source row, with chapter, physical page, bounding box, original cell text, and Arabic glyph lines |
| `data/combined-vocabulary.json` | Deduplicated records with all source references and source-specific examples |
| `data/verified-pilot.json` | Visually checked entries that support at least one quiz mode |
| `reports/extraction-report.md`, `reports/validation.json` | Chapter counts, page coverage, and validation findings |
| `reports/duplicates.json`, `reports/manual-review.json` | Exact and possible repeats, plus rows that need a source check |
| `reports/example-sentences.json` | German examples, source row and page references, and sentence verification status |

### Review and quiz data

Source IDs use the level, chapter, part of speech, and printed row number. Combined IDs use a hash of the normalized entry identity. A row that needs manual review stays separate in the combined bank.

Use the physical page number in the level JSON. Bounding boxes are measured from the top left in PDF points. Optional fields use JSON null. The original Arabic glyph lines and the candidate logical lines are retained for comparison. Parenthesized noun articles are stored in `article_note`.

`automated_pass` means the row passed structural checks. `manually_verified` means a visual comparison to the source was recorded. The optional local `reports/review-decisions.json` maps each reviewed source ID to its `review_fingerprint` as `fingerprint` and the value `visually_compared_to_pdf` as `check`. A changed source PDF or extraction invalidates the corresponding fingerprint. Resolve flagged text against the source before approving a row.

The combined records include per-mode quiz flags and the eligible Arabic prompts for reverse translation. A future multiple-choice generator should compare distractors with every accepted answer and discard options that overlap. For article questions, use the fixed choices der, die, and das.
