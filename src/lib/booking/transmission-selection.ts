type NamedService = { id: string; name: string };

export function isTransmissionOilVariant(name: string) {
  return /^(?:Частичная|Аппаратная) замена масла в АКПП:/iu.test(name);
}

export function isStandaloneTransmissionLevel(name: string) {
  return /^Выставление уровня(?: масла)?(?: в)? АКПП$/iu.test(name);
}

export function normalizeBookingServiceSelection(ids: string[], services: NamedService[]) {
  const byId = new Map(services.map(service => [service.id, service]));
  const valid = [...new Set(ids)].filter(id => byId.has(id));
  const transmissionId = [...valid].reverse().find(id => isTransmissionOilVariant(byId.get(id)!.name));
  if (!transmissionId) return valid;
  return valid.filter(id => id === transmissionId || (
    !isTransmissionOilVariant(byId.get(id)!.name) && !isStandaloneTransmissionLevel(byId.get(id)!.name)
  ));
}

export function toggleBookingServiceSelection(ids: string[], id: string, services: NamedService[]) {
  const current = normalizeBookingServiceSelection(ids, services);
  if (current.includes(id)) return current.filter(value => value !== id);
  const service = services.find(item => item.id === id);
  if (!service) return current;
  if (isStandaloneTransmissionLevel(service.name)
    && services.some(item => current.includes(item.id) && isTransmissionOilVariant(item.name))) return current;
  return normalizeBookingServiceSelection([...current, id], services);
}
