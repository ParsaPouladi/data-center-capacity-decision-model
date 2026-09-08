"""Public-application layer (NON-CANONICAL).

This package is the engine-facing application/presentation layer for the
public application. It ships alongside the frozen quantitative
engine under `src/` (so it imports through the normal installed-package
mechanism -- no repository-root `sys.path` manipulation), but it is
architecturally separate from and subordinate to it: `src/trackc/` is the
sole numerical authority and is never modified by this package.

It is subordinate to the canonical modeling documents
(the model specification and assumptions documents). It contains no
model mathematics -- see the charter in `trackc_app.service`.
"""
