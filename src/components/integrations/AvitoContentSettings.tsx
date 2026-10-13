"use client";

import { useEffect, useRef, useState } from "react";
import { EcoButton, EcoSelect } from "@/components/platform/EcoUI";
import { AVITO_TEMPLATE_VARIABLES, avitoTemplateIssues } from "@/lib/avito-autoload/content";
import { buildAvitoListing } from "@/lib/avito-autoload/domain";
import type { AvitoOilType, AvitoProductSource, AvitoSettings, AvitoWorkspaceData } from "@/lib/avito-autoload/types";
import styles from "@/app/warehouse/avito/avito.module.css";

export default function AvitoContentSettings({ settings, busy, onChange }: { settings: AvitoSettings; busy: boolean; onChange: (patch: Partial<AvitoSettings>) => void }) {
  const [category, setCategory] = useState<"all" | AvitoOilType>("all");
  const [previewType, setPreviewType] = useState<AvitoOilType>("motor");
  const [phrases, setPhrases] = useState(settings.titleRemovePhrases.join("\n"));
  const [source, setSource] = useState<AvitoProductSource | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const titleInput = useRef<HTMLInputElement>(null);
  const descriptionInput = useRef<HTMLTextAreaElement>(null);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  const template = category === "all" ? settings.descriptionTemplate : settings.categoryDescriptionTemplates[category];
  const changeTemplate = (value: string) => onChange(category === "all" ? { descriptionTemplate: value } : { categoryDescriptionTemplates: { ...settings.categoryDescriptionTemplates, [category]: value } });
  const templateErrors = [...avitoTemplateIssues(settings.titleTemplate, true), ...avitoTemplateIssues(template)];
  const preview = source ? buildAvitoListing(source, {}, settings, "preview") : null;

  function insert(key: string, title = false) {
    const input = title ? titleInput.current : descriptionInput.current;
    const value = title ? settings.titleTemplate : template;
    const start = input?.selectionStart ?? value.length;
    const end = input?.selectionEnd ?? start;
    const token = `{${key}}`;
    const next = value.slice(0, start) + token + value.slice(end);
    if (title) onChange({ titleTemplate: next }); else changeTemplate(next);
    requestAnimationFrame(() => { input?.focus(); input?.setSelectionRange(start + token.length, start + token.length); });
  }

  function selectType(type: AvitoOilType) {
    pending.current?.abort(); setLoading(false); setPreviewType(type); setSource(null); setError("");
  }

  async function loadExample() {
    pending.current?.abort();
    const controller = new AbortController(); pending.current = controller;
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/avito-autoload?type=${previewType}`, { cache: "no-store", signal: controller.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Не удалось загрузить пример");
      const product = (data as AvitoWorkspaceData).products.find((item) => item.type === previewType && !item.archived);
      setSource(product?.source ?? null);
      if (!product) setError("В этой категории пока нет товаров. Шаблон можно сохранить заранее.");
    } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Не удалось загрузить пример"); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }

  return <fieldset disabled={busy}><legend>Заголовки и описания</legend>
    <p className={styles.help}>Правила применяются ко всем товарам этого филиала при подготовке файла. Отдельные правки в объявлении имеют приоритет.</p>
    <label className={styles.field}><span>Шаблон заголовка</span><input className="eco-input" ref={titleInput} required maxLength={500} value={settings.titleTemplate} onChange={(event) => onChange({ titleTemplate: event.target.value })} /><small>Например: {"{название}"} или {"{бренд} {вязкость} {объём}"}.</small></label>
    <div className={styles.variableButtons} aria-label="Переменные заголовка">{AVITO_TEMPLATE_VARIABLES.filter((item) => item.title).map((item) => <button type="button" key={item.key} onClick={() => insert(item.key, true)} title={`Вставить {${item.key}}`}>{item.label}</button>)}</div>
    <label className={styles.checkField}><input type="checkbox" checked={settings.autoShortenTitles} onChange={(event) => onChange({ autoShortenTitles: event.target.checked })} /><span><strong>Автоматически сокращать длинные заголовки до 50 символов</strong><small>Сначала убираем указанные фразы, затем сокращаем по границе слова. Короткие заголовки сохраняются.</small></span></label>
    {settings.autoShortenTitles && <label className={styles.field}><span>Фразы, которые можно убрать</span><textarea className="eco-input" rows={4} value={phrases} onChange={(event) => { setPhrases(event.target.value); onChange({ titleRemovePhrases: [...new Set(event.target.value.split("\n").map((line) => line.trim()).filter(Boolean))] }); }} /><small>Каждая фраза с новой строки. Регистр букв не учитывается.</small></label>}
    <label className={styles.field}><span>Описание для категории</span><EcoSelect value={category} onChange={(event) => { const next = event.target.value as "all" | AvitoOilType; setCategory(next); if (next !== "all") selectType(next); }}><option value="all">Общий шаблон для всех масел</option><option value="motor">Моторные масла</option><option value="transmission">Трансмиссионные масла</option></EcoSelect></label>
    <label className={styles.field}><span>{category === "all" ? "Общее описание Авито" : "Описание этой категории"}</span><textarea ref={descriptionInput} className="eco-input" rows={8} required={category === "all"} maxLength={7500} value={template} placeholder={category === "all" ? "{описание}" : "Оставьте пустым, чтобы использовать общий шаблон"} onChange={(event) => changeTemplate(event.target.value)} /><small>Напишите текст о сервисе, вставьте описание товара и добавьте адрес. Переменные заменятся для каждого товара. Итоговое описание — до 7 500 символов.</small></label>
    <div className={styles.variableButtons} aria-label="Переменные описания">{AVITO_TEMPLATE_VARIABLES.map((item) => <button type="button" key={item.key} onClick={() => insert(item.key)} title={`Вставить {${item.key}}`}>{item.label}</button>)}</div>
    <p className={styles.help}>{"{описание}"} — описание из карточки товара. Если оно пустое, используем характеристики масла. Для категории без собственного шаблона действует общий.</p>
    {templateErrors.map((message, index) => <p role="alert" className={styles.fieldError} key={index}>{message}</p>)}
    <div className={styles.templatePreview}>
      {category === "all" && settings.categoryDescriptionTemplates[previewType].trim() && <p className={styles.help}>Для выбранной категории заполнен собственный шаблон описания. В предпросмотре используется он.</p>}
      <div className={styles.templatePreviewHeader}><h3>Предпросмотр на товаре</h3><EcoSelect aria-label="Категория товара для предпросмотра" value={previewType} onChange={(event) => selectType(event.target.value as AvitoOilType)}><option value="motor">Моторные масла</option><option value="transmission">Трансмиссионные масла</option></EcoSelect><EcoButton size="sm" type="button" disabled={loading} onClick={() => void loadExample()}>{loading ? "Загружаем…" : "Выбрать пример из товаров"}</EcoButton></div>
      {error && <p role="status" className={styles.fieldError}>{error}</p>}
      {preview ? <><small className={styles.help}>Исходный товар: {source!.name}. Показываем результат шаблона без отдельных правок.</small><h4>{preview.values.title || "Заголовок пуст"}</h4><div className={styles.counter}>{[...preview.values.title].length} / 50 символов</div><div className={styles.descriptionPreview}>{preview.values.description}</div><div className={styles.counter}>{[...preview.values.description].length} / 7 500 символов</div>{preview.issues.filter((issue) => ["title", "description"].includes(issue.field)).map((issue, index) => <p className={issue.severity === "error" ? styles.fieldError : styles.help} key={index}>{issue.message}</p>)}</> : <p className={styles.help}>Загрузите товар, чтобы увидеть результат. Изменения шаблона сразу отобразятся здесь.</p>}
    </div>
  </fieldset>;
}
