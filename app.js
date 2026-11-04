'use strict';
const APP_URL=location.origin+location.pathname.replace(/index\.html$/,'');
const $=s=>document.querySelector(s), LS=localStorage;
const J=(k,d)=>{try{return JSON.parse(LS.getItem(k))??d}catch(e){return d}}, S=(k,v)=>LS.setItem(k,JSON.stringify(v));
const DAY=864e5, M=42.195;
let state={runs:J('r42_runs',[]),strava:J('r42_strava',{}),cfg:J('r42_cfg',{}),plan:J('r42_plan',null),demo:J('r42_demo',false),be:J('r42_be',{})};
if(state.demo&&(state.strava.access_token||state.runs.some(r=>r.src=='strava')))state.demo=false;
function save(){S('r42_runs',state.runs);S('r42_strava',state.strava);S('r42_cfg',state.cfg);S('r42_plan',state.plan);S('r42_demo',state.demo);S('r42_be',state.be)}
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmtT=s=>{s=Math.round(s);const h=Math.floor(s/3600),m=Math.floor(s%3600/60),x=s%60;return(h?h+':'+String(m).padStart(2,'0'):m)+':'+String(x).padStart(2,'0')};
const fmtP=spk=>isFinite(spk)&&spk>0?fmtT(spk)+'/km':'–';
const ymd=d=>{d=new Date(d);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')};
const monday=d=>{d=new Date(d);d.setHours(0,0,0,0);d.setDate(d.getDate()-((d.getDay()+6)%7));return d};

/* ---------- demo data (clearly sample) ---------- */
function demoRuns(){let seed=7;const r=()=>(seed=(seed*16807)%2147483647)/2147483647;const out=[];const start=monday(Date.now()-16*7*DAY);
 for(let w=0;w<16;w++){const vol=14+w*1.6*(w%4==3?.7:1);const days=[1,3,5,6];days.forEach((dd,i)=>{const long=i==3;let km=long?Math.min(6+w*.75,18):vol/5*(0.8+r()*.4);km=+km.toFixed(2);
  const pace=(long?400:370)-w*2.2+r()*20;const d=new Date(+start+(w*7+dd)*DAY+7*36e5);if(d>Date.now())return;
  out.push({id:'demo'+w+i,date:d.toISOString(),km,sec:Math.round(km*pace),name:long?'Sample long run':'Sample easy run',src:'demo'})})}
 return out}
const runs=()=>(state.demo?demoRuns():state.runs).slice().sort((a,b)=>new Date(a.date)-new Date(b.date));

/* ---------- Strava ---------- */
const STANDALONE=matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
const SCOPE='read,activity:read_all';
let diag=[];const dlog=(ok,m)=>{diag.push((ok===null?'… ':ok?'✅ ':'❌ ')+m);const el=$('#diag');if(el)el.textContent=diag.join('\n')};
async function tokenPost(params){let r;
 // form-encoded body = "simple" CORS request, no preflight needed
 try{r=await fetch('https://www.strava.com/oauth/token',{method:'POST',body:new URLSearchParams(params)})}catch(e){throw Error('Could not reach Strava (network/CORS: '+e.message+'). Check internet and try again.')}
 let j={};try{j=await r.json()}catch(e){}
 if(!r.ok){const f=(j.errors||[]).map(x=>(x.resource||'')+' '+x.field+' '+x.code).join(', ');let m='Strava '+r.status+' '+(j.message||'')+(f?' ['+f+']':'');
  if(/client_id|client_secret|Application/i.test(f))m+=' → Client ID or Client Secret is wrong. Re-copy both from strava.com/settings/api (no spaces).';
  else if(/code/i.test(f))m+=' → This approval code is invalid, expired or already used. Tap Connect Strava again.';
  else if(/refresh/i.test(f))m+=' → Saved login expired. Tap Disconnect, then Connect Strava again.';
  throw Error(m)}return j}
async function stravaToken(){const s=state.strava,c=state.cfg;if(!s.access_token)throw Error('Not connected. Tap Connect Strava first.');
 if(!s.expires_at||s.expires_at*1000<Date.now()+60e3){const j=await tokenPost({client_id:c.cid,client_secret:c.csec,grant_type:'refresh_token',refresh_token:s.refresh_token});Object.assign(s,j);save()}return s.access_token}
async function sget(p){const t=await stravaToken();let r;try{r=await fetch('https://www.strava.com/api/v3'+p,{headers:{Authorization:'Bearer '+t}})}catch(e){throw Error('Could not reach Strava API ('+e.message+')')}
 if(!r.ok){const b=(await r.text()).slice(0,200);let m='Strava API '+r.status+' '+b;
  if(r.status==401&&/activity:read/.test(b))m='Strava did not grant permission to read activities. Tap Disconnect, Connect Strava again and leave "View data about your activities" ticked.';
  else if(r.status==401)m+=' → Tap Disconnect, then Connect Strava again.';else if(r.status==429)m='Strava rate limit reached. Wait 15 minutes and try again.';
  throw Error(m)}return r.json()}
function connect(){const c=state.cfg;if(!c.cid||!c.csec)return alert('Paste your Client ID and Client Secret first, then tap Save.');
 if(!/^\d+$/.test(c.cid))return alert('Client ID should be a number only (e.g. 123456). Please re-copy it.');
 LS.setItem('r42_pending',Date.now());
 location.href='https://www.strava.com/oauth/authorize?'+new URLSearchParams({client_id:c.cid,redirect_uri:APP_URL,response_type:'code',approval_prompt:'force',scope:SCOPE})}
function parseReturn(str){str=String(str||'').trim();let q;try{q=new URL(str).searchParams}catch(e){q=new URLSearchParams(str.replace(/^[^?]*\?/,'').replace(/#.*/,''))}
 if(!q.has('code')&&!q.has('error')&&/^[0-9a-f]{20,}$/i.test(str))q=new URLSearchParams({code:str,scope:''});return q}
async function exchange(q){if(q.get('error'))throw Error(q.get('error')=='access_denied'?'You tapped Cancel on Strava. Tap Connect Strava and choose Authorize.':'Strava: '+q.get('error'));
 const c=state.cfg;if(!c.cid||!c.csec)throw Error('Client ID/Secret are not saved in this app. Enter them in Settings, Save, then paste the link again.');
 const sc=q.get('scope');if(sc&&!/activity:read/.test(sc))throw Error('You unticked "View data about your activities". Tap Connect Strava again and keep it ticked.');
 const j=await tokenPost({client_id:c.cid,client_secret:c.csec,code:q.get('code'),grant_type:'authorization_code'});
 state.strava=j;state.strava.scope=sc||'';state.demo=false;LS.removeItem('r42_pending');save();return j}
async function handleReturn(){const q=new URLSearchParams(location.search);if(!q.has('code')&&!q.has('error'))return;history.replaceState(null,'',APP_URL);
 try{if(!state.cfg.cid||!state.cfg.csec){ // iPhone home-screen app: Strava returned to Safari, which has separate storage
   showPaste(location.origin+APP_URL.replace(location.origin,'')+'?'+q.toString());return}
  await exchange(q);await syncStrava();
  if(!STANDALONE&&navigator.standalone===false&&/iPhone|iPad/.test(navigator.userAgent))alert('Strava connected in Safari. If you use the home-screen app, open Settings there and use "Paste Strava link".')}
 catch(e){alert('Could not connect Strava: '+e.message)}}
function showPaste(url){document.querySelector('nav [data-v="set"]')?.click();const d=document.createElement('div');d.className='card';
 d.innerHTML='<h2>Almost done</h2><p>Strava approved, but this browser does not have your Client ID/Secret (the home-screen app keeps its own storage). Copy this link, open the <b>GACD Run</b> home-screen app → Settings → <b>Paste Strava link</b>:</p><textarea readonly style="width:100%;height:80px">'+esc(url)+'</textarea><button id="cpy">Copy link</button>';
 $('#v-set').prepend(d);$('#cpy').onclick=()=>navigator.clipboard.writeText(url).then(()=>alert('Copied. Now open the home-screen app.'),()=>alert('Select the text and copy it manually.'))}
const RUNTYPES=['Run','TrailRun','VirtualRun'];
const BE=[['400m',.4],['1/2 mile',.8047],['1K',1],['1 mile',1.6093],['2 mile',3.2187],['5K',5],['10K',10],['15K',15],['10 mile',16.0934],['20K',20],['Half-Marathon',21.0975],['30K',30],['Marathon',42.195]];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function dedupe(){const sid=new Set(state.runs.filter(r=>r.src=='strava').map(r=>r.id.slice(1)));const pri=r=>r.src=='strava'?0:1;const seen=new Set();
 state.runs=state.runs.filter(r=>r.km>0&&r.sec>0&&!(r.src!='strava'&&sid.has(String(r.id).slice(1)))).sort((a,b)=>pri(a)-pri(b)).filter(r=>{const k=String(r.date).slice(0,16)+'|'+Math.round(r.km*10);if(seen.has(k))return false;seen.add(k);return true})}
async function fetchBests(max=60){const todo=state.runs.filter(r=>r.src=='strava'&&r.km>=.39&&!state.be[r.id]).sort((a,b)=>b.km-a.km||new Date(b.date)-new Date(a.date)).slice(0,max);let n=0;
 for(const r of todo){setSrc('Best efforts '+(++n)+'/'+todo.length+'…');try{const a=await sget('/activities/'+r.id.slice(1));state.be[r.id]=(a.best_efforts||[]).map(e=>[e.name,e.elapsed_time])}catch(e){if(/rate limit|429/.test(e.message))break;}save();await sleep(350)}
 return state.runs.filter(r=>r.src=='strava'&&r.km>=.39&&!state.be[r.id]).length}
async function syncStrava(){setSrc('Syncing Strava…');try{const out=[];for(let p=1;p<=20;p++){const a=await sget('/athlete/activities?per_page=200&page='+p);if(!Array.isArray(a)||!a.length)break;out.push(...a);if(a.length<200)break}
  const rs=out.filter(a=>RUNTYPES.includes(a.sport_type||a.type)&&a.distance>0&&a.moving_time>0).map(a=>({id:'s'+a.id,date:a.start_date_local.replace('Z',''),km:+(a.distance/1000).toFixed(2),sec:a.moving_time,name:a.name,hr:a.average_heartrate,elev:a.total_elevation_gain,src:'strava'}));
  state.runs=state.runs.filter(r=>r.src!=='strava').concat(rs);state.demo=false;dedupe();state.strava.last=Date.now();save();render();const left=await fetchBests();save();render();alert('Synced '+rs.length+' runs from Strava ('+out.length+' activities checked).'+(left?' '+left+' runs still need best efforts; tap Rebuild stats later (Strava rate limit).':''))}catch(e){alert('Sync failed: '+e.message)}render()}
async function testConn(){diag=[];const c=state.cfg,s=state.strava;
 dlog(true,'App version r42-v3 · '+(STANDALONE?'home-screen app':'browser tab')+' · redirect '+APP_URL);
 dlog(!!c.cid&&/^\d+$/.test(c.cid),'Client ID saved'+(c.cid&&!/^\d+$/.test(c.cid)?' (should be digits only)':''));
 dlog(!!c.csec&&c.csec.length>=30,'Client Secret saved'+(c.csec&&c.csec.length<30?' (looks too short)':''));
 dlog(true,'Strava app must have Authorization Callback Domain = '+location.hostname);
 try{const r=await fetch('https://www.strava.com/oauth/token',{method:'POST',body:new URLSearchParams({client_id:c.cid||'0',client_secret:c.csec||'x',grant_type:'refresh_token',refresh_token:'test'})});const j=await r.json().catch(()=>({}));
  dlog(true,'Reached Strava token server (HTTP '+r.status+', CORS OK)');const f=JSON.stringify(j.errors||'');
  dlog(!/client_id|client_secret|Application/i.test(f),/client_id|client_secret|Application/i.test(f)?'Strava rejects this Client ID/Secret: re-copy them':'Client ID/Secret accepted by Strava')}catch(e){dlog(false,'Cannot reach Strava token server: '+e.message);return}
 if(!s.access_token){dlog(false,'Not connected yet → tap Connect Strava (or Paste Strava link)');return}
 dlog(!s.scope||/activity:read/.test(s.scope),'Granted scope: '+(s.scope||'unknown'));
 try{await stravaToken();dlog(true,'Access token valid until '+new Date(s.expires_at*1000).toLocaleString())}catch(e){dlog(false,'Token refresh: '+e.message);return}
 try{const a=await sget('/athlete');dlog(true,'Athlete: '+(a.firstname||'')+' '+(a.lastname||''))}catch(e){dlog(false,e.message)}
 try{const a=await sget('/athlete/activities?per_page=5');dlog(true,'Read activities OK ('+a.length+' recent)')}catch(e){dlog(false,e.message)}}

/* ---------- imports ---------- */
function parseCSV(t){const rows=[];let row=[],f='',q=false;for(let i=0;i<t.length;i++){const c=t[i];if(q){if(c=='"'){if(t[i+1]=='"'){f+='"';i++}else q=false}else f+=c}else if(c=='"')q=true;else if(c==','){row.push(f);f=''}else if(c=='\n'||c=='\r'){if(c=='\r'&&t[i+1]=='\n')i++;row.push(f);rows.push(row);row=[];f=''}else f+=c}if(f||row.length){row.push(f);rows.push(row)}return rows}
function importCSV(t){const rows=parseCSV(t),h=rows.shift().map(x=>x.trim());const ix=n=>h.indexOf(n);const iD=ix('Activity Date'),iT=ix('Activity Type'),iDist=ix('Distance'),iMv=ix('Moving Time')>=0?ix('Moving Time'):ix('Elapsed Time'),iN=ix('Activity Name'),iId=ix('Activity ID');
 if(iD<0||iDist<0)throw Error('This does not look like Strava activities.csv');let n=0;
 rows.forEach(r=>{if(!r[iD]||!/Run/i.test(r[iT]||'Run'))return;let km=parseFloat(String(r[iDist]).replace(/,/g,''));if(km>200)km/=1000;const sec=parseFloat(r[iMv]);const d=new Date(r[iD]);if(!(km>0&&sec>0)||isNaN(d))return;
  const id='c'+(r[iId]||+d);if(state.runs.some(x=>x.id==id||x.id=='s'+r[iId]))return;state.runs.push({id,date:d.toISOString(),km:+km.toFixed(2),sec,name:r[iN]||'Run',src:'csv'});n++});return n}
function importGPX(t,fn){const x=new DOMParser().parseFromString(t,'application/xml');const pts=[...x.getElementsByTagName('trkpt')].map(p=>({la:+p.getAttribute('lat'),lo:+p.getAttribute('lon'),t:p.getElementsByTagName('time')[0]?.textContent}));
 if(pts.length<2)throw Error(fn+': no track points');let m=0;for(let i=1;i<pts.length;i++){const a=pts[i-1],b=pts[i],R=6371e3,r=Math.PI/180,dl=(b.la-a.la)*r,dn=(b.lo-a.lo)*r;const h=Math.sin(dl/2)**2+Math.cos(a.la*r)*Math.cos(b.la*r)*Math.sin(dn/2)**2;m+=2*R*Math.asin(Math.sqrt(h))}
 const t0=new Date(pts[0].t),t1=new Date(pts.at(-1).t);const sec=(t1-t0)/1000;if(!(sec>0))throw Error(fn+': no timestamps');
 state.runs.push({id:'g'+(+t0),date:t0.toISOString(),km:+(m/1000).toFixed(2),sec,name:x.getElementsByTagName('name')[0]?.textContent||fn,src:'gpx'});return 1}

/* ---------- analytics ---------- */
function weekly(rs,n=16){const m0=monday(Date.now());const w=[];for(let i=n-1;i>=0;i--){const s=+m0-i*7*DAY;const r=rs.filter(x=>{const t=+new Date(x.date);return t>=s&&t<s+7*DAY});w.push({start:new Date(s),km:r.reduce((a,b)=>a+b.km,0),long:Math.max(0,...r.map(x=>x.km)),n:r.length})}return w}
const riegel=(sec,km,to=M)=>sec*Math.pow(to/km,1.06);
function pbs(rs){return BE.map(([l,d])=>{let b=null;rs.forEach(r=>{(state.be[r.id]||[]).forEach(([n,t])=>{if(n==l&&(!b||t<b.t))b={t,date:r.date,id:r.id,real:1}})});
 if(!b){const c=rs.filter(r=>r.km>=d);if(c.length){const x=c.reduce((a,r)=>r.sec/r.km<a.sec/a.km?r:a);b={t:x.sec/x.km*d,date:x.date,id:x.id,real:0}}}return b&&{l,d,...b}}).filter(Boolean)}
function predict(rs){const rec=rs.filter(r=>+new Date(r.date)>Date.now()-120*DAY);const src=[];
 rec.forEach(r=>(state.be[r.id]||[]).forEach(([n,t])=>{const d=BE.find(x=>x[0]==n)?.[1];if(d>=5)src.push({t,km:d,r,real:1})}));
 if(!src.length)rec.filter(r=>r.km>=5).forEach(r=>src.push({t:r.sec,km:r.km,r,real:0}));if(!src.length)return null;
 let b=null;src.forEach(x=>{const p=riegel(x.t,x.km);if(!b||p<b.mt)b={...x,mt:p}});return{t:b.mt*1.05,r:b.r,src:b,at:d=>riegel(b.t,b.km,d)*1.05}}
function readiness(rs){const w=weekly(rs,4),avg=w.reduce((a,b)=>a+b.km,0)/4,lg=Math.max(0,...rs.filter(r=>+new Date(r.date)>Date.now()-42*DAY).map(r=>r.km)),fr=w.reduce((a,b)=>a+b.n,0)/4;
 const v=Math.min(1,avg/55),l=Math.min(1,lg/32),f=Math.min(1,fr/4);return{score:Math.round(100*(.4*v+.4*l+.2*f)),avg,lg,fr,v,l,f}}

/* ---------- plan ---------- */
const DEF_RACE='2027-10-17';
function buildPlan(race){const rs=runs(),r=readiness(rs);const start=monday(Date.now()+7*DAY),end=monday(race);let N=Math.round((end-start)/(7*DAY))+1;if(N<8)return alert('Pick a race at least 8 weeks away.');
 let vol=Math.max(15,Math.round(r.avg)),long=Math.max(6,Math.min(Math.round(r.lg)||6,vol*.45));const peakVol=Math.max(55,vol),taper=3,weeks=[];
 for(let i=0;i<N;i++){const left=N-1-i;let ph=i<N*.35?'Base':left<taper?'Taper':left<taper+5?'Peak':'Build';let wv,wl,cut=false;
  if(ph==='Taper'){wv=[.4,.6,.75][left]*peakVol;wl=[0,13,20][left]}else{cut=(i%4==3);if(!cut&&i){vol=Math.min(peakVol,vol*1.1);long=Math.min(32,long+(ph==='Base'?1:2))}wv=cut?vol*.8:vol;wl=cut?Math.round(long*.75):long}
  wl=Math.min(wl,Math.round(wv*.5)||wl);if(ph==='Peak'&&!cut)wl=Math.min(32,Math.max(wl,long));
  const q=ph==='Base'?{t:'easy',l:'Easy + strides'}:(i%2?{t:'int',l:'Intervals'}:{t:'tempo',l:'Tempo'});const rest=wv-wl;const e1=Math.round(rest*.35),e2=Math.round(rest*.4),e3=Math.max(0,Math.round(rest-e1-e2));
  const d=[{t:'rest',l:'Rest',km:0},{t:'easy',l:'Easy',km:e1},{...q,km:e2},{t:'rest',l:'Rest / cross',km:0},{t:'easy',l:'Easy',km:e3},{t:'easy',l:'Shakeout',km:Math.min(5,Math.round(rest*.15))},{t:'long',l:'Long run',km:Math.round(wl)}];
  if(left===0){d[6]={t:'long',l:'RACE 42.2!',km:42.2};d[2]={t:'easy',l:'Easy + strides',km:6};d[4].km=5;d[5].km=3}
  weeks.push({start:ymd(+start+i*7*DAY),ph:ph+(cut?' (recovery)':''),days:d,done:[]})}
 state.plan={race:ymd(race),weeks,made:Date.now()};save();render()}
function adherence(){if(!state.plan)return null;const rs=runs();let due=0,done=0;state.plan.weeks.forEach(w=>w.days.forEach((d,j)=>{const day=+new Date(w.start+'T00:00')+j*DAY;if(d.km<=0||day>Date.now())return;due++;if(w.done.includes(j)||rs.some(r=>ymd(r.date)===ymd(day)))done++}));return{due,done}}

/* ---------- charts ---------- */
function chart(cv,vals,labels,{type='bar',color='#fc4c02',fmt=v=>v.toFixed(0),invert=false}={}){const dpr=devicePixelRatio||1,W=cv.clientWidth,H=cv.clientHeight;cv.width=W*dpr;cv.height=H*dpr;const g=cv.getContext('2d');g.scale(dpr,dpr);
 const P={l:38,r:8,t:10,b:22},v=vals.filter(x=>x!=null&&isFinite(x));g.font='11px system-ui';g.fillStyle='#8a9bb0';if(!v.length){g.fillText('No data yet',W/2-30,H/2);return}
 let mn=type=='bar'?0:Math.min(...v),mx=Math.max(...v);if(mx==mn)mx=mn+1;const pad=(mx-mn)*.1;if(type!='bar'){mn-=pad;mx+=pad}
 const y=x=>{let f=(x-mn)/(mx-mn);if(invert)f=1-f;return P.t+(H-P.t-P.b)*(1-f)},bw=(W-P.l-P.r)/vals.length;
 g.strokeStyle='#223041';for(let i=0;i<=3;i++){const val=mn+(mx-mn)*i/3,yy=y(val);g.beginPath();g.moveTo(P.l,yy);g.lineTo(W-P.r,yy);g.stroke();g.fillText(fmt(val),2,yy+4)}
 const step=Math.ceil(vals.length/8);labels.forEach((l,i)=>{if(i%step==0)g.fillText(l,P.l+i*bw+2,H-6)});
 if(type=='bar'){vals.forEach((x,i)=>{if(!x)return;const yy=y(x);g.fillStyle=i==vals.length-1?'#ff9a3c':color;g.fillRect(P.l+i*bw+2,yy,bw-4,y(0)-yy)})}
 else{g.strokeStyle=color;g.lineWidth=2;g.beginPath();let f=1;vals.forEach((x,i)=>{if(x==null)return;const X=P.l+i*bw+bw/2;f?g.moveTo(X,y(x)):g.lineTo(X,y(x));f=0});g.stroke();g.fillStyle=color;vals.forEach((x,i)=>{if(x!=null){g.beginPath();g.arc(P.l+i*bw+bw/2,y(x),3,0,7);g.fill()}})}}

/* ---------- views ---------- */
async function rebuild(){state.demo=false;dedupe();save();render();if(state.strava.access_token){try{const l=await fetchBests(100);alert(l?'Stats rebuilt. '+l+' runs still waiting for best efforts (Strava rate limit); try again in 15 min.':'Stats rebuilt from your Strava runs.')}catch(e){alert('Rebuild: '+e.message)}}save();render()}
function setSrc(t){$('#src').textContent=t}
function render(){const rs=runs();$('#demoBanner').classList.toggle('hidden',!state.demo);
 setSrc(state.demo?'Demo data':state.strava.access_token?'Strava ✓ '+rs.length+' runs':rs.length?rs.length+' runs':'No data');
 rDash(rs);rLog(rs);rPlan();rTips(rs);rSet()}
function rDash(rs){const w=weekly(rs),r=readiness(rs),p=predict(rs),pb=pbs(rs),tot=rs.reduce((a,b)=>a+b.km,0),lg=rs.reduce((a,b)=>b.km>(a?.km||0)?b:a,null),ad=adherence();
 const race=state.plan?.race||state.cfg.race||DEF_RACE,dl=Math.ceil((new Date(race)-Date.now())/DAY);
 $('#v-dash').innerHTML=`${rs.length?'':`<div class="card"><h2>Welcome! 👋</h2><p>Connect Strava, import a file or add a run in <b>Settings</b>, or turn on <b>Demo data</b> to look around.</p></div>`}
 <div class="card ring"><div class="big">${r.score}</div><div style="flex:1"><h3>Marathon readiness</h3><div class="bar"><i style="width:${r.score}%"></i></div>
 <div class="muted" style="margin-top:6px">Volume ${r.avg.toFixed(0)}/55 km/wk · Long run ${r.lg.toFixed(1)}/32 km · ${r.fr.toFixed(1)}/4 runs/wk · ${dl} days to race (${race})</div></div></div>
 <div class="grid">
 <div class="card stat"><div class="k">This week</div><div class="v">${w.at(-1).km.toFixed(1)} km</div><div class="s">4-wk avg ${r.avg.toFixed(1)}</div></div>
 <div class="card stat"><div class="k">Total runs</div><div class="v">${rs.length}</div><div class="s">${tot.toFixed(0)} km total</div></div>
 <div class="card stat"><div class="k">Longest run</div><div class="v">${lg?lg.km.toFixed(1):0} km</div><div class="s">${lg?ymd(lg.date):'–'}</div></div>
 <div class="card stat"><div class="k">Marathon predictor</div><div class="v">${p?fmtT(p.t):'–'}</div><div class="s">${p?'Riegel +5% from '+(p.src.real?'your '+fmtT(p.src.t)+' '+(BE.find(x=>x[1]==p.src.km)||[''])[0]+' best effort':'a '+p.r.km.toFixed(1)+' km run (estimate)'):'needs a 5 km+ run'}</div></div>
 <div class="card stat"><div class="k">Plan adherence</div><div class="v">${ad&&ad.due?Math.round(100*ad.done/ad.due)+'%':'–'}</div><div class="s">${ad?ad.done+'/'+ad.due+' sessions':'no plan yet'}</div></div></div>
 <div class="card"><h3>Best efforts &amp; predictions</h3><div class="muted">Last synced: ${state.strava.last?new Date(state.strava.last).toLocaleString():'never'} <button id="rb" class="btn2">Rebuild stats</button></div>
 <table><tr><th>Distance</th><th>Best</th><th>Pace</th><th>Date</th><th>Predicted now</th></tr>
 ${pb.map(b=>`<tr><td>${b.l}</td><td>${fmtT(b.t)}${b.real?'':' <span class="muted">est.</span>'}</td><td>${fmtP(b.t/b.d)}</td><td>${String(b.id).startsWith('s')?`<a href="https://www.strava.com/activities/${b.id.slice(1)}" target="_blank" rel="noopener">${ymd(b.date)}</a>`:ymd(b.date)}</td><td>${p?fmtT(p.at(b.d)):'–'}</td></tr>`).join('')||'<tr><td colspan="5" class="muted">No runs yet. Sync Strava in Settings.</td></tr>'}</table>
 <div class="muted">Best = Strava best efforts (fastest segment inside any run). "est." = no Strava best effort yet, estimated from a whole run's average pace. Predicted = Riegel from your strongest recent best effort, +5%.</div></div>
 <div class="charts"><div class="card"><h3>Weekly km (16 wks)</h3><canvas id="c1"></canvas></div><div class="card"><h3>Long run trend (km)</h3><canvas id="c2"></canvas></div>
 <div class="card"><h3>Avg pace per week (min/km)</h3><canvas id="c3"></canvas></div></div>`;
 const lb=w.map(x=>(x.start.getMonth()+1)+'/'+x.start.getDate());
 $('#rb').onclick=rebuild;chart($('#c1'),w.map(x=>x.km),lb);chart($('#c2'),w.map(x=>x.long||null),lb,{type:'line',color:'#3fa9f5'});
 chart($('#c3'),w.map(x=>{const r2=rs.filter(r=>{const t=+new Date(r.date);return t>=+x.start&&t<+x.start+7*DAY});const k=r2.reduce((a,b)=>a+b.km,0);return k?r2.reduce((a,b)=>a+b.sec,0)/k:null}),lb,{type:'line',color:'#2ecc71',fmt:v=>fmtT(v),invert:true})}
function rLog(rs){$('#v-log').innerHTML=`<div class="card"><h2>Run log <span class="ph">${rs.length}</span></h2><table><tr><th>Date</th><th>Run</th><th>km</th><th>Time</th><th>Pace</th><th></th></tr>
 ${rs.slice().reverse().map(r=>`<tr><td>${ymd(r.date)}</td><td>${esc(r.name)}${r.hr?` <span class="muted">♥${Math.round(r.hr)}</span>`:''}</td><td>${r.km.toFixed(2)}</td><td>${fmtT(r.sec)}</td><td>${fmtP(r.sec/r.km)}</td><td>${r.src=='demo'?'':`<a href="#" data-del="${r.id}">✕</a>`}</td></tr>`).join('')}</table></div>`;
 $('#v-log').querySelectorAll('[data-del]').forEach(a=>a.onclick=e=>{e.preventDefault();if(confirm('Delete this run?')){state.runs=state.runs.filter(x=>x.id!=a.dataset.del);save();render()}})}
function rPlan(){const p=state.plan,race=p?.race||state.cfg.race||DEF_RACE;let h=`<div class="card"><h2>Training plan to 42.2 km</h2>
 <label>Target race date (edit to your race — default is a placeholder mid-October 2027 date, check the official race calendar)</label><input type="date" id="raceD" value="${race}" min="2027-01-01" max="2027-12-31">
 <button id="mk">${p?'Rebuild plan':'Build my plan'}</button> <span class="muted">Adapts to your last 4 weeks of running. Max ~10%/week increase, every 4th week easier, long run builds to 32 km, 3-week taper.</span></div>`;
 if(p){const today=ymd(Date.now()),rs=runs();h+=p.weeks.map((w,i)=>{const tot=w.days.reduce((a,b)=>a+b.km,0);const cur=today>=w.start&&today<ymd(+new Date(w.start+'T00:00')+7*DAY);
  return`<div class="card" ${cur?'id="curwk" style="border-color:#fc4c02"':''}><h3>Week ${i+1} · ${w.start} <span class="ph">${w.ph}</span> <span class="ph">${tot.toFixed(0)} km</span>${cur?' <span class="ph" style="background:#fc4c02">THIS WEEK</span>':''}</h3><div class="wk">
  ${w.days.map((d,j)=>{const day=ymd(+new Date(w.start+'T00:00')+j*DAY),dn=w.done.includes(j)||(d.km>0&&rs.some(r=>ymd(r.date)===day));return`<div class="d ${d.t}${dn?' done':''}" data-w="${i}" data-j="${j}"><b>${'MTWTFSS'[j]} ${d.l}</b>${d.km?d.km+' km':''}${dn?' ✓':''}</div>`}).join('')}</div></div>`}).join('')}
 $('#v-plan').innerHTML=h;$('#mk').onclick=()=>{state.cfg.race=$('#raceD').value;buildPlan(new Date($('#raceD').value+'T00:00'))};
 $('#v-plan').querySelectorAll('.d').forEach(el=>el.onclick=()=>{const w=state.plan.weeks[el.dataset.w],j=+el.dataset.j;w.done=w.done.includes(j)?w.done.filter(x=>x!=j):[...w.done,j];save();rPlan();rDash(runs())})}
function rTips(rs){const r=readiness(rs),p=predict(rs),ez=p?p.t/M*1.12:null,adv=[];
 if(r.avg<20)adv.push('Build a base first: 3–4 easy runs a week, add no more than ~10% per week.');
 if(r.lg<16)adv.push('Your long run is the key marathon session — add 1–2 km every week or two (Sundays).');
 if(r.fr<3)adv.push('Consistency beats big days: aim for at least 3–4 runs every week.');
 const w=weekly(rs,2);if(w[0].km&&w[1].km>w[0].km*1.3)adv.push('<span class="warn">This week jumped more than 30% over last week — consider an easier few days.</span>');
 if(!adv.length)adv.push('<span class="ok">You are on a good trajectory. Keep stacking consistent weeks.</span>');
 $('#v-tips').innerHTML=`<div class="card"><h2>Your advice right now</h2><ul>${adv.map(a=>'<li>'+a+'</li>').join('')}</ul>${p?`<p>Suggested paces (from your predictor): easy <b>${fmtP(ez)}</b> or slower · marathon pace <b>${fmtP(p.t/M)}</b> · tempo <b>${fmtP(p.t/M*.92)}</b>.</p>`:''}</div>
 <div class="card"><h3>Pacing</h3><ul><li>80% of your running should be truly easy (you can talk in full sentences).</li><li>Race day: start 10–15 s/km slower than goal pace for the first 5 km; aim for even or negative splits.</li><li>As a first-timer, the goal is to finish strong — walk breaks (e.g. 1 min every 2 km) are a valid strategy.</li></ul></div>
 <div class="card"><h3>Fueling & hydration</h3><ul><li>For runs over 75–90 min, practice taking 30–60 g carbs per hour (gels, chews) — never try new fuel on race day.</li><li>Drink to thirst; add electrolytes on hot days. Toronto summers are humid — run early.</li><li>Carb-load the 2–3 days before the race; familiar breakfast 3 h before the start.</li></ul></div>
 <div class="card"><h3>Injury prevention</h3><ul><li>Strength 2×/week: squats, lunges, calf raises, glute bridges, planks.</li><li>Replace shoes every ~600–800 km. Ease into winter running with traction for icy sidewalks.</li><li>Sharp or worsening pain that changes your stride = stop and rest; see a physio if it persists beyond a few days.</li></ul></div>
 <div class="card"><h3>Recovery</h3><ul><li>Sleep 7–9 h; it is where adaptation happens.</li><li>Keep the day after long runs and hard workouts easy or off.</li><li>Recovery weeks (every 4th) are part of the plan, not lost time.</li></ul><p class="muted">General guidance, not medical advice. Check with a doctor before starting a new training program.</p></div>`}
function rSet(){const c=state.cfg,s=state.strava;$('#v-set').innerHTML=`
 <div class="card"><h2>Connect Strava</h2><ol>
 <li>On a computer or phone, open <a href="https://www.strava.com/settings/api" target="_blank" rel="noopener">strava.com/settings/api</a> and create an app (any name, e.g. "GACD Run 42.2"; Website: <code>${esc(APP_URL)}</code>).</li>
 <li>Set <b>Authorization Callback Domain</b> to exactly <code>${esc(location.hostname)}</code> (no https://, no slash, no /marathon-2027).</li>
 <li>Copy the <b>Client ID</b> and <b>Client Secret</b> into the boxes below and tap Save.</li><li>Tap <b>Connect Strava</b>, approve, then tap <b>Sync</b> any time.</li></ol>
 <label>Client ID</label><input id="cid" inputmode="numeric" value="${esc(c.cid||'')}"><label>Client Secret</label><input id="csec" type="password" value="${esc(c.csec||'')}">
 <div class="row"><button id="sv" class="btn2">Save</button><button id="cn">Connect Strava</button>${s.access_token?'<button id="sy">Sync</button><button id="dc" class="btn2">Disconnect</button>':''}<button id="tc" class="btn2">Test connection</button></div>
 <details ${STANDALONE?'open':''}><summary>Paste Strava link (iPhone home-screen app)</summary><p class="muted">If Strava opened in Safari after you tapped Authorize, copy the full address from Safari (it contains <code>code=</code>) and paste it here.</p><textarea id="pl" style="width:100%;height:70px" placeholder="https://alesilee119.github.io/marathon-2027/?state=&code=..."></textarea><button id="pb">Finish connecting</button></details>
 <pre id="diag" class="muted" style="white-space:pre-wrap"></pre>
 <p class="muted">${s.access_token?`Connected${s.athlete?' as '+esc(s.athlete.firstname||''):''}. Last sync: ${s.last?new Date(s.last).toLocaleString():'never'}.`:'Not connected.'} Your keys and data stay only on this device (browser storage); nothing is sent anywhere except Strava.</p></div>
 <div class="card"><h2>Import files</h2><p class="muted">Strava → Settings → My Account → Download or Delete Your Account → Request archive. Upload <b>activities.csv</b> and/or <b>.gpx</b> files.</p><input type="file" id="fi" multiple accept=".csv,.gpx"></div>
 <div class="card"><h2>Add a run manually</h2><div class="row"><div><label>Date</label><input type="date" id="md" value="${ymd(Date.now())}"></div><div><label>Distance km</label><input id="mk2" inputmode="decimal" placeholder="5.0"></div><div><label>Time (h:mm:ss)</label><input id="mt" placeholder="0:32:00"></div></div><button id="ma">Add run</button></div>
 <div class="card"><h2>Demo data</h2><label><input type="checkbox" id="dm" style="width:auto" ${state.demo?'checked':''}> Show SAMPLE data (not your runs) to preview the app</label></div>
 <div class="card"><button class="btn2" id="wipe">Erase all my data on this device</button></div>`;
 const rd=()=>{c.cid=$('#cid').value.trim();c.csec=$('#csec').value.trim();save()};$('#sv').onclick=()=>{rd();alert('Saved on this device.')};$('#cn').onclick=()=>{rd();connect()};
 if($('#sy'))$('#sy').onclick=syncStrava;$('#tc').onclick=()=>{rd();testConn()};$('#pb').onclick=async()=>{rd();try{await exchange(parseReturn($('#pl').value));await syncStrava()}catch(e){alert('Could not connect Strava: '+e.message)}};if($('#dc'))$('#dc').onclick=()=>{state.strava={};state.runs=state.runs.filter(r=>r.src!='strava');save();render()};
 $('#dm').onchange=e=>{state.demo=e.target.checked;save();render()};
 $('#wipe').onclick=()=>{if(confirm('Erase all runs, plan and Strava keys from this device?')){LS.clear();location.reload()}};
 $('#fi').onchange=async e=>{let n=0;for(const f of e.target.files){try{const t=await f.text();n+=/\.csv$/i.test(f.name)?importCSV(t):importGPX(t,f.name)}catch(x){alert(x.message)}}state.demo=false;save();render();alert('Imported '+n+' runs.')};
 $('#ma').onclick=()=>{const km=parseFloat($('#mk2').value),p=$('#mt').value.split(':').map(Number).reverse(),sec=(p[0]||0)+(p[1]||0)*60+(p[2]||0)*3600;if(!(km>0&&sec>0))return alert('Enter distance and time.');
  state.runs.push({id:'m'+Date.now(),date:$('#md').value+'T07:00:00',km,sec,name:'Manual run',src:'manual'});state.demo=false;save();render();alert('Run added.')}}

document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>{document.querySelectorAll('nav button').forEach(x=>x.classList.toggle('on',x==b));document.querySelectorAll('.view').forEach(v=>v.classList.toggle('hidden',v.id!='v-'+b.dataset.v));scrollTo(0,0);if(b.dataset.v=='dash')rDash(runs());if(b.dataset.v=='plan')$('#curwk')?.scrollIntoView()});
addEventListener('resize',()=>rDash(runs()));
if('serviceWorker'in navigator)navigator.serviceWorker.register('sw.js',{updateViaCache:'none'}).then(r=>r.update());
(async()=>{const q=new URLSearchParams(location.search);if(q.has('demo')){state.demo=true;save()}render();await handleReturn();
 if(q.has('demo')&&!state.plan)buildPlan(new Date(DEF_RACE+'T00:00'));if(q.get('view'))document.querySelector(`nav [data-v="${q.get('view')}"]`)?.click();
 if(state.strava.access_token&&!state.demo&&Date.now()-(state.strava.last||0)>6*36e5)syncStrava().catch(()=>{})})();
