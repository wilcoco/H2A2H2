# ADR 0001: Adopt Chomskyan P→I→C Structure and `infers` Edges

## Context
We need a repeatable way to convert AI conversations into reusable knowledge. Chomskyan analysis separates surface sentences from deep structure, which maps well to premise → inference → conclusion.

## Decision
- Extend node types with `premise`, `inference`, `conclusion`.
- Add edge type `infers` to connect P→I→C.
- RightChat conceptualizes answers into P→I→C; Auto-apply applies safe patches.

## Consequences
- Knowledge is captured as rules/structure, not only text.
- Left-side discovery improves via structure-aware search (keywords first; rule ranking later).

## Status
Accepted (MVP).
