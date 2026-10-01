# Brain Studio — "02 모델 구조" 화면

React + Tailwind(범위 한정: `#brain-studio`, Preflight 끔) 앱. 빌드 결과 하나(`public/brain-studio.js`)를
사이트가 "02 모델 구조" 를 처음 열 때 불러와 `window.BrainStudio.mount(el)` 로 붙인다. 실패하면 옛 화면이 그대로 남는다.

- OMNI 3D 는 WebGL(`src/gl/omniGL.ts`) — 선 3.7만 줄을 GPU 가 한 번에 그린다(메인 스레드 1ms 미만).
- 화면 속 3D 는 손가락 기기에서 터치를 받지 않는다(페이지 스크롤이 막힐 수 없다). 조작은 '크게 보기' 전체 화면에서.
- 장면 데이터는 사이트의 `NeuralObservatory.omniCore` 를 그대로 쓴다(값을 지어내지 않는다).

빌드: `cd studio && pnpm install && npx vite build && cp dist/brain-studio.js ../public/brain-studio.js`
