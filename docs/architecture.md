# Architecture

## Frontend
- Framework: Next.js + TypeScript (app router)
- Key components:
  - LeftPanel: renders References list
  - CenterGraph: DAG layout with dagre; edit nodes/edges; invest +/−
  - RightChat: Ask/Conceptualize; Auto-apply toggle; proposes/applies patches; triggers References search

## API routes
- POST /api/ai/chat: concise chat answer
- POST /api/ai/patch: returns LlmPatch (add/update/remove nodes/edges), supports P→I→C structure and QA anchoring
- POST /api/ai/keywords: extracts keywords (OpenAI or heuristic fallback)
- GET /api/works?kw=a,b,c: OR-match over title/description/topic (public only)
- POST /api/works: create work (graph snapshot + topic/public)
- POST /api/auth/login, /api/auth/logout, /api/auth/me (session helpers)

## Data model (MVP)
- Work: { id, title, description?, nodeCount, investmentScore, createdBy?, createdAt?, topic?, isPublic? }
- Graph: nodes: GraphNode[], edges: GraphEdge[]
  - GraphNode: { id, type, title, content?, score? }
  - GraphEdge: { id, sourceId, targetId, type, score? }

## Environment
- DATABASE_URL
- AUTH_SECRET
- OPENAI_API_KEY

## Deployment (Railway)
- Root Directory: web
- Install: npm ci
- Build: npm run build
- Start: npm start

## Notes
- If OpenAI key is missing, minimal local patches still return so the UI remains usable.
- ESLint/TS are configured not to fail CI builds; incrementally fix lints/types.
