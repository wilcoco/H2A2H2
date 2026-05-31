import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { z } from "zod";

// Runtime node to allow using OpenAI SDK
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NodeType = z.enum([
  "concept",
  "claim",
  "evidence",
  "source",
  "qa",
  "premise",
  "inference",
  "conclusion",
]);

const GraphNode = z.object({
  id: z.string(),
  type: NodeType,
  title: z.string(),
  content: z.string().optional(),
});

const EdgeType = z.enum(["supports", "refutes", "relates_to", "cites", "infers"]);

const GraphEdge = z.object({
  id: z.string(),
  sourceId: z.string(),
  targetId: z.string(),
  type: EdgeType,
});

const PatchOp = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add_node"), node: GraphNode }),
  z.object({ op: z.literal("update_node"), id: z.string(), patch: GraphNode.partial() }),
  z.object({ op: z.literal("remove_node"), id: z.string() }),
  z.object({ op: z.literal("add_edge"), edge: GraphEdge }),
  z.object({ op: z.literal("remove_edge"), id: z.string() }),
]);

const LlmPatch = z.object({
  id: z.string(),
  description: z.string().optional(),
  ops: z.array(PatchOp).min(1),
});

const RequestSchema = z.object({
  prompt: z.string().optional().default(""),
  answer: z.string().optional(),
  mode: z.enum(["from_prompt", "from_answer"]).optional().default("from_prompt"),
  title: z.string().optional(),
  type: NodeType.optional(),
  nodes: z.array(GraphNode).optional().default([]),
  edges: z.array(GraphEdge).optional().default([]),
  provider: z.enum(["openai", "anthropic"]).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const json = await req.json();
    const input = RequestSchema.parse(json);

    const buildFallback = () => {
      const id = `n_${Date.now()}`;
      const desc = input.answer || input.prompt || input.title || "New node";
      const body = {
        id,
        description: desc,
        ops: [
          {
            op: "add_node" as const,
            node: {
              id,
              type: input.type ?? (input.answer ? "qa" : "concept"),
              title: input.title ?? "New node",
              content: input.answer || input.prompt || undefined,
            },
          },
        ],
      };
      return LlmPatch.parse(body);
    };

    const openaiKey = process.env.OPENAI_API_KEY;
    const client = openaiKey ? new OpenAI({ apiKey: openaiKey }) : null;

    const system = `You generate graph editing proposals for a knowledge graph.
Return ONLY a JSON object matching this TypeScript type exactly, with no markdown:
{
  id: string;
  description?: string;
  ops: (
    | { op: "add_node"; node: { id: string; type: "concept"|"claim"|"evidence"|"source"|"qa"|"premise"|"inference"|"conclusion"; title: string; content?: string } }
    | { op: "update_node"; id: string; patch: Partial<{ id: string; type: "concept"|"claim"|"evidence"|"source"|"qa"|"premise"|"inference"|"conclusion"; title: string; content?: string }> }
    | { op: "remove_node"; id: string }
    | { op: "add_edge"; edge: { id: string; sourceId: string; targetId: string; type: "supports"|"refutes"|"relates_to"|"cites"|"infers" } }
    | { op: "remove_edge"; id: string }
  )[]
}
Constraints:
- Prefer small, safe patches.
- If user provided title/type, use them for one add_node op.
- Generate stable-ish id if user didn't provide (e.g., "n_" + random digits).
- Do not hallucinate connections to non-existing node ids.
- Always include a concise natural-language description summarizing the proposed changes for end users (<=120 words). If the user's language is Korean, write the description in Korean.
`;

    const flavor = input.mode === "from_answer"
      ? `Source is the assistant's answer text provided below. Decompose into logical units inspired by Chomskyan structure: use node types 'premise', 'inference', 'conclusion' when applicable; otherwise use concept/claim/evidence/source/qa. Connect logical flow with 'infers' edges (premise -> inference -> conclusion) and use supports/refutes/relates_to/cites where appropriate. Create 1-5 safe operations with clear titles and minimal content.`
      : `Source is the user's prompt/instructions. Create a small, safe patch (1-3 ops).`;

    const user = {
      role: "user" as const,
      content: [
        {
          type: "text" as const,
          text: `${flavor}\nMode: ${input.mode}\nUser prompt: ${input.prompt}\nAnswer: ${input.answer ?? "(none)"}\nTitle: ${input.title ?? "(none)"}\nType: ${input.type ?? "(unspecified)"}\nExisting nodes: ${input.nodes
            .slice(0, 20)
            .map((n) => `${n.id}:${n.type}:${n.title}`)
            .join(", ")}\nExisting edges: ${input.edges
            .slice(0, 20)
            .map((e) => `${e.id}:${e.sourceId}->${e.targetId}:${e.type}`)
            .join(", ")}\nReturn a valid JSON object only.`,
        },
      ],
    };
    
    try {
      const model = process.env.OPENAI_MODEL || "gpt-4o";
      const envProv = process.env.AI_PROVIDER as "openai" | "anthropic" | undefined;
      const provider: "openai" | "anthropic" = input.provider ?? envProv ?? "openai";
      const anthropicModel = process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-latest";
      const firstContent = user.content?.[0] as { text?: string } | undefined;
      const inputText = `${system}\n\n${firstContent?.text ?? ""}`;
      let text = "";
      if (provider === "anthropic") {
        const antKey = process.env.ANTHROPIC_API_KEY;
        if (antKey) {
          try {
            const resp = await fetch("https://api.anthropic.com/v1/messages", {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "x-api-key": antKey,
                "anthropic-version": "2023-06-01",
              },
              body: JSON.stringify({
                model: anthropicModel,
                system: "Return ONLY a JSON object matching the described schema. No markdown.",
                max_tokens: 2000,
                temperature: 0.1,
                messages: [
                  { role: "user", content: [{ type: "text", text: inputText }] },
                ],
              }),
            });
            const j = await resp.json().catch(() => ({} as { content?: Array<{ type: string; text?: string }> }));
            const parts: Array<{ type: string; text?: string }> = Array.isArray(j?.content) ? j.content : [];
            text = parts.filter((p) => p?.type === "text").map((p) => String(p.text || "")).join("\n");
          } catch {}
        }
        if (!text && client) {
          const body: Record<string, unknown> = { model, input: inputText, temperature: 0.1, max_output_tokens: 2000 };
          if (model.startsWith("o3")) body.reasoning = { effort: "high" };
          try {
            const res = await client.responses.create(body as Parameters<typeof client.responses.create>[0]);
            text = (res as { output_text?: string }).output_text ?? "";
          } catch {}
        }
      } else {
        const body: Record<string, unknown> = { model, input: inputText, temperature: 0.1, max_output_tokens: 2000 };
        if (model.startsWith("o3")) body.reasoning = { effort: "high" };
        body.response_format = {
          type: "json_schema",
          json_schema: {
            name: "LlmPatch",
            strict: true,
            schema: {
              type: "object",
              properties: {
                id: { type: "string" },
                description: { type: "string" },
                ops: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      op: { type: "string", enum: ["add_node","update_node","remove_node","add_edge","remove_edge"] },
                      id: { type: "string" },
                      node: {
                        type: "object",
                        properties: {
                          id: { type: "string" },
                          type: { type: "string", enum: ["concept","claim","evidence","source","qa","premise","inference","conclusion"] },
                          title: { type: "string" },
                          content: { type: "string" },
                        },
                        required: ["id","type","title"],
                        additionalProperties: false,
                      },
                      patch: {
                        type: "object",
                        properties: {
                          id: { type: "string" },
                          type: { type: "string", enum: ["concept","claim","evidence","source","qa","premise","inference","conclusion"] },
                          title: { type: "string" },
                          content: { type: "string" },
                        },
                        additionalProperties: true,
                      },
                      edge: {
                        type: "object",
                        properties: {
                          id: { type: "string" },
                          sourceId: { type: "string" },
                          targetId: { type: "string" },
                          type: { type: "string", enum: ["supports","refutes","relates_to","cites","infers"] },
                        },
                        required: ["id","sourceId","targetId","type"],
                        additionalProperties: false,
                      },
                    },
                    required: ["op"],
                    additionalProperties: true,
                  },
                },
              },
              required: ["id","ops"],
              additionalProperties: false,
            },
          },
        };
        if (client) {
          try {
            const res = await client.responses.create(body as Parameters<typeof client.responses.create>[0]);
            text = (res as { output_text?: string }).output_text ?? "";
          } catch {
            if (model !== "gpt-4o") {
              try {
                const res2 = await client.responses.create({ ...body, model: "gpt-4o", reasoning: undefined } as Parameters<typeof client.responses.create>[0]);
                text = (res2 as { output_text?: string }).output_text ?? "";
              } catch {}
            }
          }
        } else {
          const antKey = process.env.ANTHROPIC_API_KEY;
          if (antKey) {
            try {
              const resp = await fetch("https://api.anthropic.com/v1/messages", {
                method: "POST",
                headers: {
                  "content-type": "application/json",
                  "x-api-key": antKey,
                  "anthropic-version": "2023-06-01",
                },
                body: JSON.stringify({
                  model: anthropicModel,
                  system: "Return ONLY a JSON object matching the described schema. No markdown.",
                  max_tokens: 2000,
                  temperature: 0.1,
                  messages: [
                    { role: "user", content: [{ type: "text", text: inputText }] },
                  ],
                }),
              });
              const j = await resp.json().catch(() => ({} as { content?: Array<{ type: string; text?: string }> }));
              const parts: Array<{ type: string; text?: string }> = Array.isArray(j?.content) ? j.content : [];
              text = parts.filter((p) => p?.type === "text").map((p) => String(p.text || "")).join("\n");
            } catch {}
          }
        }
      }
      if (!text) return NextResponse.json(buildFallback());
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return NextResponse.json(buildFallback());
      }

      let patch = LlmPatch.parse(parsed);
      if (input.mode === "from_answer") {
        type GraphNodeT = z.infer<typeof GraphNode>;
        type GraphEdgeT = z.infer<typeof GraphEdge>;
        type PatchOpT = z.infer<typeof PatchOp>;

        const addedNodes: GraphNodeT[] = [];
        const existingAddEdges: GraphEdgeT[] = [];
        for (const op of patch.ops) {
          if (op.op === "add_node") addedNodes.push(op.node);
          else if (op.op === "add_edge") existingAddEdges.push(op.edge);
        }
        const anyEdge = existingAddEdges.length > 0;
        const premises = addedNodes.filter((n) => n.type === "premise");
        const inferences = addedNodes.filter((n) => n.type === "inference");
        const conclusions = addedNodes.filter((n) => n.type === "conclusion");
        const makeKey = (e: { sourceId: string; targetId: string; type: string }) => `${e.sourceId}->${e.targetId}:${e.type}`;
        const seen = new Set(existingAddEdges.map(makeKey));
        const newOps: PatchOpT[] = [];
        let edgeCounter = 0;
        const pushEdge = (src: string, dst: string) => {
          const key = `${src}->${dst}:infers`;
          if (seen.has(key)) return;
          const id = `e_${Date.now()}_${edgeCounter++}`;
          const addEdgeOp: PatchOpT = {
            op: "add_edge" as const,
            edge: { id, sourceId: src, targetId: dst, type: "infers" as const },
          };
          newOps.push(addEdgeOp);
          seen.add(key);
        };
        // If model provided no edges, or provided some but missed obvious P→I→C, we add minimal safe links
        if (!anyEdge || (premises.length && conclusions.length && newOps.length === 0)) {
          if (premises.length && inferences.length) {
            for (const p of premises.slice(0, 3)) {
              for (const i of inferences.slice(0, 2)) {
                pushEdge(p.id, i.id);
              }
            }
          }
          if (inferences.length && conclusions.length) {
            for (const i of inferences.slice(0, 3)) {
              for (const c of conclusions.slice(0, 2)) {
                pushEdge(i.id, c.id);
              }
            }
          }
          // Direct P→C if no inference nodes
          if (!inferences.length && premises.length && conclusions.length) {
            for (const p of premises.slice(0, 3)) {
              for (const c of conclusions.slice(0, 3)) {
                pushEdge(p.id, c.id);
              }
            }
          }
        }
        if (newOps.length) {
          patch = { ...patch, ops: [...patch.ops, ...newOps] };
        }
      }
      // Add QA anchor node and link question -> answer structure if missing
      if (input.mode === "from_answer") {
        type GraphNodeT = z.infer<typeof GraphNode>;
        type GraphEdgeT = z.infer<typeof GraphEdge>;
        type PatchOpT = z.infer<typeof PatchOp>;

        const ops = patch.ops;
        const addNodeOps = ops.filter((op) => op.op === "add_node") as Extract<PatchOpT, { op: "add_node" }>[];
        const addEdgeOps = ops.filter((op) => op.op === "add_edge") as Extract<PatchOpT, { op: "add_edge" }> [];

        const hasQa = addNodeOps.some((o) => o.node.type === "qa");
        let qaId: string | null = null;
        const newOps: PatchOpT[] = [];
        if (!hasQa && (input.prompt?.trim() || input.title?.trim())) {
          qaId = `q_${Date.now()}`;
          const qaTitle = input.title?.trim() || (input.prompt?.trim()?.slice(0, 40) ?? "Question");
          const qaContent = input.prompt?.trim();
          const qaNode: GraphNodeT = { id: qaId, type: "qa", title: qaTitle, content: qaContent };
          newOps.push({ op: "add_node" as const, node: qaNode });
        } else {
          const existingQa = addNodeOps.find((o) => o.node.type === "qa");
          qaId = existingQa?.node.id ?? null;
        }

        if (qaId) {
          const priority: Array<GraphNodeT["type"]> = ["conclusion", "inference", "premise", "claim", "concept", "evidence", "source"];
          const targets: GraphNodeT[] = [];
          for (const t of priority) {
            const cand = addNodeOps.filter((o) => o.node.type === t).map((o) => o.node);
            if (cand.length) targets.push(...cand.slice(0, 4));
          }
          // Cap total QA links to avoid noise
          const maxLinks = 10;
          const makeKey = (e: GraphEdgeT) => `${e.sourceId}->${e.targetId}:${e.type}`;
          const seen = new Set(addEdgeOps.map((o) => makeKey(o.edge)));
          let idx = 0;
          for (const t of targets.slice(0, maxLinks)) {
            const key = `${qaId}->${t.id}:relates_to`;
            if (seen.has(key)) continue;
            const edge: GraphEdgeT = { id: `e_${Date.now()}_qa_${idx++}`, sourceId: qaId, targetId: t.id, type: "relates_to" };
            newOps.push({ op: "add_edge" as const, edge });
            seen.add(key);
          }
        }

        if (newOps.length) {
          patch = { ...patch, ops: [...patch.ops, ...newOps] };
        }
      }
      // Normalize direction: QA should be the source for 'relates_to' edges
      {
        type GraphNodeT = z.infer<typeof GraphNode>;
        type PatchOpT = z.infer<typeof PatchOp>;
        const addNodeOps = patch.ops.filter((op) => op.op === "add_node") as Extract<PatchOpT, { op: "add_node" }>[];
        const qaIds = new Set<string>(addNodeOps.filter((o) => o.node.type === "qa").map((o) => o.node.id));
        if (qaIds.size > 0) {
          const normalized: PatchOpT[] = patch.ops.map((op) => {
            if (op.op === "add_edge" && op.edge.type === "relates_to") {
              const isSrcQA = qaIds.has(op.edge.sourceId);
              const isTgtQA = qaIds.has(op.edge.targetId);
              if (!isSrcQA && isTgtQA) {
                return {
                  op: "add_edge",
                  edge: { id: op.edge.id, sourceId: op.edge.targetId, targetId: op.edge.sourceId, type: op.edge.type },
                } as Extract<PatchOpT, { op: "add_edge" }>;
              }
            }
            return op;
          });
          patch = { ...patch, ops: normalized };
        }
      }
      if (!patch.description) {
        const human = (op: z.infer<typeof PatchOp>) => {
          if (op.op === "add_node") return `노드 추가: [${op.node.type}] ${op.node.title}`;
          if (op.op === "update_node") return `노드 수정: ${op.id}`;
          if (op.op === "remove_node") return `노드 삭제: ${op.id}`;
          if (op.op === "add_edge") return `관계 추가: ${op.edge.sourceId} → ${op.edge.targetId} [${op.edge.type}]`;
          if (op.op === "remove_edge") return `관계 삭제: ${op.id}`;
          return "변경";
        };
        const desc = patch.ops.slice(0, 6).map(human).join("\n");
        patch = { ...patch, description: desc };
      }
      return NextResponse.json(patch);
    } catch {
      // On any OpenAI API error, degrade gracefully
      return NextResponse.json(buildFallback());
    }
  } catch (err) {
    console.error("/api/ai/patch error", err);
    return NextResponse.json({ error: "Bad Request" }, { status: 400 });
  }
}
