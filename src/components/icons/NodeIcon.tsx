"use client";

import {
  Lightbulb,
  MessageSquareQuote,
  FileSearch,
  Link as LinkIcon,
  HelpCircle,
  Anchor,
  GitBranch,
  Flag,
  Circle,
} from "lucide-react";
import type { NodeType } from "@/types/graph";

const MAP: Record<NodeType, React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>> = {
  concept: Lightbulb,
  claim: MessageSquareQuote,
  evidence: FileSearch,
  source: LinkIcon,
  qa: HelpCircle,
  premise: Anchor,
  inference: GitBranch,
  conclusion: Flag,
};

type Props = {
  type: NodeType | string;
  size?: number;
  strokeWidth?: number;
  className?: string;
};

export default function NodeIcon({ type, size = 14, strokeWidth = 1.6, className }: Props) {
  const Icon = (MAP as Record<string, React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>>)[type as string] ?? Circle;
  return <Icon size={size} strokeWidth={strokeWidth} className={className} />;
}
