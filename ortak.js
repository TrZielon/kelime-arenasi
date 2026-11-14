/* Kelime Arenası · ortak kod (bütün sayfalar kullanır) */
(function(){
'use strict';
const KA=window.KA={};
const $=KA.$=(s,r)=>(r||document).querySelector(s);
const esc=KA.esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
KA.shuf=a=>{a=[...a];for(let i=a.length-1;i>0;i--){const j=Math.random()*(i+1)|0;[a[i],a[j]]=[a[j],a[i]]}return a};
KA.forms=en=>String(en||'').toLowerCase().split(/\s*[\/~]\s*/).map(v=>v.trim()).filter(Boolean);

/* ---------- Güvenli kayıt ---------- */
const S=KA.store={
  get(k,d){try{const v=localStorage.getItem(k);return v==null?d:JSON.parse(v)}catch(e){return d}},
  raw(k,d){try{const v=localStorage.getItem(k);return v==null?d:v}catch(e){return d}},
  set(k,v){try{localStorage.setItem(k,typeof v==='string'?v:JSON.stringify(v));return true}catch(e){return false}},
  del(k){try{localStorage.removeItem(k)}catch(e){}},
  keys(){try{return Object.keys(localStorage)}catch(e){return[]}}
};
KA.uid=()=>{let u=S.raw('ka_uid','');if(!u){u=(window.crypto&&crypto.randomUUID)?crypto.randomUUID():Date.now()+'-'+Math.random().toString(36).slice(2);S.set('ka_uid',u)}return u};

/* ---------- Kelime listeleri (eski kayıtlarla uyumlu) ---------- */
const pre=()=>'db:data/users/'+KA.uid()+'/';
KA.listPacks=()=>{
  const p=pre(),out=[];
  S.keys().filter(k=>k.startsWith(p)&&k!==p+'meta').forEach(k=>{const d=S.get(k,null);if(d&&typeof d==='object'&&Array.isArray(d.items||d.words))out.push(Object.assign({id:k.slice(p.length)},d))});
  if(!out.length){
    const b=S.get('ka_packs_backup_v4',null);
    const arr=Array.isArray(b)?b:(b&&Array.isArray(b.packs)?b.packs:(b&&typeof b==='object'?Object.values(b):[]));
    arr.forEach(x=>{if(x&&x.id&&Array.isArray(x.items||x.words)){out.push(x);S.set(p+x.id,Object.assign({},x,{id:undefined}))}});
  }
  return out;
};
KA.getPack=id=>{const d=S.get(pre()+id,null);return d?Object.assign({id},d):null};
const saveT={};
KA.savePack=(p,now)=>{
  if(!p||!p.id)return;
  const w=()=>{const {id,...rest}=p;S.set(pre()+id,rest)};
  clearTimeout(saveT[p.id]);
  if(now)w();else saveT[p.id]=setTimeout(w,250);
};
KA.deletePack=id=>{S.del(pre()+id);if(KA.activeId()===id)S.del('ka_active_pack_id')};
KA.activeId=v=>{if(v!==undefined){S.set('ka_active_pack_id',v)}return S.raw('ka_active_pack_id','')};
KA.normPack=p=>{
  p.words=p.words||[];
  if(!Array.isArray(p.items))p.items=p.words.map(w=>({en:w.en,tr:w.tr||''}));
  p.items.forEach(x=>{x.d=x.d||[];x.gl=x.gl||{};x.mo=x.mo||{};x.syn=x.syn||[]});
  p.groups=Array.isArray(p.groups)?p.groups:[];
  p.dict=p.dict||{};
  p.prog=Object.assign({box:{},steps:[0,0,0,0,0,0,0],xp:0,mdone:[],cdone:[]},p.prog||{});
  if(!Array.isArray(p.prog.steps)||p.prog.steps.length<7)p.prog.steps=[0,0,0,0,0,0,0];
  return p;
};

/* ---------- İstatistik (seri, XP) ---------- */
const dayKey=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
KA.meta=()=>Object.assign({days:[],streak:0,ok:0,tot:0,kart:0,xp:0},S.get(pre()+'meta',{}));
KA.saveMeta=m=>S.set(pre()+'meta',m);
KA.streak=m=>{const set=new Set(m.days||[]);let s=0;const d=new Date();if(!set.has(dayKey(d)))d.setDate(d.getDate()-1);while(set.has(dayKey(d))){s++;d.setDate(d.getDate()-1)}return s};
KA.markDay=()=>{const m=KA.meta();m.days=[...new Set([...(m.days||[]),dayKey(new Date())])].sort().slice(-120);m.streak=KA.streak(m);KA.saveMeta(m);return m};
KA.totalXp=()=>{let t=KA.meta().xp||0;KA.listPacks().forEach(p=>{t+=(p.prog&&p.prog.xp)||0});return t};
KA.addXp=(n,where)=>{const m=KA.markDay();m.xp=(m.xp||0)+n;KA.saveMeta(m);KA.refreshChips()};

/* ---------- "Bilmediklerim" listesi ---------- */
KA.findWord=k=>{k=String(k||'').toLowerCase();for(const p of KA.listPacks()){const it=(p.items||[]).find(x=>KA.forms(x.en).includes(k));if(it)return {pack:p,item:it}}return null};
KA.addUnknown=(en,tr,extra)=>{
  en=String(en||'').trim().toLowerCase();if(!en||!tr)return false;
  if(KA.findWord(en))return 'var';
  const p=KA.normPack(KA.getPack('unk')||{id:'unk',name:'Bilmediklerim',words:[],items:[]});
  p.id='unk';p.name=p.name||'Bilmediklerim';
  p.words.push({en,tr});
  p.items.push(Object.assign({en,tr,d:[],gl:{},mo:{},syn:[]},extra||{}));
  KA.savePack(p,true);
  return true;
};

/* ---------- Yapay zekâ ---------- */
const SRV={server_config:'Sunucuda API anahtarı tanımlı değil.',rate:'Çok fazla istek gönderildi, biraz bekle.',upstream:'Yapay zekâ servisine şu an ulaşılamadı.',prompt:'İstek geçersiz.',origin:'Bu adres sunucuda izinli değil.',image:'Fotoğraf gönderilemedi (çok büyük ya da desteklenmeyen biçim).'};
const gate={n:0,q:[],max:3};
const gIn=()=>gate.n<gate.max?(gate.n++,Promise.resolve()):new Promise(r=>gate.q.push(r));
const gOut=()=>{const r=gate.q.shift();if(r)r();else gate.n--};
KA.ai=async(prompt,o={})=>{
  if(location.protocol==='file:')throw new Error('Yapay zekâ için siteyi https adresinden aç.');
  await gIn();
  const ac=new AbortController(),tm=setTimeout(()=>ac.abort(),o.ms||55000);
  try{
    const r=await fetch('api/claude',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(Object.assign({prompt,tier:o.tier||'default'},o.image?{image:o.image}:{})),signal:ac.signal});
    if(!r.ok){let j={};try{j=await r.json()}catch(e){}throw new Error(SRV[j.error]||j.detail||('Sunucu hatası '+r.status))}
    const j=await r.json();return String(j.text||'');
  }catch(e){if(e.name==='AbortError')throw new Error('Zaman aşımı, tekrar dene.');throw e}
  finally{clearTimeout(tm);gOut()}
};
KA.parseJSON=t=>{const m=String(t||'').match(/[\[{][\s\S]*[\]}]/);if(!m)return null;try{return JSON.parse(m[0])}catch(e){return null}};
KA.askJ=async(sys,input,o={})=>{try{const t=await KA.ai(sys+'\n\nGİRDİ:\n'+input,o);const j=KA.parseJSON(t);return {json:j,err:j?'':'Geçersiz yanıt'}}catch(e){return {json:null,err:e.message}}};

/* ---------- Ses: Amerikan İngilizcesi ---------- */
let muted=S.raw('ka_mute','0')==='1',voice=null,audio=null,seq=0;
const mem=new Map();
function pickVoice(){try{const vs=speechSynthesis.getVoices()||[];voice=vs.find(v=>/^en[-_]US/i.test(v.lang)&&/Samantha|Google US|Aaron|Ava|Allison|Zira|Jenny|Aria|Natural/i.test(v.name))||vs.find(v=>/^en[-_]US/i.test(v.lang))||null}catch(e){}}
if('speechSynthesis' in window){pickVoice();try{speechSynthesis.onvoiceschanged=pickVoice}catch(e){}}
function local(text,rate){try{speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(text);u.lang='en-US';if(voice)u.voice=voice;u.rate=rate||.95;speechSynthesis.speak(u)}catch(e){}}
async function cloudUrl(text){
  if(mem.has(text))return mem.get(text);
  const key='https://ka-tts.local/'+encodeURIComponent(text);
  let blob=null;
  try{if(window.caches){const c=await caches.open('ka-tts-v1');const hit=await c.match(key);if(hit)blob=await hit.blob()}}catch(e){}
  if(!blob){
    const ac=new AbortController(),tm=setTimeout(()=>ac.abort(),text.length>60?6000:2500);
    try{const r=await fetch('api/tts',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text}),signal:ac.signal});if(!r.ok)throw 0;blob=await r.blob();try{if(window.caches)(await caches.open('ka-tts-v1')).put(key,new Response(blob.slice(0),{headers:{'content-type':'audio/wav'}}))}catch(e){}}
    finally{clearTimeout(tm)}
  }
  const u=URL.createObjectURL(blob);mem.set(text,u);return u;
}
KA.speak=(t,rate)=>{
  if(muted)return;
  let text=String(t||'').replace(/\s+/g,' ').trim();if(text.length<60)text=text.split(/\s*[\/~]\s*/)[0];text=text.slice(0,1800);if(!text)return;
  const my=++seq;if(audio){try{audio.pause()}catch(e){}}
  try{speechSynthesis.cancel()}catch(e){}
  if(location.protocol==='file:')return local(text,rate);
  cloudUrl(text).then(u=>{if(my!==seq)return;audio=new Audio(u);audio.playbackRate=rate||1;return audio.play()}).catch(()=>{if(my===seq)local(text,rate)});
};
KA.stopSpeak=()=>{seq++;if(audio){try{audio.pause()}catch(e){}}try{speechSynthesis.cancel()}catch(e){}};
KA.muted=v=>{if(v!==undefined){muted=!!v;S.set('ka_mute',muted?'1':'0');if(muted)KA.stopSpeak();document.querySelectorAll('[data-ka-snd]').forEach(b=>{b.innerHTML=KA.ic(muted?'mute':'sound');b.title=muted?'Sesi aç':'Sesi kapat'})}return muted};
let ac=null;
function tone(fs,d,ty,vol){if(muted)return;try{ac=ac||new(window.AudioContext||window.webkitAudioContext)();const t=ac.currentTime;fs.forEach((f,i)=>{const o=ac.createOscillator(),g=ac.createGain(),s=t+i*d;o.type=ty;o.frequency.value=f;o.connect(g);g.connect(ac.destination);g.gain.setValueAtTime(1e-4,s);g.gain.exponentialRampToValueAtTime(vol||.12,s+.012);g.gain.exponentialRampToValueAtTime(1e-4,s+d);o.start(s);o.stop(s+d+.03)})}catch(e){}}
KA.sfx={ok:()=>tone([660,880],.09,'triangle'),bad:()=>tone([220,180],.16,'sawtooth',.07),win:()=>tone([523,659,784,1047],.12,'triangle'),tick:()=>tone([1200],.03,'square',.04),cap:()=>tone([392,523,784],.1,'triangle'),hit:()=>tone([150,110],.18,'square',.08)};

