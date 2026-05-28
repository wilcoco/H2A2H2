// Obsidian-style: single muted stroke color; distinguish edge types
// by SVG dash pattern + width instead of color hue.

export interface EdgeStyle {
  dasharray: string | undefined;
  width: number;
}

export function edgeStyleFor(t: string | undefined | null): EdgeStyle {
  const k = (t || "").toLowerCase();
  switch (k) {
    case "supports":     return { dasharray: undefined,      width: 1.8 };
    case "refutes":      return { dasharray: "6 3",          width: 1.6 };
    case "clarifies":    return { dasharray: "2 2",          width: 1.4 };
    case "elaborates":   return { dasharray: "8 2 2 2",      width: 1.4 };
    case "prerequisite": return { dasharray: "1 3",          width: 1.4 };
    case "narrows":      return { dasharray: "4 2 1 2",      width: 1.4 };
    case "precedes":     return { dasharray: undefined,      width: 2.0 };
    case "alternative":  return { dasharray: "5 5",          width: 1.4 };
    case "cites":        return { dasharray: "2 4",          width: 1.2 };
    case "relates_to":   return { dasharray: "3 3",          width: 1.2 };
    case "infers":       return { dasharray: undefined,      width: 1.6 };
    default:             return { dasharray: undefined,      width: 1.4 };
  }
}

// Default stroke color (muted, monochrome). SVG inside React doesn't
// reliably resolve CSS variables, so use a sensible neutral.
// Components can override per-theme by reading getComputedStyle.
export const EDGE_STROKE = "#6b6b6b";
export const EDGE_STROKE_EMPHASIS = "#1f1f1f";
