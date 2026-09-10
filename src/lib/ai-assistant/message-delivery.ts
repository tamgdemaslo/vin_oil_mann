type ThreadDeliverySnapshot = {
  thread: { id: string } | null;
  latestRun: { inputMessageId?: string | null } | null;
  messages: Array<{ id: string; role: string; content: string }>;
};

// A failed POST response does not establish whether the server accepted it.
// Reconcile against the saved run before restoring text for another submission.
export function assistantMessageWasAccepted(
  snapshot: ThreadDeliverySnapshot | null,
  request: { threadId: string; message: string; previousMessageIds: ReadonlySet<string> },
) {
  if (snapshot?.thread?.id !== request.threadId || !snapshot.latestRun?.inputMessageId) return false;
  return snapshot.messages.some(message => message.id === snapshot.latestRun?.inputMessageId
    && !request.previousMessageIds.has(message.id)
    && message.role === "user" && message.content === request.message);
}

export function assistantDeliveryError(error: unknown) {
  if (error instanceof TypeError || (error instanceof Error && /^(?:Load failed|Failed to fetch|NetworkError.*|The network connection was lost\.?|The operation was aborted\.?)$/i.test(error.message))) {
    return "Связь с сервером прервалась. Запрос мог продолжить выполняться. Проверьте состояние диалога перед повторной отправкой.";
  }
  return error instanceof Error ? error.message : "Не удалось получить ответ сервера. Проверьте состояние диалога.";
}
