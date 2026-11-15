/* Kelime Arenası · çevrimdışı çalışma (service worker) */
const V='ka-v2';
const CORE=['./','index.html','haber.html','fetih.html','sinav.html','sozluk.html','gizlilik.html','offline.html','ortak.css?v=3','ortak.js?v=3','favicon.svg','favicon-96.png','icon-192.png','icon-512.png','manifest.webmanifest'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(V).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==V).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
  const r=e.request,u=new URL(r.url);
  if(r.method!=='GET'||u.origin!==location.origin||u.pathname.startsWith('/api/'))return;
  // Sayfalar ve haberler: önce internet, olmazsa kayıtlı kopya
  if(r.mode==='navigate'||u.pathname.endsWith('.json')||u.pathname.endsWith('.html')){
    e.respondWith(fetch(r).then(res=>{if(res.ok){const c=res.clone();caches.open(V).then(x=>x.put(r,c))}return res}).catch(()=>caches.match(r,{ignoreSearch:true}).then(m=>m||(r.mode==='navigate'?caches.match('offline.html'):Response.error()))));
    return;
  }
  // Stil, kod, ikon, PDF okuyucu: kayıtlı kopyayı hemen ver, arkada güncelle
  e.respondWith(caches.match(r).then(m=>{const net=fetch(r).then(res=>{if(res.ok){const c=res.clone();caches.open(V).then(x=>x.put(r,c))}return res}).catch(()=>m);return m||net}));
});
