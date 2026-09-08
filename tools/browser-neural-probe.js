// Codex: run via agent-browser eval --stdin on a visible SEQ model scene.
(async()=>{
  const room=document.querySelector('.nerve-room'),canvas=room.querySelector('canvas');
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  const button=text=>Array.from(room.querySelectorAll('button')).find(b=>b.textContent===text);
  const assert=(v,m)=>{if(!v)throw new Error(m);};
  const results={width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth};
  assert(!results.overflow,'horizontal overflow');
  const selects=room.querySelectorAll('.nerve-controls select');
  const initial=canvas.dataset.nodes;
  button('전체 노드').click();await wait(300);
  assert(+canvas.dataset.nodes>+initial,'detail mode does not expand nodes');
  results.detailNodes=+canvas.dataset.nodes;
  for(const select of selects){select.value='0';select.dispatchEvent(new Event('change'));await wait(80);}
  room.querySelector('.nerve-layer').value='2';room.querySelector('.nerve-layer').dispatchEvent(new Event('change'));
  assert(room.querySelector('output').textContent.includes('t0'),'selected time/node details incorrect');
  results.inspector=room.querySelector('output').textContent;
  button('+').click();await wait(150);assert(+canvas.dataset.zoom>1,'zoom did not work');
  canvas.dispatchEvent(new KeyboardEvent('keydown',{key:'Home'}));await wait(150);assert(+canvas.dataset.zoom===1,'keyboard fit did not work');
  for(const text of ['신호 움직임','자동회전']){const b=button(text);if(b.getAttribute('aria-pressed')==='true')b.click();}
  await wait(150);const paused=+canvas.dataset.draws;await wait(250);assert(+canvas.dataset.draws===paused,'paused animation keeps rendering');
  results.pause=true;
  button('신호 움직임').click();await wait(250);assert(+canvas.dataset.draws>paused,'animation does not resume');
  const viewport=room.querySelector('.nerve-viewport');viewport.style.visibility='hidden';
  // display:none exercises IntersectionObserver, as switching to operations does.
  viewport.style.display='none';await wait(150);const hidden=+canvas.dataset.draws;await wait(250);assert(+canvas.dataset.draws===hidden,'hidden scene keeps rendering');
  viewport.style.display='';viewport.style.visibility='';await wait(250);assert(+canvas.dataset.draws>hidden,'visible scene does not resume');
  results.hiddenPause=true;results.averageMs=+canvas.dataset.averageMs;
  button('전체 노드').click();
  return JSON.stringify(results);
})()
