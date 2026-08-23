const CALCULATION_TOOL_NAMES = new Set([
  "calculate_quote_preview",
  "calculate_service_quote_v2",
  "build_quote_and_tech_card",
  "build_quote_and_tech_card_bundle",
]);

export function isAssistantCalculationTool(toolName: string) {
  return CALCULATION_TOOL_NAMES.has(toolName);
}

export function shouldFinalizeAssistantToolTurn(input: {
  turn: number;
  maxToolTurns: number;
  calculationCompleted: boolean;
}) {
  return input.calculationCompleted || input.turn >= input.maxToolTurns - 1;
}