/* ---------- Açık / koyu mod ---------- */
KA.mode=v=>{
  if(v){document.documentElement.dataset.mode=v;S.set('ka_pal',v==='dark'?'derin_akdeniz':'akdeniz');document.querySelectorAll('.ka-mode button').forEach(b=>b.classList.toggle('on',b.dataset.m===v));const mt=$('meta[name="theme-color"]');if(mt)mt.content=v==='dark'?'#061312':'#0f766e'}
  return document.documentElement.dataset.mode||'light';
};

/* ---------- Simgeler ---------- */
const IC={
  home:'<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  news:'<path d="M4 5h13v14a2 2 0 0 0 2 2H6a2 2 0 0 1-2-2z"/><path d="M17 9h3v10a2 2 0 0 1-2 2"/><path d="M8 9h5M8 13h5M8 17h3"/>',
  sword:'<path d="M14.5 17.5 3 6V3h3l11.5 11.5"/><path d="m13 19 6-6M16 16l4 4M19 21l2-2"/>',
  exam:'<path d="M9 4h6l1 2h3v15H5V6h3z"/><path d="m9 13 2 2 4-4"/>',
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon:'<path d="M20 14.5A8 8 0 0 1 9.5 4 7 7 0 1 0 20 14.5z"/>',
  sound:'<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>',
  mute:'<path d="M11 5 6 9H3v6h3l5 4z"/><path d="m16 9 5 6M21 9l-5 6"/>',
  x:'<path d="M18 6 6 18M6 6l12 12"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  flame:'<path d="M12 22c4 0 7-2.7 7-7 0-3.5-2.3-5.6-4-8-.5 2-1.5 3-3 3 .5-3-1-6-4-8 0 4-4 6.5-4 13 0 4.3 3.6 7 8 7z"/>',
  star:'<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
  play:'<path d="M7 4v16l13-8z"/>',
  book:'<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5M8 7h7"/>',
  search:'<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  upload:'<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
  trash:'<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  reset:'<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  download:'<path d="M12 4v12M7 11l5 5 5-5M4 20h16"/>',
  check:'<path d="m5 12 5 5 9-10"/>',
  spark:'<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
  arrow:'<path d="M5 12h14M13 6l6 6-6 6"/>',
  back:'<path d="M19 12H5M11 6l-6 6 6 6"/>',
  phone:'<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
  pen:'<path d="m4 20 4-1L19 8l-3-3L5 16z"/>',
  note:'<path d="M5 4h14v11l-5 5H5z"/><path d="M14 20v-5h5"/>',
  hl:'<path d="m9 15 6-6 3 3-6 6H9z"/><path d="M4 20h7"/><path d="m14 6 3-3 4 4-3 3"/>',
  ul:'<path d="M7 4v6a5 5 0 0 0 10 0V4M5 20h14"/>',
  cursor:'<path d="m5 3 14 8-6 2-2 6z"/>',
  eraser:'<path d="m7 21-4-4L14 6l6 6-9 9z"/><path d="M11 21h10"/>',
  undo:'<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  zin:'<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5M8 11h6M11 8v6"/>',
  zout:'<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5M8 11h6"/>',
  flag:'<path d="M5 21V4h11l-2 4 2 4H5"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  list:'<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  shield:'<path d="M12 3 4 6v6c0 5 3.4 8 8 9 4.6-1 8-4 8-9V6z"/>',
  crown:'<path d="m3 8 4 4 5-7 5 7 4-4-2 11H5z"/>'
};
KA.ic=(n,cls)=>`<svg class="${cls||''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[n]||''}</svg>`;

