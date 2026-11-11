import { askClarificationTool } from "@/lib/ai/tools/ask-clarification";
import { createProposeBlockChangeTool, type ProposeToolContext } from "@/lib/ai/tools/propose-block-change";

/** Narzędzia czatu tworzone per żądanie, bo propose_block_change zna użytkownika i wariant. */
export function createChatTools(context: ProposeToolContext) {
  return {
    ask_clarification: askClarificationTool,
    propose_block_change: createProposeBlockChangeTool(context),
  };
}
