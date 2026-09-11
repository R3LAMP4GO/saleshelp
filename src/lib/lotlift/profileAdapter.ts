import type { ResolvedSalesProfile } from "../sales/profiles";
import type { LotLiftNextMove } from "./nextMove";

export interface ResolvedLotLiftScriptContext {
  representativeName?: string | null;
  firstName?: string | null;
  dealership?: string | null;
}

function safeValue(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized && !/[\[\]\r\n]/.test(normalized) ? normalized : null;
}

/** Renders only the predeclared profile variables; unknown or missing values fail back safely. */
export function renderResolvedLotLiftScript(script: string, context: ResolvedLotLiftScriptContext): string | null {
  const values: Record<string, string | null> = {
    "configured rep name": safeValue(context.representativeName),
    "first name": safeValue(context.firstName),
    dealership: safeValue(context.dealership),
  };
  let missing = false;
  const response = script.replace(/\[([^\]]+)\]/g, (_, variable: string) => {
    const value = values[variable];
    if (!value) missing = true;
    return value ?? "";
  });
  return missing ? null : response;
}

/** Applies the session snapshot without allowing it to modify engine safety metadata. */
export function applyResolvedLotLiftMove(move: LotLiftNextMove, profile: ResolvedSalesProfile | undefined, context: ResolvedLotLiftScriptContext): LotLiftNextMove {
  const configured = profile?.behavior.moves.find((candidate) => candidate.id === move.id);
  if (!configured) return move;
  const response = renderResolvedLotLiftScript(configured.script, context) ?? move.response;
  return {
    ...move,
    title: configured.title,
    goal: configured.goal,
    response,
    fallback_response: response,
    response_mode: configured.responseMode,
    max_words: configured.maxWords,
  };
}