/* ---------- Gezinme çubuğu (tek kaynak) ---------- */
const LINKS=[['index.html','Ana sayfa','home'],['haber.html','Haber','news'],['fetih.html','Arena Fethi','sword'],['sinav.html','Sınav','exam'],['sozluk.html','Sözlük','book']];
KA.nav=(active,o={})=>{
  const links=LINKS.map(([h,t,i])=>`<a href="${h==='index.html'?'./':h}" class="${h===active?'on':''}">${KA.ic(i)}<span>${t}</span></a>`).join('');
  const m=KA.mode();
  const html=`<nav class="ka-nav" aria-label="Ana gezinme"><div class="ka-nav-in">
    <a class="ka-brand" href="./" aria-label="Kelime Arenası ana sayfa"><img src="favicon.svg" alt="" width="34" height="34">Kelime Arenası</a>
    <div class="ka-links">${links}</div>
    <div class="ka-tools">
      ${o.stats?`<span class="ka-chip ka-hide-sm" title="Günlük seri"><span style="color:var(--acc2)">${KA.ic('flame')}</span><b id="kaStreak">0</b><small>gün</small></span><span class="ka-chip" title="Toplam XP"><span style="color:var(--acc)">${KA.ic('star')}</span><b id="kaXp">0</b></span>`:''}
      <div class="ka-mode" role="group" aria-label="Görünüm modu"><button data-m="light" class="${m!=='dark'?'on':''}" title="Açık Akdeniz">${KA.ic('sun')}<span>Açık</span></button><button data-m="dark" class="${m==='dark'?'on':''}" title="Koyu Akdeniz">${KA.ic('moon')}<span>Koyu</span></button></div>
      <button class="ka-icon-btn" data-ka-snd title="${muted?'Sesi aç':'Sesi kapat'}">${KA.ic(muted?'mute':'sound')}</button>
    </div></div></nav>`;
  document.body.insertAdjacentHTML('afterbegin',html);
  document.body.insertAdjacentHTML('beforeend',`<nav class="ka-tabbar" aria-label="Sekmeler">${links}</nav>`);
  KA.refreshChips();
};
KA.refreshChips=()=>{const s=$('#kaStreak'),x=$('#kaXp');if(s)s.textContent=KA.streak(KA.meta());if(x)x.textContent=KA.totalXp()};

