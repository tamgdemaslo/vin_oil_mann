/** No inferred aliasing: a model list or prose is not one confirmed gearbox. */
export function mannExplicitTransmissionTypeCount(value: unknown): {type:'automatic'|'manual'|'robot'; gearCount:number} | null {
  if(typeof value!=='string')return null;
  const match=value.trim().match(/^(\d{1,2})(AT|MT|DCT|DSG)$/i);
  if(!match)return null;
  const gearCount=Number(match[1]);if(gearCount<3||gearCount>18)return null;
  const token=match[2].toUpperCase();
  return {type:token==='AT'?'automatic':token==='MT'?'manual':'robot',gearCount};
}

export function mannTransmissionComponent(value: string | null | undefined):
  { kind: "type" } | { kind: "model"; model: string } | { kind: "conditions"; text: string } {
  const raw = (value ?? "").trim();
  if (/^(?:[-—]|N\/A|NONE|AT|MT|CVT|DCT|DSG|АКПП|МКПП)?$/i.test(raw)) return { kind: "type" };
  // Full decimal gearbox code, optionally one source-list bullet. A family
  // (725.0), a list or a serial-number clause is not an exact model choice.
  const decimalModel = raw.match(/^(?:[-—]\s+)?(7\d{2}\.\d{3})$/);
  if (decimalModel) return { kind: "model", model: decimalModel[1] };
  if (/^(?:ZF\s+|AISIN\s+|JATCO\s+)?[A-Z0-9][A-Z0-9-]{2,15}$/i.test(raw)
    && /\d/.test(raw) && !/^\d+(?:AT|MT|DCT|DSG)$/i.test(raw)) {
    return { kind: "model", model: raw.toUpperCase().replace(/\s+/g, " ") };
  }
  return { kind: "conditions", text: raw };
}
