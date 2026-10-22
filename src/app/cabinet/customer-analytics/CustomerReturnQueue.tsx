"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Copy, RefreshCw,Send } from "lucide-react";
import { RETURN_SCENARIO_LABELS, type ReturnCandidate, type ReturnScenario } from "@/lib/customer-return-candidates";
import { withCustomerReturnBookingLink } from "@/lib/customer-return-message";
import { returnMoney } from "@/lib/customer-return-offer";
import { returnCandidateFingerprint } from "@/lib/customer-return-shared-types";
import { RETURN_TABS,customerReturnTab,customerReturnStatus,type ReturnTab } from "@/lib/customer-return-workflow";
import { effectiveCustomerReturnState } from "@/lib/customer-return-contact-policy";
import { useCustomerReturnSharedState } from "./useCustomerReturnSharedState";
import { formatServiceDate, formatServiceDateTime, toServiceDateInput } from "@/lib/date-time";

type Saved = { drafts: Record<string, { text: string; fingerprint: string }>; skipped: string[] };
function readSaved(key: string): Saved {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "null") as Partial<Saved> | null;
    const drafts: Saved["drafts"] = {};
    for (const [id, item] of Object.entries(value?.drafts ?? {})) {
      if (item && typeof item.text === "string" && typeof item.fingerprint === "string") drafts[id] = item;
    }
    return {drafts, skipped:Array.isArray(value?.skipped) ? value.skipped.filter((id): id is string => typeof id === "string") : []};
  } catch { return {drafts:{}, skipped:[]}; }
}
const fingerprint = returnCandidateFingerprint;
type Edit = {text:string; baseVersion:number};

