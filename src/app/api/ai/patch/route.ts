import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { z } from "zod";

// Runtime node to allow using OpenAI SDK
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NodeType = z.enum(["concept", "claim", "evidence", "source", "qa"]);

const GraphNode = z.object({
  id: z.string(),
  type: NodeType,
  title: z.string(),
  content: z.string().optional(),
});

const EdgeType = z.enum(["supports", "refutes", "relates_to", "cites"]);

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

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      // No API key in env → return minimal local patch so UI can still function
      return NextResponse.json(buildFallback());
    }

    const client = new OpenAI({ apiKey });

    const system = `You generate graph editing proposals for a knowledge graph.
Return ONLY a JSON object matching this TypeScript type exactly, with no markdown:
{
  id: string;
  description?: string;
  ops: (
    | { op: "add_node"; node: { id: string; type: "concept"|"claim"|"evidence"|"source"|"qa"; title: string; content?: string } }
    | { op: "update_node"; id: string; patch: Partial<{ id: string; type: "concept"|"claim"|"evidence"|"source"|"qa"; title: string; content?: string }> }
    | { op: "remove_node"; id: string }
    | { op: "add_edge"; edge: { id: string; sourceId: string; targetId: string; type: "supports"|"refutes"|"relates_to"|"cites" } }
    | { op: "remove_edge"; id: string }
  )[]
}
Constraints:
- Prefer small, safe patches.
- If user provided title/type, use them for one add_node op.
- Generate stable-ish id if user didn't provide (e.g., "n_" + random digits).
- Do not hallucinate connections to non-existing node ids.
`;

    const flavor = input.mode === "from_answer" ? `Source is the assistant's answer text provided below. Identify key concepts, claims, evidence, and optional sources. Create 1-5 operations. Prefer adding nodes with meaningful titles and minimal content; add edges when clear logical relations exist.` : `Source is the user's prompt/instructions. Create a small, safe patch (1-3 ops).`;

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
      // Use Chat Completions with JSON mode
      const completion = await client.chat.completions.create({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          user,
        ],
        temperature: 0.2,
      });

      const text = completion.choices?.[0]?.message?.content ?? "";
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return NextResponse.json(buildFallback());
      }

      const patch = LlmPatch.parse(parsed);
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
