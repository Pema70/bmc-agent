import { askClarificationTool } from "@/lib/ai/tools/ask-clarification";
import { createEvaluateBmcTool, type EvaluateToolContext } from "@/lib/ai/tools/evaluate-bmc";
import { createProposeBlockChangeTool, type ProposeToolContext } from "@/lib/ai/tools/propose-block-change";

/** Narzędzia czatu tworzone per żądanie: znają użytkownika i wariant, a evaluate_bmc pilnuje limitu jednej próby na turę. */
export function createChatTools(context: ProposeToolContext & EvaluateToolContext) {
  return {
    ask_clarification: askClarificationTool,
    propose_block_change: createProposeBlockChangeTool(context),
    evaluate_bmc: createEvaluateBmcTool(context),
  };
}