/* ---------- Bildirim ve pencere ---------- */
let toastT=null;
KA.toast=(msg,ms)=>{let t=$('.ka-toast');if(!t){t=document.createElement('div');t.className='ka-toast';t.setAttribute('role','status');document.body.appendChild(t)}t.textContent=msg;clearTimeout(toastT);toastT=setTimeout(()=>t.remove(),ms||2600)};
KA.modal=(html,o={})=>{
  const m=document.createElement('div');m.className='ka-modal';
  m.innerHTML=`<div class="ka-modal-box ${o.wide?'wide':''}" role="dialog" aria-modal="true"><button class="ka-icon-btn ka-modal-x" aria-label="Kapat">${KA.ic('x')}</button>${html}</div>`;
  const close=()=>{m.remove();document.removeEventListener('keydown',k);o.onClose&&o.onClose()};
  const k=e=>{if(e.key==='Escape')close()};
  m.addEventListener('click',e=>{if(e.target===m||e.target.closest('.ka-modal-x'))close()});
  document.addEventListener('keydown',k);document.body.appendChild(m);
  return {el:m.querySelector('.ka-modal-box'),close};
};

/* ---------- Metni dokunulabilir kelimelere böl ---------- */
KA.tokens=s=>esc(s).split(/([A-Za-z][A-Za-z'’-]*)/).map((t,i)=>i%2?`<span class="tk" data-w="${t}">${t}</span>`:t).join('');

/* ---------- Kelime paneli ---------- */
const LOOKUP=`Sen İngilizce-Türkçe akademik sözlük yazarısın. Girdide bir İngilizce KELİME ve (varsa) geçtiği BAĞLAM cümlesi var. YALNIZCA geçerli JSON döndür: {"lemma":"kelimenin sözlük biçimi","pos":"isim, fiil, sıfat, zarf ya da deyim","tr":"bağlama uygun en yaygın Türkçe karşılık, 1-4 kelime","syn":["en fazla 4 İngilizce eş anlamlı, kelimeyle aynı türde"]}. Eş anlamlı yoksa boş dizi. Uydurma.`;
let LEX=null,lexEl=null,lexN=0;
const lex=()=>LEX||(LEX=S.get('ka_lex',{})||{});
const saveLex=()=>{const k=Object.keys(LEX);if(k.length>3000)k.slice(0,k.length-2500).forEach(x=>delete LEX[x]);S.set('ka_lex',LEX)};
KA.closeLookup=()=>{if(lexEl){lexEl.remove();lexEl=null}document.querySelectorAll('.tk.sel').forEach(x=>x.classList.remove('sel'))};
KA.lookup=async(word,o={})=>{
  const k=String(word||'').toLowerCase().replace(/[’]/g,"'").replace(/[^a-z'-]/g,'').replace(/^'+|'+$/g,'');
  if(!k)return;
  KA.closeLookup();
  if(o.anchor)o.anchor.classList.add('sel');
  KA.speak(k);
  const my=++lexN;
  const known=KA.findWord(k);
  const L=lex()[k]||{};
  const st={k,w:word,tr:o.tr||(known&&known.item.tr)||L.tr||'',syn:(L.syn&&L.syn.length?L.syn:(known&&known.item.syn)||[]),pos:L.pos||'',lemma:L.lemma||'',loading:false,err:'',added:false};
  lexEl=document.createElement('div');lexEl.className='ka-lex';lexEl.setAttribute('role','dialog');
  document.body.appendChild(lexEl);
  const place=()=>{
    if(!lexEl||innerWidth<=640)return;
    if(!o.anchor){lexEl.style.right='20px';lexEl.style.bottom='20px';return}
    const r=o.anchor.getBoundingClientRect(),w=lexEl.offsetWidth,h=lexEl.offsetHeight;
    let x=Math.min(Math.max(12,r.left+r.width/2-w/2),innerWidth-w-12),y=r.bottom+10;
    if(y+h>innerHeight-12)y=Math.max(12,r.top-h-10);
    lexEl.style.left=x+'px';lexEl.style.top=y+'px';
  };
  const paint=()=>{
    if(!lexEl)return;
    const inList=KA.findWord(k);
    const mo=Array.isArray(o.mo)?o.mo.filter(Array.isArray):[];
    lexEl.innerHTML=`<button class="ka-icon-btn" data-x aria-label="Kapat">${KA.ic('x')}</button>
      <div class="ka-lex-w"><b>${esc(k)}</b>${st.pos?`<span class="tag">${esc(st.pos)}</span>`:''}${st.lemma&&st.lemma!==k?`<span class="mut" style="font-size:13px">← ${esc(st.lemma)}</span>`:''}</div>
      <div class="ka-lex-tr">${st.tr?esc(st.tr):(st.loading?'<span class="ka-spin"></span> <span class="mut" style="font-weight:600;font-size:14px">anlam aranıyor…</span>':`<span class="mut" style="font-weight:600;font-size:14px">${esc(st.err||'Anlam bulunamadı.')}</span>`)}</div>
      ${st.syn&&st.syn.length?`<div class="ka-lex-syn"><span class="lbl">Eş anlamlı</span>${st.syn.map(s=>`<button data-syn="${esc(s)}">${esc(s)}</button>`).join('')}</div>`:(st.loading?'':'')}
      ${mo.length?`<div class="ka-lex-mo">${mo.map(([a,b,c])=>`<span><b>${esc(a)}</b> · ${esc(b)}${c?': '+esc(c):''}</span>`).join('')}</div>`:''}
      <div class="ka-lex-act">
        <button class="btn btn-ghost" data-say>${KA.ic('sound')}Dinle</button>
        ${inList?`<button class="btn btn-ghost" disabled>${KA.ic('check')}Listende var</button>`:(st.added?`<button class="btn btn-ghost" disabled>${KA.ic('check')}Eklendi</button>`:`<button class="btn btn-p" data-add ${st.tr?'':'disabled'}>${KA.ic('plus')}Bilmediklerime ekle</button>`)}
        ${o.onQuiz&&inList?`<button class="btn btn-acc" data-quiz>${KA.ic('play')}Quiz</button>`:''}
      </div>
      <div class="ka-lex-links"><a target="_blank" rel="noopener" href="https://tureng.com/en/turkish-english/${encodeURIComponent(k)}">Tureng ↗</a><a target="_blank" rel="noopener" href="https://dictionary.cambridge.org/dictionary/english-turkish/${encodeURIComponent(k)}">Cambridge ↗</a></div>`;
    place();
  };
  lexEl.addEventListener('click',e=>{
    const t=e.target.closest('button');if(!t)return;
    if(t.hasAttribute('data-x'))return KA.closeLookup();
    if(t.hasAttribute('data-say'))return KA.speak(k);
    if(t.dataset.syn)return KA.speak(t.dataset.syn);
    if(t.hasAttribute('data-quiz')){KA.closeLookup();return o.onQuiz(k)}
    if(t.hasAttribute('data-add')){const r=KA.addUnknown(k,st.tr,{syn:st.syn});st.added=r===true;KA.toast(r===true?'“'+k+'” Bilmediklerim listesine eklendi.':'Bu kelime zaten listende.');paint();o.onAdd&&o.onAdd(k)}
  });
  paint();
  if(st.tr&&(st.syn.length||L.done))return;
  st.loading=true;paint();
  const r=await KA.askJ(LOOKUP,`KELİME: ${k}\nBAĞLAM: ${String(o.context||'').slice(0,400)}`,{tier:'quick',ms:20000});
  if(my!==lexN)return;
  st.loading=false;
  const j=r.json&&!Array.isArray(r.json)?r.json:null;
  if(j){
    const e={done:1};
    if(typeof j.tr==='string'&&j.tr.trim()&&j.tr.trim().toLowerCase()!==k)e.tr=j.tr.trim();
    e.syn=(Array.isArray(j.syn)?j.syn:[]).map(s=>String(s).toLowerCase().trim()).filter(s=>s&&s!==k&&/^[a-z' -]{2,28}$/.test(s)).slice(0,4);
    if(typeof j.pos==='string')e.pos=j.pos.trim().slice(0,18);
    if(typeof j.lemma==='string')e.lemma=j.lemma.trim().toLowerCase().slice(0,30);
    lex()[k]=Object.assign(lex()[k]||{},e);saveLex();
    st.tr=st.tr||e.tr||'';if(e.syn.length)st.syn=e.syn;st.pos=e.pos||'';st.lemma=e.lemma||'';
  }else st.err=r.err||'Anlam bulunamadı.';
  paint();
};
document.addEventListener('keydown',e=>{if(e.key==='Escape')KA.closeLookup()});
document.addEventListener('pointerdown',e=>{if(lexEl&&!lexEl.contains(e.target)&&!e.target.closest('.tk'))KA.closeLookup()},true);

/* ---------- Başlangıç ---------- */
document.addEventListener('click',e=>{
  const mb=e.target.closest('.ka-mode button');if(mb){KA.mode(mb.dataset.m);return}
  if(e.target.closest('[data-ka-snd]')){KA.muted(!muted);return}
});
})();
