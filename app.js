(function(){
"use strict";
var CFG=window.EMS_CONFIG||{};
var $=function(id){return document.getElementById(id)};
function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]})}
function ls(k,v){try{if(v===undefined){var r=localStorage.getItem(k);return r?JSON.parse(r):null}localStorage.setItem(k,JSON.stringify(v))}catch(e){}return null}
function clone(o){return JSON.parse(JSON.stringify(o))}

/* ---------- 常數 ---------- */
var COLS=["A","B","C"], NROW=6, CODES=[];
for(var r0=NROW;r0>=1;r0--)COLS.forEach(function(c){CODES.push(c+r0)});
CODES.push("H","X");
var DEF={A6:"左後方",B6:"天公殿",C6:"右後方",A5:"左廂後段",B5:"佛祖殿・大士殿",C5:"右廂後段",
 A4:"左廂",B4:"五王殿",C4:"右廂",A3:"左側門",B3:"媽祖殿（正殿）",C3:"右側門",
 A2:"廟埕左",B2:"廟埕中央",C2:"廟埕右",A1:"左停車場",B1:"牌樓",C1:"右停車場",H:"香客大樓",X:"場外／其他"};
var COMPLAINTS=["昏倒／意識改變","OHCA","胸痛","呼吸困難","抽搐","熱傷害","外傷","燒燙傷","跌倒","其他"];
var MARKS=["金爐旁","香爐前","階梯","殿內","廁所","攤位","舞台","護城河邊"];
var STAT={new:"待出勤",enroute:"出勤中",onscene:"處置中",transport:"後送中",closed:"結案",cancel:"取消"};
var TKEY=[["reported","通報"],["dispatched","出勤"],["arrived","到達"],["transport","後送"],["closed","結案"]];
var TRI=[{v:1,l:"紅　危急",c:"t1"},{v:2,l:"黃　緊急",c:"t2"},{v:3,l:"綠　輕症",c:"t3"}];
var NEXT={new:[["enroute","我出勤"]],enroute:[["onscene","到達現場"]],onscene:[["transport","後送"],["closed","現場結案"]],transport:[["closed","結案"]]};
var TILE={photo:"https://wmts.nlsc.gov.tw/wmts/PHOTO2/default/GoogleMapsCompatible/{z}/{y}/{x}",
          emap:"https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}"};
var MAXN=CFG.maxNativeZoom||19;

/* ---------- 狀態 ---------- */
var cases=ls("ems.cases")||{}, dirty=ls("ems.dirty")||{}, me=ls("ems.me")||"", team=ls("ems.team")||"";
var dev=ls("ems.dev");if(!dev){dev="d"+Math.random().toString(36).slice(2,10);ls("ems.dev",dev)}
var site=ls("ems.site")||{eventId:"e0",eventName:"",zones:{},grid:null};
var fs=null, root=null, live=false, syncErr="", sending={}, crew={};
var tab="map", form=null, pos=null, pending=null, calib=null, lastPub={t:0,ll:null};
var map, gGrid, gCases, gCrew, meDot, meAcc, pendMk;

function grid(){return site.grid||CFG.grid}
function zname(c){return(site.zones&&site.zones[c])||DEF[c]||c}
function persist(){ls("ems.cases",cases);ls("ems.dirty",dirty)}
function hm(t){if(!t)return"—";var d=new Date(t);return("0"+d.getHours()).slice(-2)+":"+("0"+d.getMinutes()).slice(-2)}
function mins(a,b){return(a&&b)?Math.round((b-a)/60000):null}
function cur(){return Object.keys(cases).map(function(k){return cases[k]}).filter(function(c){return c.eventId===site.eventId})}
function active(c){return c.status!=="closed"&&c.status!=="cancel"}
function toast(m){var t=$("toast");t.textContent=m;t.hidden=false;clearTimeout(toast.t);toast.t=setTimeout(function(){t.hidden=true},2800)}
function radio(c){return[c.zone+" "+zname(c.zone),c.landmark,[c.sex,c.age].filter(Boolean).join(""),c.complaint].filter(Boolean).join("、")}

