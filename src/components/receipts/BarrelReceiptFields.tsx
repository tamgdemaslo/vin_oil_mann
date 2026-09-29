"use client";

import { Plus, Trash2 } from "lucide-react";
import { EcoButton } from "@/components/platform/EcoUI";
import BarrelCodeInput from "@/components/receipts/BarrelCodeInput";
import type { BarrelReceiptInput } from "@/lib/bulk-oil-barrels";

export default function BarrelReceiptFields({ barrels, readOnly, onChange }: {
  barrels: BarrelReceiptInput[]; readOnly: boolean; onChange: (barrels: BarrelReceiptInput[]) => void;
}) {
  return <div className="eco-barrel-receipt-fields">
    <div className="eco-barrel-receipt-heading">
      <strong>Бочки</strong>
      <span>{barrels.length} · {barrels.reduce((sum, b) => sum + (Number(b.volumeLiters) || 0), 0)} л</span>
      {!readOnly && <EcoButton variant="ghost" size="sm" type="button" onClick={() => onChange([...barrels, { markingCode: "", volumeLiters: barrels.at(-1)?.volumeLiters || 208 }])}><Plus size={14} />Добавить бочку</EcoButton>}
    </div>
    {barrels.map((barrel, index) => <div key={index} className="eco-barrel-receipt-row">
      <label className="eco-barrel-receipt-code">Бочка {index + 1} · DataMatrix
        <BarrelCodeInput value={barrel.markingCode} disabled={readOnly} label={`Код маркировки бочки ${index + 1}`}
          onCommit={(markingCode) => onChange(barrels.map((b, i) => i === index ? { ...b, markingCode } : b))} />
      </label>
      <label className="eco-barrel-receipt-volume">Объём, л<input aria-label={`Объём бочки ${index + 1}, л`} type="number" min="0.001" step="0.001" value={barrel.volumeLiters || ""} disabled={readOnly} onChange={(e) => onChange(barrels.map((b, i) => i === index ? { ...b, volumeLiters: Number(e.target.value) } : b))} /></label>
      {!readOnly && <EcoButton variant="ghost" size="sm" className="eco-barrel-receipt-remove" type="button" aria-label={`Убрать бочку ${index + 1}`} title={`Убрать бочку ${index + 1}`} onClick={() => onChange(barrels.filter((_, i) => i !== index))}><Trash2 size={16} /></EcoButton>}
    </div>)}
    <small>Количество и цены — за литр. После приёмки бочки запечатаны; начало разлива — в карточке товара.</small>
  </div>;
}
