export type AssistantIntent = "new_quote" | "edit_quote" | "technical_question" | "filter_selection" | "format_message" | "general";
export function assistantIntent(message: string, hasQuote = false): AssistantIntent {
  const value = message.normalize("NFKC").toLocaleLowerCase("ru-RU");
  if (/друг(?:ой|ая|ое|ого|ую)\s+(?:авто|машин)|нов(?:ый|ая|ое|ого|ую)\s+(?:авто|машин)/u.test(value)) return "new_quote";
  // A request for an answer to the customer can also contain a NEW price or
  // technical question. Classify that question before presentation wording.
  if (/посчита|рассч|пересч|смет|в\s+какую\s+цену|какая\s+(?:будет\s+)?(?:цена|стоимость)|сколько[\s\S]*(?:стоит|стоить|обойд|итого|всего)|(?:^|[.!?\n]\s*)стоимост\S*\s+(?:замен|работ|обслуж)|под ключ/u.test(value)) return hasQuote ? "edit_quote" : "new_quote";
  if (/адаптац|сброс\S*\s+(?:обуч|настро)|температур|момент.*затяж|как.*(?:провер|выстав|меня)|процедур|какой.*допуск|какой.*объ[её]м/u.test(value)) return "technical_question";
  if (hasQuote && /пересч|добав|убер|замен[иь]/u.test(value)) return "edit_quote";
  if (/замен.*(?:масл|жидкост)|(?:масл|жидкост).*замен/u.test(value)) return "new_quote";
  if (/фильтр|filter/u.test(value)) return "filter_selection";
  if (/только (?:итогов\S* )?(?:цен|сумм)|без цен|коротк|кратк|подробн|(?:текст|сообщени|ответ).*клиент/u.test(value)) return "format_message";
  return "general";
}