/* ---------- 座標換算 ---------- */
var RAD=Math.PI/180, ER=6371000;
function toXY(ll,o){return[(ll[1]-o[1])*RAD*ER*Math.cos(o[0]*RAD),(ll[0]-o[0])*RAD*ER]}
function toLL(xy,o){return[o[0]+xy[1]/(RAD*ER),o[1]+xy[0]/(RAD*ER*Math.cos(o[0]*RAD))]}
function basis(){var g=grid(),o=g.fl;return{o:o,a:toXY(g.fr,o),b:toXY(g.bl,o)}}
function gp(u,v){var s=basis();return toLL([s.a[0]*u+s.b[0]*v,s.a[1]*u+s.b[1]*v],s.o)}
function zoneAt(ll){
  var s=basis(),p=toXY(ll,s.o),det=s.a[0]*s.b[1]-s.a[1]*s.b[0];if(!det)return"X";
  var u=(p[0]*s.b[1]-p[1]*s.b[0])/det,v=(s.a[0]*p[1]-s.a[1]*p[0])/det;
  if(u<0||u>=1||v<0||v>=1)return"X";
  return COLS[Math.floor(u*3)]+(Math.floor(v*NROW)+1);
}
function zoneCenter(code){var c=COLS.indexOf(code[0]),r=parseInt(code.slice(1),10);if(c<0||!r)return null;return gp((c+.5)/3,(r-.5)/NROW)}
function guide(ll){
  if(!pos||!ll)return"";
  var d=toXY(ll,pos.ll),m=Math.round(Math.sqrt(d[0]*d[0]+d[1]*d[1]));
  if(m<8)return"就在附近（8 公尺內）";
  var brg=(Math.atan2(d[0],d[1])/RAD+360)%360;
  return["北","東北","東","東南","南","西南","西","西北"][Math.round(brg/45)%8]+"方 "+m+" 公尺";
}

/* ---------- 同步 ---------- */
function save(c){c.updatedAt=Date.now();c.by=me||"未設定";cases[c.id]=c;dirty[c.id]=1;persist();render();flush()}
function flush(){
  if(root)Object.keys(dirty).forEach(function(id){
    var c=cases[id];if(!c){delete dirty[id];return}
    if(sending[id]===c.updatedAt)return;
    var sent=c.updatedAt;sending[id]=sent;
    root.collection("cases").doc(id).set(clone(c)).then(function(){
      if(cases[id]&&cases[id].updatedAt===sent){delete dirty[id];persist()}
      delete sending[id];syncErr="";syncPill();
    },function(e){delete sending[id];syncErr=(e&&e.code)||"error";syncPill()});
  });
  syncPill();
}
function syncPill(){
  var n=Object.keys(dirty).length,p=$("sync");p.className="pill";
  if(!CFG.firebase||!window.firebase){p.textContent="單機模式";return}
  if(!team){p.textContent="未設勤務代碼";p.classList.add("warn");return}
  if(syncErr==="permission-denied"){p.textContent="同步被拒，請檢查設定";p.classList.add("warn");return}
  if(n){p.textContent="待上傳 "+n+" 筆";p.classList.add("warn")}
  else if(live){p.textContent="已同步";p.classList.add("ok")}
  else{p.textContent="離線，資料存本機";p.classList.add("warn")}
}
function connect(){
  if(!CFG.firebase||!window.firebase||!team)return syncPill();
  try{
    firebase.initializeApp(CFG.firebase);fs=firebase.firestore();
    fs.enablePersistence({synchronizeTabs:true}).catch(function(){});
    root=fs.collection("teams").doc(team);
  }catch(e){syncErr="error";return syncPill()}
  root.collection("cases").onSnapshot({includeMetadataChanges:true},function(snap){
    live=!snap.metadata.fromCache;
    snap.forEach(function(doc){
      var r=doc.data();if(!r||!r.id)return;var l=cases[r.id];
      if(l&&dirty[r.id]&&(l.updatedAt||0)>=(r.updatedAt||0))return;
      if(!l||(r.updatedAt||0)>(l.updatedAt||0)){cases[r.id]=clone(r);delete dirty[r.id]}
    });
    persist();render();
  },function(e){live=false;syncErr=(e&&e.code)||"error";syncPill()});
  root.collection("meta").doc("site").onSnapshot(function(s){
    if(!s.exists)return;var r=s.data();
    if((r.updatedAt||0)<=(site.updatedAt||0))return;
    site={eventId:r.eventId||"e0",eventName:r.eventName||"",zones:r.zones||{},grid:r.grid||null,updatedAt:r.updatedAt||0};
    ls("ems.site",site);drawGrid();render();renderSettings();
  },function(){});
  root.collection("crew").onSnapshot(function(snap){
    crew={};snap.forEach(function(d){if(d.id!==dev)crew[d.id]=d.data()});drawCrew();
  },function(){});
  flush();
}
function saveSite(msg){
  site.updatedAt=Date.now();ls("ems.site",site);drawGrid();render();
  if(!root)return toast((msg||"已儲存")+"（本機）");
  root.collection("meta").doc("site").set(clone(site)).then(function(){toast(msg||"已儲存")},function(){toast("同步失敗，只存在這支手機")});
  toast((msg||"已儲存")+"，有訊號時會同步給全隊");
}
function publishPos(){
  if(!root||!me||!pos)return;
  var now=Date.now(),moved=lastPub.ll?Math.hypot.apply(null,toXY(pos.ll,lastPub.ll)):999;
  if(!((now-lastPub.t>30000&&moved>15)||now-lastPub.t>120000))return;
  lastPub={t:now,ll:pos.ll};
  root.collection("crew").doc(dev).set({name:me,lat:pos.ll[0],lng:pos.ll[1],acc:Math.round(pos.acc),t:now}).catch(function(){});
}