export default function CustomerReturnQueue({ candidates, today, scope, branchId, onRefresh, onOpenClient }: {
  candidates: ReturnCandidate[];
  today: string;
  scope: string;
  branchId: string;
  onRefresh: () => void;
  onOpenClient?: (key: string) => void;
}) {
  const sectionRef=useRef<HTMLElement>(null);
  const titleRef=useRef<HTMLHeadingElement>(null);
  const storageKey = `eco:return-drafts:v1:${scope}:${today}`;
  const [legacy] = useState<Saved>(() => readSaved(storageKey));
  const [edits,setEdits]=useState<Record<string,Edit>>({});
  const shared=useCustomerReturnSharedState(branchId,today);
  const states=useMemo(()=>Object.fromEntries(Object.entries(shared.states).map(([key,state])=>[key,effectiveCustomerReturnState(candidates.find(candidate=>candidate.id===key)??{},state)])),[shared.states,candidates]);
  const saved = {skipped:Object.values(states).filter(state=>state.skipped).map(state=>state.clientKey)};
  const hasEdits=Object.keys(edits).length>0;
  const [selected, setSelected] = useState<string | null>(null);
  const [scenario, setScenario] = useState<ReturnScenario | "all">("all");
  const [search, setSearch] = useState("");
  const [tab,setTab]=useState<ReturnTab>("ready");
  const [notice, setNotice] = useState<string | null>(null);


  useEffect(() => {
    const timer = setInterval(() => { if (toServiceDateInput(new Date()) !== today && !hasEdits) onRefresh(); }, 60_000);
    return () => clearInterval(timer);
  }, [today, onRefresh, hasEdits]);

  useEffect(()=>{
    if(!hasEdits)return;
    const protect=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue="";};
    window.addEventListener("beforeunload",protect);
    return()=>window.removeEventListener("beforeunload",protect);
  },[hasEdits]);
  function clearEdit(id:string){setEdits(previous=>{const next={...previous};delete next[id];return next;});}

  // A new visit can remove a client from today's candidates; their delivery report must survive.
  const reportCandidates=useMemo(()=>[...candidates,...Object.values(states).filter(state=>state.deliveryStatus && state.deliveryStatus!=="none" && !candidates.some(candidate=>candidate.id===state.clientKey)).map(state=>({id:state.clientKey,clientKey:state.clientKey,displayName:"Клиент вне текущей подборки",phone:null,reasons:[],draft:state.draftText??"",needsReview:false} as ReturnCandidate))],[candidates,states]);
  const counts=Object.fromEntries(Object.keys(RETURN_TABS).map(key=>[key,reportCandidates.filter(candidate=>customerReturnTab(candidate,states[candidate.id])===key).length])) as Record<ReturnTab,number>;
  const visible = useMemo(() => reportCandidates.filter(candidate =>
    customerReturnTab(candidate,states[candidate.id])===tab &&
    (scenario === "all" || candidate.reasons.some(reason => reason.scenario === scenario)) &&
    (!search.trim() || [candidate.displayName, candidate.phone, ...candidate.reasons.map(r => r.vehicle)].filter(Boolean).join(" ").toLowerCase().includes(search.trim().toLowerCase()))
  ), [reportCandidates, scenario, search, tab, states]);
  const current = visible.find(c => c.id === selected) ?? visible[0];
  const currentBusy=!!current && !!shared.busy[current.id];
  const currentSaved = current ? states[current.id] : null;
  const currentFingerprint = current ? fingerprint(current) : "";
  const currentEdit=current?edits[current.id]:null;
  const draft = currentEdit?.text ?? currentSaved?.draftText ?? current?.draft ?? "";
  const version=currentSaved?.version ?? 0;
  const staleDraft=(!currentSaved?.deliveryStatus||currentSaved.deliveryStatus==="none") && !!currentSaved?.draftText && currentSaved.draftFingerprint!==currentFingerprint;
  const deliveryLocked=!!currentSaved?.deliveryStatus && currentSaved.deliveryStatus!=="none";
  const conflict=!!currentEdit && currentEdit.baseVersion!==version;
  const legacyDraft=current?legacy.drafts[current.id]:null;
  const legacyMatches=!!current && (legacyDraft?.fingerprint===currentFingerprint || legacyDraft?.fingerprint===JSON.stringify(current.reasons));
  const canImport=!!current && !currentSaved && (legacyMatches || legacy.skipped.includes(current.id));
  async function saveDraft(overwrite=false) {
    if(!current)return;
    const result=await shared.patch({clientKey:current.id,expectedVersion:overwrite?version:currentEdit?.baseVersion??version,fingerprint:currentFingerprint,draftText:draft});
    if(result.ok)clearEdit(current.id);
    setNotice(result.ok?"Общий черновик сохранён в базе.":result.error);
  }
  async function sendDraft(){
    if(!current || deliveryLocked)return;
    const id=current.id;
    const name=current.displayName;
    const request=shared.send({clientKey:id,expectedVersion:currentEdit?.baseVersion??version,fingerprint:currentFingerprint,draftText:draft});
    requestAnimationFrame(()=>{sectionRef.current?.scrollIntoView({behavior:"instant",block:"start"});titleRef.current?.focus({preventScroll:true});});
    const result=await request;
    if(result.ok)clearEdit(id);
    setNotice(result.ok?`${name}: сообщение сохранено в очереди. Результат появится во вкладке «Отправленные» или «Ошибки».`:result.error);
  }
  async function toggleSkipped(){
    if(!current)return;
    const result=await shared.patch({clientKey:current.id,expectedVersion:version,fingerprint:currentFingerprint,skipped:!currentSaved?.skipped});
    setNotice(result.ok?"Общая подборка обновлена.":result.error);
  }
  async function importLegacy(){
    if(!current)return;
    const result=await shared.patch({clientKey:current.id,expectedVersion:0,fingerprint:currentFingerprint,
      ...(legacyMatches?{draftText:legacyDraft!.text}:{}),skipped:legacy.skipped.includes(current.id)});
    setNotice(result.ok?"Локальные правки перенесены в общую подборку.":result.error);
  }

  async function copyDraft() {
    try { await navigator.clipboard.writeText(draft); setNotice("Черновик скопирован. Сообщение не отправлено."); }
    catch { setNotice("Не удалось скопировать. Выделите текст в поле и скопируйте вручную."); }
  }

  return (
    <section ref={sectionRef} className="eco-return-queue" aria-labelledby="return-queue-title">
      <div className="eco-ca-panel-head">
        <div>
          <h2 id="return-queue-title">Кого вернуть сегодня</h2>
          <p>{formatServiceDate(today)} · Клиентов в подборке: {candidates.length}. История текущего филиала.</p>
        </div>
        <button type="button" className="eco-btn" disabled={hasEdits || shared.saving} title={hasEdits?"Сначала сохраните или отмените свои правки":undefined} onClick={()=>{void shared.refresh();onRefresh();}}><RefreshCw size={15} /> Пересчитать</button>
      </div>
      <p className="eco-return-queue__note">Отправка через Telegram филиала. После нажатия клиент перейдёт в «В процессе», и откроется следующий. Коллеги видят общую очередь. Отправки прошлых дней учитываются; без нового обслуживания повторное приглашение заблокировано.</p>
      <nav className="eco-return-queue__tabs" aria-label="Статус предложения">{Object.entries(RETURN_TABS).map(([key,label])=><button key={key} type="button" aria-current={tab===key?"page":undefined} onClick={()=>{setTab(key as ReturnTab);setSelected(null);setNotice(null);}}>{label}<span>{shared.loaded?counts[key as ReturnTab]:"…"}</span></button>)}</nav>
      <div className="eco-return-queue__summary"><p>{({ready:"Рассчитанные предложения. Проверьте текст и отправьте — следующий клиент откроется сразу.",processing:"Сообщения обрабатываются в фоне. Статусы обновляются каждые 3 секунды; результат сохранится после закрытия страницы.",sent:"Telegram подтвердил отправку. История сохраняется между днями. Повторное приглашение по тому же обслуживанию заблокировано.",errors:"Отправка не удалась или её результат не подтверждён. Проверьте причину и диалог.",review:"Не хватает данных для полного предложения. Причина указана в карточке.",skipped:"Клиенты, которых сотрудники пропустили сегодня."})[tab]}</p><button type="button" className="eco-btn" onClick={()=>void shared.refresh()}><RefreshCw size={14}/> Обновить статусы</button></div>
      <div className="eco-return-queue__filters">
        <label>Сценарий<select value={scenario} onChange={e => setScenario(e.target.value as ReturnScenario | "all")}>
          <option value="all">Все три сценария</option>
          {Object.entries(RETURN_SCENARIO_LABELS).map(([key, label]) => <option key={key} value={key}>{label} ({candidates.filter(c => c.reasons.some(r => r.scenario === key)).length})</option>)}
        </select></label>
        <label>Клиент или автомобиль<input value={search} onChange={e => setSearch(e.target.value)} placeholder="Имя, телефон, модель или госномер" /></label>

      </div>
      {shared.error && <p role="alert" className="eco-return-queue__notice">{shared.error} <button type="button" className="eco-btn" onClick={()=>void shared.refresh()}>Повторить загрузку</button></p>}
      {!shared.loaded && !shared.error && <p role="status" className="eco-return-queue__note">Загружаем общие черновики и пропуски…</p>}
      {notice && <p role="status" className="eco-return-queue__notice">{notice}</p>}
      {!current ? <div className="eco-return-queue__empty"><h3>{search.trim() || scenario!=="all" ? "Клиентов по этим фильтрам нет" : ({ready:"Предложений к отправке не осталось",processing:"Активных отправок нет",sent:"Отправленных сообщений пока нет",errors:"Ошибок отправки нет",review:"Предложений на проверку нет",skipped:"Пропущенных клиентов нет"})[tab]}</h3><p>{search.trim() || scenario!=="all" ? "Измените поиск или сценарий." : tab==="ready" && counts.processing>0 ? "Сообщения обрабатываются в фоне. Результаты появятся в «Отправленных» или «Ошибках»." : "Выберите другую вкладку или пересчитайте подборку."}</p>{tab==="ready" && counts.processing>0 && <button type="button" className="eco-btn" onClick={()=>setTab("processing")}>Открыть отправки в процессе ({counts.processing})</button>}</div> : (
        <div className="eco-return-queue__layout">
          <div className="eco-return-queue__list" aria-label="Кандидаты на сегодня">
            <p>Клиентов в выборке: {visible.length}</p>
            {visible.map(candidate => <button key={candidate.id} type="button" className="eco-return-queue__client" aria-pressed={candidate.id === current.id} onClick={() => {setSelected(candidate.id);setNotice(null);}}>
              <strong>{candidate.displayName}</strong>
              <span>{[...new Set(candidate.reasons.map(r => r.vehicle))].join("; ")}</span>
              <span>{[...new Set(candidate.reasons.map(r => RETURN_SCENARIO_LABELS[r.scenario]))].join(" · ")}</span>
              <span className={`eco-return-queue__badge eco-return-queue__badge--${customerReturnTab(candidate,states[candidate.id])}`}>{customerReturnStatus(states[candidate.id])??(candidate.offerReady?"Готово к отправке":"Проверить предложение")}{states[candidate.id]?.deliveryAt && ` · ${formatServiceDateTime(states[candidate.id].deliveryAt!)}`}</span>
              {candidate.needsReview && <span className="eco-ca-table-warning">{candidate.offerReady===false ? "Проверить предложение" : "Проверить историю"}</span>}
              {saved.skipped.includes(candidate.id) && <span>Пропущен сегодня</span>}
            </button>)}
          </div>
          <div className="eco-return-queue__detail">
            <div className="eco-return-queue__detail-head"><div><h3 ref={titleRef} tabIndex={-1}>{current.displayName}</h3><p>{current.phone || "Телефон не указан"}</p></div>{onOpenClient && <button type="button" className="eco-btn" onClick={() => onOpenClient(current.clientKey)}>История клиента</button>}</div>
            {currentSaved?.deliveryStatus && currentSaved.deliveryStatus!=="none" && <p role="status" className={`eco-return-queue__delivery eco-return-queue__delivery--${customerReturnTab(current,currentSaved??undefined)}`}>
              <strong>{customerReturnStatus(currentSaved??undefined)}</strong>
              {currentSaved.deliveryAt && ` · ${formatServiceDateTime(currentSaved.deliveryAt)}`}
              {currentSaved.historyServiceDate && " · Отправка прошлого дня сохранена. Повтор по тому же обслуживанию заблокирован."}
              {currentSaved.deliveryError && ` · ${currentSaved.deliveryError}`}
              {currentSaved.deliveryConversationId && <> · <Link href={`/messages?conversationId=${encodeURIComponent(currentSaved.deliveryConversationId)}`}>Открыть диалог</Link></>}
              {["failed","unknown"].includes(currentSaved.deliveryStatus) && " · Перед повторными действиями проверьте историю в диалоге."}
            </p>}
            {current.reasons.some(reason=>reason.needsReview) && <p className="eco-return-queue__notice">Есть неполная привязка документов, общие идентификаторы или противоречия пробега. Проверьте историю перед использованием черновика.</p>}
            <h4>{current.reasons.length?"Почему в подборке":"Сохранённый результат"}</h4>
            {!current.reasons.length && <p className="eco-return-queue__note">Клиент больше не соответствует сценариям. Текст и результат отправки сохранены; карточка клиента доступна в диалоге.</p>}
            <ul className="eco-return-queue__reasons">{current.reasons.map((reason, index) => <li key={`${reason.scenario}:${index}`}>
              <strong>{RETURN_SCENARIO_LABELS[reason.scenario]} · {reason.vehicle}</strong>
              <p>{reason.explanation}</p>
              <p>{reason.scenario === "single_visit" ? "Визит" : "Последняя замена масла"}: {formatServiceDate(reason.lastVisit)} · {reason.confidence === "estimate" ? "Оценка по истории, не измеренный пробег" : "По записанным датам"}</p>
              <details><summary>Документы основания ({reason.documentIds.length})</summary><div className="eco-return-queue__documents">{reason.documentIds.map(id => <Link key={id} href={`/shipment/${encodeURIComponent(id)}`}>Открыть документ {id}</Link>)}</div></details>
            </li>)}</ul>
            {current.offers && <section aria-label="Расчёт предложения">
              <h4>{current.offerReady ? "Предложение рассчитано" : "Предложение требует проверки"}</h4>
              {current.offers.map((offer,index)=><div key={`${offer.vehicle}:${index}`}>
                <p><strong>{offer.vehicle}</strong>{offer.sourceDate ? ` · состав от ${formatServiceDate(offer.sourceDate)}` : ""}</p>
                {offer.materialsOwner==="customer" && <p>Обслуживание с маслом клиента. Масло не включено в предложение; применяется отдельный тариф работы.</p>}
                <ul className="eco-return-queue__reasons">{offer.lines.map(line=><li key={line.productId}>
                  <strong>{line.name}</strong>{line.selectionBasis && <p>{line.replaces ? `Вместо: ${line.replaces}. ` : ""}{line.selectionBasis}</p>}<p>{line.quantity} {line.unit} × {returnMoney(line.priceCents)} = {returnMoney(line.sumCents)} · {line.stockPolicy==="always_available"?"универсальное кольцо: складской остаток не ограничивает предложение":`доступно ${line.available} ${line.unit}`}</p>
                </li>)}</ul>
                <p>Работа: {offer.laborCents==null ? "тариф не подтверждён" : offer.laborCents===0 ? "включена" : returnMoney(offer.laborCents)}. {offer.laborBasis}</p>
                {offer.totalCents!=null && <p><strong>Итого с работой: {returnMoney(offer.totalCents)}</strong></p>}
                {!!offer.issues.length && <ul className="eco-return-queue__notice">{offer.issues.map(issue=><li key={issue}>{issue}</li>)}</ul>}
              </div>)}
              <p className="eco-return-queue__note">Наличие и цены — на момент расчёта. Объём покупки взят из прошлого обслуживания; изменения фасовок масла и замены фильтров отмечены отдельно. Объём покупки не означает фактически залитый объём. Перед использованием обновите подборку.</p>
            </section>}
            {currentSaved?.deliveryStatus==="none" && currentSaved.deliveryError && <p role="alert" className="eco-return-queue__notice">{currentSaved.deliveryError}</p>}
            <label className="eco-return-queue__draft-label" htmlFor="return-message-draft">{deliveryLocked?"Текст сообщения для Telegram":"Черновик сообщения для Telegram"}</label>
            <p className="eco-return-queue__note">{deliveryLocked?"Сохранённый текст доступен для просмотра и копирования.":"Причина обращения, комплект по истории и текущий расчёт. Текст можно изменить и сохранить для коллег."}</p>
            {currentSaved && <p className="eco-return-queue__note">{deliveryLocked?"Отправку запустил":"Последняя общая правка"}: {currentSaved.updatedByName || currentSaved.updatedByLogin || "Постановка в очередь"} · {formatServiceDateTime(currentSaved.updatedAt)} · версия {version}</p>}
            {staleDraft && <p className="eco-return-queue__notice">{deliveryLocked?"Текущий расчёт изменился. Ниже сохранён текст, переданный на отправку.":"История, предложение или шаблон изменились после сохранения. Общий текст сохранён; проверьте товары, цены и наличие или подставьте исходный шаблон."}</p>}
            {canImport && <p className="eco-return-queue__notice">В этом браузере есть прежние локальные правки. <button type="button" className="eco-btn" disabled={!shared.loaded || !!shared.error || currentBusy || !!currentEdit || deliveryLocked} onClick={()=>void importLegacy()}>Перенести в общую подборку</button></p>}
            {conflict && <div role="alert" className="eco-return-queue__notice"><p>Коллега изменил эту запись. Ваш текст остался в поле. Общий текст сейчас:</p><pre className="eco-return-queue__conflict-text">{currentSaved?.draftText ?? current.draft}</pre><button type="button" className="eco-btn" disabled={currentBusy} onClick={()=>clearEdit(current.id)}>Загрузить общий текст</button></div>}
            {!deliveryLocked && (current.bookingUrl ? <label className="eco-return-queue__booking-toggle"><input type="checkbox" checked={draft.includes(current.bookingUrl)} disabled={!shared.loaded || currentBusy || deliveryLocked} onChange={e=>{
              const url=current.bookingUrl!;
              const text=withCustomerReturnBookingLink(draft,url,e.target.checked);
              setEdits({...edits,[current.id]:{text,baseVersion:currentEdit?.baseVersion??version}});
            }}/> Добавить ссылку на самостоятельную запись в этот филиал</label> : <p className="eco-return-queue__note">Ссылка на запись не добавлена: проверьте, включена ли онлайн-запись филиала и настроен ли публичный адрес приложения.</p>)}
            <textarea id="return-message-draft" readOnly={deliveryLocked} disabled={!shared.loaded || currentBusy} rows={8} value={draft} maxLength={10000} onChange={e => setEdits({...edits,[current.id]:{text:e.target.value,baseVersion:currentEdit?.baseVersion??version}})} />
            {currentEdit && <p role="status" className="eco-return-queue__note">Есть несохранённые правки. До сохранения коллеги видят общий текст.</p>}
            <p className="eco-return-queue__note">Кнопка отправит этот текст клиенту через подключённый Telegram филиала и сохранит результат для коллег. Лимит — 4096 символов; сейчас {draft.length}. {staleDraft?"Сохранённый текст устарел: подставьте актуальный шаблон или проверьте и сохраните правки.":""}</p>
            <div className="eco-return-queue__actions">
              {!deliveryLocked && <><button type="button" className="eco-btn eco-btn--primary" disabled={!shared.loaded || !!shared.error || currentBusy || deliveryLocked || current.offerReady!==true || (!current.phone&&!current.counterpartyId) || !!currentSaved?.skipped || conflict || (staleDraft&&!currentEdit) || !draft.trim() || draft.length>4096} onClick={()=>void sendDraft()}><Send size={15}/>{currentBusy?"Обрабатываем…":deliveryLocked?(currentSaved?.deliveryStatus==="sent"?"Отправлено":"Повторная отправка заблокирована"):"Отправить в Telegram"}</button>
              <button type="button" className="eco-btn" disabled={!shared.loaded || !!shared.error || currentBusy || !currentEdit || deliveryLocked} onClick={()=>void saveDraft(conflict)}>{currentBusy?"Сохраняем…":conflict?"Сохранить мой вариант поверх общей версии":"Сохранить общий черновик"}</button></>}
              <button type="button" className="eco-btn" disabled={!draft.trim() || (!deliveryLocked && (current.offerReady===false || (staleDraft&&!currentEdit)))} onClick={() => void copyDraft()}><Copy size={15} /> Скопировать черновик</button>
              {!deliveryLocked && <><button type="button" className="eco-btn" disabled={currentBusy || !shared.loaded || deliveryLocked} onClick={() => setEdits({...edits,[current.id]:{text:current.draft,baseVersion:version}})}>Подставить исходный шаблон</button>
              {currentEdit && <button type="button" className="eco-btn" disabled={currentBusy} onClick={()=>clearEdit(current.id)}>Отменить мои правки</button>}
              <button type="button" className="eco-btn" disabled={!shared.loaded || !!shared.error || currentBusy || !!currentEdit || deliveryLocked} title={currentEdit?"Сначала сохраните или отмените текст":undefined} onClick={()=>void toggleSkipped()}>{currentSaved?.skipped ? "Вернуть в подборку" : "Пропустить сегодня"}</button></>}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
