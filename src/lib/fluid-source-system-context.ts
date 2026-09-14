/** Read only explicit source labels; never infer a gearbox model from its speeds. */
export function extractFluidSourceSystemContext(systemName: string | null | undefined, componentModel?: string | null) {
  const name = (systemName ?? "").normalize("NFKC").toUpperCase().replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();
  const component = (componentModel ?? "").normalize("NFKC").toUpperCase().trim();
  const head = name.replace(/^(?:МАСЛО|ЖИДКОСТЬ)\s+(?:В|ДЛЯ)\s+/, "");
  let destinationSystemCode: string | null = null;
  if (/^РАЗДАТОЧН(?:УЮ|ОЙ|АЯ)\s+КОРОБК/.test(head)) destinationSystemCode = "TRANSFER_CASE";
  else if (/^ЗАДН(?:ИЙ|ЕГО|ЕМ)\s+(?:ДИФФЕРЕНЦИАЛ|РЕДУКТОР|МОСТ)/.test(head)) destinationSystemCode = "REAR_DIFFERENTIAL";
  else if (/^ПЕРЕДН(?:ИЙ|ЕГО|ЕМ)\s+(?:ДИФФЕРЕНЦИАЛ|РЕДУКТОР|МОСТ)/.test(head)) destinationSystemCode = "FRONT_DIFFERENTIAL";
  const direct = head.match(/^(АКПП|МКПП|CVT|ВАРИАТОР|DSG|DCT|РКПП|РОБОТ)(?=$|[^A-ZА-Я])/);
  const typeFor = (word: string) => word === "АКПП" || word === "AT" ? "automatic" : word === "МКПП" || word === "MT" ? "manual" : word === "CVT" || word === "ВАРИАТОР" ? "cvt" : "robot";
  const attached = destinationSystemCode ? name.match(/\sОТ\s+(АКПП|МКПП|CVT|ВАРИАТОР[А]?|DSG|DCT|РКПП)(?=$|[^A-ZА-Я])/) : null;
  const transmissionType = direct ? typeFor(direct[1]) : attached ? typeFor(attached[1].replace(/ВАРИАТОРА$/, "ВАРИАТОР")) : null;
  if (!destinationSystemCode && direct) destinationSystemCode = transmissionType === "automatic" ? "AUTOMATIC_TRANSMISSION" : transmissionType === "manual" ? "MANUAL_TRANSMISSION" : transmissionType === "cvt" ? "CVT_TRANSMISSION" : "ROBOT_TRANSMISSION";
  const labelCount = direct ? head.match(/^(?:АКПП|МКПП|DSG|DCT|РКПП)[ -]+(\d{1,2})(?!\d)/) : null;
  const componentCount = component.match(/^(\d{1,2})(AT|MT|DCT|DSG)$/);
  const issues: string[] = [];
  // A gearbox's differential is a separate oil circuit; without an explicit
  // location we cannot safely assign front/rear or reuse the gearbox scope.
  if (/^(?:ДИФФЕРЕНЦИАЛ|РЕДУКТОР|МОСТ)(?=$|\s)/.test(head)) issues.push("UNRESOLVED_DIFFERENTIAL_CIRCUIT");
  if (direct) {
    const remainder = head.slice(direct[0].length).replace(/^[ -]+\d{1,2}(?!\d)/, "").trim();
    if (remainder && !/^(?:\*|\(|МОДЕЛ|"S-TRONIC")/.test(remainder)) {
      issues.push("UNPARSED_TRANSMISSION_LABEL");
      destinationSystemCode = null;
    }
  }
  let transmissionGearCount: number | null = null;
  if (labelCount || componentCount) {
    const count = Number(labelCount?.[1] ?? componentCount?.[1]);
    if (count < 3 || count > 18) issues.push("UNSUPPORTED_GEAR_COUNT");
    else transmissionGearCount = count;
    if (labelCount && /^[\s]*[/+,\-]\s*\d/.test(head.slice(labelCount[0].length))) issues.push("ALTERNATIVE_GEAR_COUNTS");
    if (labelCount && componentCount && Number(labelCount[1]) !== Number(componentCount[1])) issues.push("GEAR_COUNT_CONFLICT");
    if (componentCount && transmissionType && typeFor(componentCount[2]) !== transmissionType) issues.push("TRANSMISSION_TYPE_CONFLICT");
  }
  if (issues.length) transmissionGearCount = null;
  return { destinationSystemCode, transmissionType, transmissionGearCount, issues,
    evidence: { systemName: systemName ?? null, componentModel: componentModel ?? null },
    // Preserve suffixes such as dates, drive modes, model lists and footnotes.
    hasAdditionalLabelConditions: issues.length > 0 || /\*|\(|МОДЕЛ|ДЛЯ\s+(?:\d|[A-Z])/.test(head),
  };
}
