# Privacy audit

The source PDFs stay in the external source folder. Private curricula, archival extraction text, vocabulary transfers and progress backups belong outside the repository. Tests that use real data pass a local path explicitly. All representative browser operations use a disposable local profile.

Baseline: commit `60ddc29`. The production app shell passed its allowlist check for 10 files. The plan authorizes local checkpoints. Publishing a release requires separate user approval.
