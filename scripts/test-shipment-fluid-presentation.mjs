import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) },
  jsx: { runtime: "automatic" },
});
const { FluidResearchResults, TechnicalProfile } = await jiti.import("../src/components/shipment/VehicleLookupPanel.tsx");
const render = (component, props) => renderToStaticMarkup(React.createElement(component, props));
const research = (status, items = []) => ({ status, items, message: "Сохранено в БД: INTERNAL_MESSAGE" });
const item = { systemCode: "ENGINE_OIL", specification: "Spec A; Spec B", volumeText: "5 л с фильтром; 4,6 л без фильтра", sourceUrl: "https://example.com/manual", sourceTitle: "Owner’s manual" };
const pending = render(FluidResearchResults, { result: research("searching") });
assert.match(pending, /aria-busy="true"/);
assert.doesNotMatch(pending, /Нет данных|INTERNAL_MESSAGE/);
const saved = render(FluidResearchResults, { result: research("saved", [item]) });
assert.match(saved, /Требует проверки/);
assert.match(saved, /5 л с фильтром; 4,6 л без фильтра/);
assert.match(saved, /<details><summary>Источник<\/summary>/);
assert.doesNotMatch(saved, /<details open|INTERNAL_MESSAGE/);
const failure = render(FluidResearchResults, { result: research("unavailable"), onRetry() {} });
assert.match(failure, /Повторить поиск/);
assert.doesNotMatch(failure, /__spinner|__skeleton/);
assert.match(render(FluidResearchResults, { result: research("complete") }), /Раздатка/);
assert.equal((saved.match(/<th scope="row">/g)||[]).length,12);
assert.match(saved,/Передний редуктор/);assert.match(saved,/Не подтверждено/);assert.match(saved,/>—</);
const absent=render(FluidResearchResults,{result:{...research('saved'),systems:[{systemCode:'TRANSFER_CASE',applicability:'absent',reason:'Нет раздатки',sourceUrl:'https://example.com/manual',sourceTitle:'Manual'}]}});
assert.match(absent,/Не предусмотрен/);assert.match(absent,/Нет раздатки/);
const props = {
  loading: false, error: "", selectedTransmissionModel: "", selectedTransmissionGearCount: undefined,
  confirmedEquipment: [], onSelectEquipment() {}, onSelectTransmission() {}, onSelectTransmissionModel() {}, onSelectTransmissionGearCount() {},
};
const base = { status: "catalog_preview", items: [], transmissionOptions: [], containsCatalogPreview: true };
assert.doesNotMatch(render(TechnicalProfile, { ...props, profile: base, researchPendingOrFound: true }), /Нет данных/);
assert.match(render(TechnicalProfile, { ...props, profile: base }), /Нет данных/);
const profileItem = {
  revisionId: "test", systemCode: "ENGINE_OIL", systemLabel: "Моторное масло", capacities: [{ nominalLiters: 123.456, serviceContextLabel: "с фильтром" }],
  specifications: ["Spec A"], viscosityGrades: ["5W-30"], evidence: [], sourceStatus: "catalog_preview", requiresReview: true,
  userConfirmedTransmission: false, automaticSelectionEligible: false,
};
const blocked = render(TechnicalProfile, { ...props, profile: { ...base, items: [profileItem] } });
assert.match(blocked, /Объём требует проверки/);
assert.doesNotMatch(blocked, /123[.,]456/);
assert.match(blocked, /Требует проверки/);
const unblocked = render(TechnicalProfile, { ...props, profile: { ...base, items: [{ ...profileItem, requiresReview: false }] } });
assert.match(unblocked, /123,456 л · с фильтром/);
assert.match(unblocked, /Требует проверки/);
console.log("Shipment fluid presentation: loading, failure, source disclosure, empty states and capacity safety passed.");
