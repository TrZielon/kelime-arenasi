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
const SRV={busy:'Yapay zekâ şu an yoğun, biraz sonra tekrar dene.',server_config:'Sunucuda API anahtarı tanımlı değil.',rate:'Çok fazla istek gönderildi, biraz bekle.',upstream:'Yapay zekâ servisine şu an ulaşılamadı.',prompt:'İstek geçersiz.',origin:'Bu adres sunucuda izinli değil.',image:'Fotoğraf gönderilemedi (çok büyük ya da desteklenmeyen biçim).'};
const gate={n:0,q:[],max:3};
const gIn=()=>gate.n<gate.max?(gate.n++,Promise.resolve()):new Promise(r=>gate.q.push(r));
const gOut=()=>{const r=gate.q.shift();if(r)r();else gate.n--};
// Safari "Load failed", Chrome "Failed to fetch": ağ seviyesinde kopma; kısa bekleyip iki kez daha dene
const isNet=e=>e&&e.name!=='AbortError'&&(e instanceof TypeError||/load failed|failed to fetch|networkerror|network connection/i.test(e.message||''));
async function netRetry(f,ac){for(let i=0;;i++){try{return await f()}catch(e){if(!isNet(e)||i>=2||ac.signal.aborted)throw e;await new Promise(r=>setTimeout(r,1500*(i+1)))}}}
KA.ai=async(prompt,o={})=>{
  if(location.protocol==='file:')throw new Error('Yapay zekâ için siteyi https adresinden aç.');
  await gIn();
  const ac=new AbortController(),tm=setTimeout(()=>ac.abort(),o.ms||62000);
  try{
    const r=await netRetry(()=>fetch('api/claude',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(Object.assign({prompt,tier:o.tier||'default'},o.image?{image:o.image}:{},o.mode?{mode:o.mode}:{},o.json?{json:true}:{})),signal:ac.signal}),ac);
    if(!r.ok){let j={};try{j=await r.json()}catch(e){}throw new Error(SRV[j.error]?SRV[j.error]+(j.detail?' ['+String(j.detail).slice(0,140)+']':''):(j.detail||('Sunucu hatası '+r.status)))}
    const j=await r.json();return String(j.text||'');
  }catch(e){if(e.name==='AbortError')throw new Error('Zaman aşımı, tekrar dene.');if(isNet(e))throw new Error('Bağlantı koptu. İnternetini kontrol edip tekrar dene.');throw e}
  finally{clearTimeout(tm);gOut()}
};
/* ---------- Fotoğraftan yazı okuma (OCR) ---------- */
KA.isImage=f=>!!f&&(/^image\//.test(f.type||'')||/\.(jpe?g|png|heic|heif|webp|gif|bmp|tiff?)$/i.test(f.name||''));
KA.prepImage=(src,M=2048)=>new Promise((ok,no)=>{
  const fin=(im,w,h,rev)=>{const k=Math.min(1,M/Math.max(w,h)),c=document.createElement('canvas');c.width=Math.max(1,Math.round(w*k));c.height=Math.max(1,Math.round(h*k));const g=c.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,c.width,c.height);g.drawImage(im,0,0,c.width,c.height);if(rev)rev();
    let q=.88,u=c.toDataURL('image/jpeg',q);while(u.length>3600000&&q>.5){q-=.12;u=c.toDataURL('image/jpeg',q)}
    const data=u.split(',')[1];ok({mime:'image/jpeg',data,w:c.width,h:c.height,canvas:c})};
  if(src instanceof HTMLCanvasElement)return fin(src,src.width,src.height);
  const u=URL.createObjectURL(src),im=new Image();
  im.onload=()=>fin(im,im.naturalWidth,im.naturalHeight,()=>URL.revokeObjectURL(u));
  im.onerror=()=>{URL.revokeObjectURL(u);no(new Error(/hei[cf]$/i.test(src.name||'')?'Bu tarayıcı HEIC fotoğrafı açamıyor. iPhone\'da Ayarlar → Kamera → Biçimler → "En Uyumlu" seç ya da ekran görüntüsü al.':'Fotoğraf açılamadı. JPEG/PNG ya da ekran görüntüsü olarak dene.'))};
  im.src=u;
});
KA.b64bytes=b=>{const s=atob(b),a=new Uint8Array(s.length);for(let i=0;i<s.length;i++)a[i]=s.charCodeAt(i);return a};
let tessP=null;
KA.tesseract=async(canvas,onp)=>{
  if(!tessP)tessP=new Promise((ok,no)=>{if(window.Tesseract)return ok();const s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';s.onload=ok;s.onerror=()=>{tessP=null;no(new Error('Yedek okuyucu yüklenemedi'))};document.head.appendChild(s)});
  await tessP;
  const r=await Tesseract.recognize(canvas,'eng+tur',{logger:m=>{if(onp&&m.status==='recognizing text')onp(Math.round(m.progress*100))}});
  return r.data;
};
const OCR_TXT=`You are a precise OCR engine. Transcribe ALL text in this image exactly as written, line by line, top to bottom. The text is usually English and/or Turkish: keep Turkish characters (ç ğ ı İ ö ş ü) exactly. Read handwriting too and give your best reading of unclear words. Keep each table row or list row on ONE line and separate its columns with " | ". Keep numbers, bullets, option letters and blanks (write blanks as _____). If the photo is rotated or tilted, read it in the correct orientation. Do not translate, summarize, explain or add anything. Output only the transcribed text.`;
const OCR_LAY=`You are a precise OCR and layout engine for exam papers. Find every line of text in this page image and return its exact text and bounding box.
Rules: keep reading order (top to bottom). If a line has large horizontal gaps (two columns, or answer options on one line such as "A) cat   B) dog   C) bird"), split it into separate items, one per piece, each with its own box. Keep question numbers ("1.", "2)"), option letters ("A)", "(b)"), Turkish characters exactly, and write blanks/underlines as _____ . A ruled answer line with no text is an item whose text is "__________". Do not translate or fix the text.
Coordinates: "b" is [ymin, xmin, ymax, xmax] normalized to 0-1000 of the image height/width, tight around the text.
Return ONLY JSON: {"lines":[{"t":"text","b":[ymin,xmin,ymax,xmax]}]}`;
KA.ocrText=async(img,o={})=>{
  let err='';
  for(let i=0;i<2;i++){
    try{const t=(await KA.ai(OCR_TXT,{image:{mime:img.mime,data:img.data},mode:'ocr',ms:65000})).replace(/^```[a-z]*\n?|```$/g,'').trim();
      if(/[A-Za-zÇĞİÖŞÜçğıöşü]{2,}/.test(t))return {text:t,src:'ai'}}
    catch(e){err=e.message;if(/API anahtarı|izinli değil/.test(err))break}
  }
  if(img.canvas&&o.fallback!==false){try{o.status&&o.status('Yedek okuyucu çalışıyor…');const d=await KA.tesseract(img.canvas,p=>o.status&&o.status('Yedek okuyucu çalışıyor… %'+p));const t=String(d.text||'').trim();if(t)return {text:t,src:'tess'}}catch(e){err=err||e.message}}
  return {text:'',err:err||'Yazı bulunamadı'};
};
KA.ocrLayout=async(img,o={})=>{
  let err='';
  for(let i=0;i<2;i++){
    try{const t=await KA.ai(OCR_LAY,{image:{mime:img.mime,data:img.data},mode:'ocr',json:true,ms:65000});const j=KA.parseJSON(t);
      const arr=j&&(Array.isArray(j)?j:j.lines||Object.values(j).find(Array.isArray));
      const lines=(arr||[]).map(l=>({t:String(l.t||l.text||'').trim(),b:(l.b||l.box||l.box_2d||[]).map(Number)})).filter(l=>l.t&&l.b.length===4&&l.b.every(isFinite)&&l.b[2]>l.b[0]&&l.b[3]>l.b[1]);
      if(lines.length)return {lines,src:'ai'};err='Geçersiz yanıt'}
    catch(e){err=e.message;if(/API anahtarı|izinli değil/.test(err))break}
  }
  if(img.canvas&&o.fallback!==false){try{o.status&&o.status('Yedek okuyucu çalışıyor…');const d=await KA.tesseract(img.canvas,p=>o.status&&o.status('Yedek okuyucu çalışıyor… %'+p));const W=img.canvas.width,H=img.canvas.height;
    const lines=(d.lines||[]).map(l=>({t:String(l.text||'').trim(),b:[l.bbox.y0/H*1000,l.bbox.x0/W*1000,l.bbox.y1/H*1000,l.bbox.x1/W*1000]})).filter(l=>l.t);if(lines.length)return {lines,src:'tess'}}catch(e){err=err||e.message}}
  return {lines:[],err:err||'Yazı bulunamadı'};
};
KA.parseJSON=t=>{const m=String(t||'').match(/[\[{][\s\S]*[\]}]/);if(!m)return null;try{return JSON.parse(m[0])}catch(e){return null}};
KA.askJ=async(sys,input,o={})=>{try{const t=await KA.ai(sys+'\n\nGİRDİ:\n'+input,Object.assign({json:true},o));const j=KA.parseJSON(t);return {json:j,err:j?'':'Geçersiz yanıt'}}catch(e){return {json:null,err:e.message}}};

/* ---------- Ses: Amerikan İngilizcesi ---------- */
let muted=S.raw('ka_mute','0')==='1',voice=null,audio=null,seq=0;
const mem=new Map();
function pickVoice(){try{const vs=speechSynthesis.getVoices()||[];voice=vs.find(v=>/^en[-_]US/i.test(v.lang)&&/Samantha|Google US|Aaron|Ava|Allison|Zira|Jenny|Aria|Natural/i.test(v.name))||vs.find(v=>/^en[-_]US/i.test(v.lang))||null}catch(e){}}
if('speechSynthesis' in window){pickVoice();try{speechSynthesis.onvoiceschanged=pickVoice}catch(e){}}
function local(text,rate){try{speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(text);u.lang='en-US';if(voice)u.voice=voice;u.rate=rate||.95;speechSynthesis.speak(u)}catch(e){}}
async function cloudUrl(text,ms){
  if(mem.has(text))return mem.get(text);
  const key='https://ka-tts.local/'+encodeURIComponent(text);
  let blob=null;
  try{if(window.caches){const c=await caches.open('ka-tts-v1');const hit=await c.match(key);if(hit)blob=await hit.blob()}}catch(e){}
  if(!blob){
    const ac=new AbortController(),tm=setTimeout(()=>ac.abort(),ms||(text.length>60?6000:2500));
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
// Oynatma bitince çözülen sürüm (uzun dinleme metinleri için)
KA.speakP=(t,rate)=>new Promise(res=>{
  if(muted)return res(false);
  const text=String(t||'').replace(/\s+/g,' ').trim().slice(0,1900);if(!text)return res(false);
  const my=++seq;if(audio){try{audio.pause()}catch(e){}}
  try{speechSynthesis.cancel()}catch(e){}
  const loc=()=>{try{const u=new SpeechSynthesisUtterance(text);u.lang='en-US';if(voice)u.voice=voice;u.rate=(rate||1)*.95;u.onend=()=>res(my===seq);u.onerror=()=>res(false);speechSynthesis.speak(u)}catch(e){res(false)}};
  if(location.protocol==='file:')return loc();
  cloudUrl(text,25000).then(u=>{if(my!==seq)return res(false);audio=new Audio(u);audio.playbackRate=rate||1;audio.onended=()=>res(my===seq);audio.onerror=()=>{if(my===seq)loc();else res(false)};return audio.play()}).catch(()=>{if(my===seq)loc();else res(false)});
});
KA.ttsWarm=t=>{const x=String(t||'').replace(/\s+/g,' ').trim().slice(0,1900);if(!x||muted||location.protocol==='file:')return;cloudUrl(x,25000).catch(()=>{})};
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
  ear:'<path d="M6 8.5a6 6 0 1 1 12 0c0 3-2 4.2-3 5.5-.9 1.2-.9 2.4-1.6 3.6A3 3 0 0 1 8 16"/><path d="M10 8.5a2 2 0 1 1 4 0c0 1.2-1 1.7-1.5 2.3"/>',
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
const LINKS=[['index.html','Ana sayfa','home'],['haber.html','Haber','news'],['oyunlar.html','Oyunlar','sword'],['sinav.html','Sınav','exam'],['sozluk.html','Sözlük','book'],['dinle.html','Dinle','ear']];
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

/* ---------- Alt bilgi ---------- */
addEventListener('DOMContentLoaded',()=>{if(document.querySelector('.ka-foot'))return;const m=document.querySelector('main');if(m)m.insertAdjacentHTML('afterend','<footer class="ka-foot"><a href="gizlilik.html">Gizlilik politikası</a><span>·</span><span>Kelime Arenası</span></footer>')});

/* ---------- Uygulama: çevrimdışı çalışma ---------- */

/* ================= YENİ ARAYÜZ KATMANI ================= */
(function(){
const calm=matchMedia('(prefers-reduced-motion:reduce)').matches,root=document.documentElement;
const cssv=v=>getComputedStyle(root).getPropertyValue(v).trim();
let PX=innerWidth/2,PY=innerHeight/2,PT=null;
addEventListener('pointerdown',e=>{PX=e.clientX;PY=e.clientY;PT=e.target},true);
/* konfeti */
let cv=null,cx=null,parts=[],raf=0;
function canvas(){if(cv)return;cv=document.createElement('canvas');cv.id='kaFx';cv.setAttribute('aria-hidden','true');document.body.appendChild(cv);cx=cv.getContext('2d');const fit=()=>{const r=Math.min(2,devicePixelRatio||1);cv.width=innerWidth*r;cv.height=innerHeight*r;cx.setTransform(r,0,0,r,0,0)};addEventListener('resize',fit);fit()}
function step(){cx.clearRect(0,0,innerWidth,innerHeight);
  parts.forEach(p=>{p.vy+=.32;p.vx*=.985;p.x+=p.vx;p.y+=p.vy;p.r+=p.vr;p.life-=.011;cx.save();cx.translate(p.x,p.y);cx.rotate(p.r);cx.globalAlpha=Math.max(0,Math.min(1,p.life*2));cx.fillStyle=cx.strokeStyle=p.c;
    if(p.k===0)cx.fillRect(-p.s/2,-p.s/3,p.s,p.s*.66);else if(p.k===1){cx.lineWidth=2.6;cx.lineCap='round';cx.beginPath();cx.arc(0,0,p.s*.6,Math.PI,0);cx.stroke()}else{cx.beginPath();cx.arc(0,0,p.s*.32,0,6.3);cx.fill()}cx.restore()});
  parts=parts.filter(p=>p.life>0&&p.y<innerHeight+40);raf=parts.length?requestAnimationFrame(step):0;if(!raf)cx.clearRect(0,0,innerWidth,innerHeight)}
KA.confetti=(x,y,n,spread)=>{if(calm)return;try{canvas();const cols=[cssv('--p'),cssv('--p2'),cssv('--acc'),cssv('--acc2'),cssv('--ok')];
  for(let i=0;i<n;i++){const a=-Math.PI/2+(Math.random()-.5)*(spread||Math.PI),v=5+Math.random()*9;parts.push({x,y,vx:Math.cos(a)*v,vy:Math.sin(a)*v,r:Math.random()*6.2,vr:(Math.random()-.5)*.4,s:5+Math.random()*6,c:cols[i%cols.length],k:i%3,life:1})}
  if(parts.length>400)parts=parts.slice(-400);if(!raf)raf=requestAnimationFrame(step)}catch(e){}};
/* ses kancaları: doğru → küçük patlama, tur sonu → büyük konfeti, yanlış → titreme */
if(KA.sfx){const o=KA.sfx.ok,w=KA.sfx.win,b=KA.sfx.bad;let lw=0;
  KA.sfx.ok=function(){try{KA.confetti(PX,PY,14,Math.PI*.8)}catch(e){}return o.apply(this,arguments)};
  KA.sfx.win=function(){try{const t=Date.now();if(t-lw>1500){lw=t;KA.confetti(innerWidth*.25,innerHeight*.6,45,Math.PI*.6);KA.confetti(innerWidth*.75,innerHeight*.6,45,Math.PI*.6)}}catch(e){}return w.apply(this,arguments)};
  KA.sfx.bad=function(){try{const el=PT&&PT.closest&&PT.closest('button');if(el&&document.contains(el)){el.classList.remove('ka-shake');void el.offsetWidth;el.classList.add('ka-shake');setTimeout(()=>el.classList.remove('ka-shake'),500)}}catch(e){}return b.apply(this,arguments)}}
/* puan sayacı: rakamlar döner, puanlar sayaca uçar */
function roll(box,n){const s=String(n);if(box.children.length!==s.length)box.innerHTML=s.split('').map(()=>'<span class="ka-dg"><i>'+'0123456789'.split('').map(d=>'<u>'+d+'</u>').join('')+'</i></span>').join('');
  requestAnimationFrame(()=>[...box.children].forEach((d,i)=>{d.firstChild.style.transform='translateY(-'+s[i]+'em)'}));box.dataset.v=n;box.setAttribute('aria-label',s)}
const oldRefresh=KA.refreshChips;
KA.refreshChips=()=>{
  const x=document.getElementById('kaXp');if(!x)return oldRefresh();
  const prev=x.dataset.v===undefined?null:+x.dataset.v;
  const s=document.getElementById('kaStreak');if(s)s.textContent=KA.streak(KA.meta());
  const now=KA.totalXp();if(prev===now)return;
  const chip=x.closest('.ka-chip');
  if(prev===null||now<prev||calm||!document.body.animate||document.hidden)return roll(x,now);
  const b=chip.getBoundingClientRect(),dx=b.left+b.width/2-PX,dy=b.top+b.height/2-PY,N=Math.min(6,Math.max(3,now-prev));
  for(let i=0;i<N;i++){const c=document.createElement('div');c.className='ka-coin';c.style.left=PX+'px';c.style.top=PY+'px';document.body.appendChild(c);
    const sx=(Math.random()-.5)*120,sy=-40-Math.random()*70;
    const an=c.animate([{transform:'translate(0,0) scale(.4)',opacity:0},{transform:`translate(${sx}px,${sy}px) scale(1.15)`,opacity:1,offset:.3},{transform:`translate(${dx}px,${dy}px) scale(.5)`,opacity:1}],{duration:750,delay:i*50,easing:'cubic-bezier(.5,0,.3,1)',fill:'both'});
    an.onfinish=an.oncancel=()=>{c.remove();if(i===N-1){roll(x,KA.totalXp());chip.classList.remove('bump');void chip.offsetWidth;chip.classList.add('bump')}}}
};
/* menü: kayan vurgu */
function ind(box){if(!box)return;let i=box.querySelector('.ka-ind');const on=box.querySelector('a.on');
  if(!on||!box.offsetParent){if(i)i.style.opacity=0;box.classList.remove('has-ind');return}
  if(!i){i=document.createElement('span');i.className='ka-ind';box.prepend(i);i.style.transition='none';requestAnimationFrame(()=>requestAnimationFrame(()=>{i.style.transition=''}))}
  box.classList.add('has-ind');i.style.opacity=1;i.style.width=on.offsetWidth+'px';i.style.transform='translateX('+on.offsetLeft+'px)'}
const inds=()=>{ind(document.querySelector('.ka-links'));ind(document.querySelector('.ka-tabbar'))};
const oldNav=KA.nav;KA.nav=function(){const r=oldNav.apply(this,arguments);inds();const x=document.getElementById('kaXp');if(x){delete x.dataset.v;x.textContent='';roll(x,KA.totalXp())}return r};
addEventListener('resize',inds);addEventListener('load',inds);if(document.fonts&&document.fonts.ready)document.fonts.ready.then(inds);
/* sayfa geçişi: kemer */
function gate(cls){let g=document.querySelector('.ka-gate');if(!g){g=document.createElement('div');g.className='ka-gate';g.setAttribute('aria-hidden','true');g.innerHTML='<img src="favicon.svg" alt="">';document.body.appendChild(g)}g.className='ka-gate '+cls;return g}
try{if(sessionStorage.getItem('ka_gate')){sessionStorage.removeItem('ka_gate');if(!calm){const g=gate('hold');root.classList.remove('ka-gin');requestAnimationFrame(()=>requestAnimationFrame(()=>{g.className='ka-gate leave';setTimeout(()=>g.remove(),520)}))}}}catch(e){}
root.classList.remove('ka-gin');
addEventListener('pageshow',e=>{if(e.persisted){const g=document.querySelector('.ka-gate');if(g)g.remove();root.classList.remove('ka-gin')}});
document.addEventListener('click',e=>{
  if(calm||e.defaultPrevented||e.button||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;
  const a=e.target.closest&&e.target.closest('a[href]');if(!a||a.target==='_blank'||a.hasAttribute('download'))return;
  let u;try{u=new URL(a.href,location.href)}catch(err){return}
  if(u.origin!==location.origin||!/^https?:$/.test(u.protocol))return;
  if(u.pathname===location.pathname&&u.search===location.search)return;
  if(!/(\.html|\/)$/.test(u.pathname))return;
  e.preventDefault();
  const on=a.closest('.ka-links,.ka-tabbar');if(on){on.querySelectorAll('a').forEach(l=>l.classList.toggle('on',l===a));ind(on)}
  const g=gate('cover');try{sessionStorage.setItem('ka_gate','1')}catch(err){}
  setTimeout(()=>{location.href=u.href},270);
  setTimeout(()=>{g.remove();try{sessionStorage.removeItem('ka_gate')}catch(err){}},4000);
});
/* açık / koyu: dokunulan yerden daire açılır */
KA.fxMode=(btn,v)=>{
  if(calm||!document.startViewTransition||KA.mode()===v)return KA.mode(v);
  const r=btn.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,R=Math.hypot(Math.max(x,innerWidth-x),Math.max(y,innerHeight-y));
  let t;try{t=document.startViewTransition(()=>KA.mode(v))}catch(err){return KA.mode(v)}
  t.ready.then(()=>root.animate({clipPath:[`circle(0px at ${x}px ${y}px)`,`circle(${R}px at ${x}px ${y}px)`]},{duration:620,easing:'cubic-bezier(.4,0,.2,1)',pseudoElement:'::view-transition-new(root)'})).catch(()=>{});
};
/* kart: sürükleyerek cevapla */
let drag=null,eat=false;
document.addEventListener('pointerdown',e=>{const c=e.target.closest&&e.target.closest('#flip');if(!c||e.button||e.target.closest('[data-stop],button,a'))return;drag={c,x:e.clientX,dx:0,moved:false}});
document.addEventListener('pointermove',e=>{if(!drag)return;drag.dx=e.clientX-drag.x;if(!drag.moved&&Math.abs(drag.dx)<8)return;
  if(!drag.moved){drag.moved=true;const c=drag.c;c.style.animation='none';c.style.transition='none';if(!c.querySelector('.kstamp'))c.insertAdjacentHTML('beforeend','<span class="kstamp yes">BİLİYORUM</span><span class="kstamp again">TEKRAR</span>')}
  const c=drag.c;c.style.transform=`translate(${drag.dx}px,${Math.abs(drag.dx)*.06}px) rotate(${drag.dx*.06}deg)`;
  c.querySelector('.yes').style.opacity=Math.max(0,Math.min(1,drag.dx/90));c.querySelector('.again').style.opacity=Math.max(0,Math.min(1,-drag.dx/90))});
const dragEnd=()=>{if(!drag)return;const d=drag;drag=null;if(!d.moved)return;eat=true;setTimeout(()=>{eat=false},60);const c=d.c;
  if(Math.abs(d.dx)>110){const dir=d.dx>0?1:-1;c.style.transition='transform .3s cubic-bezier(.5,0,.8,.4),opacity .3s';c.style.transform=`translate(${dir*innerWidth*.7}px,60px) rotate(${dir*24}deg)`;c.style.opacity=0;
    setTimeout(()=>{const b=document.querySelector(`[data-k="${dir>0?1:0}"]`);if(b)b.click();else{c.style.transition='';c.style.transform='';c.style.opacity=''}},calm?0:280);return}
  c.style.transition='transform .45s cubic-bezier(.34,1.56,.64,1)';c.style.transform='';c.querySelectorAll('.kstamp').forEach(s=>{s.style.opacity=0})};
document.addEventListener('pointerup',dragEnd);document.addEventListener('pointercancel',dragEnd);
document.addEventListener('click',e=>{if(eat&&e.target.closest&&e.target.closest('#flip')){e.stopPropagation();e.preventDefault()}},true);
})();


/* ---------- Hız ve yumuşaklık ---------- */
(function(){
// kota dolunca bir kez sessizce bekleyip yeniden dene
const ai0=KA.ai;KA.ai=async(p,o={})=>{try{return await ai0(p,o)}catch(e){if(/Çok fazla istek/.test(e.message||'')&&!o._re){await new Promise(r=>setTimeout(r,6000));return ai0(p,Object.assign({},o,{_re:1}))}throw e}};
// uzun metinler cihazın kendi sesiyle hemen okunur; doğal ses kotası tek kelimelere kalır
const sp0=KA.speak,spP0=KA.speakP;
const local=(t,rate,done)=>{try{speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(String(t).slice(0,1900));u.lang='en-US';u.rate=(rate||1)*.95;const v=speechSynthesis.getVoices().find(x=>/^en[-_]US/i.test(x.lang)&&/Samantha|Google US|Aria|Jenny/i.test(x.name))||speechSynthesis.getVoices().find(x=>/^en/i.test(x.lang));if(v)u.voice=v;u.onend=()=>done&&done(true);u.onerror=()=>done&&done(false);speechSynthesis.speak(u);return true}catch(e){return false}};
const long=t=>String(t||'').trim().length>70&&'speechSynthesis' in window&&!(KA.muted&&KA.muted());
KA.speak=(t,r)=>{if(long(t)){if(KA.stopSpeak)try{KA.stopSpeak()}catch(e){}if(local(t,r))return}return sp0(t,r)};
if(spP0)KA.speakP=(t,r)=>long(t)?new Promise(res=>{try{KA.stopSpeak()}catch(e){}if(!local(t,r,res))spP0(t,r).then(res)}):spP0(t,r);
KA.ttsWarm=()=>{};
// sayfalar önceden hazırlanır: menüye gelince hedef sayfa arka planda indirilir
const seen=new Set();const pre=e=>{const a=e.target.closest&&e.target.closest('a[href]');if(!a)return;let u;try{u=new URL(a.href,location.href)}catch(x){return}if(u.origin!==location.origin||!/\.html$|\/$/.test(u.pathname)||u.pathname===location.pathname||seen.has(u.pathname))return;seen.add(u.pathname);const l=document.createElement('link');l.rel='prefetch';l.href=u.pathname;document.head.appendChild(l)};
document.addEventListener('pointerover',pre,{passive:true});document.addEventListener('touchstart',pre,{passive:true});
})();
if('serviceWorker' in navigator&&location.protocol==='https:'&&!/claude\.ai|claudeusercontent/.test(location.host))addEventListener('load',()=>{navigator.serviceWorker.register('sw.js').catch(()=>{})});

/* ---------- Kendi yapay zekân (kullanıcı anahtarı) ---------- */
(function(){
const K='ka_ai',QK='ka_aiq',LIM=20;
const rd=k=>{try{return JSON.parse(localStorage.getItem(k))}catch(e){return null}};
const wr=(k,v)=>{try{v==null?localStorage.removeItem(k):localStorage.setItem(k,JSON.stringify(v))}catch(e){}};
const today=()=>{const d=new Date();return d.getFullYear()+'-'+(d.getMonth()+1)+'-'+d.getDate()};
const quota=()=>{let o=rd(QK);if(!o||o.d!==today())o={d:today(),n:0};return o};
const conf=()=>{const c=rd(K);return c&&c.key?c:null};
KA.aiConf=conf;
KA.aiLeft=()=>Math.max(0,LIM-quota().n);
KA.aiLimit=LIM;
const detect=k=>{k=String(k||'').trim();if(/^AIza[0-9A-Za-z_\-]{30,}$/.test(k))return 'gemini';if(/^gsk_[0-9A-Za-z]{20,}$/.test(k))return 'groq';return null};
KA.aiDetect=detect;
class KeyErr extends Error{}
/* Gemini, doğrudan tarayıcıdan */
async function gemini(key,prompt,o,signal){
  const quick=o.tier==='quick',ocr=o.mode==='ocr';
  const models=quick?['gemini-2.5-flash-lite','gemini-2.5-flash','gemini-flash-lite-latest','gemini-flash-latest']:['gemini-2.5-flash','gemini-2.5-flash-lite','gemini-flash-latest','gemini-flash-lite-latest'];
  const parts=o.image?[{inline_data:{mime_type:o.image.mime,data:o.image.data}},{text:prompt}]:[{text:prompt}];
  let last='';
  for(const m of models){
    for(const plain of [false,true]){
      const gen={temperature:ocr?0:0.7,maxOutputTokens:ocr?24000:quick?4096:8192};
      if(!plain){if(/2\.5-flash/.test(m))gen.thinkingConfig={thinkingBudget:0};if(o.json)gen.responseMimeType='application/json'}
      let r,j={};
      try{r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`,{method:'POST',headers:{'content-type':'application/json','x-goog-api-key':key},body:JSON.stringify({contents:[{role:'user',parts}],generationConfig:gen}),signal});j=await r.json().catch(()=>({}))}
      catch(e){if(e.name==='AbortError')throw e;throw new Error('Bağlantı koptu. İnternetini kontrol edip tekrar dene.')}
      const msg=(j.error&&j.error.message)||'';
      if(r.ok){const c=j.candidates&&j.candidates[0];const t=c&&c.content&&Array.isArray(c.content.parts)?c.content.parts.filter(p=>!p.thought).map(p=>p.text||'').join(''):'';if(t.trim())return t;last='boş yanıt';break}
      if(r.status===400&&/api key|API_KEY/i.test(msg)||r.status===401||r.status===403)throw new KeyErr('Bağlantı kodun geçersiz ya da kapatılmış.');
      if(r.status===400&&!plain&&!/model/i.test(msg))continue;
      last=m+' ('+r.status+'): '+msg.slice(0,120);
      if(r.status===429){await new Promise(x=>setTimeout(x,1500));break}
      break;
    }
  }
  if(/429/.test(last))throw new Error('Kendi yapay zekânın dakikalık kotası doldu; birkaç saniye bekleyip tekrar dene.');
  throw new Error('Yapay zekâ yanıt vermedi. '+(last?'['+last+']':''));
}
/* Groq, doğrudan tarayıcıdan */
async function groq(key,prompt,o,signal){
  const models=o.tier==='quick'?['openai/gpt-oss-20b','openai/gpt-oss-120b','llama-3.3-70b-versatile']:['openai/gpt-oss-120b','openai/gpt-oss-20b','llama-3.3-70b-versatile'];
  let last='';
  for(const m of models){
    const body={model:m,messages:[{role:'user',content:prompt}],temperature:0.7,max_completion_tokens:o.tier==='quick'?4096:8192};
    if(/gpt-oss/.test(m))body.reasoning_effort='low';
    if(o.json&&/json/i.test(prompt))body.response_format={type:'json_object'};
    for(let k=0;k<2;k++){
      let r,j={};
      try{r=await fetch('https://api.groq.com/openai/v1/chat/completions',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+key},body:JSON.stringify(body),signal});j=await r.json().catch(()=>({}))}
      catch(e){if(e.name==='AbortError')throw e;throw new Error('Bağlantı koptu. İnternetini kontrol edip tekrar dene.')}
      if(r.ok){const t=j.choices&&j.choices[0]&&j.choices[0].message&&j.choices[0].message.content||'';if(t.trim())return t;last='boş yanıt';break}
      if(r.status===401||r.status===403)throw new KeyErr('Bağlantı kodun geçersiz ya da kapatılmış.');
      last=m+' ('+r.status+'): '+((j.error&&j.error.message)||'').slice(0,120);
      if(r.status===400&&k===0){delete body.response_format;delete body.reasoning_effort;continue}
      break;
    }
  }
  if(/429/.test(last))throw new Error('Kendi yapay zekânın dakikalık kotası doldu; birkaç saniye bekleyip tekrar dene.');
  throw new Error('Yapay zekâ yanıt vermedi. '+(last?'['+last+']':''));
}
const slots={n:0,q:[]};
const take=()=>slots.n<4?(slots.n++,Promise.resolve()):new Promise(r=>slots.q.push(r));
const give=()=>{const r=slots.q.shift();if(r)r();else slots.n--};
async function direct(c,p,o){
  await take();const ac=new AbortController(),tm=setTimeout(()=>ac.abort(),o.ms||90000);
  try{return c.prov==='groq'?await groq(c.key,p,o,ac.signal):await gemini(c.key,p,o,ac.signal)}
  catch(e){if(e.name==='AbortError')throw new Error('Zaman aşımı, tekrar dene.');throw e}
  finally{clearTimeout(tm);give()}
}
KA.aiTest=async(prov,key)=>{const c={prov,key};const t=await direct(c,'Reply with exactly one word: OK',{tier:'quick',ms:25000});return /ok/i.test(t)};
const base=KA.ai;
KA.ai=async(p,o={})=>{
  const c=conf();
  if(c&&(!o.image||c.prov==='gemini')){
    try{return await direct(c,p,o)}
    catch(e){if(e instanceof KeyErr){KA.aiWizard('bad');throw new Error(e.message+' Yeni bir kod ekle.')}throw e}
  }
  const Q=quota();
  if(Q.n>=LIM){KA.aiWizard('limit');throw new Error('Bugünkü ücretsiz deneme hakların bitti. Kendi yapay zekânı bağlarsan sınırsız devam edersin.')}
  const r=await base(p,o);
  const Q2=quota();Q2.n++;wr(QK,Q2);chip();
  const left=LIM-Q2.n;
  if(left===5)KA.toast&&KA.toast('5 deneme hakkın kaldı. Kendi yapay zekânı bağlarsan sınırsız olur.');
  return r;
};
/* ---------- üst çubuktaki gösterge ---------- */
function chip(){
  const t=document.querySelector('.ka-tools');if(!t)return;
  let b=document.getElementById('kaAi');
  if(!b){b=document.createElement('button');b.id='kaAi';b.className='ka-chip ka-ai';b.type='button';t.prepend(b)}
  const c=conf(),l=KA.aiLeft();
  b.classList.toggle('on',!!c);b.classList.toggle('low',!c&&l<=5);
  b.title=c?'Kendi yapay zekân bağlı':'Bugün kalan ücretsiz yapay zekâ hakkı';
  b.innerHTML=c?`<span class="dot"></span><b>YZ bağlı</b>`:`<span class="spk">✦</span><b>${l}</b><small>hak</small>`;
}
const nav0=KA.nav;KA.nav=function(){const r=nav0.apply(this,arguments);chip();return r};
/* ilk ziyarette ve birkaç günde bir: göze çarpan davet */
function banner(){
  if(conf()||document.querySelector('.aiw,.aiw-ban'))return;
  const st=rd('ka_aiban')||{};if(st.until&&Date.now()<st.until)return;
  const l=KA.aiLeft(),d=document.createElement('div');d.className='aiw-ban';
  d.innerHTML=`<span class="aiw-ic sm">✦</span><div><b>Kendi yapay zekânı bağla</b><small>Ücretsiz, 1 dakika. Bağlayınca her şey daha hızlı ve sınırsız. Bugün ${l} deneme hakkın var.</small></div><button class="btn btn-p btn-sm" data-aiban="go">Bağla</button><button class="aiw-bx" data-aiban="later" aria-label="Sonra">×</button>`;
  document.body.appendChild(d);requestAnimationFrame(()=>d.classList.add('in'));
}
document.addEventListener('click',e=>{const b=e.target.closest('[data-aiban]');if(!b)return;const d=document.querySelector('.aiw-ban');if(b.dataset.aiban==='go'){d&&d.remove();KA.aiWizard('')}else{wr('ka_aiban',{until:Date.now()+3*864e5});d&&d.remove()}});
const boot=()=>{chip();if(/^#(yz|yapay-zeka)$/i.test(location.hash))KA.aiWizard('');else setTimeout(banner,1800)};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else setTimeout(boot,0);
/* ---------- bağlama sihirbazı ---------- */
const MOCK={
 g1:`<div class="mk"><div class="mk-bar"><i></i><i></i><i></i><span>aistudio.google.com/apikey</span></div><div class="mk-body"><div class="mk-g"><b style="color:#4285f4">G</b><b style="color:#ea4335">o</b><b style="color:#fbbc05">o</b><b style="color:#4285f4">g</b><b style="color:#34a853">l</b><b style="color:#ea4335">e</b></div><div class="mk-line">Oturum açın</div><div class="mk-in">ornek@gmail.com</div><div class="mk-btn">İleri</div></div></div>`,
 g2:`<div class="mk"><div class="mk-bar"><i></i><i></i><i></i><span>Google AI Studio</span></div><div class="mk-body"><div class="mk-line" style="font-weight:800">API Keys</div><div class="mk-row"><span>Henüz anahtar yok</span><span class="mk-btn hot">Create API key</span></div><div class="mk-hand">☝</div></div></div>`,
 g3:`<div class="mk"><div class="mk-bar"><i></i><i></i><i></i><span>Google AI Studio</span></div><div class="mk-body"><div class="mk-row key"><code>AIzaSyB•••••••••••••••Xk4</code><span class="mk-copy hot">⧉ Copy</span></div><div class="mk-hand">☝</div></div></div>`,
 r1:`<div class="mk"><div class="mk-bar"><i></i><i></i><i></i><span>console.groq.com/keys</span></div><div class="mk-body"><div class="mk-line" style="font-weight:800">groq</div><div class="mk-btn" style="background:#fff;color:#111;border:1px solid #ddd">Continue with Google</div></div></div>`,
 r2:`<div class="mk"><div class="mk-bar"><i></i><i></i><i></i><span>GroqCloud · API Keys</span></div><div class="mk-body"><div class="mk-row"><span>API Keys</span><span class="mk-btn hot" style="background:#f55036">Create API Key</span></div><div class="mk-hand">☝</div></div></div>`,
 r3:`<div class="mk"><div class="mk-bar"><i></i><i></i><i></i><span>GroqCloud</span></div><div class="mk-body"><div class="mk-row key"><code>gsk_8Fq•••••••••••••••2mZ</code><span class="mk-copy hot">⧉ Copy</span></div><div class="mk-hand">☝</div></div></div>`
};
const STEPS={
 gemini:{n:'Google Gemini',tag:'Önerilen',url:'https://aistudio.google.com/apikey',steps:[
  ['Google sayfasını aç','Aşağıdaki düğmeye bas. Sayfa yeni sekmede açılır; bu sekme açık kalır.','g1','Google hesabınla giriş yap. İlk seferde şartları onaylamanı isterse kutucukları işaretleyip devam et.'],
  ['"Create API key" düğmesine bas','Sayfadaki mavi düğme. Proje sorarsa varsayılanı bırak ve oluştur.','g2',''],
  ['Kodu kopyala','"AIza" ile başlayan uzun kodun yanındaki kopyala simgesine bas, sonra bu sekmeye geri dön.','g3','']]},
 groq:{n:'Groq',tag:'Çok hızlı',url:'https://console.groq.com/keys',steps:[
  ['Groq sayfasını aç','Aşağıdaki düğmeye bas ve "Continue with Google" ile giriş yap.','r1',''],
  ['"Create API Key" düğmesine bas','Bir isim ister: "kelime" yazman yeterli, sonra "Submit".','r2',''],
  ['Kodu kopyala','"gsk_" ile başlayan kodu kopyala; bu kod bir daha gösterilmez. Sonra bu sekmeye dön.','r3','Groq fotoğraftan okuma yapmaz; fotoğraf istekleri deneme hakkından kullanılır.']]}
};
let W=null;
KA.aiWizard=(reason)=>{
  if(document.querySelector('.aiw'))return;
  const c=conf();
  W={prov:(c&&c.prov)||'gemini',reason,st:'idle',msg:''};
  const el=document.createElement('div');el.className='aiw';el.innerHTML='<div class="aiw-in" role="dialog" aria-modal="true" aria-label="Kendi yapay zekânı bağla"></div>';
  document.body.appendChild(el);drawW();
  setTimeout(()=>{const i=document.getElementById('aiwKey');i&&!matchMedia('(pointer:coarse)').matches&&i.focus()},200);
};
function drawW(){
  const box=document.querySelector('.aiw-in');if(!box)return;
  const c=conf(),S=STEPS[W.prov],l=KA.aiLeft();
  const why=W.reason==='limit'?`<div class="aiw-why">Bugünkü ${LIM} ücretsiz deneme hakkın bitti. Oyunlar ve kayıtlı içerikler çalışmaya devam ediyor; yapay zekâ özellikleri için kendi bağlantını ekle.</div>`:W.reason==='bad'?`<div class="aiw-why">Kayıtlı bağlantı kodun artık çalışmıyor. Yeni bir kod alıp buraya yapıştır.</div>`:'';
  box.innerHTML=`<button class="aiw-x" data-aiw="close" aria-label="Kapat">×</button>
   <div class="aiw-hd"><span class="aiw-ic">✦</span><div><h2>Kendi yapay zekânı bağla</h2><p>Ücretsiz · kart bilgisi istemez · yaklaşık 1 dakika</p></div></div>
   ${why}
   ${c&&W.st!=='ok'?`<div class="aiw-done"><b>Şu an bağlı: ${STEPS[c.prov].n}</b><span>Kod: ${KA.esc(c.key.slice(0,6))}••••${KA.esc(c.key.slice(-4))}</span><button class="btn btn-ghost btn-sm" data-aiw="remove">Bağlantıyı kaldır</button></div>`:''}
   ${W.st==='ok'?`<div class="aiw-ok"><div class="big">✓</div><h3>Bağlandı!</h3><p>Artık yapay zekâ isteklerin kendi ${STEPS[W.prov].n} hesabından ve sınırsız çalışıyor. Bağlantı kodun sadece bu cihazda, bu tarayıcıda saklanıyor.</p><button class="btn btn-p" data-aiw="close">Harika, devam et</button></div>`:`
   <div class="aiw-tabs">${Object.entries(STEPS).map(([k,v])=>`<button class="${W.prov===k?'on':''}" data-aiw-prov="${k}"><b>${v.n}</b><small>${v.tag}</small></button>`).join('')}</div>
   <ol class="aiw-steps">${S.steps.map(([t,d,mk,note],i)=>`<li><div class="aiw-n">${i+1}</div><div class="aiw-st"><b>${t}</b><p>${d}</p>${i===0?`<a class="btn btn-p" href="${S.url}" target="_blank" rel="noopener">${S.n} sayfasını aç ↗</a>`:''}${MOCK[mk]}${note?`<p class="aiw-note">${note}</p>`:''}</div></li>`).join('')}
    <li><div class="aiw-n">4</div><div class="aiw-st"><b>Kodu buraya yapıştır</b><p>Kodu yapıştırdığın an otomatik olarak denenir.</p>
     <div class="aiw-paste"><input id="aiwKey" type="text" inputmode="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${W.prov==='groq'?'gsk_…':'AIza…'}"><button class="btn btn-ghost btn-sm" data-aiw="clip">Panodan yapıştır</button></div>
     <div class="aiw-msg ${W.st}">${W.st==='test'?'<span class="spin"></span> Deneniyor…':esc(W.msg)}</div>
     <button class="btn btn-p" data-aiw="save" ${W.st==='test'?'disabled':''}>Bağla ve dene</button></div></li></ol>
   <div class="aiw-trust"><div><b>Neden?</b>Herkes kendi ücretsiz kotasını kullanınca site daha hızlı çalışır ve bekleme olmaz.</div><div><b>Güvenli mi?</b>Kod sadece senin cihazında saklanır, sunucumuza gönderilmez. İstediğin an Google'dan silebilirsin.</div><div><b>Ücretli mi?</b>Hayır. Kart bilgisi girmezsen hiçbir ücret çıkmaz.</div></div>
   ${c?'':`<p class="aiw-left">Şimdilik bugün ${l} / ${LIM} ücretsiz deneme hakkın var.${l?' <a href="#" data-aiw="close">Sonra bağlarım</a>':''}</p>`}`}`;
}
async function trySave(v){
  v=String(v||'').trim().replace(/\s+/g,'');
  const p=detect(v);
  if(!v){W.st='err';W.msg='Önce kodu yapıştır.';return drawW()}
  if(!p){W.st='err';W.msg=/^AIza|^gsk_/.test(v)?'Kod eksik görünüyor; tamamını kopyaladığından emin ol.':'Bu bir bağlantı kodu gibi görünmüyor. Gemini kodları "AIza", Groq kodları "gsk_" ile başlar.';return drawW()}
  W.prov=p;W.st='test';drawW();const i=document.getElementById('aiwKey');if(i)i.value=v;
  try{const ok=await KA.aiTest(p,v);if(!ok)throw new Error('Beklenmedik bir yanıt geldi; yine de kaydedildi.');wr(K,{prov:p,key:v,at:Date.now()});W.st='ok';drawW();chip();KA.sfx&&KA.sfx.ok&&KA.sfx.ok();const b=document.querySelector('.aiw-ok .big');if(b&&KA.confetti){const r=b.getBoundingClientRect();KA.confetti(r.left+r.width/2,r.top+r.height/2,30,Math.PI)}}
  catch(e){W.st='err';W.msg=e.message||'Denenemedi.';drawW();const j=document.getElementById('aiwKey');if(j)j.value=v}
}
document.addEventListener('click',async e=>{
  const t=e.target;
  if(t.closest('#kaAi')){KA.aiWizard('');return}
  const a=t.closest('[data-aiw]');const pv=t.closest('[data-aiw-prov]');
  if(pv){W.prov=pv.dataset.aiwProv;W.st='idle';W.msg='';drawW();return}
  if(t.classList&&t.classList.contains('aiw')){document.querySelector('.aiw')?.remove();return}
  if(!a)return;
  const k=a.dataset.aiw;if(a.tagName==='A')e.preventDefault();
  if(k==='close'){document.querySelector('.aiw')?.remove();return}
  if(k==='remove'){wr(K,null);chip();W.st='idle';W.msg='Bağlantı kaldırıldı.';drawW();return}
  if(k==='clip'){try{const v=await navigator.clipboard.readText();const i=document.getElementById('aiwKey');if(i)i.value=v;trySave(v)}catch(err){W.st='err';W.msg='Pano okunamadı. Kutuya uzun basıp "Yapıştır"ı seç.';drawW()}return}
  if(k==='save'){trySave((document.getElementById('aiwKey')||{}).value);return}
});
document.addEventListener('input',e=>{if(e.target.id==='aiwKey'){const v=e.target.value.trim();if(detect(v)&&W.st!=='test')trySave(v)}});
document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelector('.aiw')?.remove()});
})();

/* ---------- Google ile giriş ve bulut eşitleme (isteğe bağlı) ---------- */
(function(){
const CFG=window.KA_FIREBASE;
if(!CFG||!CFG.apiKey||!CFG.projectId)return; // ayar yoksa hiçbir şey görünmez
const V='10.12.2',BASE='https://www.gstatic.com/firebasejs/'+V+'/';
const FLAG='ka_fb',SYNC='ka_fb_sync';
const NOSYNC=new Set(['ka_ai','ka_aiq','ka_aiban','ka_gate','ka_uid','ka_mute',FLAG,SYNC]);
const MAX=800000;
let FB=null,loading=null,user=null,dirty=new Set(),timer=null,applying=false;
const ls={get:k=>{try{return localStorage.getItem(k)}catch(e){return null}},set:(k,v)=>{try{Storage.prototype._kaSet.call(localStorage,k,v)}catch(e){}},del:k=>{try{Storage.prototype._kaDel.call(localStorage,k)}catch(e){}},keys:()=>{try{return Object.keys(localStorage)}catch(e){return[]}}};
const syncable=k=>(k.startsWith('ka_')||k.startsWith('db:'))&&!NOSYNC.has(k);
/* kelime listeleri cihaza özel kimlik içeriyor; bulutta ortak bir biçime çevrilir */
const upre=()=>'db:data/users/'+KA.uid()+'/';
const toCloud=k=>k.startsWith(upre())?'db:data/users/@/'+k.slice(upre().length):k;
const toLocal=k=>k.startsWith('db:data/users/@/')?upre()+k.slice('db:data/users/@/'.length):k;
const enc=k=>encodeURIComponent(k).replace(/\./g,'%2E');
const dec=id=>decodeURIComponent(id);
async function load(){
  if(FB)return FB;if(loading)return loading;
  loading=(async()=>{
    const [a,au,fs]=await Promise.all([import(BASE+'firebase-app.js'),import(BASE+'firebase-auth.js'),import(BASE+'firebase-firestore.js')]);
    const app=a.initializeApp(CFG);const auth=au.getAuth(app);const db=fs.getFirestore(app);
    try{auth.languageCode='tr'}catch(e){}
    FB={au,fs,auth,db};
    au.onAuthStateChanged(auth,u=>{const was=user;user=u||null;if(u){ls.set(FLAG,'1');if(!was){if(ls.get(SYNC))pullNew();else firstSync()}}else ls.del(FLAG);chip();if(document.querySelector('.acc'))drawAcc()});
    try{await au.getRedirectResult(auth)}catch(e){}
    return FB;
  })();
  return loading;
}
const kv=()=>FB.fs.collection(FB.db,'users',user.uid,'kv');
/* ---------- eşitleme ---------- */
async function pullAll(){const s=await FB.fs.getDocs(kv());const out={};s.forEach(d=>{out[dec(d.id)]=d.data()});return out}
function localAll(){const o={};ls.keys().filter(syncable).forEach(k=>{const v=ls.get(k);if(v!=null&&v.length<MAX)o[toCloud(k)]=v});return o}
async function pushKeys(keys){
  if(!user||!keys.length)return;
  const now=Date.now();
  for(let i=0;i<keys.length;i+=400){
    const b=FB.fs.writeBatch(FB.db);
    keys.slice(i,i+400).forEach(ck=>{const lk=toLocal(ck),v=ls.get(lk),ref=FB.fs.doc(kv(),enc(ck));if(v==null)b.delete(ref);else if(v.length<MAX)b.set(ref,{v,t:now})});
    await b.commit();
  }
  ls.set(SYNC,String(now));chip();
}
async function firstSync(){
  try{
    setState('Eşitleniyor…');
    const cloud=await pullAll(),local=localAll();
    const ck=Object.keys(cloud),lk=Object.keys(local);
    let up=[],down=0;
    if(!ck.length){up=lk}
    else{
      applying=true;
      ck.forEach(k=>{const c=cloud[k];if(!(k in local)){ls.set(toLocal(k),c.v);down++}else if(local[k]!==c.v){if(String(c.v).length>=String(local[k]).length){ls.set(toLocal(k),c.v);down++}else up.push(k)}});
      lk.forEach(k=>{if(!(k in cloud))up.push(k)});
      applying=false;
    }
    await pushKeys(up);
    const t=Number(ls.get(SYNC)||0);ls.set('ka_fb_pull',String(t));
    setState('');
    if(down){KA.toast&&KA.toast('Hesabındaki veriler bu cihaza aktarıldı.');setTimeout(()=>{try{sessionStorage.setItem('ka_fb_rl','1')}catch(e){}location.reload()},900)}
    else KA.toast&&KA.toast('Hesabın bağlandı. Verilerin artık bulutta da güvende.');
  }catch(e){applying=false;setState('Eşitlenemedi: '+(e.code||e.message||''))}
}
async function pullNew(){
  if(!user)return;
  try{
    const since=Number(ls.get('ka_fb_pull')||0);
    const q=FB.fs.query(kv(),FB.fs.where('t','>',since));
    const s=await FB.fs.getDocs(q);let n=0,max=since;
    applying=true;
    s.forEach(d=>{const x=d.data(),k=toLocal(dec(d.id));if(x.t>max)max=x.t;if(ls.get(k)!==x.v){ls.set(k,x.v);n++}});
    applying=false;
    ls.set('ka_fb_pull',String(Math.max(max,Number(ls.get(SYNC)||0))));
    let rl=false;try{rl=sessionStorage.getItem('ka_fb_rl')==='1';sessionStorage.removeItem('ka_fb_rl')}catch(e){}
    if(n&&!rl){KA.toast&&KA.toast('Diğer cihazındaki değişiklikler alındı.');setTimeout(()=>{try{sessionStorage.setItem('ka_fb_rl','1')}catch(e){}location.reload()},900)}
  }catch(e){applying=false}
}
function mark(k){if(applying||!user||!syncable(k))return;dirty.add(toCloud(k));clearTimeout(timer);timer=setTimeout(flush,4000)}
async function flush(){const ks=[...dirty];dirty.clear();try{await pushKeys(ks)}catch(e){ks.forEach(k=>dirty.add(k))}}
addEventListener('pagehide',()=>{if(dirty.size)flush()});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&dirty.size)flush();if(document.visibilityState==='visible'&&user)pullNew()});
/* yerel kayıtlardaki her değişikliği yakala */
if(!Storage.prototype._kaSet){
  Storage.prototype._kaSet=Storage.prototype.setItem;Storage.prototype._kaDel=Storage.prototype.removeItem;
  Storage.prototype.setItem=function(k,v){Storage.prototype._kaSet.call(this,k,v);if(this===window.localStorage)mark(String(k))};
  Storage.prototype.removeItem=function(k){Storage.prototype._kaDel.call(this,k);if(this===window.localStorage)mark(String(k))};
}
/* ---------- giriş / çıkış / silme ---------- */
let state='';function setState(t){state=t;if(document.querySelector('.acc'))drawAcc()}
async function signIn(){
  try{
    const f=FB||await load();const p=new f.au.GoogleAuthProvider();p.setCustomParameters({prompt:'select_account'});
    try{await f.au.signInWithPopup(f.auth,p)}
    catch(e){if(/popup-blocked|operation-not-supported/.test(e.code||''))await f.au.signInWithRedirect(f.auth,p);else throw e}
  }catch(e){
    const c=e.code||'';
    setState(/popup-closed|cancelled-popup/.test(c)?'Giriş penceresi kapatıldı.':/unauthorized-domain/.test(c)?'Bu adres Firebase\'de yetkili değil. (Yönetici: Authentication → Settings → Authorized domains)':/network/.test(c)?'İnternet bağlantısı yok gibi görünüyor.':/disallowed|web-storage|internal/.test(c)?'Bu tarayıcı Google girişine izin vermiyor. Siteyi Safari ya da Chrome\'da açıp tekrar dene (Instagram gibi uygulamaların içindeki tarayıcılar engelleniyor).':'Giriş yapılamadı: '+(c||e.message||''));
  }
}
async function signOutNow(){if(dirty.size)await flush();await FB.au.signOut(FB.auth);ls.del(SYNC);ls.del('ka_fb_pull');setState('Çıkış yapıldı. Verilerin bu cihazda kalmaya devam ediyor.')}
async function deleteAll(){
  if(!confirm('Hesabın ve buluttaki bütün verilerin kalıcı olarak silinecek. Bu cihazdaki veriler silinmez. Emin misin?'))return;
  try{
    setState('Siliniyor…');
    const s=await FB.fs.getDocs(kv());const refs=[];s.forEach(d=>refs.push(d.ref));
    for(let i=0;i<refs.length;i+=400){const b=FB.fs.writeBatch(FB.db);refs.slice(i,i+400).forEach(r=>b.delete(r));await b.commit()}
    try{await FB.fs.deleteDoc(FB.fs.doc(FB.db,'users',user.uid))}catch(e){}
    try{await FB.au.deleteUser(user)}catch(e){if(/requires-recent-login/.test(e.code||'')){await FB.au.reauthenticateWithPopup(user,new FB.au.GoogleAuthProvider());await FB.au.deleteUser(FB.auth.currentUser)}else throw e}
    ls.del(SYNC);ls.del('ka_fb_pull');setState('Hesabın ve buluttaki verilerin silindi.');
  }catch(e){setState('Silinemedi: '+(e.code||e.message||''))}
}
/* ---------- arayüz ---------- */
function chip(){
  const t=document.querySelector('.ka-tools');if(!t)return;
  let b=document.getElementById('kaAcc');
  if(!b){b=document.createElement('button');b.id='kaAcc';b.type='button';b.className='ka-chip ka-acc';const ai=document.getElementById('kaAi');ai?ai.after(b):t.prepend(b)}
  if(user){const n=(user.displayName||user.email||'?').trim();b.classList.add('on');b.title='Hesabım: '+(user.email||'');const ini=`<span class="ini">${KA.esc(n[0].toUpperCase())}</span>`;b.innerHTML=user.photoURL?`<img src="${KA.esc(user.photoURL)}" alt="" referrerpolicy="no-referrer">`:ini;const im=b.querySelector('img');if(im){const bad=()=>{b.innerHTML=ini};im.onerror=bad;if(im.complete&&!im.naturalWidth)bad()}}
  else{b.classList.remove('on');b.title='Google ile giriş yap';b.innerHTML=`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg><b>Giriş</b>`}
}
const GLOGO='<svg viewBox="0 0 48 48" width="20" height="20"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';
function openAcc(){if(document.querySelector('.acc'))return;const d=document.createElement('div');d.className='acc aiw';d.innerHTML='<div class="aiw-in" role="dialog" aria-modal="true" aria-label="Hesabım"></div>';document.body.appendChild(d);drawAcc();load().catch(()=>setState('Giriş sistemi yüklenemedi. İnternetini kontrol et.'))}
function drawAcc(){
  const box=document.querySelector('.acc .aiw-in');if(!box)return;
  const last=Number(ls.get(SYNC)||0);
  box.innerHTML=`<button class="aiw-x" data-acc="close" aria-label="Kapat">×</button>
   <div class="aiw-hd"><span class="aiw-ic">${user&&user.photoURL?`<img src="${KA.esc(user.photoURL)}" alt="" referrerpolicy="no-referrer" style="width:100%;height:100%;border-radius:15px">`:'☁'}</span><div><h2>${user?KA.esc(user.displayName||'Hesabım'):'Hesabınla giriş yap'}</h2><p>${user?KA.esc(user.email||''):'İsteğe bağlı · verilerin bütün cihazlarında'}</p></div></div>
   ${user?`<div class="acc-box"><div><b>Eşitleme açık</b><span>${last?'Son eşitleme: '+new Date(last).toLocaleString('tr-TR',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'Henüz eşitlenmedi'}</span></div><button class="btn btn-ghost btn-sm" data-acc="sync">Şimdi eşitle</button></div>
     <p class="acc-p">Kelime listelerin, ilerlemen, XP'n, oyun ve dava kayıtların bu hesapla bütün cihazlarında aynı kalır. Yapay zekâ bağlantı kodun güvenlik için buluta gönderilmez; her cihazda ayrı eklenir.</p>
     <div class="acc-row"><button class="btn btn-ghost" data-acc="out">Çıkış yap</button><button class="btn btn-ghost acc-del" data-acc="del">Hesabımı ve buluttaki verilerimi sil</button></div>`
   :`<ul class="acc-list"><li><b>Telefon değişse de kaybolmaz.</b> Listelerin ve ilerlemen hesabında saklanır.</li><li><b>Bilgisayar ve telefon aynı.</b> Birinde eklediğin kelime diğerinde de olur.</li><li><b>Zorunlu değil.</b> Giriş yapmadan da her şey şimdiki gibi çalışır.</li></ul>
     <button class="acc-g" data-acc="in">${GLOGO}<span>Google ile giriş yap</span></button>
     <p class="acc-small">Sadece adın, e-posta adresin ve profil fotoğrafın alınır; şifren hiçbir zaman bize ulaşmaz. Bu cihazdaki verilerin hesabınla birleştirilir. <a href="gizlilik.html">Gizlilik politikası</a></p>`}
   ${state?`<div class="aiw-msg ${/Eşitleniyor|Siliniyor/.test(state)?'test':/silindi|Çıkış yapıldı/.test(state)?'':'err'}" style="margin-top:12px">${/Eşitleniyor|Siliniyor/.test(state)?'<span class="spin"></span> ':''}${KA.esc(state)}</div>`:''}`;
}
document.addEventListener('click',e=>{
  if(e.target.closest('#kaAcc')){openAcc();return}
  const a=e.target.closest('[data-acc]');
  if(e.target.classList&&e.target.classList.contains('acc')){document.querySelector('.acc')?.remove();return}
  if(!a)return;const k=a.dataset.acc;
  if(k==='close'){document.querySelector('.acc')?.remove();state='';return}
  if(k==='in'){setState('');signIn();return}
  if(k==='out'){signOutNow();return}
  if(k==='sync'){setState('Eşitleniyor…');pushKeys(Object.keys(localAll())).then(()=>pullNew()).then(()=>setState('')).catch(err=>setState('Eşitlenemedi: '+(err.code||err.message||'')));return}
  if(k==='del'){deleteAll();return}
});
const nav1=KA.nav;KA.nav=function(){const r=nav1.apply(this,arguments);chip();return r};
const boot=()=>{chip();if(ls.get(FLAG)==='1')load().catch(()=>{})};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else setTimeout(boot,0);
})();

/* ---------- Başlangıç ---------- */
document.addEventListener('click',e=>{
  const mb=e.target.closest('.ka-mode button');if(mb){KA.fxMode?KA.fxMode(mb,mb.dataset.m):KA.mode(mb.dataset.m);return}
  if(e.target.closest('[data-ka-snd]')){KA.muted(!muted);return}
});
})();
