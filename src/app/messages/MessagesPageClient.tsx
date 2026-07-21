"use client";

import Link from "next/link";
import { ArrowLeft, MoreVertical } from "lucide-react";
import { useState } from "react";
import { useMessenger } from "@/components/messenger/MessengerProvider";
import {
  AIAgentRunActivity,
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

export default function MessagesPageClient() {
  const { selectedConversation, selectedContext } = useMessenger();
  const [mobilePane, setMobilePane] = useState<"inbox" | "chat">("inbox");

  return (
    <main className="eco-page eco-page--wide eco-messenger-page">
      <header className="eco-page-head eco-messenger-page-head">
        <div>
          <div className="eco-page-kicker">
            <Link href="/crm">CRM</Link> / <span>Сообщения</span>
          </div>
          <h1 className="eco-page-title">Сообщения</h1>
          <p className="eco-page-subtitle">
            Единое окно переписок для Telegram, VK, WhatsApp, Instagram, Avito, Max, сайта, SMS и внутренних сообщений.
          </p>
        </div>
        <div className="eco-actions">
          <FullPageStateControls />
        </div>
      </header>

      <ChannelStatusStrip />

      <section className="eco-messenger-layout" data-mobile-pane={mobilePane}>
        <div className="eco-messenger-layout__inbox" onClick={() => setMobilePane("chat")}>
          <MessengerInbox />
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
                  <button type="button" className="eco-messenger-icon-btn" aria-label="Действия">
                    <MoreVertical aria-hidden className="eco-icon" />
                  </button>
                }
              />
              <AIAgentRunActivity conversation={selectedConversation} />
              <ChatThread conversation={selectedConversation} />
              <MessengerComposer conversation={selectedConversation} />
            </>
          ) : (
            <EmptySelection />
          )}
        </div>

        <ContextPanel conversation={selectedConversation} context={selectedContext} />
      </section>

      <GatewayApiCard />
    </main>
  );
}
