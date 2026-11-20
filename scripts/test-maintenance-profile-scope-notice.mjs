import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { createJiti } from 'jiti';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const j = createJiti(import.meta.url, { jsx: { runtime: 'automatic' }, alias: {
  '@': resolve('src'), './VehicleLookupCandidates.module.css': resolve('scripts/fixtures/css-module-mock.mjs'),
} });
const { TechnicalProfile, FluidResearchResults } = await j.import('../src/components/shipment/VehicleLookupPanel.tsx');
const notice = 'Сохранённые исследования другой комплектации не применены. Уточните условия автомобиля.';
const props = { profile: { status: 'none', items: [], transmissionOptions: [], containsCatalogPreview: false, notice },
  loading: false, error: '', selectedTransmissionModel: '', selectedTransmissionGearCount: undefined, confirmedEquipment: [],
  onSelectEquipment() {}, onSelectTransmission() {}, onSelectTransmissionModel() {}, onSelectTransmissionGearCount() {},
};
const html = renderToStaticMarkup(React.createElement(TechnicalProfile, props));
assert.ok(html.includes(notice), 'scope rejection reason must remain visible when no fluid survived applicability filtering');
assert.match(html, /role="status"/);
assert.doesNotMatch(html, /<article/);
const held = renderToStaticMarkup(React.createElement(FluidResearchResults, {
  result: { status: 'needs_context', items: [], message: 'Уточните комплектацию автомобиля.', unresolved: [notice] }, onRetry() {},
}));
assert.ok(held.includes(notice));
assert.match(held, /<details open/);
assert.doesNotMatch(held, /Повторить поиск|Повторить незавершённые/);
console.log('PASS real TechnicalProfile shows applicability rejection reason even without fluid cards');

const savedProfile = { ...props.profile, selectedTransmissionType: 'automatic',
  transmissionOptions: [{type:'automatic',label:'АКПП',systemCode:'AUTOMATIC_TRANSMISSION'}],
  savedVehicleConfirmation: {source:'saved_vehicle_passport',transmissionType:'automatic',confirmedAt:{transmissionType:'2026-11-20T09:00:00Z'},conflicts:[]},
};
const restored = renderToStaticMarkup(React.createElement(TechnicalProfile, {...props, profile:savedProfile}));
assert.match(restored,/Подтверждено в карточке автомобиля/);
assert.match(restored,/aria-pressed="true"/);
assert.doesNotMatch(restored,/Указано вручную/);
const manual = renderToStaticMarkup(React.createElement(TechnicalProfile,{...props,profile:{...savedProfile,selectedTransmissionType:'manual'}}));
assert.match(manual,/Указано вручную/);
console.log('PASS restored gearbox confirmation is visibly attributed to saved vehicle card');
