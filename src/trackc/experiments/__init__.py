"""Composed analyses built on the frozen model primitives.

This package is not model physics -- it composes the frozen
`trackc.model.*` primitives (the lambda-envelope construction used by
the application, and deliberate synthetic portfolio construction for
scale testing and envelope validation). It never redefines a metric,
equation, or mapping; every physical/economic quantity still comes from
`trackc.model.evaluator.evaluate_strategy` or
`trackc.model.optimizer.optimize_allocation`.
"""

from __future__ import annotations
