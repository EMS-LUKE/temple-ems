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
// 英文在前，其餘依首字筆畫由少到多，「其他」固定最後
var COMPLAINTS=["OHCA","外傷","抽搐","肢體無力","胸痛","喘／呼吸困難","跌倒","意識改變","頭暈","燒燙傷","爆炸傷","其他"];
// 依首字筆畫由少到多排列，「其他」固定最後
var MARKS=["戶外","走廊","金爐旁","香爐旁","涼亭","廁所","階梯","殿內","舞台旁","餐廳","護城河旁","攤位","其他"];
function who(c){return[c.sex==="其他"?"性別其他":c.sex,c.age==="其他"?"年齡其他":c.age,c.preg?"孕婦":""].filter(Boolean).join("")}
var STAT={new:"待出勤",enroute:"出勤中",onscene:"處置中",transport:"後送中",closed:"結案",cancel:"取消"};
var TKEY=[["reported","通報"],["dispatched","出勤"],["arrived","到達"],["transport","後送"],["closed","結案"]];
var TRI=[{v:1,l:"紅 危急",c:"t1"},{v:2,l:"黃 緊急",c:"t2"},{v:3,l:"綠 輕症",c:"t3"}];
var NEXT={new:[["enroute","我出勤"]],enroute:[["onscene","到達現場"]],onscene:[["transport","後送"],["closed","現場結案"]],transport:[["closed","結案"]]};
var TILE={photo:"https://wmts.nlsc.gov.tw/wmts/PHOTO2/default/GoogleMapsCompatible/{z}/{y}/{x}",
          emap:"https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}"};
var MAXN=CFG.maxNativeZoom||19;
var APP_VERSION="v30";
var EVENT_NAME=CFG.eventName||"鹿耳門聖母廟煙火勤務系統";

/* ---------- 狀態 ---------- */
var cases=ls("ems.cases")||{}, dirty=ls("ems.dirty")||{}, me=ls("ems.me")||"", team=ls("ems.team")||"";
var dev=ls("ems.dev");if(!dev){dev="d"+Math.random().toString(36).slice(2,10);ls("ems.dev",dev)}
var site=ls("ems.site")||{eventId:"e0",eventName:"",zones:{},grid:null};
var fs=null, root=null, live=false, syncErr="", sending={}, crew={};
var tab="map", form=null, pos=null, pending=null, calib=null, lastPub={t:0,ll:null};
var map, gGrid, gCases, gCrew, meDot, meAcc, pendMk;
var moving=null, navId=ls("ems.nav")||null, heading=null, navLine=null, navT=0, compassOn=false;
var alerts=[], firstSnap=true, lastSync=ls("ems.lastSync")||0, actx=null;

function grid(){return site.grid||CFG.grid}
function zname(c){return(site.zones&&site.zones[c])||DEF[c]||c}
function persist(){ls("ems.cases",cases);ls("ems.dirty",dirty)}
function hm(t){if(!t)return"—";var d=new Date(t);return("0"+d.getHours()).slice(-2)+":"+("0"+d.getMinutes()).slice(-2)}
function mins(a,b){return(a&&b)?Math.round((b-a)/60000):null}
function casesOf(eid){return Object.keys(cases).map(function(k){return cases[k]}).filter(function(c){return c.eventId===eid&&!c.deleted})}
function cur(){return casesOf(site.eventId)}
function md(t){var d=new Date(t);return(d.getMonth()+1)+"/"+d.getDate()+" "+hm(t)}
function active(c){return !c.deleted&&c.status!=="closed"&&c.status!=="cancel"}
function tomb(c){return{id:c.id,eventId:c.eventId,no:c.no,deleted:true}}
function toast(m){var t=$("toast");t.textContent=m;t.hidden=false;clearTimeout(toast.t);toast.t=setTimeout(function(){t.hidden=true},2800)}
function unsynced(id){return !!(CFG.firebase&&team&&dirty[id])}
function ago(t){if(!t)return"尚未同步過";var m=Math.floor((Date.now()-t)/60000);return m<1?"剛剛同步":m<60?"上次同步 "+m+" 分前":"上次同步 "+hm(t)}
function radio(c){return[caseCode(c)+" "+zname(c.zone),c.landmark,who(c),c.complaint].filter(Boolean).join("、")}

