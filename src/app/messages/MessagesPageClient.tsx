"use client";

import Link from "next/link";
import { ArrowLeft, PanelRight, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useMessenger } from "@/components/messenger/MessengerProvider";
import {
  ChannelStatusStrip,
  ChatHeader,
  ChatThread,
  ContextPanel,
  EmptySelection,
  FullPageStateControls,
  GatewayApiCard,
  MessengerComposer,
  MessengerInbox,
} from "@/components/messenger/MessengerUi";

export default function MessagesPageClient({ initialConversationId }: { initialConversationId: string | null }) {
  const { selectedConversation, selectedContext, closeWidget } = useMessenger();
  const [mobilePane, setMobilePane] = useState<"inbox" | "chat" | "context">(
    initialConversationId ? "chat" : "inbox"
  );
  const [detailsOpen, setDetailsOpen] = useState(false);

  useEffect(() => {
    closeWidget();
  }, [closeWidget]);

  function openConversation() {
    setMobilePane("chat");
    setDetailsOpen(false);
  }

  function toggleContext() {
    if (detailsOpen) {
      closeContext();
      return;
    }
    setMobilePane("context");
    setDetailsOpen(true);
  }

  function closeContext() {
    setMobilePane("chat");
    setDetailsOpen(false);
  }

  return (
    <main className="eco-page eco-page--wide eco-messenger-page">
      <header className="eco-page-head eco-messenger-page-head">
        <div className="eco-messenger-page-head__title">
          <div className="eco-page-kicker">
            <Link href="/crm">CRM</Link> / <span>Сообщения</span>
          </div>
          <h1 className="eco-page-title">Сообщения</h1>
        </div>
        <div className="eco-messenger-page-head__status">
          <ChannelStatusStrip />
          <FullPageStateControls />
        </div>
      </header>

      <section
        className="eco-messenger-layout"
        data-mobile-pane={mobilePane}
        data-details-open={detailsOpen ? "true" : "false"}
      >
        <div className="eco-messenger-layout__inbox">
          <MessengerInbox onSelect={openConversation} />
        </div>

        <div className="eco-messenger-layout__thread">
          {selectedConversation ? (
            <>
              <ChatHeader
                conversation={selectedConversation}
                leftAction={
                  <button
                    type="button"
                    className="eco-messenger-icon-btn eco-messenger-mobile-back"
                    onClick={() => setMobilePane("inbox")}
                    aria-label="К списку"
                  >
                    <ArrowLeft aria-hidden className="eco-icon" />
                  </button>
                }
                rightAction={
                  <button
                    type="button"
                    className={`eco-messenger-icon-btn eco-messenger-context-toggle${detailsOpen ? " is-active" : ""}`}
                    onClick={toggleContext}
                    aria-label="Клиент и действия"
                    aria-expanded={detailsOpen}
                  >
                    <PanelRight aria-hidden className="eco-icon" />
                  </button>
                }
              />
              <ChatThread conversation={selectedConversation} />
              <MessengerComposer key={selectedConversation.id} conversation={selectedConversation} />
            </>
          ) : (
            <EmptySelection />
          )}
        </div>

        <div className="eco-messenger-layout__context">
          <div className="eco-messenger-context-pane__head">
            <button type="button" className="eco-messenger-icon-btn" onClick={closeContext} aria-label="Закрыть панель клиента">
              <ArrowLeft aria-hidden className="eco-icon eco-messenger-context-pane__back" />
              <X aria-hidden className="eco-icon eco-messenger-context-pane__close" />
            </button>
            <strong>Клиент и действия</strong>
          </div>
          <ContextPanel conversation={selectedConversation} context={selectedContext} />
        </div>
      </section>

      <GatewayApiCard />
    </main>
  );
}
