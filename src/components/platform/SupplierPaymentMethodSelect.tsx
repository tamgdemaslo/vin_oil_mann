import { EcoSelect } from "@/components/platform/EcoUI";

export function SupplierPaymentMethodSelect({
  value, onChange, disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <EcoSelect aria-label="Способ оплаты" value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} required>
      <option value="">Выберите способ оплаты</option>
      <option value="cash">Наличные</option>
      <option value="card">Карта</option>
      <option value="bank_transfer">Перевод</option>
    </EcoSelect>
  );
}
