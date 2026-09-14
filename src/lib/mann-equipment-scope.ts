export const MANN_EQUIPMENT_CIRCUITS = {
  HYDRAULIC_STEERING: 'POWER_STEERING',
  TRANSFER_CASE: 'TRANSFER_CASE',
  FRONT_DIFFERENTIAL: 'FRONT_DIFFERENTIAL',
  REAR_DIFFERENTIAL: 'REAR_DIFFERENTIAL',
  ANGLE_GEAR: 'DIFFERENTIAL_GENERIC',
  AWD_COUPLING: 'AWD_COUPLING',
} as const;
export type MannEquipmentConfirmation = {
  circuit: keyof typeof MANN_EQUIPMENT_CIRCUITS;
  componentModel?: string;
  drive?: '2WD' | '4WD';
  attachedTransmissionType?: 'automatic' | 'manual' | 'cvt' | 'robot';
};
export const MANN_EXACT_EQUIPMENT_MODEL_POLICY = 'EXACT_SOURCE_EQUIPMENT_MODEL_V1';
export const MANN_EQUIPMENT_COMPONENT_DRIVE_POLICY = 'EXPLICIT_COMPONENT_DRIVE_CONDITION_V1';
export function mannEquipmentComponentDrives(value: unknown): ('2WD' | '4WD')[] | null {
  if(typeof value!=='string')return null;
  const text=value.trim().toUpperCase().replace(/\s+/g,' ');
  if(text==='ДЛЯ 2WD')return ['2WD'];
  if(text==='ДЛЯ 4WD')return ['4WD'];
  if(text==='ДЛЯ 2WD И 4WD')return ['2WD','4WD'];
  return null;
}
// Only a whole literal code. LSD, prose, aliases and lists need separate policies.
export function mannExactEquipmentModel(value: unknown): string | null {
  if(typeof value!=='string')return null;
  const model=value.trim().replace(/^(?:-|—)\s+/, '').toUpperCase();
  if(/^(?:2WD|4WD|4X4|4X2|\d{1,2}(?:AT|MT|DCT|CVT))$/.test(model))return null;
  return /^(?=[A-Z0-9-]*[A-Z])(?=[A-Z0-9-]*\d)[A-Z0-9]{2,16}$/.test(model)?model:null;
}
export function mannEquipmentChoiceKey(option?: MannEquipmentConfirmation): string {
  return option?`${option.circuit}:${option.drive??''}:${option.attachedTransmissionType??''}${option.componentModel?`:${option.componentModel}`:''}`:'';
}
export function readMannEquipmentScope(value: unknown): (MannEquipmentConfirmation & {systemCode:string}) | null {
  if(!value || typeof value!=='object' || Array.isArray(value))return null;
  const data=value as Record<string,unknown>;
  if(typeof data.circuit!=='string'||!Object.hasOwn(MANN_EQUIPMENT_CIRCUITS,data.circuit))return null;
  const circuit=data.circuit as MannEquipmentConfirmation['circuit'];
  if(data.systemCode!==MANN_EQUIPMENT_CIRCUITS[circuit])return null;
  if(data.drive!==undefined&&!['2WD','4WD'].includes(String(data.drive)))return null;
  if(data.attachedTransmissionType!==undefined&&!['automatic','manual','cvt','robot'].includes(String(data.attachedTransmissionType)))return null;
  if(data.componentModel!==undefined&&(mannExactEquipmentModel(data.componentModel)!==data.componentModel))return null;
  if(Object.keys(data).some(k=>!['systemCode','circuit','drive','attachedTransmissionType','componentModel'].includes(k)))return null;
  return data as MannEquipmentConfirmation & {systemCode:string};
}
export function mannEquipmentScopeMatches(scope: unknown, confirmations?: MannEquipmentConfirmation[]): boolean {
  const required=readMannEquipmentScope(scope);
  if(!required||!Array.isArray(confirmations))return false;
  const matching=confirmations.filter(c=>c&&c.circuit===required.circuit);
  // Contradictory/duplicate confirmations must not pick whichever passes first.
  if(matching.length!==1)return false;
  const actual=matching[0];
  if(!readMannEquipmentScope({...actual,systemCode:required.systemCode}))return false;
  return (required.drive===undefined||actual.drive===required.drive)&&
    (required.componentModel===undefined||actual.componentModel===required.componentModel)&&
    (required.attachedTransmissionType===undefined||actual.attachedTransmissionType===required.attachedTransmissionType);
}