/* ---------- 座標換算 ---------- */
var RAD=Math.PI/180, ER=6371000;
function toXY(ll,o){return[(ll[1]-o[1])*RAD*ER*Math.cos(o[0]*RAD),(ll[0]-o[0])*RAD*ER]}
function toLL(xy,o){return[o[0]+xy[1]/(RAD*ER),o[1]+xy[0]/(RAD*ER*Math.cos(o[0]*RAD))]}
function basis(){var g=grid(),o=g.fl;return{o:o,a:toXY(g.fr,o),b:toXY(g.bl,o)}}
function gp(u,v){var s=basis();return toLL([s.a[0]*u+s.b[0]*v,s.a[1]*u+s.b[1]*v],s.o)}
function uvOf(ll){
  var s=basis(),p=toXY(ll,s.o),det=s.a[0]*s.b[1]-s.a[1]*s.b[0];if(!det)return null;
  var u=(p[0]*s.b[1]-p[1]*s.b[0])/det,v=(s.a[0]*p[1]-s.a[1]*p[0])/det;
  return(u<0||u>=1||v<0||v>=1)?null:[u,v];
}
function zoneAt(ll){var t=uvOf(ll);return t?COLS[Math.floor(t[0]*3)]+(Math.floor(t[1]*NROW)+1):"X"}
// 九宮格：由廟前往廟後數。下排(1 2 3)靠廟前，上排(7 8 9)靠廟後，左右以面向廟為準
function subAt(ll){var t=uvOf(ll);if(!t)return 0;var su=Math.min(2,Math.floor((t[0]*3%1)*3)),sv=Math.min(2,Math.floor((t[1]*NROW%1)*3));return sv*3+su+1}
function posCode(ll){var z=zoneAt(ll);return z==="X"?"X":z+"-"+subAt(ll)}
function codeLL(zone,n){
  var c=COLS.indexOf(zone[0]),r=parseInt(zone.slice(1),10);if(c<0||!r)return null;
  if(!n)return gp((c+.5)/3,(r-.5)/NROW);
  var su=(n-1)%3,sv=Math.floor((n-1)/3);return gp((c+(su+.5)/3)/3,(r-1+(sv+.5)/3)/NROW);
}
function caseCode(c){
  if(c.zone==="H"||c.zone==="X")return c.zone;
  var ll=(c.lat&&c.lng)?[c.lat,c.lng]:null;
  return(ll&&zoneAt(ll)===c.zone)?posCode(ll):c.zone+"-5";
}
function bearingTo(ll){var d=toXY(ll,pos.ll);return{m:Math.round(Math.hypot(d[0],d[1])),brg:(Math.atan2(d[0],d[1])/RAD+360)%360}}
var DIR8=["北","東北","東","東南","南","西南","西","西北"];
function cellSize(){var s=basis(),w=Math.hypot(s.a[0],s.a[1])/3,d=Math.hypot(s.b[0],s.b[1])/NROW,ar=Math.abs(s.a[0]*s.b[1]-s.a[1]*s.b[0])/(3*NROW);return{w:Math.round(w),d:Math.round(d),area:Math.round(ar/10)*10}}
function zoneCenter(code){var c=COLS.indexOf(code[0]),r=parseInt(code.slice(1),10);if(c<0||!r)return null;return gp((c+.5)/3,(r-.5)/NROW)}
function guide(ll){
  if(!pos||!ll)return"";
  var b=bearingTo(ll);
  if(b.m<8)return"就在附近（8 公尺內）";
  return DIR8[Math.round(b.brg/45)%8]+"方 "+b.m+" 公尺";
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
      delete sending[id];syncErr="";syncPill();if($("sheet").hidden)renderList();
    },function(e){delete sending[id];syncErr=(e&&e.code)||"error";syncPill()});
  });
  syncPill();
}
function syncPill(){
  var n=Object.keys(dirty).length,p=$("sync");p.className="pill";
  if(!CFG.firebase||!window.firebase){p.textContent="單機模式";return}
  if(!team){p.textContent="未設勤務代碼";p.classList.add("warn");return}
  if(syncErr==="permission-denied"){p.textContent="同步被拒，請檢查設定";p.classList.add("warn");return}
  if(live&&!n){lastSync=Date.now();ls("ems.lastSync",lastSync);p.textContent="已同步 "+hm(lastSync);p.classList.add("ok");return}
  p.classList.add("warn");
  p.textContent=(n?"待上傳 "+n+" 筆":"離線")+"・"+ago(lastSync);
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
    if(live){lastSync=Date.now();ls("ems.lastSync",lastSync)}
    snap.forEach(function(doc){applyRemote(doc.data())});
    if(live)firstSnap=false;
    persist();render();
  },function(e){live=false;syncErr=(e&&e.code)||"error";syncPill()});
  root.collection("meta").doc("site").onSnapshot(function(s){
    if(!s.exists)return;var r=s.data();
    if((r.updatedAt||0)<=(site.updatedAt||0))return;
    site={eventId:r.eventId||"e0",eventName:r.eventName||"",zones:r.zones||{},grid:r.grid||null,updatedAt:r.updatedAt||0};
    ls("ems.site",site);drawGrid();render();renderSettings();gpsBox();
  },function(){});
  root.collection("crew").onSnapshot(function(snap){
    crew={};snap.forEach(function(d){if(d.id!==dev)crew[d.id]=d.data()});drawCrew();
  },function(){});
  flush();
}
function applyRemote(r){
  if(!r||!r.id)return;var l=cases[r.id];
  if(l&&dirty[r.id]&&(l.updatedAt||0)>=(r.updatedAt||0))return;
  if(l&&(r.updatedAt||0)<=(l.updatedAt||0))return;
  cases[r.id]=clone(r);delete dirty[r.id];
  if(r.deleted&&form&&form.id===r.id){form=null;$("sheet").hidden=true}
  if(r.eventId!==site.eventId||!active(r))return;
  if(!l){if(!firstSnap||Date.now()-(r.times&&r.times.reported||0)<3*60000)alertCase("new",r)}
  else if(l.zone!==r.zone||(l.lat&&r.lat&&Math.hypot.apply(null,toXY([r.lat,r.lng],[l.lat,l.lng]))>10))alertCase("move",r);
}
function saveSite(msg){
  site.updatedAt=Date.now();ls("ems.site",site);drawGrid();render();gpsBox();
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
  L.control.scale({imperial:false,metric:true,maxWidth:140,position:"bottomleft"}).addTo(map);
  gGrid=L.layerGroup().addTo(map);gCases=L.layerGroup().addTo(map);gCrew=L.layerGroup().addTo(map);
  map.on("click",onMapClick);
  map.on("zoomend",drawGrid);map.on("moveend",function(){if(map.getZoom()>=20)drawGrid()});
  drawGrid();
}
function drawGrid(){
  if(!map)return;gGrid.clearLayers();
  var act={};cur().filter(active).forEach(function(c){act[c.zone]=Math.min(act[c.zone]||4,c.triage||3)});
  var col={1:"#ff5252",2:"#ffb300",3:"#66bb6a"},z=map.getZoom();
  if(z>=19){
    var st={color:"#ffffff",weight:1,opacity:.55,dashArray:"4 6",interactive:false},i;
    for(i=1;i<9;i++)if(i%3)L.polyline([gp(i/9,0),gp(i/9,1)],st).addTo(gGrid);
    for(i=1;i<NROW*3;i++)if(i%3)L.polyline([gp(0,i/(NROW*3)),gp(1,i/(NROW*3))],st).addTo(gGrid);
  }
  if(z>=20){
    var bd=map.getBounds().pad(.1);
    COLS.forEach(function(cl,ci){for(var r=1;r<=NROW;r++)for(var n=1;n<=9;n++){
      var q=codeLL(cl+r,n);if(q&&bd.contains(q))L.marker(q,{interactive:false,keyboard:false,icon:L.divIcon({className:"",iconSize:[60,18],iconAnchor:[30,9],html:'<div class="zs">'+cl+r+"-"+n+'</div>'})}).addTo(gGrid);
    }});
  }
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
      html:'<div class="cm '+(active(c)?"t"+(c.triage||3):"done")+'">'+esc(caseCode(c))+'</div>'})})
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
  if(!pos){g.className="gps wait";g.textContent=gpsBox.err||"定位中…";return}
  g.className="gps";g.innerHTML='<span class="plate sm">'+esc(posCode(pos.ll))+'</span><span class="gz">'+esc(zname(zoneAt(pos.ll)))+'<small>你的位置，誤差 ±'+Math.round(pos.acc)+' 公尺</small></span>';
}
function startGPS(){
  if(!navigator.geolocation){gpsBox.err="這支手機不支援定位";return gpsBox()}
  var first=true;
  navigator.geolocation.watchPosition(function(p){
    pos={ll:[p.coords.latitude,p.coords.longitude],acc:p.coords.accuracy||99,t:Date.now()};
    if(!compassOn&&typeof p.coords.heading==="number"&&!isNaN(p.coords.heading)&&p.coords.speed>0.7)heading=p.coords.heading;
    drawMe();gpsBox();publishPos();drawNav();
    if(first){first=false;if(zoneAt(pos.ll)!=="X")map.setView(pos.ll,19)}
  },function(e){gpsBox.err=e.code===1?"未允許定位，請到手機設定開啟":"收不到定位訊號";if(!pos)gpsBox()},
  {enableHighAccuracy:true,maximumAge:5000,timeout:30000});
}
function setBar(html){var b=$("bar");if(!html){b.hidden=true;b.innerHTML="";return}b.innerHTML=html;b.hidden=false}
function clearPending(){pending=null;if(pendMk){map.removeLayer(pendMk);pendMk=null}setBar("")}
function setPending(ll){
  pending=ll;
  if(pendMk)pendMk.setLatLng(ll);else pendMk=L.circleMarker(ll,{radius:10,color:"#fff",weight:3,fillColor:"#e53935",fillOpacity:1,interactive:false}).addTo(map);
  var z=zoneAt(ll),t='<div class="t"><span class="pc">'+esc(posCode(ll))+'</span> '+esc(zname(z))+'</div>';
  if(moving&&cases[moving])setBar('<div class="t">把 '+esc(cases[moving].no)+' 移到 <span class="pc">'+esc(posCode(ll))+'</span></div><button type="button" class="btn go" id="moveGo">確定移動</button><button type="button" class="btn" id="pendNo">取消</button>');
  else setBar(t+'<button type="button" class="btn go" id="pendGo">在此建立案件</button><button type="button" class="btn" id="pendNo">取消</button>');
}
function moveStart(id){
  moving=id;$("sheet").hidden=true;form=null;show("map");
  setBar('<div class="t">點地圖上的新位置</div><button type="button" class="btn" data-codeopen="1">輸入位置碼</button><button type="button" class="btn" id="pendNo">取消</button>');
}
var CAL=["A1 左前角（面向廟，最前排左邊）","C1 右前角（最前排右邊）","A6 左後角（最後排左邊）"];
function calibBar(){setBar('<div class="t">校正 '+(calib.length+1)+'/3：在地圖上點 '+CAL[calib.length]+'</div><button type="button" class="btn" id="calCancel">取消</button>')}
function onMapClick(e){
  var ll=[e.latlng.lat,e.latlng.lng];
  if(calib){
    calib.push(ll);L.circleMarker(ll,{radius:6,color:"#ff0",fillOpacity:1}).addTo(gGrid);
    if(calib.length<3)return calibBar();
    site.grid={fl:calib[0],fr:calib[1],bl:calib[2]};calib=null;setBar("");saveSite("分區已校正");return;
  }
  setPending(ll);
}

/* ---------- 導引、指南針 ---------- */
function onOri(e){
  var h=null;
  if(typeof e.webkitCompassHeading==="number")h=e.webkitCompassHeading;
  else if(e.absolute&&typeof e.alpha==="number")h=360-e.alpha;
  if(h===null||isNaN(h))return;
  h+=(screen.orientation&&screen.orientation.angle)||0;
  heading=(h%360+360)%360;compassOn=true;
  var now=Date.now();if(now-navT>150){navT=now;drawNav()}
}
function startCompass(){
  if(startCompass.done)return;
  try{
    var D=window.DeviceOrientationEvent;if(!D)return;
    if(typeof D.requestPermission==="function"){
      D.requestPermission().then(function(s){if(s==="granted"){startCompass.done=true;window.addEventListener("deviceorientation",onOri)}}).catch(function(){});
    }else{startCompass.done=true;window.addEventListener("deviceorientationabsolute",onOri);window.addEventListener("deviceorientation",onOri)}
  }catch(er){}
}
function setNav(id){navId=id||null;ls("ems.nav",navId);drawNav()}
function drawNav(){
  var box=$("nav"),c=navId&&cases[navId];
  if(!c||!active(c)||c.eventId!==site.eventId){
    if(navId){navId=null;ls("ems.nav",null)}
    box.hidden=true;if(navLine&&map){map.removeLayer(navLine);navLine=null}return;
  }
  var ll=caseLL(c),ar=$("navArrow");box.hidden=false;
  $("navText").textContent=[caseCode(c),c.landmark,who(c),c.complaint].filter(Boolean).join("、");
  if(!pos||!ll){ar.style.visibility="hidden";$("navDist").textContent="等待定位…";$("navMode").textContent="";return}
  var b=bearingTo(ll);
  if(b.m<8){ar.style.visibility="hidden";$("navDist").textContent="就在附近";$("navMode").textContent=""}
  else{
    ar.style.visibility="visible";ar.style.transform="rotate("+Math.round(heading!==null?b.brg-heading:b.brg)+"deg)";
    $("navDist").textContent=DIR8[Math.round(b.brg/45)%8]+"方 "+b.m+" 公尺";
    $("navMode").textContent=heading!==null?"箭頭指向實際方向":"箭頭以畫面上方為北";
  }
  if(map){if(!navLine)navLine=L.polyline([pos.ll,ll],{color:"#2196f3",weight:4,dashArray:"8 8",interactive:false}).addTo(map);else navLine.setLatLngs([pos.ll,ll])}
}

/* ---------- 新案件提醒 ---------- */
function unlockAudio(){try{if(!actx){var AC=window.AudioContext||window.webkitAudioContext;if(AC)actx=new AC()}if(actx&&actx.state==="suspended")actx.resume()}catch(er){}}
function beep(){
  try{if(!actx)return;[0,.28,.56].forEach(function(t){
    var o=actx.createOscillator(),g=actx.createGain(),s=actx.currentTime+t;o.frequency.value=880;o.connect(g);g.connect(actx.destination);
    g.gain.setValueAtTime(.001,s);g.gain.exponentialRampToValueAtTime(.5,s+.02);g.gain.exponentialRampToValueAtTime(.001,s+.2);o.start(s);o.stop(s+.22)})}catch(er){}
}
function alertCase(kind,c){
  alerts=alerts.filter(function(x){return x.id!==c.id});alerts.unshift({id:c.id,kind:kind});
  beep();try{if(navigator.vibrate)navigator.vibrate([300,150,300,150,300])}catch(er){}
  renderAlert();
}
function renderAlert(){
  var a=$("alert");alerts=alerts.filter(function(x){return cases[x.id]&&active(cases[x.id])});
  if(!alerts.length){a.hidden=true;return}
  var x=alerts[0],c=cases[x.id];a.hidden=false;a.className="alert t"+(c.triage||3);
  $("alertText").textContent=(x.kind==="new"?"新案件　":"位置更新　")+[caseCode(c),c.landmark,who(c),c.complaint].filter(Boolean).join("、")+(alerts.length>1?"（另有 "+(alerts.length-1)+" 則）":"");
}

