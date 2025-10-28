# Project Overview

This project is a three-pane knowledge editor that turns AI conversations into a structured knowledge graph and shares it publicly.

- Left: References (public works). Only shows when triggered by keywords extracted from the right-side question.
- Center: Knowledge Graph (user-approved structure), including Chomskyan P→I→C nodes.
- Right: AI Q&A (Ask/Conceptualize) with Auto-apply to update the center.

## Core Concepts
- Node types: concept, claim, evidence, source, qa, premise, inference, conclusion (P→I→C).
- Edge types: supports, refutes, relates_to, cites, infers.
- Investment: nodes/edges have a score via +1/-1.

## Primary Flows
- Ask: user asks → AI answers → auto-conceptualize into P→I→C → if Auto-apply ON and signed-in, patch is applied to the graph.
- Conceptualize: directly converts the right input text into P→I→C without requiring a full chat.
- References: right question → POST /api/ai/keywords → GET /api/works?kw=... → show results on the left.
- Publish: save the current graph snapshot (+topic/public). Newly published works can surface in the left panel for similar questions.

## MVP Scope
- 3 panes functional and synchronized via the flows above.
- Public sharing via Works and keyword-based discovery.
- Deployment: GitHub → Railway.
