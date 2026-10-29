// Only displays notifications requested by an open CRM tab. No caching or background messaging.
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = new URL(event.notification.data?.href || "/crm", self.location.origin);
  if (target.origin !== self.location.origin || target.pathname !== "/crm") return;
  event.waitUntil((async () => {
    const tabs = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const tab = tabs.find(client => new URL(client.url).origin === target.origin);
    if (tab) { await tab.navigate(target.href); await tab.focus(); }
    else await self.clients.openWindow(target.href);
  })());
});