/* ---------- 列表與統計 ---------- */
function stepper(c){
  return'<ol class="steps">'+TKEY.map(function(k){var t=c.times[k[0]];return'<li class="'+(t?"on":"")+'"><span>'+k[1]+'</span><b>'+(t?hm(t):"")+'</b></li>'}).join("")+'</ol>';
}
function card(c){
  var on=active(c),el=on?Math.max(0,Math.round((Date.now()-c.times.reported)/60000)):null,g=on?guide(caseLL(c)):"";
  var tags=['<span>'+esc(c.no)+'</span>','<span>'+STAT[c.status]+(c.disposition?"・"+esc(c.disposition):"")+'</span>'];
  if(c.crew)tags.push('<span>出勤 '+esc(c.crew)+'</span>');
  if(el!==null)tags.push('<span>已 '+el+' 分</span>');
  if(g)tags.push('<span class="dist">'+esc(g)+'</span>');
  var h='<article class="case '+(on?"tri"+(c.triage||3):"done")+'"><div class="plate '+(on?"t"+(c.triage||3):"off")+'">'+esc(caseCode(c))+'</div>'+
   '<div class="body"><div class="where">'+esc(zname(c.zone))+(c.landmark?"　"+esc(c.landmark):"")+'</div>'+
   '<div class="what"><b>'+esc(c.complaint||"未填主訴")+'</b>　'+esc(who(c))+'</div></div>'+
   '<div class="wide">'+stepper(c)+'</div><div class="wide tags">'+tags.join("")+'</div>'+
   (unsynced(c.id)?'<div class="wide"><span class="pill warn">尚未同步，請用無線電補報</span></div>':'')+'<div class="row">';
  (NEXT[c.status]||[]).forEach(function(n){h+='<button type="button" class="btn go" data-step="'+n[0]+'" data-id="'+esc(c.id)+'">'+n[1]+'</button>'});
  if(c.status==="onscene"||c.status==="transport")h+=c.tx?'<button type="button" class="btn" data-txopen="'+esc(c.id)+'">修改處置紀錄</button>':'<button type="button" class="btn txhot" data-txopen="'+esc(c.id)+'">'+TX_ICON+'填寫處置紀錄</button>';
  return h+'<button type="button" class="btn" data-open="'+esc(c.id)+'">詳細</button></div></article>';
}
function renderList(){
  var all=cur(),a=all.filter(active).sort(function(x,y){return y.times.reported-x.times.reported});
  var d=all.filter(function(c){return!active(c)}).sort(function(x,y){return y.times.reported-x.times.reported});
  $("nAct").textContent=a.length?String(a.length):"";
  $("list").innerHTML=all.length?a.map(card).join("")+(d.length?'<h2 class="muted">已結束 '+d.length+' 件</h2>':"")+d.map(card).join("")
   :'<div class="empty"><b>目前沒有案件</b>到「地圖」按「在我的位置建立案件」，或直接點地圖上患者所在的位置。</div>';
}
function renderStats(){
  var all=cur().filter(function(c){return c.status!=="cancel"});
  var rt=all.map(function(c){return mins(c.times.reported,c.times.arrived)}).filter(function(v){return v!==null});
  var avg=rt.length?(rt.reduce(function(a,b){return a+b},0)/rt.length).toFixed(1):"—";
  function n(f){return all.filter(f).length}
  $("stats").innerHTML='<div><b>'+all.length+'</b>總案件</div><div class="r"><b>'+n(function(c){return c.triage===1})+'</b>紅 危急</div><div class="y"><b>'+n(function(c){return c.triage===2})+'</b>黃 緊急</div><div class="g"><b>'+n(function(c){return c.triage===3})+'</b>綠 輕症</div><div><b>'+n(function(c){return!!c.times.transport})+'</b>後送</div><div><b>'+avg+'</b>平均到達（分）</div>';
  var z={};all.forEach(function(c){z[c.zone]=(z[c.zone]||0)+1});
  var ks=Object.keys(z).sort(function(a,b){return z[b]-z[a]});
  $("byzone").textContent=ks.length?"各區件數："+ks.map(function(k){return k+" "+z[k]}).join("、"):"";
}
function renderSettings(){
  var ae=document.activeElement;if(ae&&$("v-stat").contains(ae)&&ae.tagName==="INPUT")return;
  $("zedit").innerHTML=CODES.map(function(c){return'<code>'+c+'</code><input type="text" id="z-'+c+'" maxlength="20" aria-label="'+c+' 區名" value="'+esc(zname(c))+'">'}).join("");
  var cs=cellSize();$("cellInfo").textContent="目前每格約 "+cs.w+" × "+cs.d+" 公尺（約 "+cs.area.toLocaleString()+" 平方公尺），走過一格的寬度約 "+Math.round(cs.w/1.3/5)*5+" 秒。"+((cs.w>150||cs.d>150||cs.w<10||cs.d<10)?"尺寸不合理，校正可能點錯了。":"");
  var ev={};Object.keys(cases).forEach(function(k){var c=cases[k];if(c.deleted||c.eventId===site.eventId||!c.times)return;(ev[c.eventId]=ev[c.eventId]||[]).push(c.times.reported)});
  var ek=Object.keys(ev).sort(function(a,b){return Math.max.apply(null,ev[b])-Math.max.apply(null,ev[a])});
  $("pastEv").innerHTML=ek.length?ek.map(function(k){var t=ev[k];
    return'<div class="pev"><div><b>'+esc(md(Math.min.apply(null,t)))+' ～ '+esc(md(Math.max.apply(null,t)))+'</b>　'+t.length+' 件</div><div class="rowb"><button type="button" class="btn" data-evdl="'+esc(k)+'">下載 CSV</button><button type="button" class="btn" data-evback="'+esc(k)+'">切回這場活動</button></div></div>'}).join("")
    :'<p class="muted">沒有過去的活動。按過「開始新活動」之後，先前的案件會列在這裡，可以下載或切回去。</p>';
  $("verInfo").textContent="目前版本 "+APP_VERSION;
  $("teamInput").value=team;
  $("teamInfo").textContent=!CFG.firebase?"尚未設定 Firebase（見 README），目前是單機模式，輸入代碼也不會同步。":(team?"目前代碼："+team:"尚未輸入，資料只存在這支手機。");
  tileCount();
}
function render(){
  $("evName").textContent=EVENT_NAME;
  $("who").textContent=me?"呼號："+me:"設定呼號";
  drawGrid();drawCases();renderList();renderStats();syncPill();drawNav();renderAlert();
}
function show(t){tab=t;["map","list","stat"].forEach(function(k){$("v-"+k).hidden=k!==t});
  document.querySelectorAll("nav button").forEach(function(b){b.setAttribute("aria-current",b.dataset.tab===t?"true":"false")});
  if(t==="stat")renderSettings();if(t==="map"&&map)setTimeout(function(){map.invalidateSize()},30)}

/* ---------- 表單 ---------- */
function chips(name,opts,val){return'<div class="chips'+(name==="triage"?" seg":"")+'">'+opts.map(function(o){var v=o.v!==undefined?o.v:o,l=o.l||o;
  return'<button type="button" class="chip '+(o.c||"")+'" data-f="'+name+'" data-v="'+esc(v)+'" aria-pressed="'+(String(val)===String(v))+'">'+esc(l)+'</button>'}).join("")+'</div>'}
function zoneSel(z){return'<select id="f-zone" aria-label="區碼">'+CODES.map(function(k){return'<option value="'+k+'"'+(k===z?" selected":"")+'>'+k+" "+esc(zname(k))+'</option>'}).join("")+'</select>'}
function keypad(n){var h='<div class="kp">';[7,8,9,4,5,6,1,2,3].forEach(function(i){h+='<button type="button" class="chip" data-sub="'+i+'" aria-pressed="'+(i===n)+'">'+i+'</button>'});
  return h+'</div><p class="muted">九宮格跟地圖方向一樣：下排 1 2 3 靠廟前，上排 7 8 9 靠廟後，左右以面向廟為準。</p>'}
