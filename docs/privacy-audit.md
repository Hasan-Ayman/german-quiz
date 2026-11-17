# Privacy audit

The source PDFs stay in the external source folder. Private curricula, archival extraction text, vocabulary transfers and progress backups belong outside the repository. Tests that use real data pass a local path explicitly. All representative browser operations use a disposable local profile.

Baseline: commit `60ddc29`. The production app shell passed its allowlist check for 10 files. The plan authorizes local checkpoints. Publishing a release requires separate user approval.

## Release candidate

The Vite development server denies private curricula and review JSON. Ignore rules and the Pages workflow reject the known private paths and backups. The allowed production file set contains ten app-shell assets. The full build content audit checked 2,752 study/curriculum excerpts and 3,221 vocabulary/example strings against the release output. The browser smoke test observed only app-shell GET requests during local import and use.
