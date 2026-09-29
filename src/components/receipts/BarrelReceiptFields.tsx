"use client";
import { EcoButton } from "@/components/platform/EcoUI";
import type { BarrelReceiptInput } from "@/lib/bulk-oil-barrels";

export default function BarrelReceiptFields({ barrels, readOnly, onChange }: { barrels: BarrelReceiptInput[]; readOnly: boolean; onChange: (barrels: BarrelReceiptInput[]) => void }) {
  return <div className="eco-barrel-receipt-fields">
    <strong>Бочки · количество и цена за литр</strong>
    {barrels.map((barrel, index) => <div key={index} className="eco-barrel-receipt-row">
      <label>Код бочки {index + 1}<textarea rows={2} aria-label={`Код маркировки бочки ${index + 1}`} value={barrel.markingCode} disabled={readOnly} placeholder="Отсканируйте DataMatrix" onChange={(e) => onChange(barrels.map((b, i) => i === index ? { ...b, markingCode: e.target.value } : b))} onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }} /></label>
      <label>Объём, л<input type="number" min="0.001" step="0.001" value={barrel.volumeLiters || ""} disabled={readOnly} onChange={(e) => onChange(barrels.map((b, i) => i === index ? { ...b, volumeLiters: Number(e.target.value) } : b))} /></label>
      {!readOnly && <EcoButton size="sm" type="button" aria-label={`Убрать бочку ${index + 1}`} onClick={() => onChange(barrels.filter((_, i) => i !== index))}>Убрать</EcoButton>}
    </div>)}
    {!readOnly && <EcoButton size="sm" type="button" onClick={() => onChange([...barrels, { markingCode: "", volumeLiters: barrels.at(-1)?.volumeLiters || 208 }])}>Добавить бочку</EcoButton>}
    <small>При проведении каждая бочка поступит запечатанной. Начало разлива — в карточке товара.</small>
  </div>;
}