function bigCode(){var z=$("f-zone").value;return(z==="H"||z==="X")?z:z+"-"+(form.sub||5)}
function openCode(){
  form={mode:"code",zone:"",sub:5};
  openSheet('<div class="top"><div><div class="big" id="c-big">—</div><div class="muted">輸入無線電報的位置碼</div></div><button type="button" class="btn" data-close>取消</button></div>'+
   '<fieldset><legend>區（排列跟地圖一樣：上面是後殿）</legend><div class="zg">'+CODES.slice(0,18).map(function(k){return'<button type="button" class="chip" data-cz="'+k+'" aria-pressed="false">'+k+'</button>'}).join("")+'</div></fieldset>'+
   '<fieldset><legend>格內位置</legend>'+keypad(5)+'</fieldset>'+
   '<div class="sticky"><button type="button" class="btn go" id="codeGo">顯示在地圖上</button></div>');
}
function openSheet(h){$("sheetIn").innerHTML=h;$("sheet").hidden=false;$("sheet").scrollTop=0}
function openNew(ll,acc){
  var z=zoneAt(ll);
  form={mode:"new",ll:ll,landmark:"",complaint:"",triage:2,sex:"",age:"",preg:"",sub:subAt(ll)||5};
  openSheet('<div class="top"><div><div class="big" id="f-big">'+esc(posCode(ll))+'</div><div class="muted">新案件</div></div><button type="button" class="btn" data-close>取消</button></div>'+
   (acc&&acc>25?'<div class="warnbox">GPS 誤差約 ±'+Math.round(acc)+' 公尺，請確認下方區碼正確。</div>':'')+
   '<fieldset><legend>位置碼（自動帶入，不對請改）</legend>'+zoneSel(z)+keypad(form.sub)+'</fieldset>'+
   '<fieldset><legend>檢傷</legend>'+chips("triage",TRI,2)+'</fieldset>'+
   '<fieldset><legend>主訴</legend>'+chips("complaint",COMPLAINTS,"")+'<input type="text" id="f-complaintx" maxlength="40" placeholder="手動輸入" aria-label="手動輸入主訴"></fieldset>'+
   '<fieldset><legend>地標（讓出勤的人找得到）</legend>'+chips("landmark",MARKS,"")+'<input type="text" id="f-landmark" maxlength="40" placeholder="手動輸入" aria-label="手動輸入地標"></fieldset>'+
   '<fieldset><legend>患者</legend>'+chips("sex",["男","女","其他"],"")+chips("age",["兒童","青少年","成人","長者","其他"],"")+chips("preg",["孕婦"],"")+'</fieldset>'+
   '<fieldset><label class="l" for="f-note">備註</label><textarea id="f-note" rows="2" maxlength="300"></textarea></fieldset>'+
   '<div class="sticky"><button type="button" class="btn go" id="f-save">建立案件</button></div>');
}
function openDetail(id){
  var c=cases[id];if(!c)return;var cc=caseCode(c);form={mode:"detail",id:id,triage:c.triage,sub:parseInt(cc.split("-")[1],10)||5};
  var ll=caseLL(c),g=active(c)?guide(ll):"";
  var h='<div class="top"><div><div class="big" id="f-big">'+esc(cc)+'</div><div class="muted">'+esc(c.no)+"・"+STAT[c.status]+(c.disposition?"・"+esc(c.disposition):"")+'</div></div><button type="button" class="btn" data-close>關閉</button></div>'+
   (unsynced(id)?'<div class="warnbox">這筆的最新狀態還沒傳出去，其他人看不到，請用無線電補報。</div>':'')+
   (g?'<div class="guide">從你的位置：'+esc(g)+'</div>':'')+
   '<fieldset><legend>無線電報位</legend><div class="radio">'+esc(radio(c))+'</div></fieldset><div class="rowb">';
  (NEXT[c.status]||[]).forEach(function(n){h+='<button type="button" class="btn go" data-step="'+n[0]+'" data-id="'+esc(id)+'">'+n[1]+'</button>'});
  if(active(c))h+='<button type="button" class="btn" data-nav="'+esc(id)+'">'+(navId===id?"導引中":"導引到這裡")+'</button><button type="button" class="btn" data-move="'+esc(id)+'">在地圖上改位置</button>';
  h+='<button type="button" class="btn" data-show="'+esc(id)+'">在地圖上看</button>'+
   (ll?'<a class="btn" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&amp;query='+ll[0].toFixed(6)+','+ll[1].toFixed(6)+'">在 Google 地圖開啟</a>':'')+'</div>'+
   txBlock(c,id)+stepper(c)+
   '<p class="muted">出勤人員：'+esc(c.crew||"尚未指派")+'　建立：'+esc(c.createdBy||"")+'</p>'+

   '<fieldset><legend>檢傷</legend>'+chips("triage",TRI,c.triage)+'</fieldset>'+
   '<fieldset><legend>位置碼（改了之後標記會移到該小格中央）</legend>'+zoneSel(c.zone)+keypad(form.sub)+'</fieldset>'+
   '<fieldset><label class="l" for="f-landmark">地標</label><input type="text" id="f-landmark" maxlength="40" value="'+esc(c.landmark)+'"></fieldset>'+
   '<fieldset><label class="l" for="f-note">備註／處置</label><textarea id="f-note" rows="3" maxlength="300">'+esc(c.note)+'</textarea></fieldset>'+
   '<button type="button" class="btn go" id="f-update">儲存修改</button>';
  if(c.status==="onscene")h+='<button type="button" class="btn" data-refuse="'+esc(id)+'">拒絕送醫結案</button>';
  if(active(c))h+='<button type="button" class="btn danger" data-cancel="'+esc(id)+'">取消案件（誤報）</button>';
  else h+='<button type="button" class="btn" data-reopen="'+esc(id)+'">重新開啟</button>';
  h+='<button type="button" class="btn danger" data-del="'+esc(id)+'">刪除案件（無法復原）</button>';
  openSheet(h);
}
/* ---------- 處置紀錄（主訴、X C A B C D E） ---------- */
var NA="無明顯異常";
// 依首字筆畫由少到多
var CC_T=["肢體外傷","跌倒"];
var CC_N=["心悸","肢體無力","喘／呼吸困難","發燒","意識改變","嘔吐","頭暈"];
var W6=["擦傷","割傷","燒燙傷","撕裂傷","爆炸傷","穿刺傷"], W6b=["擦傷","割傷","撕裂傷","燒燙傷","爆炸傷","穿刺傷"];
var INJ=[
 {k:"head",name:"頭部",loc:["頭頂","右側","左側","後腦"],sit:W6,act:["沖洗傷口","止血包紮"]},
 {k:"face",name:"顏面",loc:["額頭","鼻子","嘴巴","下巴","|","右眉","右眼","右臉","|","左眉","左眼","左臉"],locx:true,sit:["異物"].concat(W6),act:["沖洗傷口","止血包紮"]},
 {k:"neck",name:"頸部",loc:[],sit:W6,act:["沖洗傷口","止血包紮","填塞止血"]},
 {k:"front",name:"軀幹前側",loc:[],sit:W6b,act:["沖洗傷口","止血包紮"]},
 {k:"back",name:"軀幹背側",loc:[],sit:W6b,act:["沖洗傷口","止血包紮"]},
 {k:"arm",name:"上肢",loc:["右手","左手"],sit:W6b.concat(["截斷傷"]),act:["沖洗傷口","止血包紮","填塞止血","止血帶"]},
 {k:"leg",name:"下肢",loc:["右腳","左腳"],sit:W6b.concat(["截斷傷"]),act:["沖洗傷口","止血包紮","填塞止血","止血帶"]}];
var LIMBS=[["lRU","右上肢"],["lLU","左上肢"],["lRL","右下肢"],["lLL","左下肢"]], LIMB_OPT=["正常","無力","痠痛","麻痺"];
var TX=[
 {k:"X",name:"X 大出血",sit:["穿刺傷","撕裂傷","割傷","爆炸傷","截斷傷"],act:["止血包紮","填塞止血","止血帶"]},
 {k:"S",name:"C 脊椎減移",sit:[],act:["頸圈","長背板","減移術"]},
 {k:"A",name:"A 呼吸道",sit:["鼾音","雜音","異物梗塞"],act:["徒手暢通呼吸道","抽吸","鼻咽","口咽","SGA","ETT","哈姆立克"]},
 {k:"B",name:"B 呼吸",sit:["喘／呼吸困難","換氣過度"],act:["鼻導管","一般面罩","NRM","BVM"]},
 {k:"C",name:"C 循環",sit:["休克","低體溫","蒼白","發紺","骨盆穩固","骨盆不穩"],act:["保暖","輸液"]},
 {k:"D",name:"D 失能",sit:["CVA","ICH"],act:[]},
 {k:"E",name:"E 暴露",sit:[],act:[]}];
