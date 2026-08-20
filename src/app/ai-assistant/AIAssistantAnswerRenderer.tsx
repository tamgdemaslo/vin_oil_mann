"use client";

import { Check, CheckCircle2, Clipboard, ExternalLink, FileText, Info, ReceiptText, ShieldAlert, Sparkles, Wrench } from "lucide-react";
import { useState, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cleanAssistantMarkdown } from "@/lib/ai-assistant/markdown";
import type { AIAssistantStructuredResponse } from "@/lib/ai-assistant/structured-response";
import type { QuoteAndTechCardResult } from "@/lib/ai-assistant/quote-and-tech-card";

export type AIAssistantSource = {
  id?: string;
  sourceType?: string;
  title: string | null;
  url: string | null;
  excerpt?: string | null;
};

export type AIServiceQuote = {
  id: string;
  status: string;
  vehicleDisplayName: string | null;
  serviceName: string | null;
  selectedScenario: string | null;
  appliedRuleSnapshotJson: unknown;
  includedItemsJson: unknown;
  optionalItemsJson: unknown;
  baseTotalCents: number;
  maximumTotalCents: number | null;
  assumptionsJson: unknown;
  internalWarningsJson: unknown;
  customerSafeWarningsJson: unknown;
  validUntil: string | null;
};

type Props = {
  content: string;
  structuredResponse?: AIAssistantStructuredResponse;
  status: "streaming" | "completed" | "failed";
  sources?: AIAssistantSource[];
  quote?: AIServiceQuote;
  quoteAndTechCard?: QuoteAndTechCardResult;
};

type QuoteLine = { name: string; article: string | null; quantity: number; totalCents: number; type: string | null };

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).slice(0, 12) : [];
}

function quoteLines(value: unknown): QuoteLine[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const line = object(item);
    const article = typeof line.article === "string" && line.article.trim() ? line.article.trim() : null;
    const rawName = typeof line.name === "string" ? line.name.trim() : "";
    const name = !rawName || /^деталь$/iu.test(rawName) ? (article ? `Запчасть ${article}` : "Позиция без названия") : rawName;
    return {
      name,
      article,
      quantity: Number(line.quantity) || 1,
      totalCents: Number(line.totalCents) || 0,
      type: typeof line.type === "string" ? line.type : null,
    };
  }).filter((line) => line.totalCents >= 0).slice(0, 40);
}

function money(cents: number) {
  const rubles = cents / 100;
  return `${new Intl.NumberFormat("ru-RU", { minimumFractionDigits: Number.isInteger(rubles) ? 0 : 2, maximumFractionDigits: 2 }).format(rubles)} ₽`;
}

function quantity(value: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(value);
}

