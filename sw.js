self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()); });

self.addEventListener('push', (event) => {
  let data = { title: 'OpsTac Callout', body: 'New activation' };
  try { if(event.data) data = { ...data, ...event.data.json() }; } catch(_){}
  event.waitUntil(showAlert(data));
});

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if(data.type === 'CALLOUT') event.waitUntil(showAlert(data));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/app.html';
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const open = list.find(c => c.url.includes('app.html'));
    if(open){ open.focus(); open.postMessage({ type: 'OPEN_CALLOUTS' }); return; }
    return clients.openWindow(url);
  }));
});

function showAlert(data){
  return self.registration.showNotification(data.title || 'OpsTac Callout', {
    body: data.body || 'New activation',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    vibrate: [300, 100, 300, 100, 300],
    requireInteraction: true,
    renotify: true,
    silent: false,
    tag: data.tag || 'opstac-callout',
    data: { url: data.url || '/app.html' }
  });
}
