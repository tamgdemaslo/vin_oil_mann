export function appendBookingManagementLink(eventType: string, message: string, managementUrl: string) {
  if (eventType !== "appointment_admin_created" && eventType !== "appointment_client_created") return message;
  let url: URL;
  try {
    url = new URL(managementUrl);
  } catch {
    return message;
  }
  // A general booking URL must never be presented as management of this visit.
  if (!/^https?:$/.test(url.protocol) || !/^\/booking\/manage\/[^/]+\/?$/.test(url.pathname)) return message;
  const escapedUrl = managementUrl.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  if (message.includes(managementUrl) || message.includes(escapedUrl)) return message;
  return `${message}\n\nЕсли планы изменились, вы можете перенести или отменить запись: <a href="${escapedUrl}">Управление записью</a>`;
}