/* ---------- 地圖 ---------- */
function initMap(){
  map=L.map("map",{zoomControl:false,attributionControl:true,maxZoom:21}).setView(CFG.center||[23.068,120.1272],18);
  map.attributionControl.setPrefix(false);
  var opt={maxZoom:21,maxNativeZoom:MAXN,attribution:"內政部國土測繪中心"};
  var photo=L.tileLayer(TILE.photo,opt).addTo(map), emap=L.tileLayer(TILE.emap,opt);
  L.control.layers({"空拍影像":photo,"電子地圖":emap},null,{position:"topright",collapsed:true}).addTo(map);
  gGrid=L.layerGroup().addTo(map);gCases=L.layerGroup().addTo(map);gCrew=L.layerGroup().addTo(map);
  map.on("click",onMapClick);
  map.on("zoomend",drawGrid);
  drawGrid();
}
function drawGrid(){
  if(!map)return;gGrid.clearLayers();
  var act={};cur().filter(active).forEach(function(c){act[c.zone]=Math.min(act[c.zone]||4,c.triage||3)});
  var col={1:"#ff5252",2:"#ffb300",3:"#66bb6a"},z=map.getZoom();
  COLS.forEach(function(cl,ci){for(var r=1;r<=NROW;r++){
    var code=cl+r,t=act[code];
    L.polygon([gp(ci/3,(r-1)/NROW),gp((ci+1)/3,(r-1)/NROW),gp((ci+1)/3,r/NROW),gp(ci/3,r/NROW)],
      {color:t?col[t]:"#ffffff",weight:t?4:1.5,opacity:.9,fillColor:t?col[t]:"#ffffff",fillOpacity:t?.25:0,interactive:false}).addTo(gGrid);
    if(z>=17)L.marker(gp((ci+.5)/3,(r-.5)/NROW),{interactive:false,keyboard:false,
      icon:L.divIcon({className:"",iconSize:[90,34],iconAnchor:[45,17],html:'<div class="zl">'+code+(z>=18?'<small>'+esc(zname(code))+'</small>':'')+'</div>'})}).addTo(gGrid);
  }});
}
function caseLL(c){return(c.lat&&c.lng)?[c.lat,c.lng]:zoneCenter(c.zone)}
function drawCases(){
  if(!map)return;gCases.clearLayers();
  cur().forEach(function(c){
    var ll=caseLL(c);if(!ll||c.status==="cancel")return;
    if(!active(c)&&Date.now()-(c.times.closed||0)>30*60000)return;
    L.marker(ll,{zIndexOffset:active(c)?1000:0,icon:L.divIcon({className:"",iconSize:[38,38],iconAnchor:[19,19],
      html:'<div class="cm '+(active(c)?"t"+(c.triage||3):"done")+'">'+esc(c.zone)+'</div>'})})
     .on("click",function(e){L.DomEvent.stop(e);openDetail(c.id)}).addTo(gCases);
  });
}
function drawCrew(){
  if(!map)return;gCrew.clearLayers();
  Object.keys(crew).forEach(function(k){var p=crew[k];if(!p||!p.lat||Date.now()-p.t>10*60000)return;
    L.marker([p.lat,p.lng],{interactive:false,icon:L.divIcon({className:"",iconSize:[60,20],iconAnchor:[30,10],html:'<div class="crew">'+esc(p.name)+'</div>'})}).addTo(gCrew)});
}
function drawMe(){
  if(!map||!pos)return;
  if(!meDot){meAcc=L.circle(pos.ll,{radius:pos.acc,color:"#2196f3",weight:1,fillOpacity:.15,interactive:false}).addTo(map);
    meDot=L.circleMarker(pos.ll,{radius:8,color:"#fff",weight:3,fillColor:"#2196f3",fillOpacity:1,interactive:false}).addTo(map)}
  else{meAcc.setLatLng(pos.ll).setRadius(pos.acc);meDot.setLatLng(pos.ll)}
}
function gpsBox(){
  var g=$("gps");
  if(!pos){g.textContent=gpsBox.err||"定位中…";return}
  g.innerHTML="<b>"+esc(zoneAt(pos.ll))+"</b>"+esc(zname(zoneAt(pos.ll)))+"　±"+Math.round(pos.acc)+" 公尺";
}
function startGPS(){
  if(!navigator.geolocation){gpsBox.err="這支手機不支援定位";return gpsBox()}
  var first=true;
  navigator.geolocation.watchPosition(function(p){
    pos={ll:[p.coords.latitude,p.coords.longitude],acc:p.coords.accuracy||99,t:Date.now()};
    drawMe();gpsBox();publishPos();
    if(first){first=false;if(zoneAt(pos.ll)!=="X")map.setView(pos.ll,19)}
  },function(e){gpsBox.err=e.code===1?"未允許定位，請到手機設定開啟":"收不到定位訊號";if(!pos)gpsBox()},
  {enableHighAccuracy:true,maximumAge:5000,timeout:30000});
}
function setBar(html){var b=$("bar");if(!html){b.hidden=true;b.innerHTML="";return}b.innerHTML=html;b.hidden=false}
function clearPending(){pending=null;if(pendMk){map.removeLayer(pendMk);pendMk=null}setBar("")}
var CAL=["A1 左前角（面向廟，最前排左邊）","C1 右前角（最前排右邊）","A6 左後角（最後排左邊）"];
function calibBar(){setBar('<div class="t">校正 '+(calib.length+1)+'/3：在地圖上點 '+CAL[calib.length]+'</div><button type="button" class="btn" id="calCancel">取消</button>')}
function onMapClick(e){
  var ll=[e.latlng.lat,e.latlng.lng];
  if(calib){
    calib.push(ll);L.circleMarker(ll,{radius:6,color:"#ff0",fillOpacity:1}).addTo(gGrid);
    if(calib.length<3)return calibBar();
    site.grid={fl:calib[0],fr:calib[1],bl:calib[2]};calib=null;setBar("");saveSite("分區已校正");return;
  }
  pending=ll;
  if(pendMk)pendMk.setLatLng(ll);else pendMk=L.circleMarker(ll,{radius:10,color:"#fff",weight:3,fillColor:"#e53935",fillOpacity:1,interactive:false}).addTo(map);
  var z=zoneAt(ll);
  setBar('<div class="t">'+esc(z)+" "+esc(zname(z))+'</div><button type="button" class="btn go" id="pendGo">在此建案</button><button type="button" class="btn" id="pendNo">取消</button>');
}

