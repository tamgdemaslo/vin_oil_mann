"use client";
import BarrelCodeInput from "@/components/receipts/BarrelCodeInput";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { EcoButton } from "@/components/platform/EcoUI";
import type { ProductMarkingSettings } from "@/lib/product-marking";

type Barrel = { id: string; number: string; status: string; remainingLiters: number; receivedLiters: number; storeName: string; receivedAt: string };
type Data = { settings: ProductMarkingSettings; barrels: Barrel[] };
const statusName: Record<string, string> = { SEALED: "Запечатанная", OPEN: "В разливе", CLOSED: "Закрыта", CANCELLED: "Приёмка отменена" };
export default function BulkOilBarrelManager({ productId, stores, onChanged }: { productId: string; stores: { id: string; name: string }[]; onChanged: () => Promise<void> }) {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [storeId, setStoreId] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [scannedCode, setScannedCode] = useState("");
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [reason, setReason] = useState("");
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/local-inventory/products/${encodeURIComponent(productId)}/barrels`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Не удалось загрузить бочки.");
      setData(payload); setConfirmEmpty(false); setReason("");
    } catch (e) { setError(e instanceof Error ? e.message : "Не удалось загрузить бочки."); }
    finally { setLoading(false); }
  }, [productId]);
  useEffect(() => { void load(); }, [load]);
  async function submit(action: "enable" | "switch") {
    if (!data) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/local-inventory/products/${encodeURIComponent(productId)}/barrels`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, storeId,
        barrelId: scannedCode.trim() ? undefined : selectedId, scannedCode,
        expectedActiveId: data.settings.activeBarrelId, expectedRemainingLiters: data.settings.currentVolumeLiters,
        confirmEmpty, reason,
      }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Не удалось сменить бочку.");
      setData(payload); setSelectedId(""); setScannedCode(""); setReason(""); setConfirmEmpty(false);
      await onChanged();
      setNotice(action === "enable" ? "Отдельный учёт бочек включён. Складской остаток сохранён." : "Бочка подключена. Следующие продажи будут списываться из неё.");
    } catch (e) { setError(e instanceof Error ? e.message : "Не удалось сменить бочку."); }
    finally { setBusy(false); }
  }
  const active = data?.barrels.find((b) => b.status === "OPEN");
  const sealed = data?.barrels.filter((b) => b.status === "SEALED") ?? [];
  return <section className="eco-barrel-manager" aria-label="Учёт бочек" aria-busy={loading || busy}>
    <div className="eco-barrel-manager-heading"><h4>Бочки на складе</h4><EcoButton size="sm" type="button" disabled={busy || loading} onClick={() => void load()}>Обновить</EcoButton></div>
    {error && <p role="alert" className="product-editor-error">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {loading ? <p role="status">Загрузка бочек…</p> : data && <>
      {!data.settings.barrelTrackingEnabled ? <>
        <p>Включите отдельный учёт. Текущая бочка из карточки сохранится вместе с её кодом и остатком; новые бочки будут ждать начала разлива.</p>
        <label>Склад текущей бочки<select aria-label="Склад текущей бочки" value={storeId} disabled={busy} onChange={(e) => setStoreId(e.target.value)}><option value="">Выберите склад</option>{stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <EcoButton variant="primary" type="button" disabled={busy || !storeId} onClick={() => void submit("enable")}>Включить учёт бочек</EcoButton>
      </> : <>
        <p>{active ? <><b>В разливе: {active.number}</b> · {active.remainingLiters} л · {active.storeName}</> : "Разлив не начат. Выберите принятую бочку."}</p>
        {sealed.length ? <div className="eco-barrel-switch">
          <h5>{active ? "Сменить бочку" : "Начать разлив"}</h5>
          <label>Новая бочка<select aria-label="Новая бочка" value={selectedId} disabled={busy} onChange={(e) => { setSelectedId(e.target.value); setScannedCode(""); }}><option value="">Выберите принятую бочку</option>{sealed.map((b) => <option key={b.id} value={b.id}>{b.number} · {b.remainingLiters} л · {b.storeName}</option>)}</select></label>
          <label>Или отсканируйте код новой бочки<BarrelCodeInput label="Код новой бочки" value={scannedCode} disabled={busy} onCommit={setScannedCode} /></label>
          {active && active.remainingLiters > 0 && <>
            <p>В старой бочке числится <b>{active.remainingLiters} л</b>. Если она пустая, этот остаток будет списан отдельным документом и учтён как расход.</p>
            <label className="eco-barrel-checkbox"><input type="checkbox" checked={confirmEmpty} disabled={busy} onChange={(e) => setConfirmEmpty(e.target.checked)} />Старая бочка физически пустая</label>
            <label>Причина расхождения<textarea aria-label="Причина расхождения" rows={2} value={reason} disabled={busy} onChange={(e) => setReason(e.target.value)} placeholder="Например: остаток после проверки, потери при разливе" /></label>
          </>}
          <EcoButton type="button" variant="primary" disabled={busy || (!selectedId && !scannedCode.trim()) || Boolean(active && active.remainingLiters > 0 && (!confirmEmpty || !reason.trim()))} onClick={() => void submit("switch")}>{busy ? "Сохранение…" : active ? "Закрыть старую и подключить новую" : "Начать разлив"}</EcoButton>
        </div> : <p>Запечатанных бочек нет. <Link href="/inventory/receipts">Примите новую бочку на склад</Link> и отсканируйте её код в приёмке.</p>}
        <div className="eco-barrel-table-wrap"><table><caption>Все бочки этого товара</caption><thead><tr><th>Бочка / приёмка</th><th>Статус</th><th>Остаток</th><th>Склад</th></tr></thead><tbody>{data.barrels.map((b) => <tr key={b.id}><td>{b.number}<small>{new Date(b.receivedAt).toLocaleDateString("ru-RU")}</small></td><td>{statusName[b.status] ?? b.status}</td><td>{b.remainingLiters} / {b.receivedLiters} л</td><td>{b.storeName}</td></tr>)}</tbody></table></div>
      </>}
    </>}
  </section>;
}
