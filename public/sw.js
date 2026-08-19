/* [V33.156] 서비스워커 — ★설치형 앱으로 쓰되, 옛 화면을 되살리지 않는다★
 *
 *   이 저장소는 "배포는 성공했는데 화면이 그대로다" 를 여러 번 겪었다(V33.145 가 판 배너를
 *   넣은 이유다). 서비스워커는 그 문제를 ★증폭시키기 가장 쉬운 장치★ 다 — 흔한 예제처럼
 *   cache-first 로 index.html 을 캐시하면, 앱이 영원히 옛 판을 띄우고 사용자는 지울 방법도 모른다.
 *
 *   그래서 규칙을 뒤집는다:
 *     · HTML·API : ★네트워크 우선★. 캐시는 오프라인일 때만 꺼낸다.
 *     · 아이콘/매니페스트 같은 불변 자산 : 캐시 우선(빨라도 틀릴 수 없다).
 *     · 새 워커는 즉시 인수한다(skipWaiting + clients.claim) — 판이 두 개 도는 시간을 없앤다.
 *   결과: 앱으로 설치해도 온라인이면 언제나 최신 판을 본다. 오프라인이면 마지막 화면이라도 뜬다.
 */
const VER = 'lux-v33.162';
const SHELL = 'shell-' + VER;
const RUNTIME = 'rt-' + VER;
const PRECACHE = ['/icon-192.png', '/icon-512.png', '/icon-maskable-512.png',
                  '/apple-touch-icon.png', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    // 실패해도 설치는 계속한다 — 아이콘 하나 때문에 앱이 안 깔리면 안 된다.
    await Promise.allSettled(PRECACHE.map((u) => c.add(u)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== SHELL && k !== RUNTIME).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// 페이지가 "지금 바로 새 판으로" 를 요청할 수 있게 한다(판 배너의 새로고침과 짝).
self.addEventListener('message', (e) => {
  if (e.data === 'lux-skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const isDoc = req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');
  const isApi = url.pathname.startsWith('/api/');
  const isImmutable = PRECACHE.includes(url.pathname);

  if (isImmutable) {
    // 불변 자산만 캐시 우선 — 내용이 바뀌면 VER 이 바뀌어 캐시가 통째로 갈린다.
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
    return;
  }

  if (isDoc || isApi) {
    // ★네트워크 우선★ — 온라인이면 언제나 서버 판을 쓴다. 캐시는 오프라인 대비 사본일 뿐이다.
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res && res.ok && isDoc) {
          const c = await caches.open(RUNTIME);
          c.put(req, res.clone());          // 다음 오프라인을 위해 사본만 남긴다
        }
        return res;
      } catch (err) {
        const hit = await caches.match(req);
        if (hit) return hit;
        if (isDoc) {
          const shell = await caches.match('/');
          if (shell) return shell;
        }
        // API 는 오프라인 사실을 ★조용히 숨기지 않는다★ — 화면이 "옛 값" 을 최신처럼 그리면 안 된다.
        return new Response(JSON.stringify({ error: 'offline', offline: true }),
          { status: 503, headers: { 'Content-Type': 'application/json' } });
      }
    })());
    return;
  }

  // 그 외 정적 자산 — 캐시를 먼저 보되 뒤에서 갱신한다(stale-while-revalidate)
  e.respondWith((async () => {
    const hit = await caches.match(req);
    const net = fetch(req).then(async (res) => {
      if (res && res.ok) { const c = await caches.open(RUNTIME); c.put(req, res.clone()); }
      return res;
    }).catch(() => null);
    return hit || (await net) || new Response('', { status: 504 });
  })());
});
