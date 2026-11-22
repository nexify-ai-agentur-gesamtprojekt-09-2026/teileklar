// TEILEKLAR.shop – Abschalt-Service-Worker für den Offline-Zustand.
//
// Zweck: Der bisherige Service Worker (Cache "teileklar-v4") hält Skripte, Bilder
// und JSON-Daten des Shops vor. Diese Datei ersetzt ihn unter derselben Adresse.
// Sie löscht alle Caches dieser Herkunft, meldet die Registrierung ab und lädt
// offene Fenster neu, damit sie die Offline-Seite direkt vom Server erhalten.
//
// Bewusst ohne "fetch"-Behandlung: Dieser Worker beantwortet keine Anfragen.

self.addEventListener('install', () => {
  // Nicht auf das Schließen alter Fenster warten.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const namen = await caches.keys();
      await Promise.all(namen.map((name) => caches.delete(name)));
    } catch (fehler) {
      // Caches nicht erreichbar: Abmeldung trotzdem durchführen.
    }

    let fenster = [];
    try {
      await self.clients.claim();
      fenster = await self.clients.matchAll({ type: 'window' });
    } catch (fehler) {
      fenster = [];
    }

    await self.registration.unregister();

    // Nach der Abmeldung neu laden: Die Fenster sind danach ohne Service Worker.
    await Promise.all(fenster.map((f) => f.navigate(f.url).catch(() => undefined)));
  })());
});
