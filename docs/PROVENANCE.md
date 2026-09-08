# Provenance

## Why the history is curated

Version 1.0.0 is a **curated public release** of the completed model,
application, and documentation. The repository is published so that a
technically sophisticated reader can assess the finished artifact — the
problem formulation, the mathematics, the implementation, the tests, and
the reproducibility of every result. It is not a development diary.

The public repository therefore contains a clean, single-commit history
rather than the full internal development history. Internal planning
material and development-process records are intentionally not part of the
public artifact.

## Public-export hygiene

Preparing the release removed non-functional internal development
references — cross-references to internal-only documents, development-only
experiment scaffolding, and process annotations — while leaving the model,
the application, the configuration, and the tests unchanged in behavior.
Comment and docstring edits made during this pass are cross-reference
hygiene only; no equation, parameter, mapping, fixture, or decision rule
was altered.

## What was checked after curation

- The Python test suite and linter pass on the curated tree.
- The frontend type-checks, builds, and passes its end-to-end suite.
- The committed public example exports under `web/public/data/` are
  reproduced **byte-for-byte** by re-running the export script against the
  curated engine (see [`reproducibility.md`](reproducibility.md)).

## The citable artifact

This repository at version 1.0.0 is the citable, reviewable release
artifact. See [`../CITATION.cff`](../CITATION.cff) for citation metadata.
