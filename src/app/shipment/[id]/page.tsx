"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";

type Meta = { href: string; type: string; mediaType: string };

type Header = {
  id: string;
  name: string;
  moment: string;
  applicable: boolean;
  description: string;
  sum: number;
  href?: string;
  agentName: string;
  organizationName: string;
  storeName: string;
  storeId?: string;
  ecoUserName?: string;
};

type Position = {
  id?: string;
  name: string;
  quantity: number;
  price: number;
  assortmentMeta?: Meta;
  slotName?: string;
  stock?: {
    cost?: number;
    quantity?: number;
    reserve?: number;
    intransit?: number;
    available?: number;
  };
  discount?: number; // %
  discountMode?: "percent" | "amount";
  discountAmount?: number; // ₽ по строке
};

type DemandAttribute = {
  id?: string;
  name?: string;
  type?: string;
  meta?: Meta;
  value?: unknown;
};

type DetailResponse = {
  header: Header;
  attributes: DemandAttribute[];
  positions: Position[];
  raw?: unknown;
  rawPositions?: unknown;
};

function getStockToneClass(value?: number): string {
  const qty = Math.max(0, Math.floor(value ?? 0));
  if (qty <= 0) return "text-red-600 dark:text-red-400";
  if (qty <= 2) return "text-amber-600 dark:text-amber-400";
  return "text-emerald-600 dark:text-emerald-400";
}

