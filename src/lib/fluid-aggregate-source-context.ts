/** Supplemental source evidence, never a confirmation of equipment on a VIN. */
export function extractFluidAggregateSourceContext(label: string | null, component: string | null) {
  const text=(label??'').normalize('NFKC').toUpperCase().replace(/[–—]/g,'-').replace(/\s+/g,' ').trim();
  let rest=text.replace(/^(?:МАСЛО|ЖИДКОСТЬ)\s+(?:В|ДЛЯ)\s+/,'');
  let systemCode: string|null=null;
  let circuit: string|null=null;
  let fluidRequired: boolean|null=null;
  const patterns: [RegExp,string,string,boolean][]=[
    [/^(?:ЭЛЕКТРОУСИЛИТЕЛЬ РУЛЯ|ЭЛЕКТРОПРИВОД РУЛЯ)(?=$|\s)/,'POWER_STEERING','ELECTRIC_STEERING',false],
    [/^(?:ГУР|ГИДРОУСИЛИТЕЛЬ РУЛЯ)(?=$|\s|\()/,'POWER_STEERING','HYDRAULIC_STEERING',true],
    [/^(?:РАЗДАТОЧН(?:УЮ|АЯ|ОЙ) КОРОБК[АУИ]|РАЗДАТК[УЕА])(?=$|\s|\()/,'TRANSFER_CASE','TRANSFER_CASE',true],
    [/^ПЕРЕДН(?:ИЙ|ЕМ) (?:ДИФФЕРЕНЦИАЛ|РЕДУКТОР)(?:Е)?(?=$|\s|\()/,'FRONT_DIFFERENTIAL','FRONT_DIFFERENTIAL',true],
    [/^ЗАДН(?:ИЙ|ЕМ) (?:ДИФФЕРЕНЦИАЛ|РЕДУКТОР)(?:Е)?(?=$|\s|\()/,'REAR_DIFFERENTIAL','REAR_DIFFERENTIAL',true],
    [/^ДИФФЕРЕНЦИАЛ(?=$|\s|\()/,'DIFFERENTIAL_GENERIC','UNLOCATED_DIFFERENTIAL',true],
    [/^УГЛОВОЙ РЕДУКТОР(?=$|\s|\()/,'DIFFERENTIAL_GENERIC','ANGLE_GEAR',true],
    [/^МУФТ[АУ] ПОЛНОГО ПРИВОДА(?=$|\s|\()/,'AWD_COUPLING','AWD_COUPLING',true],
  ];
  for(const [pattern,system,name,required] of patterns){
    const match=rest.match(pattern);if(!match)continue;
    systemCode=system;circuit=name;fluidRequired=required;rest=rest.slice(match[0].length).trim();break;
  }
  let attachedTransmissionType: string|null=null;
  const attached=rest.match(/^(?:ОТ )?(АКПП|МКПП|ВАРИАТОРА)(?=$|\s)/);
  if(systemCode&&systemCode!=='POWER_STEERING'&&attached){
    attachedTransmissionType=attached[1]==='АКПП'?'automatic':attached[1]==='МКПП'?'manual':'cvt';
    rest=rest.slice(attached[0].length).trim();
  }
  let requiredDrive: '4WD'|'2WD'|null=null;
  const drive=rest.match(/^\((?:ДЛЯ )?([24])\s?WD\)$/);
  if(drive){requiredDrive=drive[1]==='4'?'4WD':'2WD';rest='';}
  const rawComponent=(component??'').trim();
  const componentUnresolved=!/^(?:-|—)?$/.test(rawComponent);
  const issues:string[]=[];
  if(!systemCode)issues.push('UNRECOGNIZED_AGGREGATE_LABEL');
  if(rest)issues.push('UNPARSED_LABEL_CONDITIONS');
  if(componentUnresolved)issues.push('COMPONENT_OR_CONDITIONS_REQUIRE_REVIEW');
  if(circuit==='UNLOCATED_DIFFERENTIAL')issues.push('DIFFERENTIAL_LOCATION_UNCONFIRMED');
  return {systemCode,circuit,fluidRequired,attachedTransmissionType,requiredDrive,
    equipmentConfirmationRequired:fluidRequired===true,issues,
    remainingLabel:rest,componentRaw:component,evidenceLabel:label};
}