/* ---------- 列表與統計 ---------- */
function card(c){
  var el=active(c)?Math.max(0,Math.round((Date.now()-c.times.reported)/60000)):null,g=active(c)?guide(caseLL(c)):"";
  var h='<article class="case'+(active(c)?"":" done")+'"><div class="code t'+(c.triage||3)+'">'+esc(c.zone)+'</div>'+
   '<div class="body"><div class="where">'+esc(zname(c.zone))+(c.landmark?"・"+esc(c.landmark):"")+'</div>'+
   '<div class="meta">'+esc(c.complaint||"未填主訴")+" "+esc([c.sex,c.age].filter(Boolean).join(""))+(g?"・"+esc(g):"")+'</div></div>'+
   '<div class="body meta">'+esc(c.no)+"・"+STAT[c.status]+(c.crew?"・"+esc(c.crew):"")+(el!==null?"・已 "+el+" 分":"")+'</div><div class="row">';
  (NEXT[c.status]||[]).forEach(function(n){h+='<button type="button" class="btn go" data-step="'+n[0]+'" data-id="'+esc(c.id)+'">'+n[1]+'</button>'});
  return h+'<button type="button" class="btn" data-open="'+esc(c.id)+'">詳細</button></div></article>';
}
function renderList(){
  var all=cur(),a=all.filter(active).sort(function(x,y){return(x.triage-y.triage)||(x.times.reported-y.times.reported)});
  var d=all.filter(function(c){return!active(c)}).sort(function(x,y){return y.times.reported-x.times.reported});
  $("nAct").textContent=a.length?"("+a.length+")":"";
  $("list").innerHTML=all.length?a.map(card).join("")+(d.length?'<h2 class="muted">已結束 '+d.length+' 件</h2>':"")+d.map(card).join("")
   :'<div class="empty">目前沒有案件。<br>到「地圖」按「＋ 我的位置建案」，或直接點地圖上患者所在的位置。</div>';
}
function renderStats(){
  var all=cur().filter(function(c){return c.status!=="cancel"});
  var rt=all.map(function(c){return mins(c.times.reported,c.times.arrived)}).filter(function(v){return v!==null});
  var avg=rt.length?(rt.reduce(function(a,b){return a+b},0)/rt.length).toFixed(1):"—";
  function n(f){return all.filter(f).length}
  $("stats").innerHTML='<div><b>'+all.length+'</b>總案件</div><div><b>'+n(function(c){return c.triage===1})+'</b>紅</div><div><b>'+n(function(c){return c.triage===2})+'</b>黃</div><div><b>'+n(function(c){return c.triage===3})+'</b>綠</div><div><b>'+n(function(c){return!!c.times.transport})+'</b>後送</div><div><b>'+avg+'</b>平均到達（分）</div>';
  var z={};all.forEach(function(c){z[c.zone]=(z[c.zone]||0)+1});
  var ks=Object.keys(z).sort(function(a,b){return z[b]-z[a]});
  $("byzone").textContent=ks.length?"各區件數："+ks.map(function(k){return k+" "+z[k]}).join("、"):"";
}
function renderSettings(){
  var ae=document.activeElement;if(ae&&$("v-stat").contains(ae)&&ae.tagName==="INPUT")return;
  $("zedit").innerHTML=CODES.map(function(c){return'<code>'+c+'</code><input type="text" id="z-'+c+'" maxlength="20" aria-label="'+c+' 區名" value="'+esc(zname(c))+'">'}).join("");
  $("evInput").value=site.eventName||"";$("teamInput").value=team;
  $("teamInfo").textContent=!CFG.firebase?"尚未設定 Firebase（見 README），目前是單機模式，輸入代碼也不會同步。":(team?"目前代碼："+team:"尚未輸入，資料只存在這支手機。");
  tileCount();
}
function render(){
  $("evName").textContent=site.eventName||"聖母廟救護案件";
  $("who").textContent=me?"呼號："+me:"設定呼號";
  drawGrid();drawCases();renderList();renderStats();syncPill();
}
function show(t){tab=t;["map","list","stat"].forEach(function(k){$("v-"+k).hidden=k!==t});
  document.querySelectorAll("nav button").forEach(function(b){b.setAttribute("aria-current",b.dataset.tab===t?"true":"false")});
  if(t==="stat")renderSettings();if(t==="map"&&map)setTimeout(function(){map.invalidateSize()},30)}