export default function ShipmentDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [data, setData] = useState<DetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [paying, setPaying] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [paymentInfo, setPaymentInfo] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [applicable, setApplicable] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [attributes, setAttributes] = useState<DemandAttribute[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [vin, setVin] = useState("");
  const [printTemplate, setPrintTemplate] = useState<"default" | "birka_own" | "birka_box" | "job_order">("default");
  const [productSearch, setProductSearch] = useState("");
  const [productOem, setProductOem] = useState("");
  const [productMannName, setProductMannName] = useState("");
  const [productParams, setProductParams] = useState("");
  const [productOptions, setProductOptions] = useState<
    {
      id: string;
      name: string;
      price: number;
      currency: string;
      meta: Meta;
      cell?: string;
      stockQuantity?: number;
      reserveQuantity?: number;
      availableQuantity?: number;
      slotName?: string;
    }[]
  >([]);
  const [productSearchLoading, setProductSearchLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const sess = await fetch("/api/auth/session").then((r) => r.json());
        if (!sess?.user) {
          router.push(`/login?from=/shipment/${id}`);
          return;
        }
        if (sess.user.role === "admin" || sess.user.role === "master") {
          const shift = await fetch("/api/shifts/current").then((r) => (r.ok ? r.json() : null));
          if (!shift) {
            router.push(sess.user.role === "admin" ? "/cash?needShift=1" : "/?needShift=1");
            return;
          }
          if (sess.user.role === "admin") {
            const cash = await fetch("/api/cash").then((r) => (r.ok ? r.json() : null));
            if (!cash?.shift) {
              router.push("/cash?needShift=1");
              return;
            }
          }
        }
        const res = await fetch(`/api/demands/${id}`);
        const json = await res.json();
        if (!res.ok) {
          setError(json.error ?? "Ошибка загрузки отгрузки");
          return;
        }
        if (cancelled) return;
        setData(json);
        setDescription(json.header.description ?? "");
        setApplicable(Boolean(json.header.applicable));
        const atts = Array.isArray(json.attributes) ? (json.attributes as DemandAttribute[]) : [];
        setAttributes(atts);
        // VIN из доп. полей (по имени атрибута, содержащему "vin")
        const vinIndex = atts.findIndex(
          (a) => typeof a?.name === "string" && /vin/i.test(a.name)
        );
        if (vinIndex >= 0) {
          const v = atts[vinIndex]?.value;
          setVin(typeof v === "string" ? v : v != null ? String(v) : "");
        } else {
          setVin("");
        }
        setPositions(
          (json.positions ?? []).map((p: Position) => {
            const priceRub = (p.price || 0) / 100;
            const discount = typeof p.discount === "number" ? p.discount : 0;
            const lineBase = (p.quantity || 0) * priceRub;
            const discountAmount = lineBase * (discount / 100);
            return {
              ...p,
              price: priceRub,
              discount,
              discountMode: "percent",
              discountAmount,
            };
          })
        );
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Ошибка сети");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    if (id) load();
    return () => {
      cancelled = true;
    };
  }, [id, router]);

  useEffect(() => {
    const hasQuery = [productSearch.trim(), productOem.trim(), productMannName.trim(), productParams.trim()].some(Boolean);
    if (!hasQuery) {
      setProductOptions([]);
      return;
    }
    const t = setTimeout(() => {
      setProductSearchLoading(true);
      const params = new URLSearchParams();
      if (productSearch.trim()) params.set("search", productSearch.trim());
      if (productOem.trim()) params.set("oem", productOem.trim());
      if (productMannName.trim()) params.set("mannName", productMannName.trim());
      if (productParams.trim()) params.set("params", productParams.trim());
      if (data?.header.storeId) params.set("storeId", data.header.storeId);
      if (data?.header.storeName) params.set("storeName", data.header.storeName);
      params.set("limit", "15");
      fetch(`/api/moysklad/products?${params.toString()}`)
        .then((r) => r.json())
        .then((data) => {
          if (data.products) setProductOptions(data.products);
        })
        .finally(() => setProductSearchLoading(false));
    }, 300);
    return () => clearTimeout(t);
  }, [productSearch, productOem, productMannName, productParams, data?.header.storeId, data?.header.storeName]);

  async function saveShipment(): Promise<boolean> {
    setSaving(true);
    setError(null);
    setPaymentInfo(null);
    try {
      const res = await fetch(`/api/demands/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description,
          applicable,
          attributes,
          positions: positions.map((p) => ({
            id: p.id,
            quantity: p.quantity,
            // обратно в копейки для API МойСклад
            price: Math.round((p.price || 0) * 100),
            discount: typeof p.discount === "number" ? p.discount : 0,
            assortment: p.assortmentMeta ? { meta: p.assortmentMeta } : undefined,
          })),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Ошибка сохранения");
        return false;
      }
      setData((prev) =>
        prev
          ? {
              ...prev,
              header: {
                ...prev.header,
                description: json.description,
                applicable: json.applicable,
              },
            }
          : prev
      );
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сети");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handleSave() {
    await saveShipment();
  }

  async function handlePayment() {
    setPaying(true);
    setError(null);
    setPaymentInfo(null);
    try {
      const saved = await saveShipment();
      if (!saved) return;

      const res = await fetch(`/api/demands/${id}/payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Не удалось отправить заказ в AQSI");
        return;
      }

      setPaymentInfo(
        json.status
          ? `Заказ отправлен в AQSI. Статус: ${json.status}.`
          : "Заказ отправлен в AQSI и доступен в разделе отложенных заказов."
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка отправки в AQSI");
    } finally {
      setPaying(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-10">
        <p className="text-sm text-zinc-500">Загрузка отгрузки…</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-10">
        <p className="text-sm text-red-600 dark:text-red-400">{error ?? "Отгрузка не найдена"}</p>
        <p className="mt-2">
          <Link href="/shipment" className="text-sm text-amber-600 hover:underline dark:text-amber-400">
            ← К списку отгрузок
          </Link>
        </p>
      </div>
    );
  }

  const vinAttrIndex = attributes.findIndex(
    (a) => typeof a?.name === "string" && /vin/i.test(a.name)
  );

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-4 flex items-center gap-3">
        <Link href="/shipment" className="text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
          ← Отгрузки
        </Link>
        <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">Отгрузка {data.header.name}</h1>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <div>
          <span className="text-xs text-zinc-500">Дата</span>
          <div className="text-sm">{data.header.moment}</div>
        </div>
        <div>
          <span className="text-xs text-zinc-500">Контрагент</span>
          <div className="text-sm">{data.header.agentName || "—"}</div>
        </div>
        <div>
          <span className="text-xs text-zinc-500">Организация</span>
          <div className="text-sm">{data.header.organizationName || "—"}</div>
        </div>
        <div>
          <span className="text-xs text-zinc-500">Склад</span>
          <div className="text-sm">{data.header.storeName || "—"}</div>
        </div>
        <div>
          <span className="text-xs text-zinc-500">Создал (эко)</span>
          <div className="text-sm">
            {data.header.ecoUserName && data.header.ecoUserName.trim()
              ? data.header.ecoUserName
              : "Не указано (создано напрямую в МойСклад или до внедрения эко-пользователей)"}
          </div>
        </div>
      </div>

      {vinAttrIndex >= 0 && (
        <div className="mb-6 rounded-xl border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-700 dark:bg-zinc-800">
          <h2 className="mb-3 text-sm font-semibold text-zinc-800 dark:text-zinc-100">
            VIN номер
          </h2>
          <input
            type="text"
            value={vin}
            onChange={(e) => {
              const v = e.target.value;
              setVin(v);
              if (vinAttrIndex >= 0) {
                const next = [...attributes];
                next[vinAttrIndex] = { ...next[vinAttrIndex], value: v };
                setAttributes(next);
              }
            }}
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-mono tracking-widest dark:border-zinc-600 dark:bg-zinc-900"
            placeholder="Например: WBAXXXXX5JZ123456"
          />
        </div>
      )}

      {attributes.length > 0 && (
        <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-700 dark:bg-zinc-800">
          <h2 className="mb-3 text-sm font-semibold text-zinc-800 dark:text-zinc-100">
            Дополнительные поля МойСклад
          </h2>
          <dl className="grid gap-2 sm:grid-cols-2">
            {attributes
              .map((a, index) => ({ a, index }))
              .filter(({ a }) => {
                const name = (a.name ?? "").toString().toLowerCase();
                return (
                  name === "vin номер".toLowerCase() ||
                  name === "модель авто".toLowerCase() ||
                  name === "год".toLowerCase() ||
                  name === "гос. номер".toLowerCase() ||
                  name === "пробег".toLowerCase()
                );
              })
              .map(({ a, index }) => (
                <div key={a.id ?? a.name ?? index}>
                  <dt className="text-xs text-zinc-500">{a.name ?? a.id}</dt>
                  <dd className="mt-0.5">
                    <input
                      type="text"
                      value={
                        typeof a.value === "object"
                          ? JSON.stringify(a.value)
                          : String(a.value ?? "")
                      }
                      onChange={(e) => {
                        const next = [...attributes];
                        next[index] = { ...a, value: e.target.value };
                        setAttributes(next);
                      }}
                      className="w-full rounded border border-zinc-300 bg-white px-2 py-1 text-xs font-mono dark:border-zinc-600 dark:bg-zinc-900"
                    />
                  </dd>
                </div>
              ))}
          </dl>
        </div>
      )}

      <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-700 dark:bg-zinc-800">
        <h2 className="mb-3 text-sm font-semibold text-zinc-800 dark:text-zinc-100">
          Добавить позицию
        </h2>
        <div className="space-y-2">
          <div>
            <label className="block text-xs text-zinc-500">Наименование, код или артикул</label>
            <input
              type="text"
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
              placeholder="Поиск по названию или артикулу..."
              className="mt-0.5 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-600 dark:bg-zinc-900"
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <div>
              <label className="block text-xs text-zinc-500">OEM PARTS</label>
              <input
                type="text"
                value={productOem}
                onChange={(e) => setProductOem(e.target.value)}
                placeholder="Фильтр по OEM"
                className="mt-0.5 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-600 dark:bg-zinc-900"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-500">Наименование по Mann</label>
              <input
                type="text"
                value={productMannName}
                onChange={(e) => setProductMannName(e.target.value)}
                placeholder="Фильтр по Mann"
                className="mt-0.5 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-600 dark:bg-zinc-900"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-500">Параметры</label>
              <input
                type="text"
                value={productParams}
                onChange={(e) => setProductParams(e.target.value)}
                placeholder="Фильтр по параметрам"
                className="mt-0.5 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-600 dark:bg-zinc-900"
              />
            </div>
          </div>
        </div>
        {(productSearch.trim() || productOem.trim() || productMannName.trim() || productParams.trim()) && (
            <div className="mt-2 max-h-48 overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
              {!productSearchLoading && productOptions.length > 0 && (
                <div className="flex items-center justify-between gap-2 border-b border-zinc-200 px-3 py-1.5 text-xs text-zinc-500 dark:border-zinc-600">
                  <span className="flex-1">Товар</span>
                  <span className="w-14 text-right">Доступно</span>
                  <span className="w-12 text-right">Ячейка</span>
                  <span className="shrink-0">Цена</span>
                </div>
              )}
            <ul>
              {productSearchLoading && (
                <li className="px-3 py-2 text-sm text-zinc-500">Загрузка…</li>
              )}
              {!productSearchLoading &&
                productOptions.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      onClick={() => {
                        setPositions((prev) => [
                          ...prev,
                          {
                            id: undefined,
                            name: p.name,
                            quantity: 1,
                            price: p.price,
                            discount: 0,
                            discountMode: "percent",
                            discountAmount: 0,
                            assortmentMeta: p.meta,
                            slotName: p.slotName,
                          },
                        ]);
                        setProductSearch("");
                        setProductOem("");
                        setProductMannName("");
                        setProductParams("");
                        setProductOptions([]);
                      }}
                    >
                      <span className="min-w-0 flex-1 truncate">{p.name}</span>
                      <span className={`shrink-0 w-14 text-right tabular-nums ${getStockToneClass(p.availableQuantity ?? p.stockQuantity)}`}>
                        {p.availableQuantity ?? p.stockQuantity ?? 0}
                      </span>
                      <span className="shrink-0 w-12 text-right text-zinc-500 tabular-nums">
                        {p.cell ?? p.slotName ?? ""}
                      </span>
                      <span className="text-zinc-500">
                        {p.price.toFixed(2)} {p.currency}
                      </span>
                    </button>
                </li>
              ))}
            </ul>
            </div>
        )}
      </div>

      {positions.length > 0 && (
        <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-700 dark:bg-zinc-800">
          <h2 className="mb-3 text-sm font-semibold text-zinc-800 dark:text-zinc-100">
            Позиции
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left dark:border-zinc-700">
                  <th className="px-2 py-2 font-medium text-zinc-500">Товар</th>
                  <th className="px-2 py-2 font-medium text-zinc-500">Ячейка</th>
                  <th className="px-2 py-2 text-right font-medium text-zinc-500">Остаток</th>
                  <th className="px-2 py-2 text-right font-medium text-zinc-500">Резерв</th>
                  <th className="px-2 py-2 text-right font-medium text-zinc-500">Доступно</th>
                  <th className="px-2 py-2 text-right font-medium text-zinc-500">Скидка</th>
                  <th className="px-2 py-2 text-right font-medium text-zinc-500">Кол-во</th>
                  <th className="px-2 py-2 text-right font-medium text-zinc-500">Цена, ₽</th>
                  <th className="px-2 py-2 text-right font-medium text-zinc-500">Сумма, ₽</th>
                  <th className="px-2 py-2 text-right font-medium text-zinc-500">Действия</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((p, index) => (
                  <tr
                    key={p.id ?? `new-${index}`}
                    className="border-b border-zinc-100 dark:border-zinc-700"
                  >
                    <td className="px-2 py-2">{p.name}</td>
                    <td className="px-2 py-2">{p.slotName ?? ""}</td>
                    <td className="px-2 py-2 text-right">
                      {p.stock?.quantity ?? ""}
                    </td>
                    <td className="px-2 py-2 text-right">
                      {p.stock?.reserve ?? ""}
                    </td>
                    <td className="px-2 py-2 text-right">
                      {p.stock?.available ?? ""}
                    </td>
                    <td className="px-2 py-2 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <select
                          value={p.discountMode ?? "percent"}
                          onChange={(e) => {
                            const mode = e.target.value as "percent" | "amount";
                            const next = [...positions];
                            next[index] = { ...p, discountMode: mode };
                            setPositions(next);
                          }}
                          className="rounded border border-zinc-300 bg-white px-1 py-0.5 text-xs dark:border-zinc-600 dark:bg-zinc-900"
                        >
                          <option value="percent">%</option>
                          <option value="amount">₽</option>
                        </select>
                        {p.discountMode === "amount" ? (
                          <input
                            type="number"
                            min={0}
                            step={0.01}
                            value={p.discountAmount ?? 0}
                            onChange={(e) => {
                              const val = Number(e.target.value) || 0;
                              const lineBase = (p.quantity || 0) * (p.price || 0);
                              const percent =
                                lineBase > 0 ? Math.min(100, (val / lineBase) * 100) : 0;
                              const next = [...positions];
                              next[index] = {
                                ...p,
                                discountMode: "amount",
                                discountAmount: val,
                                discount: percent,
                              };
                              setPositions(next);
                            }}
                            className="w-20 rounded border border-zinc-300 bg-white px-2 py-1 text-right text-xs dark:border-zinc-600 dark:bg-zinc-900"
                          />
                        ) : (
                          <input
                            type="number"
                            min={0}
                            max={100}
                            step={0.1}
                            value={p.discount ?? 0}
                            onChange={(e) => {
                              const percent = Number(e.target.value) || 0;
                              const clamped = Math.max(0, Math.min(100, percent));
                              const lineBase = (p.quantity || 0) * (p.price || 0);
                              const amount = lineBase * (clamped / 100);
                              const next = [...positions];
                              next[index] = {
                                ...p,
                                discountMode: "percent",
                                discount: clamped,
                                discountAmount: amount,
                              };
                              setPositions(next);
                            }}
                            className="w-16 rounded border border-zinc-300 bg-white px-2 py-1 text-right text-xs dark:border-zinc-600 dark:bg-zinc-900"
                          />
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-2 text-right">
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={p.quantity}
                        onChange={(e) => {
                          const q = Number(e.target.value) || 0;
                          const next = [...positions];
                          next[index] = { ...p, quantity: q };
                          setPositions(next);
                        }}
                        className="w-20 rounded border border-zinc-300 bg-white px-2 py-1 text-right text-xs dark:border-zinc-600 dark:bg-zinc-900"
                      />
                    </td>
                    <td className="px-2 py-2 text-right">
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        value={p.price}
                        onChange={(e) => {
                          const val = Number(e.target.value) || 0;
                          const next = [...positions];
                          next[index] = { ...p, price: val };
                          setPositions(next);
                        }}
                        className="w-24 rounded border border-zinc-300 bg-white px-2 py-1 text-right text-xs dark:border-zinc-600 dark:bg-zinc-900"
                      />
                    </td>
                    <td className="px-2 py-2 text-right">
                      {(p.quantity *
                        (p.price || 0) *
                        (1 - (typeof p.discount === "number" ? p.discount : 0) / 100)
                      ).toLocaleString("ru-RU", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </td>
                    <td className="px-2 py-2 text-right">
                      <button
                        type="button"
                        onClick={() =>
                          setPositions((prev) =>
                            prev.filter((_, i) => i !== index)
                          )
                        }
                        className="text-xs text-red-600 hover:underline dark:text-red-400"
                      >
                        Удалить
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex justify-end text-sm text-zinc-700 dark:text-zinc-200">
            {(() => {
              const totalQty = positions.reduce((sum, p) => sum + (p.quantity || 0), 0);
              const totalSum = positions.reduce((sum, p) => {
                const base = (p.quantity || 0) * (p.price || 0);
                const disc = typeof p.discount === "number" ? p.discount : 0;
                return sum + base * (1 - disc / 100);
              }, 0);
              return (
                <div className="text-right">
                  <div>Кол-во всего: {totalQty}</div>
                  <div>
                    Сумма всего:{" "}
                    {totalSum.toLocaleString("ru-RU", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{" "}
                    ₽
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      <div className="mt-6 space-y-4 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-800">
        <div>
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Комментарий
          </label>
          <textarea
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-900"
          />
        </div>
        <div className="flex items-center gap-2">
          <input
            id="applicable"
            type="checkbox"
            checked={applicable}
            onChange={(e) => setApplicable(e.target.checked)}
            className="h-4 w-4 rounded border-zinc-300 text-amber-600 focus:ring-amber-500"
          />
          <label htmlFor="applicable" className="text-sm text-zinc-700 dark:text-zinc-300">
            Проведён (applicable)
          </label>
        </div>
        {error && (
          <p className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        {paymentInfo && (
          <p className="text-sm text-emerald-600 dark:text-emerald-400">
            {paymentInfo}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || printing || paying}
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 hover:bg-amber-600 dark:bg-amber-600 dark:hover:bg-amber-700"
          >
            {saving ? "Сохранение…" : "Сохранить"}
          </button>
          <button
            type="button"
            onClick={handlePayment}
            disabled={saving || printing || paying}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-700"
          >
            {paying ? "Отправка в AQSI…" : "Оплата"}
          </button>
          <div className="flex items-center gap-2">
            <label className="text-xs text-zinc-500">Шаблон</label>
            <select
              value={printTemplate}
              onChange={(e) =>
                setPrintTemplate(e.target.value as "default" | "birka_own" | "birka_box" | "job_order")
              }
              className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-900"
            >
              <option value="default">Основной (Заказ-наряд)</option>
              <option value="birka_own">Бирка со своим</option>
              <option value="birka_box">Бирка коробка</option>
              <option value="job_order">Заказ-наряд (отдельно)</option>
            </select>
          </div>
          <button
            type="button"
            onClick={async () => {
              setPrinting(true);
              setError(null);
              try {
                const res = await fetch(`/api/demands/${data.header.id}/print`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ templateKey: printTemplate }),
                });
                const json = await res.json();
                if (!res.ok) {
                  setError(json.error ?? "Ошибка печати");
                  return;
                }
                if (json.location) {
                  window.open(json.location, "_blank");
                } else {
                  setError("МойСклад не вернул ссылку на файл печати.");
                }
              } catch (e) {
                setError(e instanceof Error ? e.message : "Ошибка печати");
              } finally {
                setPrinting(false);
              }
            }}
            disabled={printing || saving || paying}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            {printing ? "Печать…" : "Печать"}
          </button>
          {data.header.href && (
            <a
              href={data.header.href}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-zinc-600 underline-offset-4 hover:underline dark:text-zinc-300"
            >
              Открыть в МойСклад →
            </a>
          )}
        </div>
      </div>

      {data.raw ? (
        <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-700 dark:bg-zinc-800">
          <button
            type="button"
            onClick={() => setShowRaw((v) => !v)}
            className="mb-3 text-sm font-medium text-zinc-700 hover:underline dark:text-zinc-200"
          >
            {showRaw ? "Скрыть все поля МойСклад" : "Показать все поля МойСклад (JSON)"}
          </button>
          {showRaw && (
            <div className="max-h-96 overflow-auto rounded border border-zinc-200 bg-zinc-50 p-2 text-xs font-mono text-zinc-800 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100">
              <pre>{JSON.stringify(data.raw, null, 2)}</pre>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