var TXSHORT={X:"X 大出血",S:"C 脊椎",A:"A 呼吸道",B:"B 呼吸",C:"C 循環",D:"D 失能",E:"E 暴露"};
var AVPU=[["A","A 清"],["V","V 聲"],["P","P 痛"],["U","U 否"]];
var IV_G=["18","20","22","24"], IV_S=["右手","左手","右腳","左腳"], IV_F="N/S 500 mL";
var DKEYS=["gE","gV","gM","pR","pRr","pL","pLr","lRU","lLU","lRL","lLL","lU","lL"], DNEW=["gE","gV","gM","pR","pRr","pL","pLr","lRU","lLU","lRL","lLL"], VKEYS=["spo2","sbp","dbp","glu","temp"];
function gcsTotal(t){return(t.gE&&t.gV&&t.gM)?Number(t.gE)+Number(t.gV)+Number(t.gM):null}
// 把舊版資料整理成現在的格式（不改動原資料）
function txNorm(c){
  var t=clone(c.tx||{}),base=c.txAt||c.updatedAt||Date.now();
  if(t.C&&t.C.length){var find=["蒼白","發紺","骨盆穩固","骨盆不穩"],mv=t.C.filter(function(v){return find.indexOf(v)>=0});
    if(mv.length){t.Cs=(t.Cs||[]).concat(mv);t.C=t.C.filter(function(v){return find.indexOf(v)<0})}}
  function swap(arr,a,b){return(arr||[]).map(function(v){return v===a?b:v})}
  if(t.ccN)t.ccN=swap(t.ccN,"喘","喘／呼吸困難");
  if(t.Bs)t.Bs=swap(t.Bs,"喘","喘／呼吸困難");
  if(t.ccT){var odd=t.ccT.filter(function(v){return CC_T.indexOf(v)<0});if(odd.length){t.ccTx=[t.ccTx].concat(odd).filter(Boolean).join("、");t.ccT=t.ccT.filter(function(v){return CC_T.indexOf(v)>=0})}}
  if((t.Ds||[]).indexOf("低血糖")>=0){t.Ds=t.Ds.filter(function(v){return v!=="低血糖"});t.cvS=["低血糖"]}
  if((t.D||[]).indexOf("糖粉")>=0){t.D=t.D.filter(function(v){return v!=="糖粉"});t.cvA=["糖粉"]}
  t.inj=t.inj||{};
  t.vs=(t.vs||[]).slice();
  if(!t.vs.length&&VKEYS.some(function(k){return t[k]})){var o={t:base};VKEYS.forEach(function(k){if(t[k])o[k]=t[k]});t.vs.push(o)}
  t.ds=(t.ds||[]).slice();
  if(!t.ds.length&&DKEYS.some(function(k){return t[k]})){var p={t:base};DKEYS.forEach(function(k){if(t[k])p[k]=t[k]});t.ds.push(p)}
  VKEYS.concat(DKEYS).forEach(function(k){delete t[k]});
  t.vs.sort(function(x,y){return x.t-y.t});t.ds.sort(function(x,y){return x.t-y.t});
  return t;
}
function vsOf(c){return c.tx?txNorm(c).vs:[]}
function dsOf(c){return c.tx?txNorm(c).ds:[]}
function lastVs(c){var a=vsOf(c);return a.length?a[a.length-1]:{}}
function lastDs(c){var a=dsOf(c);return a.length?a[a.length-1]:{}}
function dsText(t){
  var ex=[];
  if(t.gE||t.gV||t.gM)ex.push("GCS E"+(t.gE||"_")+"V"+(t.gV||"_")+"M"+(t.gM||"_")+(gcsTotal(t)?"＝"+gcsTotal(t):""));
  function rx(v){return v==="+"?"（＋）":v==="-"?"（－）":""}
  if(t.pR||t.pL||t.pRr||t.pLr)ex.push("瞳孔 R "+(t.pR||"_")+rx(t.pRr)+" L "+(t.pL||"_")+rx(t.pLr));
  LIMBS.forEach(function(l){if(t[l[0]])ex.push(l[1]+"（"+t[l[0]]+"）")});
  if(t.lU)ex.push("上肢（"+t.lU+"）");
  if(t.lL)ex.push("下肢（"+t.lL+"）");
  return ex.join("、");
}
function vsText(v){var a=[];if(v.spo2)a.push("血氧 "+v.spo2+"%");if(v.sbp||v.dbp)a.push("血壓 "+(v.sbp||"_")+"/"+(v.dbp||"_"));if(v.glu)a.push("血糖 "+v.glu);if(v.temp)a.push("體溫 "+v.temp+"°C");return a.join("、")}
function ivText(t){var a=[];if(t.ivF)a.push(t.ivF);if(t.ivG||t.ivS)a.push("IC "+(t.ivG?t.ivG+"G":"")+(t.ivS?" "+t.ivS:""));return a.length?"輸液（"+a.join("、").replace(/\s+/g," ")+"）":"輸液"}
function avpuLabel(v){var f=AVPU.filter(function(a){return a[0]===v})[0];return f?f[1]:""}
function txLines(c){
  if(!c.tx)return[];var t=txNorm(c),out=[];
  var ct=(t.ccT||[]).concat(t.ccTx?[t.ccTx]:[]),cn=(t.ccN||[]).concat(t.ccNx?[t.ccNx]:[]),cc=[];
  if(ct.length)cc.push("創傷（"+ct.join("、")+"）");if(cn.length)cc.push("非創傷（"+cn.join("、")+"）");
  if(cc.length)out.push("主訴："+cc.join("；"));
  injLines(t).forEach(function(l){out.push(l)});
  TX.forEach(function(g){
    var k=g.k,act=(t[k]||[]).slice(),sit=(t[k+"s"]||[]).slice(),parts=[];
    if(act.indexOf(NA)>=0){out.push(TXSHORT[k]+"："+NA)}
    else{
      if(k==="X"&&t.tq)act=act.map(function(v){return v==="止血帶"?"止血帶（"+t.tq+"）":v});
      if(k==="C"){if(t.crt)sit.push("CRT "+t.crt+" 秒");act=act.map(function(v){return v==="輸液"?ivText(t):v})}
      if(k==="E"&&t.e)sit.push(t.e);
      if(sit.length)parts.push((g.act.length?"情況 ":"")+sit.join("、"));
      if(act.length)parts.push((g.sit.length?"處置 ":"")+act.join("、"));
      if(parts.length)out.push(TXSHORT[k]+"："+parts.join("｜"));
    }
    if(k==="S"){var cv=[];if(t.avpu)cv.push(avpuLabel(t.avpu));if((t.cvS||[]).length)cv.push("情況 "+t.cvS.join("、"));if((t.cvA||[]).length)cv.push("處置 "+t.cvA.join("、"));if(cv.length)out.push("C 意識："+cv.join("｜"))}
    if(k==="D")t.ds.forEach(function(d){var s=dsText(d);if(s)out.push("D 失能 "+hm(d.t)+"："+s)});
  });
  t.vs.forEach(function(v){var s=vsText(v);if(s)out.push("檢查 "+hm(v.t)+"："+s)});
  if(t.other)out.push("其他："+t.other);
  return out;
}
function injLines(t){
  var out=[];INJ.forEach(function(g){
    var r=(t.inj||{})[g.k];if(!r)return;
    var loc=(r.loc||[]).concat(r.locx?[r.locx]:[]),sit=(r.sit||[]).concat(r.sitx?[r.sitx]:[]),act=(r.act||[]).map(function(v){return v==="止血帶"&&r.tq?"止血帶（"+r.tq+"）":v}),p=[];
    if(!loc.length&&!sit.length&&!act.length)return;
    if(sit.length)p.push("情況 "+sit.join("、"));if(act.length)p.push("處置 "+act.join("、"));
    out.push("傷情 "+g.name+(loc.length?"（"+loc.join("、")+"）":"")+(p.length?"："+p.join("｜"):""));
  });return out;
}
function injCount(r){return r?((r.loc||[]).length+(r.sit||[]).length+(r.act||[]).length+(r.locx?1:0)+(r.sitx?1:0)):0}
function injChips(k,g,opts,arr){
  return'<div class="chips">'+opts.map(function(v){if(v==="|")return'<span class="brk"></span>';return'<button type="button" class="chip" data-inj="'+k+'" data-g="'+g+'" data-v="'+esc(v)+'" aria-pressed="'+((arr||[]).indexOf(v)>=0)+'">'+esc(v)+'</button>'}).join("")+'</div>';
}
function injHtml(t){
  return INJ.map(function(g){
    var r=t.inj[g.k]||{},n=injCount(r),k=g.k;
    var h='<details class="inj" data-injbox="'+k+'"'+(n?" open":"")+'><summary>'+g.name+'<span class="injn" id="injn-'+k+'">'+(n?"已選 "+n+" 項":"")+'</span></summary><div class="injb">';
    if(g.loc.length)h+=sub("位置")+injChips(k,"loc",g.loc,r.loc);
    if(g.locx)h+='<input type="text" id="inj-'+k+'-locx" maxlength="30" placeholder="手動輸入" aria-label="'+g.name+'位置手動輸入" value="'+esc(r.locx||"")+'">';
    h+=sub("情況")+injChips(k,"sit",g.sit,r.sit)+'<input type="text" id="inj-'+k+'-sitx" maxlength="40" placeholder="手動輸入" aria-label="'+g.name+'情況手動輸入" value="'+esc(r.sitx||"")+'">';
    h+=sub("處置")+injChips(k,"act",g.act,r.act);
    if(g.act.indexOf("止血帶")>=0)h+='<div class="inl" id="inj-'+k+'-tqrow"'+((r.act||[]).indexOf("止血帶")<0?" hidden":"")+'><label class="fld"><span>止血帶時間</span><input type="time" id="inj-'+k+'-tq" value="'+esc(r.tq||"")+'"></label><button type="button" class="btn" data-injnow="'+k+'">現在</button></div>';
    return h+'</div></details>';
  }).join("");
}
function injClick(b){
  var k=b.dataset.inj,g=b.dataset.g,v=b.dataset.v,r=form.tx.inj[k]=form.tx.inj[k]||{},arr=(r[g]||[]).slice(),i=arr.indexOf(v);
  if(i>=0)arr.splice(i,1);else arr.push(v);r[g]=arr;
  b.setAttribute("aria-pressed",String(i<0));
  var n=injCount(r);$("injn-"+k).textContent=n?"已選 "+n+" 項":"";
  var row=$("inj-"+k+"-tqrow");if(row&&g==="act"){var on=arr.indexOf("止血帶")>=0;row.hidden=!on;if(on&&!$("inj-"+k+"-tq").value)$("inj-"+k+"-tq").value=hm(Date.now())}
}
function dnClick(b){
  var d=b.dataset;
  if(d.dn1){var inp=$("tx-"+d.dn1),nv=inp.value===d.v?"":d.v;inp.value=nv;b.parentNode.querySelectorAll(".chip").forEach(function(x){x.setAttribute("aria-pressed",String(x.dataset.v===nv))});return}
  var inp2=$("tx-"+d.dn),arr=inp2.value?inp2.value.split("、"):[],i=arr.indexOf(d.v);
  if(i>=0)arr.splice(i,1);else if(d.v==="正常")arr=["正常"];else{arr=arr.filter(function(x){return x!=="正常"});arr.push(d.v)}
  inp2.value=arr.join("、");b.parentNode.querySelectorAll(".chip").forEach(function(x){x.setAttribute("aria-pressed",String(arr.indexOf(x.dataset.v)>=0))});
}
function dnChips(key,opts,single){return'<div class="chips">'+opts.map(function(o){var v=Array.isArray(o)?o[0]:o,l=Array.isArray(o)?o[1]:o;return'<button type="button" class="chip" '+(single?"data-dn1":"data-dn")+'="'+key+'" data-v="'+esc(v)+'" aria-pressed="false">'+esc(l)+'</button>'}).join("")+'</div><input type="hidden" id="tx-'+key+'" value="">'}
function txChips(key,opts,arr,cls){
  return'<div class="chips">'+opts.map(function(v){
    return'<button type="button" class="chip'+(cls?" "+cls:"")+'" data-tx="'+key+'" data-v="'+esc(v)+'" aria-pressed="'+(arr.indexOf(v)>=0)+'">'+esc(v)+'</button>'}).join("")+'</div>';
}
function oneChips(key,opts,val){
  return'<div class="chips">'+opts.map(function(o){var v=Array.isArray(o)?o[0]:o,l=Array.isArray(o)?o[1]:o;
    return'<button type="button" class="chip" data-tx1="'+key+'" data-v="'+esc(v)+'" aria-pressed="'+(String(val||"")===String(v))+'">'+esc(l)+'</button>'}).join("")+'</div>';
}
function num(id,label,val,unit,w){return'<label class="fld"><span>'+label+'</span><input type="text" inputmode="decimal" id="'+id+'" maxlength="6" value="'+esc(val||"")+'"'+(w?' style="width:'+w+'px"':'')+'>'+(unit?'<span>'+unit+'</span>':'')+'</label>'}
function sel(id,label,n,val){var h='<label class="fld"><span>'+label+'</span><select id="'+id+'"><option value="">–</option>';for(var i=n;i>=1;i--)h+='<option'+(String(val)===String(i)?" selected":"")+'>'+i+'</option>';return h+'</select></label>'}
function sub(label){return'<div class="sub">'+label+'</div>'}
var TX_ICON='<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M12 10v6M9 13h6"/></svg>';
function txBlock(c,id){
  var lines=txLines(c),hot=c.status==="onscene"||c.status==="transport";
  if(!lines.length)return'<button type="button" class="txcta'+(hot?" hot":"")+'" data-txopen="'+esc(id)+'">'+TX_ICON+'<span><b>填寫處置紀錄</b><small>'+(hot?"已到達現場，尚未填寫":"主訴、傷情、X A B C D E、生命徵象")+'</small></span></button>';
  return'<section class="txcard"><div class="txhd"><span><b>處置紀錄</b><small>'+esc(c.txBy||"")+(c.txAt?" "+hm(c.txAt)+" 更新":"")+'</small></span><button type="button" class="btn go" data-txopen="'+esc(id)+'">修改</button></div><div class="txsum">'+lines.map(function(l){return'<div>'+esc(l)+'</div>'}).join("")+'</div></section>';
}
function openTx(id){
  var c=cases[id];if(!c)return;var t=txNorm(c);form={mode:"tx",id:id,tx:t};
  var h='<div class="top"><div><div class="big">'+esc(caseCode(c))+'</div><div class="muted">處置紀錄　'+esc(c.no)+(c.complaint?"　通報主訴："+esc(c.complaint):"")+'</div></div><button type="button" class="btn" data-close>取消</button></div>';
  h+='<fieldset><legend>主訴</legend>'+sub("創傷")+txChips("ccT",CC_T,t.ccT||[])+'<input type="text" id="tx-ccTx" maxlength="40" placeholder="手動輸入" aria-label="創傷主訴手動輸入" value="'+esc(t.ccTx||"")+'">'+
     sub("傷情部位（可多處，點部位展開）")+'<div class="injs">'+injHtml(t)+'</div>'+
     sub("非創傷")+txChips("ccN",CC_N,t.ccN||[])+'<input type="text" id="tx-ccNx" maxlength="40" placeholder="手動輸入" aria-label="非創傷主訴手動輸入" value="'+esc(t.ccNx||"")+'"></fieldset>';
  TX.forEach(function(g){
    var k=g.k,act=t[k]||[],sit=t[k+"s"]||[];h+='<section class="sec" data-sec="'+k+'" role="group" aria-label="'+g.name+'"><h3 class="sechd">'+g.name+'</h3>';
    if(g.sit.length)h+=sub("情況")+txChips(k+"s",g.sit,sit);
    if(k==="C")h+='<div class="inl">'+num("tx-crt","CRT",t.crt,"秒",70)+'</div>';
    if(k==="E")h+='<input type="text" id="tx-e" maxlength="80" placeholder="手動輸入" aria-label="暴露所見" value="'+esc(t.e||"")+'">';
    if(k==="D")h+=sub("意識與神經學評估（可記錄多次）")+'<div id="tx-ds" class="vs"></div><div class="vsnew"><div class="inl"><label class="fld"><span>評估時間</span><input type="time" id="tx-dt" value="'+hm(Date.now())+'"></label></div>'+
      '<div class="inl">'+sel("tx-gE","GCS　E",4,"")+sel("tx-gV","V",5,"")+sel("tx-gM","M",6,"")+'<b id="tx-gcs" class="gcs"></b></div>'+
      '<div class="inl">'+num("tx-pR","瞳孔　R","","mm",64)+'<span class="fld"><span>對光</span></span>'+dnChips("pRr",[["+","＋"],["-","－"]],true)+'</div>'+
      '<div class="inl">'+num("tx-pL","瞳孔　L","","mm",64)+'<span class="fld"><span>對光</span></span>'+dnChips("pLr",[["+","＋"],["-","－"]],true)+'</div>'+
      sub("感覺／運動功能")+'<div class="limbs">'+LIMBS.map(function(l){return'<div class="limb"><b>'+l[1]+'</b>'+dnChips(l[0],LIMB_OPT)+'</div>'}).join("")+'</div><button type="button" class="btn" id="tx-dsadd">加入這筆</button></div>';
    if(g.act.length)h+=sub("處置")+txChips(k,g.act,act);
    if(k==="X")h+='<div class="inl" id="tx-tq-row"'+(act.indexOf("止血帶")<0?" hidden":"")+'><label class="fld"><span>止血帶時間</span><input type="time" id="tx-tq" value="'+esc(t.tq||"")+'"></label><button type="button" class="btn" id="tx-now">現在</button></div>';
    if(k==="C")h+='<div class="vsnew" id="tx-iv-row"'+(act.indexOf("輸液")<0?" hidden":"")+'>'+sub("輸液")+oneChips("ivF",[IV_F],t.ivF)+sub("IC 號數")+oneChips("ivG",IV_G,t.ivG)+sub("部位")+oneChips("ivS",IV_S,t.ivS)+'</div>';
    h+=txChips(k,[NA],act,"na")+'</section>';
    if(k==="S")h+='<section class="sec" data-sec="V" role="group" aria-label="C 意識"><h3 class="sechd">C 意識</h3>'+sub("AVPU")+oneChips("avpu",AVPU,t.avpu)+sub("情況")+txChips("cvS",["低血糖"],t.cvS||[])+sub("處置")+txChips("cvA",["糖粉"],t.cvA||[])+'</section>';
  });
  h+='<fieldset><legend>輔助檢查數值（可記錄多次）</legend><div id="tx-vs" class="vs"></div>'+
     '<div class="vsnew"><div class="inl"><label class="fld"><span>測量時間</span><input type="time" id="tx-vt" value="'+hm(Date.now())+'"></label></div><div class="inl">'+num("tx-spo2","血氧","","%",70)+
     '<span class="fld nw"><span>血壓</span><input type="text" inputmode="decimal" id="tx-sbp" maxlength="4" aria-label="收縮壓" value="" style="width:70px"><span>/</span><input type="text" inputmode="decimal" id="tx-dbp" maxlength="4" aria-label="舒張壓" value="" style="width:70px"><span>mmHg</span></span></div>'+
     '<div class="inl">'+num("tx-glu","血糖","","mg/dL",70)+num("tx-temp","體溫","","°C",70)+'</div><button type="button" class="btn" id="tx-vsadd">加入這筆</button></div></fieldset>'+
     '<fieldset><label class="l" for="tx-other">其他</label><textarea id="tx-other" rows="2" maxlength="300" placeholder="手動輸入">'+esc(t.other||"")+'</textarea></fieldset>'+
     '<div class="sticky"><button type="button" class="btn go" id="tx-save">儲存處置紀錄</button></div>';
  openSheet(h);gcsShow();vsList();dsList();
}
function gcsShow(){var g=$("tx-gcs");if(!g)return;var s=gcsTotal({gE:$("tx-gE").value,gV:$("tx-gV").value,gM:$("tx-gM").value});g.textContent=s?"＝ "+s:""}
function timeOf(id){var d=new Date(),p=($(id).value||"").split(":");if(p.length>=2)d.setHours(Number(p[0]),Number(p[1]),0,0);return d.getTime()}
function rowList(boxId,arr,textFn,delAttr,emptyMsg){
  $(boxId).innerHTML=arr.length?arr.map(function(v,i){return'<div class="vsrow"><b>'+hm(v.t)+'</b><span>'+esc(textFn(v))+'</span><button type="button" class="btn" '+delAttr+'="'+i+'" aria-label="刪除 '+hm(v.t)+' 這筆">✕</button></div>'}).join(""):'<p class="muted">'+emptyMsg+'</p>';
}
function vsList(){rowList("tx-vs",form.tx.vs,vsText,"data-vsdel","尚未記錄。填好下面的數值後按「加入這筆」，可以記錄多次。")}
function dsList(){rowList("tx-ds",form.tx.ds,dsText,"data-dsdel","尚未記錄。填好下面的評估後按「加入這筆」，可以記錄多次。")}
function rowAdd(keys,timeId,arr,silent,what){
  var v={},n=0;keys.forEach(function(k){var x=$("tx-"+k).value.trim();if(x){v[k]=x;n++}});
  if(!n){if(!silent)toast("請先填入至少一項");return false}
  v.t=timeOf(timeId);v.by=me||"未設定";arr.push(v);arr.sort(function(x,y){return x.t-y.t});
  keys.forEach(function(k){$("tx-"+k).value=""});$(timeId).value=hm(Date.now());
  if(!silent)toast("已加入 "+hm(v.t)+" 的"+what);return true;
}
function vsAdd(silent){if(rowAdd(VKEYS,"tx-vt",form.tx.vs,silent,"測量"))vsList()}
function dsAdd(silent){if(rowAdd(DNEW,"tx-dt",form.tx.ds,silent,"評估")){gcsShow();dsList();document.querySelectorAll("#sheet .chip[data-dn],#sheet .chip[data-dn1]").forEach(function(b){b.setAttribute("aria-pressed","false")})}}
function txRefresh(scope){
  scope.querySelectorAll(".chip[data-tx]").forEach(function(b){b.setAttribute("aria-pressed",String((form.tx[b.dataset.tx]||[]).indexOf(b.dataset.v)>=0))});
}
function txClick(t){
  var key=t.dataset.tx,v=t.dataset.v,tx=form.tx,isSit=key.length===2&&key.charAt(1)==="s",base=isSit?key.charAt(0):key;
  if(v===NA){
    if((tx[base]||[]).indexOf(NA)>=0)tx[base]=[];else{tx[base]=[NA];tx[base+"s"]=[]}
  }else{
    tx[base]=(tx[base]||[]).filter(function(x){return x!==NA});
    var arr=(tx[key]||[]).slice(),i=arr.indexOf(v);
    if(i>=0)arr.splice(i,1);else{arr.push(v);
      if(v==="骨盆穩固")arr=arr.filter(function(x){return x!=="骨盆不穩"});
      if(v==="骨盆不穩")arr=arr.filter(function(x){return x!=="骨盆穩固"});}
    tx[key]=arr;
  }
  txRefresh(t.closest("[data-sec],fieldset"));
  if(base==="X"){var on=(tx.X||[]).indexOf("止血帶")>=0;$("tx-tq-row").hidden=!on;if(on&&!$("tx-tq").value)$("tx-tq").value=hm(Date.now())}
  if(base==="C")$("tx-iv-row").hidden=(tx.C||[]).indexOf("輸液")<0;
}
function tx1Click(t){
  var k=t.dataset.tx1,v=t.dataset.v;form.tx[k]=form.tx[k]===v?"":v;
  t.parentNode.querySelectorAll(".chip").forEach(function(b){b.setAttribute("aria-pressed",String(form.tx[k]===b.dataset.v))});
}
function txSave(){
  var c=clone(cases[form.id]),t=form.tx,map={tq:"tx-tq",crt:"tx-crt",e:"tx-e",other:"tx-other",ccTx:"tx-ccTx",ccNx:"tx-ccNx"};
  vsAdd(true);dsAdd(true);
  Object.keys(map).forEach(function(k){var v=$(map[k]).value.trim();if(v)t[k]=v;else delete t[k]});
  if((t.X||[]).indexOf("止血帶")<0)delete t.tq;
  INJ.forEach(function(g){
    var r=t.inj[g.k]||{},sx=$("inj-"+g.k+"-sitx").value.trim(),lx=g.locx?$("inj-"+g.k+"-locx").value.trim():"",tq=$("inj-"+g.k+"-tq");
    if(sx)r.sitx=sx;else delete r.sitx;if(lx)r.locx=lx;else delete r.locx;
    if(tq&&tq.value&&(r.act||[]).indexOf("止血帶")>=0)r.tq=tq.value;else delete r.tq;
    ["loc","sit","act"].forEach(function(x){if(r[x]&&!r[x].length)delete r[x]});
    if(Object.keys(r).length)t.inj[g.k]=r;else delete t.inj[g.k];
  });
  if(!Object.keys(t.inj).length)delete t.inj;
  if((t.C||[]).indexOf("輸液")<0){delete t.ivF;delete t.ivG;delete t.ivS}
  Object.keys(t).forEach(function(k){if(t[k]===""||(Array.isArray(t[k])&&!t[k].length))delete t[k]});
  c.tx=t;c.txAt=Date.now();c.txBy=me||"未設定";
  form=null;$("sheet").hidden=true;save(c);toast("處置紀錄已儲存");
}
function closeSheet(){$("sheet").hidden=true;form=null;if(typeof needReload!=="undefined"&&needReload)return location.reload();render()}
function askCode(title,then){
  var code=String(Math.floor(1000+Math.random()*9000));form={mode:"confirm",code:code,then:then};
  openSheet('<div class="top"><h2>'+esc(title)+'</h2><button type="button" class="btn" data-close>取消</button></div>'+
   '<p class="warnbox">這個操作會影響全隊所有手機。確定要執行，請輸入下面的數字。</p><div class="big">'+code+'</div>'+
   '<input type="text" id="f-code" inputmode="numeric" maxlength="4" autocomplete="off" aria-label="確認數字" placeholder="輸入上面 4 個數字"><button type="button" class="btn danger" id="f-code-ok">確認執行</button>');
}
function dlCsv(eid,name){
  var ex2=exportText(",",eid),a=document.createElement("a");
  a.href=URL.createObjectURL(new Blob(["\ufeff"+ex2.text],{type:"text/csv"}));a.download=name;
  document.body.appendChild(a);a.click();a.remove();
}
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
  if(to==="enroute"){c.times.dispatched=now;c.crew=me;startCompass();navId=id;ls("ems.nav",id);show("map")}
  if(to==="onscene"){c.times.arrived=now;if(!c.crew)c.crew=me;if(navId===id){navId=null;ls("ems.nav",null)}}
  if(to==="transport"){c.times.transport=now}
  if(to==="closed"){c.times.closed=now;c.disposition=c.times.transport?"後送":"現場處置"}
  c.status=to;$("sheet").hidden=true;form=null;save(c);toast(caseCode(c)+" "+STAT[to]+" "+hm(now));
}
function exportText(sep,eid){
  var head=["案號","區碼","位置碼","區名","地標","主訴","檢傷","性別","年齡層","狀態","處置","出勤人員","通報","出勤","到達","後送","結案","到達分鐘","緯度","經度","備註","建立者","處置紀錄","AVPU","評估次數","最後 GCS","測量次數","最後測量時間","血氧","收縮壓","舒張壓","血糖","體溫"];
  var rows=casesOf(eid||site.eventId).sort(function(a,b){return a.times.reported-b.times.reported}).map(function(c){
    return[c.no,c.zone,caseCode(c),zname(c.zone),c.landmark,c.complaint,["","紅","黃","綠"][c.triage]||"",c.sex,c.age,STAT[c.status],c.disposition,c.crew,
      hm(c.times.reported),hm(c.times.dispatched),hm(c.times.arrived),hm(c.times.transport),hm(c.times.closed),
      mins(c.times.reported,c.times.arrived),c.lat?c.lat.toFixed(6):"",c.lng?c.lng.toFixed(6):"",c.note,c.createdBy,txLines(c).join("；"),(c.tx||{}).avpu||"",dsOf(c).length||"",gcsTotal(lastDs(c))||"",vsOf(c).length||"",lastVs(c).t?hm(lastVs(c).t):"",lastVs(c).spo2,lastVs(c).sbp,lastVs(c).dbp,lastVs(c).glu,lastVs(c).temp].map(function(v){
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
  if(d.sub&&form){t.parentNode.querySelectorAll(".chip").forEach(function(b){b.setAttribute("aria-pressed","false")});t.setAttribute("aria-pressed","true");form.sub=Number(d.sub);
    if(form.mode==="code")$("c-big").textContent=form.zone?form.zone+"-"+form.sub:"—";else if($("f-big"))$("f-big").textContent=bigCode();return}
  if(d.cz&&form){t.parentNode.querySelectorAll(".chip").forEach(function(b){b.setAttribute("aria-pressed","false")});t.setAttribute("aria-pressed","true");form.zone=d.cz;$("c-big").textContent=form.zone+"-"+form.sub;return}
  if(d.codeopen)return openCode();
  if(d.txopen)return openTx(d.txopen);
  if(d.tx&&form&&form.mode==="tx")return txClick(t);
  if(d.tx1&&form&&form.mode==="tx")return tx1Click(t);
  if(d.inj&&form&&form.mode==="tx")return injClick(t);
  if((d.dn||d.dn1)&&form&&form.mode==="tx")return dnClick(t);
  if(d.injnow){$("inj-"+d.injnow+"-tq").value=hm(Date.now());return}
  if(id==="tx-now"){$("tx-tq").value=hm(Date.now());return}
  if(id==="tx-save")return txSave();
  if(id==="tx-vsadd")return vsAdd(false);
  if(id==="tx-dsadd")return dsAdd(false);
  if(d.dsdel&&form&&form.mode==="tx"){form.tx.ds.splice(Number(d.dsdel),1);dsList();return}
  if(d.vsdel&&form&&form.mode==="tx"){form.tx.vs.splice(Number(d.vsdel),1);vsList();return}
  if(id==="codeGo"){
    if(!form.zone)return toast("請先選區");
    var cl=codeLL(form.zone,form.sub);$("sheet").hidden=true;form=null;show("map");setPending(cl);map.setView(cl,Math.max(map.getZoom(),19));return;
  }
  if(d.nav){startCompass();setNav(d.nav);$("sheet").hidden=true;form=null;show("map");var nl=caseLL(cases[d.nav]);if(pos&&nl)map.fitBounds([pos.ll,nl],{padding:[70,70],maxZoom:20});return}
  if(d.move)return moveStart(d.move);
  if(id==="moveGo"){
    var mc=clone(cases[moving]),mz=zoneAt(pending);mc.lat=pending[0];mc.lng=pending[1];mc.zone=mz;moving=null;clearPending();save(mc);toast("位置已改為 "+caseCode(mc));return;
  }
  if(id==="navStop")return setNav(null);
  if(id==="navOpen"){if(navId)openDetail(navId);return}
  if(id==="alertOpen"){var ax=alerts.shift();renderAlert();if(ax)openDetail(ax.id);return}
  if(id==="alertNo"){alerts.shift();renderAlert();return}
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
  if(id==="pendNo"){moving=null;return clearPending()}
  if(id==="pendGo"){var p1=pending;clearPending();if(!me)return askMe(function(){openNew(p1,0)});return openNew(p1,0)}
  if(id==="calCancel"){calib=null;setBar("");drawGrid();return}
  if(id==="resetGrid"){
    if(d.sure!=="1"){d.sure="1";t.textContent="再按一次確定還原";setTimeout(function(){d.sure="";t.textContent="還原成預設分區位置"},5000);return}
    d.sure="";t.textContent="還原成預設分區位置";site.grid=null;saveSite("已還原預設分區");show("map");map.setView(CFG.center||[23.068,120.1272],18);return;
  }
  if(id==="calib"){calib=[];clearPending();show("map");calibBar();return}
  if(id==="f-me-save"){var v2=$("f-me").value.trim();if(!v2)return toast("請輸入呼號");me=v2;ls("ems.me",me);var th=form&&form.then;closeSheet();if(th)th();return}
  if(id==="f-save"){
    var now=Date.now(),zone=$("f-zone").value,auto=zoneAt(form.ll);
    var ll=(zone==="H"||zone==="X"||(zone===auto&&form.sub===subAt(form.ll)))?form.ll:(codeLL(zone,form.sub)||form.ll);
    var c={id:now.toString(36)+Math.random().toString(36).slice(2,6),eventId:site.eventId,no:hm(now).replace(":","")+"-"+zone,zone:zone,
      lat:ll[0],lng:ll[1],landmark:[form.landmark,$("f-landmark").value.trim()].filter(Boolean).join(" "),complaint:[form.complaint,$("f-complaintx").value.trim()].filter(Boolean).join(" "),
      triage:form.triage,sex:form.sex,age:form.age,preg:form.preg?true:false,note:$("f-note").value.trim(),status:"new",crew:"",disposition:"",createdBy:me,times:{reported:now}};
    form=null;$("sheet").hidden=true;save(c);show("list");toast("已建立 "+c.no);return;
  }
  if(id==="f-update"){
    var c2=clone(cases[form.id]),nz=$("f-zone").value;
    var ncode=(nz==="H"||nz==="X")?nz:nz+"-"+form.sub;
    if(ncode!==caseCode(c2)){c2.zone=nz;var zc=codeLL(nz,form.sub);if(zc){c2.lat=zc[0];c2.lng=zc[1]}}
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
  if(d.del){
    if(d.sure!=="1"){d.sure="1";t.textContent="再按一次確定刪除，全隊都會消失";return}
    var dc=cases[d.del];form=null;$("sheet").hidden=true;if(dc){save(tomb(dc));toast("已刪除 "+dc.no)}return;
  }
  if(id==="purgeCancel"){
    var pc=cur().filter(function(c){return c.status==="cancel"});
    if(!pc.length)return toast("沒有已取消的案件");
    if(d.sure!=="1"){d.sure="1";t.textContent="再按一次確定刪除 "+pc.length+" 筆";setTimeout(function(){d.sure="";t.textContent="刪除所有已取消的案件"},5000);return}
    d.sure="";t.textContent="刪除所有已取消的案件";
    var nowp=Date.now();pc.forEach(function(c){var x=tomb(c);x.updatedAt=nowp;x.by=me||"未設定";cases[c.id]=x;dirty[c.id]=1});persist();render();flush();toast("已刪除 "+pc.length+" 筆");return;
  }
  if(id==="f-code-ok"){
    if($("f-code").value.trim()!==form.code)return toast("數字不對，沒有執行");
    var cf=form.then;form=null;$("sheet").hidden=true;cf();return;
  }
  if(d.evdl){var et=casesOf(d.evdl).map(function(c){return c.times.reported}),e0=new Date(Math.min.apply(null,et));
    dlCsv(d.evdl,"救護案件-"+e0.getFullYear()+("0"+(e0.getMonth()+1)).slice(-2)+("0"+e0.getDate()).slice(-2)+"-過去活動.csv");return}
  if(d.evback){var eb=d.evback;return askCode("切回這場活動",function(){site.eventId=eb;saveSite("已切回該場活動");renderSettings();show("list")})}
  if(id==="copy"){
    var ex=exportText("\t"),ta=$("csv");
    var fb=function(){ta.hidden=false;ta.value=ex.text;ta.focus();ta.select();toast("請手動複製下方文字")};
    try{navigator.clipboard.writeText(ex.text).then(function(){toast("已複製 "+ex.n+" 筆，到 Excel 貼上")},fb)}catch(er){fb()}
    return;
  }
  if(id==="dl"){
    var dt=new Date();dlCsv(null,"救護案件-"+dt.getFullYear()+("0"+(dt.getMonth()+1)).slice(-2)+("0"+dt.getDate()).slice(-2)+".csv");return;
  }
  if(id==="getTiles")return getTiles(t);
  if(id==="updNow")return selfUpdate(true);
  if(id==="saveZ"){var z={};CODES.forEach(function(c){var v=$("z-"+c).value.trim();if(v&&v!==DEF[c])z[c]=v});site.zones=z;saveSite("區名已儲存");return}
  if(id==="saveTeam"){
    var tv=$("teamInput").value.trim();
    if(tv&&!/^[A-Za-z0-9_-]{6,40}$/.test(tv))return toast("代碼需為 6–40 碼英數字");
    ls("ems.team",tv);location.reload();return;
  }
  if(id==="newEv"){
    return askCode("開始新活動",function(){site.eventId="e"+Date.now().toString(36);site.eventName=EVENT_NAME;saveSite("已開始新活動，舊案件在「過去活動」");renderSettings()});
  }
});
$("sheet").addEventListener("change",function(e){if(e.target.id==="f-zone"&&$("f-big"))$("f-big").textContent=bigCode();if(/^tx-g[EVM]$/.test(e.target.id))gcsShow()});
document.addEventListener("pointerdown",unlockAudio,{passive:true});
window.addEventListener("offline",function(){live=false;syncPill()});

/* ---------- 啟動 ---------- */
initMap();render();startGPS();connect();
setInterval(function(){if(needReload&&$("sheet").hidden)return location.reload();flush();publishPos();drawCrew();drawNav();if(tab==="list"&&$("sheet").hidden)renderList()},20000);
window.addEventListener("online",flush);
function wake(){try{if(navigator.wakeLock)navigator.wakeLock.request("screen").catch(function(){})}catch(e){}}
wake();document.addEventListener("visibilitychange",function(){if(!document.hidden)wake()});
var needReload=false;
// 不依賴瀏覽器的背景更新：頁面自己比對版本，把整包新檔案抓齊後才換上，中途失敗就維持原狀
function selfUpdate(manual){
  if(!window.caches||!navigator.serviceWorker||!navigator.serviceWorker.controller){if(manual)toast("請重新整理頁面來更新");return}
  var stamp="fresh="+Date.now();
  if(manual)toast("檢查更新中…");
  fetch("sw.js?"+stamp,{cache:"no-store"}).then(function(r){if(!r.ok)throw 0;return r.text()}).then(function(txt){
    var m=/VERSION\s*=\s*"([^"]+)"/.exec(txt),fm=/FILES\s*=\s*\[([\s\S]*?)\]/.exec(txt);
    if(!m||!fm)throw 0;
    if(m[1]===APP_VERSION){if(manual)toast("已是最新版 "+APP_VERSION);return}
    if(manual)toast("發現新版 "+m[1]+"，下載中…");
    var files=JSON.parse("["+fm[1]+"]");
    return Promise.all(files.map(function(f){
      return fetch(f+(f.indexOf("?")<0?"?":"&")+stamp,{cache:"no-store"}).then(function(r){if(!r.ok)throw 0;return r.blob().then(function(b){return[f,b,r.headers.get("content-type")||""]})});
    })).then(function(list){
      return caches.keys().then(function(ks){
        return Promise.all(ks.filter(function(k){return k.indexOf("ems-shell-")===0}).map(function(k){
          return caches.open(k).then(function(c){return Promise.all(list.map(function(x){
            return c.put(new Request(x[0]),new Response(x[1],{headers:{"content-type":x[2]}}));
          }))});
        }));
      });
    }).then(function(){
      needReload=true;if($("sheet").hidden)location.reload();else toast("新版已下載，關閉這個畫面後會自動更新");
    });
  }).catch(function(){if(manual)toast("無法更新，請確認網路後再試")});
}
function autoUpdate(){
  var last=0;try{last=Number(sessionStorage.getItem("ems.upd"))||0}catch(e){}
  if(Date.now()-last<10*60000||needReload)return;
  try{sessionStorage.setItem("ems.upd",String(Date.now()))}catch(e){}
  selfUpdate(false);
}
setTimeout(autoUpdate,12000);setInterval(autoUpdate,30*60000);
if("serviceWorker" in navigator){
  var hadSW=!!navigator.serviceWorker.controller;
  navigator.serviceWorker.register("sw.js").then(function(r){
    r.update().catch(function(){});setInterval(function(){r.update().catch(function(){})},30*60000);
  }).catch(function(){});
  // 新版整包存好並接手後，自動重新載入一次
  navigator.serviceWorker.addEventListener("controllerchange",function(){
    if(!hadSW||needReload)return;needReload=true;
    if($("sheet").hidden)location.reload();else toast("系統有新版，關閉這個畫面後會自動更新");
  });
}
window.__ems={zoneAt:zoneAt,tileList:tileList,posCode:posCode,codeLL:codeLL,remote:function(r){applyRemote(r);persist();render()},setHeading:function(h){heading=h;drawNav()},firstDone:function(){firstSnap=false}};
})();