/* ---------- 表單 ---------- */
function chips(name,opts,val){return'<div class="chips">'+opts.map(function(o){var v=o.v!==undefined?o.v:o,l=o.l||o;
  return'<button type="button" class="chip '+(o.c||"")+'" data-f="'+name+'" data-v="'+esc(v)+'" aria-pressed="'+(String(val)===String(v))+'">'+esc(l)+'</button>'}).join("")+'</div>'}
function zoneSel(z){return'<select id="f-zone" aria-label="區碼">'+CODES.map(function(k){return'<option value="'+k+'"'+(k===z?" selected":"")+'>'+k+" "+esc(zname(k))+'</option>'}).join("")+'</select>'}
function openSheet(h){$("sheetIn").innerHTML=h;$("sheet").hidden=false;$("sheet").scrollTop=0}
function openNew(ll,acc){
  var z=zoneAt(ll);
  form={mode:"new",ll:ll,landmark:"",complaint:"",triage:2,sex:"",age:""};
  openSheet('<div class="top"><div><div class="big" id="f-big">'+esc(z)+'</div><div class="muted">新案件</div></div><button type="button" class="btn" data-close>取消</button></div>'+
   (acc&&acc>25?'<div class="warnbox">GPS 誤差約 ±'+Math.round(acc)+' 公尺，請確認下方區碼正確。</div>':'')+
   '<fieldset><legend>區碼（自動帶入，不對請改）</legend>'+zoneSel(z)+'</fieldset>'+
   '<fieldset><legend>檢傷</legend>'+chips("triage",TRI,2)+'</fieldset>'+
   '<fieldset><legend>主訴</legend>'+chips("complaint",COMPLAINTS,"")+'</fieldset>'+
   '<fieldset><legend>地標（讓出勤的人找得到）</legend>'+chips("landmark",MARKS,"")+'<input type="text" id="f-landmark" maxlength="40" placeholder="或自己打，例：第二根龍柱旁"></fieldset>'+
   '<fieldset><legend>患者</legend>'+chips("sex",["男","女"],"")+chips("age",["幼童","青少年","成人","長者"],"")+'</fieldset>'+
   '<fieldset><label class="l" for="f-note">備註</label><textarea id="f-note" rows="2" maxlength="300"></textarea></fieldset>'+
   '<button type="button" class="btn go" id="f-save">建立案件</button>');
}
function openDetail(id){
  var c=cases[id];if(!c)return;form={mode:"detail",id:id,triage:c.triage};
  var ll=caseLL(c),g=active(c)?guide(ll):"";
  var h='<div class="top"><div><div class="big">'+esc(c.zone)+'</div><div class="muted">'+esc(c.no)+"・"+STAT[c.status]+(c.disposition?"・"+esc(c.disposition):"")+'</div></div><button type="button" class="btn" data-close>關閉</button></div>'+
   (g?'<div class="guide">從你的位置：'+esc(g)+'</div>':'')+
   '<fieldset><legend>無線電報位</legend><div class="radio">'+esc(radio(c))+'</div></fieldset><div class="rowb">';
  (NEXT[c.status]||[]).forEach(function(n){h+='<button type="button" class="btn go" data-step="'+n[0]+'" data-id="'+esc(id)+'">'+n[1]+'</button>'});
  h+='<button type="button" class="btn" data-show="'+esc(id)+'">在地圖上看</button>'+
   (ll?'<a class="btn" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&amp;query='+ll[0].toFixed(6)+','+ll[1].toFixed(6)+'">在 Google 地圖開啟</a>':'')+'</div>'+
   '<div class="times">'+TKEY.map(function(k){return'<div>'+k[1]+'<b>'+hm(c.times[k[0]])+'</b></div>'}).join("")+'</div>'+
   '<p class="muted">出勤人員：'+esc(c.crew||"尚未指派")+'　建立：'+esc(c.createdBy||"")+'</p>'+
   '<fieldset><legend>檢傷</legend>'+chips("triage",TRI,c.triage)+'</fieldset>'+
   '<fieldset><legend>換區（標記會移到該區中央）</legend>'+zoneSel(c.zone)+'</fieldset>'+
   '<fieldset><label class="l" for="f-landmark">地標</label><input type="text" id="f-landmark" maxlength="40" value="'+esc(c.landmark)+'"></fieldset>'+
   '<fieldset><label class="l" for="f-note">備註／處置</label><textarea id="f-note" rows="3" maxlength="300">'+esc(c.note)+'</textarea></fieldset>'+
   '<button type="button" class="btn go" id="f-update">儲存修改</button>';
  if(c.status==="onscene")h+='<button type="button" class="btn" data-refuse="'+esc(id)+'">拒絕送醫結案</button>';
  if(active(c))h+='<button type="button" class="btn danger" data-cancel="'+esc(id)+'">取消案件（誤報）</button>';
  else h+='<button type="button" class="btn" data-reopen="'+esc(id)+'">重新開啟</button>';
  openSheet(h);
}
function closeSheet(){$("sheet").hidden=true;form=null;render()}
function askMe(then){
  form={mode:"me",then:then};
  openSheet('<div class="top"><h2>你的呼號</h2><button type="button" class="btn" data-close>取消</button></div>'+
   '<p class="muted">會記在案件的出勤人員欄，並顯示在隊友的地圖上。</p>'+
   '<input type="text" id="f-me" maxlength="16" aria-label="呼號" placeholder="例：救護 1、冠言" value="'+esc(me)+'"><button type="button" class="btn go" id="f-me-save">確定</button>');
  setTimeout(function(){var i=$("f-me");if(i)i.focus()},50);
}
function step(id,to){
  var c=cases[id];if(!c)return;
  if(!me)return askMe(function(){step(id,to)});
  c=clone(c);var now=Date.now();
  if(to==="enroute"){c.times.dispatched=now;c.crew=me}
  if(to==="onscene"){c.times.arrived=now;if(!c.crew)c.crew=me}
  if(to==="transport"){c.times.transport=now}
  if(to==="closed"){c.times.closed=now;c.disposition=c.times.transport?"後送":"現場處置"}
  c.status=to;$("sheet").hidden=true;form=null;save(c);toast(c.zone+" "+STAT[to]+" "+hm(now));
}
function exportText(sep){
  var head=["案號","區碼","區名","地標","主訴","檢傷","性別","年齡層","狀態","處置","出勤人員","通報","出勤","到達","後送","結案","到達分鐘","緯度","經度","備註","建立者"];
  var rows=cur().sort(function(a,b){return a.times.reported-b.times.reported}).map(function(c){
    return[c.no,c.zone,zname(c.zone),c.landmark,c.complaint,["","紅","黃","綠"][c.triage]||"",c.sex,c.age,STAT[c.status],c.disposition,c.crew,
      hm(c.times.reported),hm(c.times.dispatched),hm(c.times.arrived),hm(c.times.transport),hm(c.times.closed),
      mins(c.times.reported,c.times.arrived),c.lat?c.lat.toFixed(6):"",c.lng?c.lng.toFixed(6):"",c.note,c.createdBy].map(function(v){
        v=String(v==null?"":v).replace(/[\t\n\r]+/g," ");return sep===","?'"'+v.replace(/"/g,'""')+'"':v}).join(sep)});
  return{text:[head.join(sep)].concat(rows).join("\n"),n:rows.length};
}

/* ---------- 離線底圖 ---------- */
function tileList(){
  var g=grid(),pts=[g.fl,g.fr,g.bl,gp(1,1)],pad=150/111000,urls=[];
  var la=pts.map(function(p){return p[0]}),lo=pts.map(function(p){return p[1]});
  var s=Math.min.apply(null,la)-pad,n=Math.max.apply(null,la)+pad,w=Math.min.apply(null,lo)-pad*1.09,e=Math.max.apply(null,lo)+pad*1.09;
  function tx(lon,z){return Math.floor((lon+180)/360*Math.pow(2,z))}
  function ty(lat,z){var r=lat*RAD;return Math.floor((1-Math.log(Math.tan(r)+1/Math.cos(r))/Math.PI)/2*Math.pow(2,z))}
  [["photo",15,MAXN],["emap",15,Math.min(MAXN,18)]].forEach(function(L3){
    for(var z=L3[1];z<=L3[2];z++)for(var x=tx(w,z);x<=tx(e,z);x++)for(var y=ty(n,z);y<=ty(s,z);y++)
      urls.push(TILE[L3[0]].replace("{z}",z).replace("{y}",y).replace("{x}",x));
  });
  return urls;
}
function tileCount(){
  if(!window.caches){$("tileInfo").textContent="這個瀏覽器不支援離線儲存。";return}
  caches.open("ems-tiles").then(function(c){return c.keys()}).then(function(k){
    $("tileInfo").textContent=k.length?"這支手機已存 "+k.length+" 張底圖。":"尚未下載。";
  }).catch(function(){});
}
function getTiles(btn){
  if(!window.caches)return toast("這個瀏覽器不支援離線儲存");
  var urls=tileList();
  if(urls.length>1500)return toast("分區範圍太大（"+urls.length+" 張），請先校正分區");
  btn.disabled=true;var i=0,ok=0,bad=0;
  caches.open("ems-tiles").then(function(cache){
    function one(){
      if(i>=urls.length)return Promise.resolve();
      var u=urls[i++];
      return cache.match(u).then(function(hit){
        if(hit){ok++;return}
        return fetch(u,{mode:"cors"}).catch(function(){return fetch(u,{mode:"no-cors"})}).then(function(r){
          if(r&&(r.ok||r.type==="opaque")){ok++;return cache.put(u,r)}bad++;
        }).catch(function(){bad++});
      }).then(function(){btn.textContent="下載中 "+(ok+bad)+" / "+urls.length;return one()});
    }
    return Promise.all([one(),one(),one(),one()]);
  }).then(function(){
    btn.disabled=false;btn.textContent="下載廟區離線底圖";tileCount();
    toast(bad?"完成 "+ok+" 張，"+bad+" 張失敗，請換個訊號好的地方再按一次":"完成，共 "+ok+" 張");
  },function(){btn.disabled=false;btn.textContent="下載廟區離線底圖";toast("下載失敗，可能是儲存空間不足")});
}

/* ---------- 事件 ---------- */
document.addEventListener("click",function(e){
  var t=e.target.closest("button");if(!t)return;var d=t.dataset,id=t.id;
  if(d.tab)return show(d.tab);
  if(d.step)return step(d.id,d.step);
  if(d.open)return openDetail(d.open);
  if(d.show){var ll0=caseLL(cases[d.show]);closeSheet();show("map");if(ll0)map.setView(ll0,19);return}
  if("close" in d)return closeSheet();
  if(d.f&&form){
    var on=t.getAttribute("aria-pressed")==="true";
    t.parentNode.querySelectorAll(".chip").forEach(function(b){b.setAttribute("aria-pressed","false")});
    if(d.f==="triage"){t.setAttribute("aria-pressed","true");form.triage=Number(d.v)}
    else{t.setAttribute("aria-pressed",String(!on));form[d.f]=on?"":d.v}
    return;
  }
  if(id==="who")return askMe(null);
  if(id==="locate"){if(pos)map.setView(pos.ll,19);else toast("還沒有定位");return}
  if(id==="here"){
    if(!pos)return toast("還沒有定位，請直接點地圖上的位置");
    var p0=pos.ll,a0=pos.acc;if(!me)return askMe(function(){openNew(p0,a0)});return openNew(p0,a0);
  }
  if(id==="pendNo")return clearPending();
  if(id==="pendGo"){var p1=pending;clearPending();if(!me)return askMe(function(){openNew(p1,0)});return openNew(p1,0)}
  if(id==="calCancel"){calib=null;setBar("");drawGrid();return}
  if(id==="calib"){calib=[];clearPending();show("map");calibBar();return}
  if(id==="f-me-save"){var v2=$("f-me").value.trim();if(!v2)return toast("請輸入呼號");me=v2;ls("ems.me",me);var th=form&&form.then;closeSheet();if(th)th();return}
  if(id==="f-save"){
    var now=Date.now(),zone=$("f-zone").value,auto=zoneAt(form.ll);
    var ll=(zone===auto||zone==="H"||zone==="X")?form.ll:(zoneCenter(zone)||form.ll);
    var c={id:now.toString(36)+Math.random().toString(36).slice(2,6),eventId:site.eventId,no:hm(now).replace(":","")+"-"+zone,zone:zone,
      lat:ll[0],lng:ll[1],landmark:[form.landmark,$("f-landmark").value.trim()].filter(Boolean).join(" "),complaint:form.complaint,
      triage:form.triage,sex:form.sex,age:form.age,note:$("f-note").value.trim(),status:"new",crew:"",disposition:"",createdBy:me,times:{reported:now}};
    form=null;$("sheet").hidden=true;save(c);show("list");toast("已建立 "+c.no);return;
  }
  if(id==="f-update"){
    var c2=clone(cases[form.id]),nz=$("f-zone").value;
    if(nz!==c2.zone){c2.zone=nz;var zc=zoneCenter(nz);if(zc){c2.lat=zc[0];c2.lng=zc[1]}}
    c2.landmark=$("f-landmark").value.trim();c2.note=$("f-note").value.trim();c2.triage=form.triage||c2.triage;
    form=null;$("sheet").hidden=true;save(c2);toast("已儲存");return;
  }
  if(d.cancel||d.refuse||d.reopen){
    var k=d.cancel||d.refuse||d.reopen,c3=clone(cases[k]);
    if(d.cancel){if(d.sure!=="1"){d.sure="1";t.textContent="再按一次確定取消";return}c3.status="cancel";c3.times.closed=Date.now()}
    if(d.refuse){c3.status="closed";c3.times.closed=Date.now();c3.disposition="拒絕送醫"}
    if(d.reopen){c3.status=c3.times.arrived?"onscene":(c3.times.dispatched?"enroute":"new");delete c3.times.closed;delete c3.times.transport;c3.disposition=""}
    form=null;$("sheet").hidden=true;save(c3);return;
  }
  if(id==="copy"){
    var ex=exportText("\t"),ta=$("csv");
    var fb=function(){ta.hidden=false;ta.value=ex.text;ta.focus();ta.select();toast("請手動複製下方文字")};
    try{navigator.clipboard.writeText(ex.text).then(function(){toast("已複製 "+ex.n+" 筆，到 Excel 貼上")},fb)}catch(er){fb()}
    return;
  }
  if(id==="dl"){
    var ex2=exportText(","),a=document.createElement("a"),dt=new Date();
    a.href=URL.createObjectURL(new Blob(["﻿"+ex2.text],{type:"text/csv"}));
    a.download="救護案件-"+dt.getFullYear()+("0"+(dt.getMonth()+1)).slice(-2)+("0"+dt.getDate()).slice(-2)+".csv";
    document.body.appendChild(a);a.click();a.remove();return;
  }
  if(id==="getTiles")return getTiles(t);
  if(id==="saveZ"){var z={};CODES.forEach(function(c){var v=$("z-"+c).value.trim();if(v&&v!==DEF[c])z[c]=v});site.zones=z;saveSite("區名已儲存");return}
  if(id==="saveEv"){site.eventName=$("evInput").value.trim();saveSite("名稱已儲存");return}
  if(id==="saveTeam"){
    var tv=$("teamInput").value.trim();
    if(tv&&!/^[A-Za-z0-9_-]{6,40}$/.test(tv))return toast("代碼需為 6–40 碼英數字");
    ls("ems.team",tv);location.reload();return;
  }
  if(id==="newEv"){
    if(d.sure!=="1"){d.sure="1";t.textContent="再按一次確定：開始新活動";setTimeout(function(){d.sure="";t.textContent="開始新活動（舊案件不再顯示）"},5000);return}
    d.sure="";t.textContent="開始新活動（舊案件不再顯示）";
    site.eventId="e"+Date.now().toString(36);site.eventName=$("evInput").value.trim();saveSite("已開始新活動");return;
  }
});
$("sheet").addEventListener("change",function(e){if(e.target.id==="f-zone"&&$("f-big"))$("f-big").textContent=e.target.value});

/* ---------- 啟動 ---------- */
initMap();render();startGPS();connect();
setInterval(function(){flush();publishPos();drawCrew();if(tab==="list"&&$("sheet").hidden)renderList()},20000);
window.addEventListener("online",flush);
function wake(){try{if(navigator.wakeLock)navigator.wakeLock.request("screen").catch(function(){})}catch(e){}}
wake();document.addEventListener("visibilitychange",function(){if(!document.hidden)wake()});
if("serviceWorker" in navigator)navigator.serviceWorker.register("sw.js").catch(function(){});
window.__ems={zoneAt:zoneAt,tileList:tileList};
})();