function safeUrl(value: string | undefined) {
  if (!value) return "";
  if (value.startsWith("/") || value.startsWith("#")) return value;
  try {
    const parsed = new URL(value);
    return ["http:", "https:", "mailto:"].includes(parsed.protocol) ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function sourceTitle(source: AIAssistantSource) {
  if (source.title) return source.title;
  try { return new URL(source.url ?? "").hostname || "Источник"; } catch { return "Источник"; }
}

function Markdown({ content, suppressTables = false }: { content: string; suppressTables?: boolean }) {
  const readableContent = cleanAssistantMarkdown(content);
  const components: Components = {
    h1: ({ children }) => <h2>{children}</h2>,
    h2: ({ children }) => <h3>{children}</h3>,
    h3: ({ children }) => <h4>{children}</h4>,
    h4: ({ children }) => <h5>{children}</h5>,
    p: ({ children }) => <p>{children}</p>,
    ul: ({ children }) => <ul>{children}</ul>,
    ol: ({ children }) => <ol>{children}</ol>,
    li: ({ children }) => <li>{children}</li>,
    blockquote: ({ children }) => <blockquote><Info size={15} aria-hidden /><div>{children}</div></blockquote>,
    hr: () => <hr />,
    a: ({ href, children }) => {
      const safeHref = safeUrl(href);
      return safeHref ? <a href={safeHref} target={safeHref.startsWith("http") ? "_blank" : undefined} rel={safeHref.startsWith("http") ? "noreferrer noopener" : undefined}>{children}<ExternalLink size={12} aria-hidden /></a> : <span>{children}</span>;
    },
    img: () => null,
    table: ({ children }) => suppressTables ? null : <div className="eco-ai-answer__table-scroll"><table>{children}</table></div>,
    thead: ({ children }) => <thead>{children}</thead>,
    tbody: ({ children }) => <tbody>{children}</tbody>,
    tr: ({ children }) => <tr>{children}</tr>,
    th: ({ children }) => <th scope="col">{children}</th>,
    td: ({ children }) => <td>{children}</td>,
    pre: ({ children }) => <pre>{children}</pre>,
    code: ({ className, children }) => className ? <code className={className}>{children}</code> : <code>{children}</code>,
  };
  return <div className="eco-ai-answer__markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml urlTransform={(url) => safeUrl(url)} components={components}>{readableContent}</ReactMarkdown></div>;
}

function DetailSection({ title, icon, items, tone = "neutral" }: { title: string; icon: ReactNode; items: string[]; tone?: "neutral" | "warning" | "success" }) {
  if (!items.length) return null;
  return <section className={`eco-ai-answer__detail is-${tone}`}><header>{icon}<strong>{title}</strong></header><ul>{items.map((item, index) => <li key={`${title}-${index}`}>{item}</li>)}</ul></section>;
}

export function AIServiceQuoteCard({ quote }: { quote: AIServiceQuote }) {
  const lines = quoteLines(quote.includedItemsJson);
  const assumptions = stringList(quote.assumptionsJson);
  const rule = object(quote.appliedRuleSnapshotJson);
  const ruleName = typeof rule.name === "string" ? rule.name.trim() : "";
  const range = quote.maximumTotalCents && quote.maximumTotalCents > quote.baseTotalCents;
  return <section className="eco-ai-answer__quote" aria-label="Предварительный расчёт">
    <header className="eco-ai-answer__quote-head">
      <div><ReceiptText size={18} aria-hidden /><div><strong>Предварительный расчёт</strong><span>{quote.vehicleDisplayName || "Автомобиль уточняется"}</span></div></div>
      <span className="eco-ai-answer__quote-status">Черновик</span>
    </header>
    <div className="eco-ai-answer__quote-service"><strong>{quote.serviceName || "Состав работ уточняется"}</strong>{quote.selectedScenario && <span>{quote.selectedScenario}</span>}</div>
    {lines.length > 0 && <div className="eco-ai-answer__quote-table-wrap"><table className="eco-ai-answer__quote-table"><thead><tr><th scope="col">Позиция</th><th scope="col">Кол-во</th><th scope="col">Сумма</th></tr></thead><tbody>{lines.map((line, index) => <tr key={`${line.name}-${line.article ?? index}`}><td><strong>{line.name}</strong>{line.article && <span>{line.article}</span>}</td><td>{quantity(line.quantity)}</td><td>{money(line.totalCents)}</td></tr>)}</tbody></table></div>}
    <div className="eco-ai-answer__quote-total"><span>{range ? "Диапазон стоимости" : "Итого"}</span><strong>{range ? `${money(quote.baseTotalCents)} — ${money(quote.maximumTotalCents!)}` : money(quote.baseTotalCents)}</strong></div>
    {(ruleName || quote.validUntil) && <footer>{ruleName && <span>Тариф: {ruleName}</span>}{quote.validUntil && <span>Цена действительна до {new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(quote.validUntil))}</span>}</footer>}
    {assumptions.length > 0 && <details><summary>Допущения расчёта · {assumptions.length}</summary><ul>{assumptions.map((item, index) => <li key={index}>{item}</li>)}</ul></details>}
  </section>;
}

function ClientMessageCard({ message }: { message: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch { setCopied(false); }
  };
  return <section className="eco-ai-answer__client" aria-label="Сообщение для клиента"><header><FileText size={17} aria-hidden /><div><strong>Сообщение клиенту</strong><span>Готово для копирования, но ещё не отправлено</span></div><button type="button" onClick={() => void copy()}>{copied ? <Check size={14} /> : <Clipboard size={14} />}{copied ? "Скопировано" : "Скопировать"}</button></header><p>{message}</p></section>;
}

function QuoteAndTechCardOption({ option }: { option: QuoteAndTechCardResult["options"][number] }) {
  const range = option.maximumTotalCents != null && option.totalCents != null && option.maximumTotalCents > option.totalCents;
  return <section className={`eco-ai-answer__quote eco-ai-answer__quote-option is-${option.status}`} aria-label={option.label}>
    <header className="eco-ai-answer__quote-head">
      <div><ReceiptText size={18} aria-hidden /><div><strong>{option.label}</strong><span>{option.requiredLiters != null ? `Расчётный объём: ${quantity(option.requiredLiters)} л` : "Объём требует уточнения"}</span></div></div>
      <span className="eco-ai-answer__quote-status">{option.status === "ready" ? option.confidence === "final" ? "Подтверждено" : "Предварительно" : "Нужны данные"}</span>
    </header>
    {option.lines.length > 0 && <div className="eco-ai-answer__quote-table-wrap"><table className="eco-ai-answer__quote-table"><thead><tr><th scope="col">Позиция</th><th scope="col">Кол-во</th><th scope="col">Сумма</th></tr></thead><tbody>{option.lines.map((line, index) => <tr key={`${line.name}-${line.article ?? index}`}><td><strong>{line.name}</strong>{line.article && <span>{line.article}</span>}</td><td>{quantity(line.quantity)}</td><td>{money(line.totalCents)}</td></tr>)}</tbody></table></div>}
    {option.totalCents != null && <div className="eco-ai-answer__quote-total"><span>{range ? "Диапазон стоимости" : "Итого"}</span><strong>{range ? `${money(option.totalCents)} — ${money(option.maximumTotalCents!)}` : money(option.totalCents)}</strong></div>}
    {option.blockers.length > 0 && <div className="eco-ai-answer__blockers">{option.blockers.map((blocker) => <p key={blocker.code}><strong>{blocker.message}</strong><span>{blocker.requiredToContinue}</span></p>)}</div>}
    {option.warnings.length > 0 && <details><summary>Проверить перед работой · {option.warnings.length}</summary><ul>{option.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}
  </section>;
}

function QuoteAndTechCardView({ result }: { result: QuoteAndTechCardResult }) {
  const techRows = [
    ["Автомобиль", result.vehicle.displayName],
    ["Агрегат", result.vehicle.aggregate],
    ["Спецификация", result.techCard.requiredFluidSpec],
    ["Материал", result.techCard.selectedMaterial ? `${result.techCard.selectedMaterial.name} · ${quantity(result.techCard.selectedMaterial.quantity)}` : null],
    ["Выставление уровня", result.techCard.levelProcedure],
    ["Фильтр", result.techCard.filterPolicy],
  ].filter((row): row is [string, string] => Boolean(row[1]));
  return <>
    <section className="eco-ai-answer__techcard" aria-label="Техническая карта">
      <header><ShieldAlert size={18} aria-hidden /><div><strong>Техническая карта</strong><span>{result.techCard.serviceName}</span></div><b className={`is-${result.status}`}>{result.status === "ready" ? "готово" : result.status === "partial" ? "частично" : "нужны данные"}</b></header>
      <dl>{techRows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      {(result.techCard.servicePoints.length > 0 || result.techCard.torqueNotes.length > 0 || result.techCard.criticalChecks.length > 0) && <div className="eco-ai-answer__techcard-checks">
        {result.techCard.servicePoints.length > 0 && <DetailSection title="Точки обслуживания" icon={<CheckCircle2 size={15} aria-hidden />} items={result.techCard.servicePoints} tone="success" />}
        {result.techCard.torqueNotes.length > 0 && <DetailSection title="Моменты и порядок" icon={<Wrench size={15} aria-hidden />} items={result.techCard.torqueNotes} />}
        {result.techCard.criticalChecks.length > 0 && <DetailSection title="Контроль" icon={<ShieldAlert size={15} aria-hidden />} items={result.techCard.criticalChecks} tone="warning" />}
      </div>}
      {result.hardBlockers.length > 0 && <div className="eco-ai-answer__blockers">{result.hardBlockers.map((blocker) => <p key={blocker.code}><strong>{blocker.message}</strong><span>{blocker.requiredToContinue}</span></p>)}</div>}
    </section>
    <section className="eco-ai-answer__quote-options" aria-label="Варианты сметы"><header><ReceiptText size={17} aria-hidden /><strong>Смета</strong><span>Суммы и количества рассчитаны сервером</span></header>{result.options.map((option) => <QuoteAndTechCardOption key={option.code} option={option} />)}</section>
    {result.softWarnings.length > 0 && <div className="eco-ai-answer__details"><DetailSection title="Рабочие оговорки" icon={<Info size={16} aria-hidden />} items={result.softWarnings} tone="warning" /></div>}
    <ClientMessageCard message={result.customerMessage} />
  </>;
}

export default function AIAssistantAnswerRenderer({ content, structuredResponse, status, sources = [], quote, quoteAndTechCard }: Props) {
  const visibleSources = sources.filter((source) => Boolean(source.url && safeUrl(source.url))).filter((source, index, list) => list.findIndex((other) => other.url === source.url) === index).slice(0, 12);
  return <div className={`eco-ai-answer is-${status}`} aria-busy={status === "streaming"}>
    {quoteAndTechCard ? <QuoteAndTechCardView result={quoteAndTechCard} /> : structuredResponse ? <>
      {structuredResponse.summaryMarkdown && <Markdown content={structuredResponse.summaryMarkdown} />}
      {quote && <AIServiceQuoteCard quote={quote} />}
      <div className="eco-ai-answer__details">
        <DetailSection title="Подтверждено" icon={<CheckCircle2 size={16} aria-hidden />} items={structuredResponse.confirmed} tone="success" />
        <DetailSection title="Рабочие допущения" icon={<Info size={16} aria-hidden />} items={structuredResponse.assumptions} />
        <DetailSection title="Проверить перед работой" icon={<ShieldAlert size={16} aria-hidden />} items={structuredResponse.requiresVerification} tone="warning" />
      </div>
      {structuredResponse.recommendations.length > 0 && <section className="eco-ai-answer__recommendations"><header><Sparkles size={17} aria-hidden /><strong>Рекомендации</strong></header><div>{structuredResponse.recommendations.map((item, index) => <article className={item.priority === "important" ? "is-important" : ""} key={`${item.title}-${index}`}><strong>{item.title}</strong><p>{item.detail}</p></article>)}</div></section>}
      {structuredResponse.clientMessage && <ClientMessageCard message={structuredResponse.clientMessage} />}
    </> : <><Markdown content={content} suppressTables={Boolean(quote)} />{quote && <AIServiceQuoteCard quote={quote} />}</>}
    {visibleSources.length > 0 && <details className="eco-ai-answer__sources"><summary>Источники · {visibleSources.length}</summary><div>{visibleSources.map((source, index) => <a key={source.id ?? `${source.url}-${index}`} href={safeUrl(source.url ?? undefined)} target="_blank" rel="noreferrer noopener"><span>{source.sourceType?.toUpperCase() || "WEB"}</span><strong>{sourceTitle(source)}</strong><ExternalLink size={12} aria-hidden /></a>)}</div></details>}
  </div>;
}
