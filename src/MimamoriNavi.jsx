import { useState, useEffect, useRef } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { mimamoriDb as db, db as sharedDb } from "./firebase";
import { collection, onSnapshot, addDoc, deleteDoc, doc, getDoc, getDocs, query, orderBy } from "firebase/firestore";

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
});

const INITIAL_SPOTS = [
  // 暫定学校割当：南小=s4,s21,s22  芦口小=s19,s20  それ以外は八木山中・八木山小に仮割当（後で修正可）
  { id:"s1",  school:"中",  name:"八木山中学校",                   lat:38.23677759520709,  lng:140.844945896771,   imageUrl:"https://drive.google.com/thumbnail?id=1JhwQ9wxnJqiDuSfQ5RJuiXFhZ8bEXamw&sz=w400",  calendarUrl:"https://calendar.app.google/xaBAKYUiX8ZcvH5w8" },
  { id:"s2",  school:"中",  name:"旧ヤマザキショップ付近横断歩道",  lat:38.24149719001751,  lng:140.8416872446962,  imageUrl:"https://drive.google.com/thumbnail?id=1eDX0Fn2wnWuOukeVjUjdFmxySJDCG5bm&sz=w400",  calendarUrl:"https://calendar.app.google/wcKwfQUPGXXZb1ir5" },
  { id:"s3",  school:"中",  name:"恐竜山出口",                      lat:38.238234927334844, lng:140.84062508662637, imageUrl:"https://drive.google.com/thumbnail?id=1KXqnws_50Ri6q3d1RPgz2YzFKO7_wRbU&sz=w400",  calendarUrl:"https://calendar.app.google/4b2fAeLUvUzSrhUt8" },
  { id:"s4",  school:"南小", name:"八木山南セブンイレブン前",        lat:38.23506060451795,  lng:140.83717779589662, imageUrl:"https://drive.google.com/thumbnail?id=1Lgzg_kqe-g5FtEXD5MCI-NXLbfABvpbO&sz=w400",  calendarUrl:"https://calendar.app.google/KgcRfADocaY3rHXPA" },
  { id:"s5",  school:"小",  name:"郵政研修所交差点",                lat:38.23973162173098,  lng:140.83919565811965, imageUrl:"https://drive.google.com/thumbnail?id=1dd8xKcBULMpikeYKTPE3SMTeCg38mbeW&sz=w400",  calendarUrl:"https://calendar.app.google/YhSsvEeoPbt8L9WH6" },
  { id:"s6",  school:"小",  name:"八木山薬局前",                    lat:38.24111999860927,  lng:140.8459944752868,  imageUrl:"https://drive.google.com/thumbnail?id=1CAv54JmYKHqMd7-P6eJyVBEweFVuUw9U&sz=w400",  calendarUrl:"https://calendar.app.google/ZqirtQBqq7a4DftV7" },
  { id:"s7",  school:"小",  name:"ひろた美容室前",                  lat:38.24065795477797,  lng:140.84808767920987, imageUrl:"https://drive.google.com/thumbnail?id=1keIsaXXvNP6_wvLPmhZecCMd2gGWFgxk&sz=w400",  calendarUrl:"https://calendar.app.google/wExs5Nnnoa8nzKrw7" },
  { id:"s8",  school:"小",  name:"八木山ディサービスセンター前",     lat:38.24077066072419,  lng:140.8480172712256,  imageUrl:"https://drive.google.com/thumbnail?id=1hKGb5OLT48kG9xDP3wGZYUfYAXfzXLnT&sz=w400",  calendarUrl:"https://calendar.app.google/JywNb6pnzagycRLE7" },
  { id:"s9",  school:"小",  name:"こやぎベーカリー前",              lat:38.240395696255526, lng:140.84933576244458, imageUrl:"https://drive.google.com/thumbnail?id=1np5OyBoqA3r47K6YLesGDohjvKeSCsWx&sz=w400",  calendarUrl:"https://calendar.app.google/AACAfxKAm2wCHfwa6" },
  { id:"s10", school:"小",  name:"八木山小学校歩道橋下",            lat:38.239514381141845, lng:140.84716686484677, imageUrl:"https://drive.google.com/thumbnail?id=1dGtFi2u7oeJlyA8cJD8qKE9uiJUlZXES&sz=w400",  calendarUrl:"https://calendar.app.google/5hg8cP9M47LgPu8C7" },
  { id:"s11", school:"小",  name:"アルシオン八木山前",              lat:38.23975454317358,  lng:140.84721380350297, imageUrl:"https://drive.google.com/thumbnail?id=1cggzhIb34TlOvlaCmnu1rUIz9n8UrfTC&sz=w400",  calendarUrl:"https://calendar.app.google/3nM6d6AZXNkxgZMfA" },
  { id:"s12", school:"小",  name:"コープ交差点前①",                lat:38.237670388899765, lng:140.84936037352782, imageUrl:"https://drive.google.com/thumbnail?id=1RhPL7YxfL0RI2LE0Hg2cCQRtBqWlmqC3&sz=w400",  calendarUrl:"https://calendar.app.google/9oqnDciCy9NfYtcV6" },
  { id:"s13", school:"小",  name:"コープ交差点前②",                lat:38.237719897305745, lng:140.8495977490177,  imageUrl:"https://drive.google.com/thumbnail?id=1AUf7y_MaMiDizSkHhZ1Di3vyBvDerRq5&sz=w400",  calendarUrl:"https://calendar.app.google/ReC4eeGgYVEz9oxj9" },
  { id:"s14", school:"小",  name:"ラフールキッズ保育園前横断歩道",  lat:38.24318307178688,  lng:140.85030172140966, imageUrl:"https://drive.google.com/thumbnail?id=1JMhlGl01HZUpl7CeH5y0BDKtR8JAs2NX&sz=w400",  calendarUrl:"https://calendar.app.google/aAXwuTUZbc4sc9xX6" },
  { id:"s15", school:"小",  name:"蕎麦みずき近く横断歩道",          lat:38.23883975613502,  lng:140.85493701419472, imageUrl:"https://drive.google.com/thumbnail?id=13lr8k6tNPFGXn0wADM-qfnIMdj-7Flhn&sz=w400",  calendarUrl:"https://calendar.app.google/cQvpp8nHRr8ncUGk9" },
  { id:"s16", school:"小",  name:"あいはら商店前五叉路",            lat:38.23777322339166,  lng:140.85715473826545, imageUrl:"https://drive.google.com/thumbnail?id=1BHTcWekHGM9PDqpax3I4RSr14wsvZN1m&sz=w400",  calendarUrl:"https://calendar.app.google/4tue2fzGsXUkJnFs5" },
  { id:"s17", school:"小",  name:"ポワール前",                      lat:38.236136113618066, lng:140.8474637450346,  imageUrl:"https://drive.google.com/thumbnail?id=1kUbPkQRw6__GnCBnogBWIqFJFRICdXd9&sz=w400",  calendarUrl:"https://calendar.app.google/CiHorGfBAsb9JyeU8" },
  { id:"s18", school:"小",  name:"フレシール八木山前",              lat:38.23502265147368,  lng:140.8466648515453,  imageUrl:"https://drive.google.com/thumbnail?id=1cxF2H35ZyflzCzib0NVWY9tAAmD2xytV&sz=w400",  calendarUrl:"https://calendar.app.google/qof2s3qEqodMgGpb7" },
  { id:"s19", school:"芦口小", name:"西の平２丁目交差点①",         lat:38.23370652166431,  lng:140.8526512710203,  imageUrl:"https://drive.google.com/thumbnail?id=1fH56yhrTUBXcbi_wgK6JVB_kBErnFUab&sz=w400",  calendarUrl:"https://calendar.app.google/zuZjpikWoedwwCKx9" },
  { id:"s20", school:"芦口小", name:"西の平２丁目交差点②",         lat:38.23369177367199,  lng:140.85306835451055, imageUrl:"https://drive.google.com/thumbnail?id=1vn4AALr6_t1D-7HrBi4yTjl0-NGRLs81&sz=w400",  calendarUrl:"https://calendar.app.google/98tg3cjUBLJHdueT9" },
  { id:"s21", school:"南小", name:"ダイヤパレス八木山南前",         lat:38.23353594244764,  lng:140.8349564805444,  imageUrl:"https://drive.google.com/thumbnail?id=1wE_IMsZLJJ3om94LdOl8JqQBZ7vbg7_I&sz=w400",  calendarUrl:"https://calendar.app.google/fPahTELe49YKn5uMA" },
  { id:"s22", school:"南小", name:"鈎取３丁目交差点",               lat:38.232038665543996, lng:140.83643108251613, imageUrl:"https://drive.google.com/thumbnail?id=1vQxuQK81Rk1a6cff5zGqUDQGssyRK4f6&sz=w400",  calendarUrl:"https://calendar.app.google/afzhm9rgLcXZoq996" },
  { id:"s23", school:"小",  name:"NTT八木山交換所そば",            lat:38.23987350241181,  lng:140.85184272211907, imageUrl:"https://drive.google.com/thumbnail?id=1Q1ErYnXAIdwCyOzHo__av66_El38QTWS&sz=w400",  calendarUrl:"https://calendar.app.google/3fv6YxgNEyjf5Gtz9" },
  { id:"s24", school:"小",  name:"八木山小学校校庭入口",            lat:38.238234582073446, lng:140.84991247931433, imageUrl:"https://drive.google.com/thumbnail?id=1cL_nJqYQs5vik7E0U6sZ5BvmjB0Tbw1m&sz=w400",  calendarUrl:"https://calendar.app.google/1PmfaS2HdiEVR3ZQ6" },
  { id:"s25", school:"中",  name:"本町２丁目Ｔ字路",                lat:38.238671468809,    lng:140.84582598653304, imageUrl:"https://drive.google.com/thumbnail?id=1xwo61Wk5LptVmZFqtvyXdDV4EF6nmc25&sz=w400",  calendarUrl:"https://calendar.app.google/BuWD9xgny2CD8qJB9" },
  { id:"s26", school:"中",  name:"本町２丁目十字路",                lat:38.2377803760646,   lng:140.8438968988072,  imageUrl:"https://drive.google.com/thumbnail?id=13mnQq3cvNX-aAjZZY03RkWIgO5IbgkVo&sz=w400",  calendarUrl:"https://calendar.app.google/B7tKxgvSejoc9UxaA" },
  { id:"s27", school:"中",  name:"スクールＩＥ付近横断歩道",        lat:38.24078708468768,  lng:140.8456935981891,  imageUrl:"https://drive.google.com/thumbnail?id=1EeR5BuYIMFgZC_ippKBsWawy2PZ43_pt&sz=w400",  calendarUrl:"https://calendar.app.google/bpTuTsQEiShbzAhN7" },
  { id:"s28", school:"小",  name:"八木山小学校前横断歩道",          lat:38.23962242518082,  lng:140.84733916640388, imageUrl:"https://drive.google.com/thumbnail?id=19pKf2tueMnooh8ZD1_6OruI0P7sFzfea&sz=w400",  calendarUrl:"https://calendar.app.google/Rb75MtSxWTkH2CZEA" },
  { id:"s29", school:"中",  name:"金剛沢３丁目交差点",              lat:38.232925716100844, lng:140.84201831408487, imageUrl:"https://drive.google.com/thumbnail?id=1g4SwPPPyJv9ELndHogbluNnmhzhkUxDI&sz=w400",  calendarUrl:"https://calendar.app.google/t4Fyas6idNLhpPCK6" },
];

// 管理者ロール（PTA本部役員 + 先生）
const ADMIN_ROLES = ["会長","副会長","監事","幹事","会計","事務長","校長","教頭","教務主任"];
const isAdminRole = (role) => ADMIN_ROLES.includes(role);

// ユーザーメール取得ヘルパー
const fetchAllUserEmails = async () => {
  try {
    const snap = await getDocs(collection(sharedDb, "users"));
    return snap.docs.map(d => d.data().email).filter(Boolean);
  } catch (e) { console.error("ユーザーメール取得エラー:", e); return []; }
};

// 学校コード定義
const SCHOOLS = [
  { code:"all", label:"全校（八木山中・八木山小・南小・芦口小）" },
  { code:"中",   label:"八木山中学校" },
  { code:"小",   label:"八木山小学校" },
  { code:"南小", label:"南小学校" },
  { code:"芦口小", label:"芦の口小学校" },
];

// 指定日・スポットが休校対象かを判定
function isSpotHoliday(spot, date, specialDays) {
  return specialDays.some(d =>
    d.type === "holiday" && d.date === date &&
    (d.school === "all" || d.school === spot.school)
  );
}

// 期間内の日付配列を生成
function getDatesInRange(from, to) {
  const dates = [];
  const cur = new Date(from + "T00:00:00");
  const end = new Date(to + "T00:00:00");
  const pad = n => String(n).padStart(2, "0");
  while (cur <= end) {
    dates.push(`${cur.getFullYear()}-${pad(cur.getMonth()+1)}-${pad(cur.getDate())}`);
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

function getDefaultDate() {
  const now = new Date();
  const target = now.getHours() >= 9 ? new Date(now.getTime()+86400000) : now;
  const pad = n => String(n).padStart(2, "0");
  return `${target.getFullYear()}-${pad(target.getMonth()+1)}-${pad(target.getDate())}`;
}
function formatDateJP(dateStr) {
  const d = new Date(dateStr+"T00:00:00");
  return `${d.getMonth()+1}月${d.getDate()}日（${"日月火水木金土"[d.getDay()]}）`;
}
function getDateRange() {
  const pad = n => String(n).padStart(2, "0");
  return Array.from({length:365},(_,i)=>{ const d=new Date(); d.setDate(d.getDate()+i); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; });
}
function createSpotIcon(hasReg) {
  const color = hasReg?"#2563eb":"#dc2626";
  const shadow = hasReg?"rgba(37,99,235,0.5)":"rgba(220,38,38,0.5)";
  return L.divIcon({
    className:"",
    html:`<div style="position:relative;width:32px;height:40px"><div style="width:32px;height:32px;border-radius:50% 50% 50% 0;background:${color};transform:rotate(-45deg);box-shadow:0 3px 12px ${shadow};border:2.5px solid white"></div><div style="position:absolute;top:6px;left:6px;width:20px;height:20px;border-radius:50%;background:white;display:flex;align-items:center;justify-content:center;font-size:11px">${hasReg?"👤":"❗"}</div></div>`,
    iconSize:[32,40], iconAnchor:[16,40], popupAnchor:[0,-40],
  });
}

function createGrayIcon() {
  return L.divIcon({
    className:"",
    html:`<div style="position:relative;width:32px;height:40px;opacity:0.4"><div style="width:32px;height:32px;border-radius:50% 50% 50% 0;background:#94a3b8;transform:rotate(-45deg);border:2.5px solid white"></div><div style="position:absolute;top:6px;left:6px;width:20px;height:20px;border-radius:50%;background:white;display:flex;align-items:center;justify-content:center;font-size:11px">🏫</div></div>`,
    iconSize:[32,40], iconAnchor:[16,40], popupAnchor:[0,-40],
  });
}

function SpotModal({ spot, registrations, selectedDate, currentUser, onRegister, onCancel, onClose, specialDays }) {
  const dayRegs = registrations.filter(r=>r.spotId===spot.id&&r.date===selectedDate);
  const myReg = dayRegs.find(r=>r.userId===currentUser.id);
  const [imgError, setImgError] = useState(false);
  const isHoliday = isSpotHoliday(spot, selectedDate, specialDays);
  const isEnhanced = specialDays.some(d=>d.date===selectedDate&&d.type==="enhanced");
  const schoolLabel = SCHOOLS.find(s=>s.code===spot.school)?.label||"";
  return (
    <div style={{ position:"fixed",inset:0,zIndex:9999,display:"flex",alignItems:"flex-end",justifyContent:"center",background:"rgba(0,0,0,0.55)" }} onClick={onClose}>
      <div style={{ width:"100%",maxWidth:480,background:"white",borderRadius:"24px 24px 0 0",overflow:"hidden",maxHeight:"85vh",display:"flex",flexDirection:"column" }} onClick={e=>e.stopPropagation()}>
        {spot.imageUrl&&!imgError
          ? <div style={{ width:"100%",height:180,overflow:"hidden",flexShrink:0,position:"relative" }}>
              <img src={spot.imageUrl} alt={spot.name} onError={()=>setImgError(true)} style={{ width:"100%",height:"100%",objectFit:"cover" }}/>
              <div style={{ position:"absolute",inset:0,background:"linear-gradient(to bottom,transparent 50%,rgba(0,0,0,0.35))" }}/>
            </div>
          : <div style={{ width:"100%",height:90,background:"linear-gradient(135deg,#1a3a5c,#0284c7)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:36,flexShrink:0 }}>📍</div>
        }
        <div style={{ padding:"16px 20px 36px",overflow:"auto" }}>
          <div style={{ width:40,height:4,background:"#e2e8f0",borderRadius:2,margin:"-4px auto 14px" }}/>
          <h3 style={{ margin:"0 0 4px",fontSize:16,fontWeight:800,color:"#0c1a2e" }}>{spot.name}</h3>
          <p style={{ margin:"0 0 14px",fontSize:12,color:"#94a3b8" }}>🗓 {formatDateJP(selectedDate)} ｜ 🕗 朝の登校時間帯 ｜ 🏫 {schoolLabel}</p>
          {isHoliday&&<div style={{ background:"#f1f5f9",borderRadius:10,padding:"10px 14px",marginBottom:14,display:"flex",alignItems:"center",gap:8 }}><span style={{ fontSize:18 }}>🏫</span><span style={{ fontSize:13,fontWeight:700,color:"#64748b" }}>この日は休校日のため見守り不要です</span></div>}
          {isEnhanced&&<div style={{ background:"#fef9c3",borderRadius:10,padding:"10px 14px",marginBottom:14,display:"flex",alignItems:"center",gap:8 }}><span style={{ fontSize:18 }}>⭐</span><span style={{ fontSize:13,fontWeight:700,color:"#92400e" }}>見守り強化デー — ご参加をお願いします！</span></div>}
          {!isHoliday&&(
            <>
              <div style={{ background:"#f8fafc",borderRadius:12,padding:"12px 14px",marginBottom:16 }}>
                <p style={{ margin:"0 0 8px",fontSize:12,fontWeight:700,color:"#475569" }}>この日の見守り登録</p>
                {dayRegs.length>0
                  ? dayRegs.map(r=>(
                      <div key={r.id} style={{ display:"flex",alignItems:"center",gap:8,padding:"3px 0" }}>
                        <div style={{ width:26,height:26,borderRadius:"50%",background:"linear-gradient(135deg,#38bdf8,#0284c7)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12 }}>👤</div>
                        <span style={{ fontSize:13,fontWeight:r.userId===currentUser.id?700:500,color:r.userId===currentUser.id?"#0284c7":"#334155" }}>{r.nickname}{r.userId===currentUser.id?" （あなた）":""}</span>
                      </div>))
                  : <p style={{ margin:0,fontSize:13,color:"#dc2626",fontWeight:600 }}>❗ 未登録 — サポートが必要です</p>
                }
              </div>
              {currentUser.role==="member"&&(
                myReg
                  ? <button onClick={()=>{onCancel(myReg.id);onClose();}} style={{ width:"100%",padding:"13px",borderRadius:13,border:"2px solid #fecaca",background:"white",color:"#dc2626",cursor:"pointer",fontSize:14,fontWeight:700,fontFamily:"inherit" }}>🗑 登録をキャンセルする</button>
                  : <button onClick={()=>{onRegister(spot);onClose();}} style={{ width:"100%",padding:"13px",borderRadius:13,border:"none",background:"linear-gradient(135deg,#0284c7,#0369a1)",color:"white",cursor:"pointer",fontSize:15,fontWeight:800,fontFamily:"inherit",boxShadow:"0 4px 16px rgba(2,132,199,0.4)" }}>✋ この日に参加する</button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function MapView({ spots, registrations, selectedDate, currentUser, onRegister, onCancel, specialDays }) {
  const [activeSpot, setActiveSpot] = useState(null);
  const allHoliday = specialDays.some(d=>d.date===selectedDate&&d.type==="holiday"&&d.school==="all");
  const isEnhancedDay = specialDays.some(d=>d.date===selectedDate&&d.type==="enhanced");
  return (
    <div style={{ flex:1,position:"relative",overflow:"hidden" }}>
      {isEnhancedDay&&<div style={{ position:"absolute",top:10,left:"50%",transform:"translateX(-50%)",background:"linear-gradient(135deg,#f59e0b,#d97706)",borderRadius:12,padding:"8px 20px",zIndex:1000,textAlign:"center",boxShadow:"0 4px 16px rgba(245,158,11,0.4)" }}><span style={{ color:"white",fontWeight:800,fontSize:13 }}>⭐ 見守り強化週間実施中</span></div>}
      <MapContainer center={[38.23795,140.84650]} zoom={16} style={{ height:"100%",width:"100%" }} zoomControl={false}>
        <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/>
        {spots.map(spot=>{
          const spotHoliday = isSpotHoliday(spot, selectedDate, specialDays);
          const hasReg = !spotHoliday && registrations.some(r=>r.spotId===spot.id&&r.date===selectedDate);
          return (
            <Marker key={spot.id} position={[spot.lat,spot.lng]}
              icon={spotHoliday ? createGrayIcon() : createSpotIcon(hasReg)}
              eventHandlers={{ click:()=>!spotHoliday&&setActiveSpot(spot) }}/>
          );
        })}
      </MapContainer>
      {allHoliday&&<div style={{ position:"absolute",top:"50%",left:"50%",transform:"translate(-50%,-50%)",background:"rgba(255,255,255,0.92)",borderRadius:16,padding:"18px 28px",zIndex:1000,textAlign:"center",boxShadow:"0 4px 20px rgba(0,0,0,0.15)" }}><div style={{ fontSize:36,marginBottom:6 }}>🏫</div><div style={{ fontWeight:800,fontSize:15,color:"#334155" }}>全校休校日</div><div style={{ fontSize:12,color:"#94a3b8",marginTop:4 }}>この日は見守り不要です</div></div>}
      <div style={{ position:"absolute",bottom:16,left:12,background:"white",borderRadius:10,padding:"8px 12px",boxShadow:"0 2px 10px rgba(0,0,0,0.15)",zIndex:1000 }}>
        <div style={{ display:"flex",alignItems:"center",gap:6,marginBottom:4 }}><div style={{ width:11,height:11,borderRadius:"50%",background:"#2563eb" }}/><span style={{ fontSize:11,color:"#334155",fontWeight:600 }}>登録あり</span></div>
        <div style={{ display:"flex",alignItems:"center",gap:6,marginBottom:4 }}><div style={{ width:11,height:11,borderRadius:"50%",background:"#dc2626" }}/><span style={{ fontSize:11,color:"#334155",fontWeight:600 }}>未登録</span></div>
        <div style={{ display:"flex",alignItems:"center",gap:6 }}><div style={{ width:11,height:11,borderRadius:"50%",background:"#cbd5e1" }}/><span style={{ fontSize:11,color:"#94a3b8",fontWeight:600 }}>休校</span></div>
      </div>
      {activeSpot&&<SpotModal spot={activeSpot} registrations={registrations} selectedDate={selectedDate} currentUser={currentUser} onRegister={onRegister} onCancel={onCancel} onClose={()=>setActiveSpot(null)} specialDays={specialDays}/>}
    </div>
  );
}

const NATIONAL_HOLIDAYS = {
  "2026-01-01":"元日","2026-01-12":"成人の日","2026-02-11":"建国記念の日","2026-02-23":"天皇誕生日",
  "2026-03-20":"春分の日","2026-04-29":"昭和の日","2026-05-03":"憲法記念日","2026-05-04":"みどりの日",
  "2026-05-05":"こどもの日","2026-05-06":"振替休日","2026-07-20":"海の日","2026-08-11":"山の日",
  "2026-09-21":"敬老の日","2026-09-22":"国民の休日","2026-09-23":"秋分の日","2026-10-12":"スポーツの日",
  "2026-11-03":"文化の日","2026-11-23":"勤労感謝の日","2027-01-01":"元日","2027-01-11":"成人の日",
  "2027-02-11":"建国記念の日","2027-02-23":"天皇誕生日","2027-03-21":"春分の日"
};

function CalendarView({ spots, registrations, currentUser, onRegister, onCancel, specialDays }) {
  const [selectedSpot, setSelectedSpot] = useState(spots[0]);
  const [ym, setYm] = useState(()=>{ const n=new Date(); return {y:n.getFullYear(),m:n.getMonth()}; });
  const today=new Date();
  const maxDate=new Date(today.getFullYear()+1,2,31); // 翌年3月末まで表示
  const daysInMonth=new Date(ym.y,ym.m+1,0).getDate();
  const firstDay=new Date(ym.y,ym.m,1).getDay();
  const canPrev=new Date(ym.y,ym.m-1,1)>=new Date(today.getFullYear(),today.getMonth(),1);
  const canNext=new Date(ym.y,ym.m+1,1)<=new Date(maxDate.getFullYear(),maxDate.getMonth(),1);
  return (
    <div style={{ flex:1,overflow:"auto",background:"#f0f4f8" }}>
      <div style={{ padding:"10px 12px 0",overflowX:"auto" }}>
        <div style={{ display:"flex",gap:6,minWidth:"max-content",paddingBottom:4 }}>
          {spots.map(s=>(
            <button key={s.id} onClick={()=>setSelectedSpot(s)}
              style={{ padding:"5px 11px",borderRadius:18,border:`2px solid ${selectedSpot?.id===s.id?"#0284c7":"#d1d5db"}`,background:selectedSpot?.id===s.id?"#e0f2fe":"white",color:selectedSpot?.id===s.id?"#0284c7":"#64748b",cursor:"pointer",fontSize:11,fontWeight:selectedSpot?.id===s.id?700:500,whiteSpace:"nowrap",fontFamily:"inherit" }}>
              {s.name}
            </button>
          ))}
        </div>
      </div>
      <div style={{ padding:12 }}>
        <div style={{ background:"white",borderRadius:14,overflow:"hidden",boxShadow:"0 2px 10px rgba(0,0,0,0.07)" }}>
          <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 16px",background:"linear-gradient(135deg,#0c1a2e,#1a3a5c)",color:"white" }}>
            <button onClick={()=>canPrev&&setYm(p=>({y:p.m===0?p.y-1:p.y,m:p.m===0?11:p.m-1}))} disabled={!canPrev} style={{ width:30,height:30,borderRadius:7,background:"rgba(255,255,255,0.15)",border:"none",color:"white",fontSize:17,cursor:canPrev?"pointer":"not-allowed",opacity:canPrev?1:0.3 }}>‹</button>
            <span style={{ fontWeight:800,fontSize:14 }}>{ym.y}年{ym.m+1}月</span>
            <button onClick={()=>canNext&&setYm(p=>({y:p.m===11?p.y+1:p.y,m:p.m===11?0:p.m+1}))} disabled={!canNext} style={{ width:30,height:30,borderRadius:7,background:"rgba(255,255,255,0.15)",border:"none",color:"white",fontSize:17,cursor:canNext?"pointer":"not-allowed",opacity:canNext?1:0.3 }}>›</button>
          </div>
          <div style={{ display:"grid",gridTemplateColumns:"repeat(7,1fr)",background:"#f8fafc" }}>
            {["日","月","火","水","木","金","土"].map((d,i)=><div key={d} style={{ textAlign:"center",padding:"6px 0",fontSize:11,fontWeight:700,color:i===0?"#dc2626":i===6?"#2563eb":"#64748b" }}>{d}</div>)}
          </div>
          <div style={{ display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:1,background:"#e5e7eb" }}>
            {Array(firstDay).fill(null).map((_,i)=><div key={`e${i}`} style={{ background:"#f9fafb",minHeight:54 }}/>)}
            {Array(daysInMonth).fill(null).map((_,i)=>{
              const day=i+1;
              const dateStr=`${ym.y}-${String(ym.m+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
              const cellDate=new Date(ym.y,ym.m,day);
              const isToday=cellDate.toDateString()===today.toDateString();
              const isDisabled=cellDate<new Date(today.getFullYear(),today.getMonth(),today.getDate())||cellDate>maxDate;
              const dow=cellDate.getDay();
              const spotSchool = selectedSpot?.school;
              const SCHOOL_COLORS_CAL = {"中":"#0284c7","小":"#059669","南小":"#7c3aed","芦口小":"#d97706","all":"#f59e0b"};
              const SCHOOL_LABELS_CAL = {"中":"八木山中","小":"八木山小","南小":"南小","芦口小":"芦口小","all":"全校"};
              const nationalHoliday = NATIONAL_HOLIDAYS[dateStr];
              const dayHolidays = specialDays.filter(d=>d.date===dateStr&&d.type==="holiday");
              const isSpotHolidayDay = dayHolidays.some(d=>d.school==="all"||d.school===spotSchool);
              const isEnhanced=specialDays.some(d=>d.date===dateStr&&d.type==="enhanced");
              const dayRegs=isSpotHolidayDay?[]:registrations.filter(r=>r.spotId===selectedSpot?.id&&r.date===dateStr);
              const myReg=dayRegs.find(r=>r.userId===currentUser.id);
              const isRed = dow===0 || !!nationalHoliday;
              return (
                <div key={day} style={{ background:isSpotHolidayDay?"#f1f5f9":isEnhanced?"#fef9c3":nationalHoliday?"#fef2f2":"white",minHeight:54,padding:"3px 3px",opacity:isDisabled?0.4:1 }}>
                  <div style={{ width:21,height:21,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",background:isToday?"#0284c7":"transparent",color:isToday?"white":isRed?"#dc2626":dow===6?"#2563eb":"#334155",fontWeight:isToday?700:500,fontSize:11,marginBottom:2 }}>{day}</div>
                  {nationalHoliday&&<div style={{ fontSize:7,textAlign:"center",color:"#dc2626",fontWeight:700,lineHeight:1.3 }}>🎌{nationalHoliday}</div>}
                  {dayHolidays.length>0&&dayHolidays.map((h,hi)=>{
                    const hCol=SCHOOL_COLORS_CAL[h.school]||"#94a3b8";
                    const hLabel=SCHOOL_LABELS_CAL[h.school]||h.school;
                    return <div key={hi} style={{ fontSize:7,textAlign:"center",color:hCol,fontWeight:700,lineHeight:1.3 }}>🏫{hLabel}</div>;
                  })}
                  {isEnhanced&&!isSpotHolidayDay&&<div style={{ fontSize:9,textAlign:"center",color:"#92400e",fontWeight:700 }}>⭐強化</div>}
                  {!isSpotHolidayDay&&dayRegs.map(r=><div key={r.id} style={{ fontSize:9,padding:"1px 3px",borderRadius:3,background:r.userId===currentUser.id?"#dbeafe":"#dcfce7",color:r.userId===currentUser.id?"#1d4ed8":"#16a34a",fontWeight:600,marginBottom:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{r.nickname}</div>)}
                  {!isDisabled&&!isSpotHolidayDay&&currentUser.role==="member"&&(
                    myReg
                      ? <button onClick={()=>onCancel(myReg.id)} style={{ width:"100%",fontSize:8,padding:"1px",borderRadius:3,border:"1px solid #fecaca",background:"white",color:"#dc2626",cursor:"pointer",fontFamily:"inherit" }}>取消</button>
                      : <button onClick={()=>onRegister(selectedSpot,dateStr)} style={{ width:"100%",fontSize:8,padding:"1px",borderRadius:3,border:"none",background:"#e0f2fe",color:"#0284c7",cursor:"pointer",fontFamily:"inherit" }}>参加</button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function LoginScreen({ onLogin }) {
  const [sel, setSel] = useState(null);
  return (
    <div style={{ minHeight:"100svh",background:"linear-gradient(160deg,#0c1a2e 0%,#1a3a5c 60%,#0f4c75 100%)",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"Hiragino Kaku Gothic ProN, YuGothic, sans-serif",padding:20 }}>
      <style>{`@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}} @keyframes fadeUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}} *{box-sizing:border-box}`}</style>
      <div style={{ width:"100%",maxWidth:400,animation:"fadeUp 0.5s ease" }}>
        <div style={{ textAlign:"center",marginBottom:24 }}>
          <div style={{ fontSize:58,animation:"float 3s ease-in-out infinite",display:"inline-block",filter:"drop-shadow(0 8px 24px rgba(56,189,248,0.5))" }}>👁️</div>
          <h1 style={{ margin:"10px 0 4px",fontSize:22,fontWeight:900,color:"white",letterSpacing:2 }}>見守りナビ</h1>
          <p style={{ margin:0,fontSize:12,color:"rgba(255,255,255,0.5)" }}>八木山中学校 登校見守り活動</p>
        </div>
        <div style={{ background:"rgba(255,255,255,0.07)",backdropFilter:"blur(20px)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:20,padding:"22px 18px" }}>
          <p style={{ margin:"0 0 12px",fontSize:11,fontWeight:700,color:"rgba(255,255,255,0.5)",letterSpacing:1 }}>アカウントを選択</p>
          <div style={{ display:"flex",flexDirection:"column",gap:8 }}>
            {USERS.map(u=>(
              <div key={u.id} onClick={()=>setSel(u)} style={{ display:"flex",alignItems:"center",gap:11,padding:"11px 13px",borderRadius:11,border:`2px solid ${sel?.id===u.id?"#38bdf8":"rgba(255,255,255,0.1)"}`,background:sel?.id===u.id?"rgba(56,189,248,0.15)":"rgba(255,255,255,0.04)",cursor:"pointer",transition:"all 0.15s" }}>
                <div style={{ width:34,height:34,borderRadius:"50%",background:u.role==="admin"?"linear-gradient(135deg,#f59e0b,#d97706)":"linear-gradient(135deg,#38bdf8,#0284c7)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,flexShrink:0 }}>{u.role==="admin"?"👑":"👤"}</div>
                <div>
                  <div style={{ fontWeight:700,color:"white",fontSize:13 }}>{u.name}</div>
                  <div style={{ fontSize:10,color:"rgba(255,255,255,0.4)" }}>{u.role==="admin"?"管理者":`ニックネーム：${u.nickname}`}</div>
                </div>
                {sel?.id===u.id&&<div style={{ marginLeft:"auto",color:"#38bdf8",fontWeight:700 }}>✓</div>}
              </div>
            ))}
          </div>
          <button onClick={()=>sel&&onLogin(sel)} disabled={!sel} style={{ width:"100%",marginTop:16,padding:"13px",borderRadius:12,border:"none",background:sel?"linear-gradient(135deg,#0284c7,#0369a1)":"rgba(255,255,255,0.1)",color:"white",fontWeight:800,fontSize:14,cursor:sel?"pointer":"not-allowed",fontFamily:"inherit",boxShadow:sel?"0 4px 16px rgba(2,132,199,0.4)":"none",transition:"all 0.2s" }}>ログイン →</button>
        </div>
      </div>
    </div>
  );
}

function CalendarManageView({ specialDays, onAdd, onRemove }) {
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate]     = useState("");
  const [selType, setSelType]   = useState("holiday");
  const [selSchool, setSelSchool] = useState("all");
  const [label, setLabel]       = useState("");
  const dateRange = getDateRange();
  const holidays = specialDays.filter(d=>d.type==="holiday").sort((a,b)=>a.date.localeCompare(b.date));
  const enhanced = specialDays.filter(d=>d.type==="enhanced").sort((a,b)=>a.date.localeCompare(b.date));

  const handleAdd = () => {
    if (!fromDate) { alert("開始日を選択してください"); return; }
    const to = toDate || fromDate;
    if (to < fromDate) { alert("終了日は開始日以降にしてください"); return; }
    const dates = getDatesInRange(fromDate, to);
    dates.forEach(date => onAdd(date, selType, selSchool, label));
    alert(`✅ ${dates.length}件登録しました`);
    setFromDate(""); setToDate(""); setLabel("");
  };

  const schoolName = (code) => SCHOOLS.find(s=>s.code===code)?.label || code;

  return (
    <div style={{ flex:1,overflow:"auto",padding:14,background:"#f0f4f8" }}>
      {/* 登録フォーム */}
      <div style={{ background:"white",borderRadius:14,padding:"16px",marginBottom:14,boxShadow:"0 2px 10px rgba(0,0,0,0.07)" }}>
        <h3 style={{ margin:"0 0 14px",fontSize:14,fontWeight:800,color:"#0c1a2e" }}>📅 日程を登録</h3>

        {/* 種別 */}
        <div style={{ marginBottom:10 }}>
          <label style={{ fontSize:11,fontWeight:700,color:"#475569",display:"block",marginBottom:4 }}>種別</label>
          <div style={{ display:"flex",gap:8 }}>
            <button onClick={()=>setSelType("holiday")} style={{ flex:1,padding:"9px",borderRadius:9,border:`2px solid ${selType==="holiday"?"#64748b":"#e5e7eb"}`,background:selType==="holiday"?"#f1f5f9":"white",color:selType==="holiday"?"#334155":"#94a3b8",fontWeight:700,fontSize:12,cursor:"pointer",fontFamily:"inherit" }}>🏫 休校日</button>
            <button onClick={()=>setSelType("enhanced")} style={{ flex:1,padding:"9px",borderRadius:9,border:`2px solid ${selType==="enhanced"?"#92400e":"#e5e7eb"}`,background:selType==="enhanced"?"#fef9c3":"white",color:selType==="enhanced"?"#92400e":"#94a3b8",fontWeight:700,fontSize:12,cursor:"pointer",fontFamily:"inherit" }}>⭐ 見守り強化週間</button>
          </div>
        </div>

        {/* 対象校（休校日のみ） */}
        {selType==="holiday"&&(
          <div style={{ marginBottom:10 }}>
            <label style={{ fontSize:11,fontWeight:700,color:"#475569",display:"block",marginBottom:4 }}>対象校</label>
            <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:6 }}>
              {SCHOOLS.map(s=>(
                <button key={s.code} onClick={()=>setSelSchool(s.code)}
                  style={{ padding:"8px 10px",borderRadius:9,border:`2px solid ${selSchool===s.code?"#0284c7":"#e5e7eb"}`,background:selSchool===s.code?"#e0f2fe":"white",color:selSchool===s.code?"#0284c7":"#64748b",fontWeight:selSchool===s.code?700:500,fontSize:11,cursor:"pointer",fontFamily:"inherit",textAlign:"left" }}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 期間 */}
        <div style={{ marginBottom:10 }}>
          <label style={{ fontSize:11,fontWeight:700,color:"#475569",display:"block",marginBottom:4 }}>期間</label>
          <div style={{ display:"flex",gap:8,alignItems:"center" }}>
            <input type="date" value={fromDate} onChange={e=>setFromDate(e.target.value)}
              style={{ flex:1,padding:"9px 12px",borderRadius:9,border:"2px solid #e5e7eb",fontSize:13,fontFamily:"inherit",color:"#334155" }}/>
            <span style={{ color:"#94a3b8",fontWeight:700,fontSize:13 }}>〜</span>
            <input type="date" value={toDate} onChange={e=>setToDate(e.target.value)}
              style={{ flex:1,padding:"9px 12px",borderRadius:9,border:"2px solid #e5e7eb",fontSize:13,fontFamily:"inherit",color:"#334155" }}/>
          </div>
          <div style={{ fontSize:10,color:"#94a3b8",marginTop:4 }}>※ 1日だけの場合は開始日のみ入力</div>
        </div>

        {/* メモ */}
        <div style={{ marginBottom:12 }}>
          <label style={{ fontSize:11,fontWeight:700,color:"#475569",display:"block",marginBottom:4 }}>メモ（任意）</label>
          <input value={label} onChange={e=>setLabel(e.target.value)} placeholder="例：夏休み、創立記念日など"
            style={{ width:"100%",padding:"9px 12px",borderRadius:9,border:"2px solid #e5e7eb",fontSize:13,fontFamily:"inherit",color:"#334155" }}/>
        </div>
        <button onClick={handleAdd} style={{ width:"100%",padding:"12px",borderRadius:11,border:"none",background:"linear-gradient(135deg,#0284c7,#0369a1)",color:"white",fontWeight:800,fontSize:14,cursor:"pointer",fontFamily:"inherit",boxShadow:"0 4px 14px rgba(2,132,199,0.35)" }}>＋ 登録する</button>
      </div>

      {/* 休校日一覧 */}
      <div style={{ background:"white",borderRadius:14,padding:"16px",marginBottom:14,boxShadow:"0 2px 10px rgba(0,0,0,0.07)" }}>
        <h4 style={{ margin:"0 0 12px",fontSize:13,fontWeight:800,color:"#334155" }}>🏫 休校日（{holidays.length}件）</h4>
        {holidays.length===0
          ? <p style={{ margin:0,fontSize:12,color:"#94a3b8" }}>登録なし</p>
          : holidays.map(d=>(
              <div key={d.id} style={{ display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 0",borderBottom:"1px solid #f1f5f9" }}>
                <div>
                  <div style={{ fontSize:13,fontWeight:700,color:"#334155" }}>{formatDateJP(d.date)}</div>
                  <div style={{ fontSize:11,color:"#94a3b8",marginTop:1 }}>{schoolName(d.school)}{d.label?" · "+d.label:""}</div>
                </div>
                <button onClick={()=>onRemove(d.id)} style={{ padding:"4px 10px",borderRadius:7,border:"1px solid #fecaca",background:"white",color:"#dc2626",fontSize:11,cursor:"pointer",fontWeight:700,fontFamily:"inherit" }}>削除</button>
              </div>
            ))
        }
      </div>

      {/* 強化デー一覧 */}
      <div style={{ background:"white",borderRadius:14,padding:"16px",boxShadow:"0 2px 10px rgba(0,0,0,0.07)" }}>
        <h4 style={{ margin:"0 0 12px",fontSize:13,fontWeight:800,color:"#92400e" }}>⭐ 見守り強化週間（{enhanced.length}日間）</h4>
        {enhanced.length===0
          ? <p style={{ margin:0,fontSize:12,color:"#94a3b8" }}>登録なし</p>
          : enhanced.map(d=>(
              <div key={d.id} style={{ display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 0",borderBottom:"1px solid #f1f5f9" }}>
                <div>
                  <div style={{ fontSize:13,fontWeight:700,color:"#92400e" }}>{formatDateJP(d.date)}</div>
                  {d.label&&<div style={{ fontSize:11,color:"#94a3b8",marginTop:1 }}>{d.label}</div>}
                </div>
                <button onClick={()=>onRemove(d.id)} style={{ padding:"4px 10px",borderRadius:7,border:"1px solid #fecaca",background:"white",color:"#dc2626",fontSize:11,cursor:"pointer",fontWeight:700,fontFamily:"inherit" }}>削除</button>
              </div>
            ))
        }
      </div>
    </div>
  );
}

export default function MimamoriApp({ currentUser: externalUser, onBackToHome }) {
  const currentUser = externalUser ? {
    ...externalUser,
    role: isAdminRole(externalUser.actualRole || externalUser.role) ? "admin" : "member",
  } : null;

  const [view, setView] = useState("map");
  const [selectedDate, setSelectedDate] = useState(getDefaultDate);
  const [spots] = useState(INITIAL_SPOTS);
  const [specialDays, setSpecialDays] = useState([]);
  const [registrations, setRegistrations] = useState([]);
  const [loading, setLoading] = useState(true);

  // Firestore: registrationsをリアルタイム購読
  useEffect(() => {
    const q = query(collection(db, "registrations"), orderBy("date"));
    const unsub = onSnapshot(q, snap => {
      setRegistrations(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }, () => setLoading(false));
    return () => unsub();
  }, []);

  // Firestore: specialDays（見守りナビ独自）をリアルタイム購読
  const [localSpecialDays, setLocalSpecialDays] = useState([]);
  useEffect(() => {
    const q = query(collection(db, "specialDays"), orderBy("date"));
    const unsub = onSnapshot(q, snap => {
      setLocalSpecialDays(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, []);

  // グループウェア（yagiyama-net）の休校日をリアルタイム購読
  const [sharedHolidays, setSharedHolidays] = useState([]);
  const SCHOOL_MAP = {"八木山中":"中","八木山小":"小","八木山南小":"南小","芦口小":"芦口小","all":"all"};
  useEffect(() => {
    const unsub = onSnapshot(collection(sharedDb, "schoolHolidays"), snap => {
      setSharedHolidays(snap.docs.map(d => {
        const data = d.data();
        return { id: `shared_${d.id}`, date: data.date, type: "holiday", school: SCHOOL_MAP[data.school] || data.school, label: data.label || "", shared: true };
      }));
    });
    return () => unsub();
  }, []);

  // 統合: 見守りナビ独自 + グループウェア共有休校日（重複排除）
  useEffect(() => {
    const existingKeys = new Set(localSpecialDays.filter(d => d.type === "holiday").map(d => `${d.date}|${d.school}`));
    const merged = [...localSpecialDays, ...sharedHolidays.filter(h => !existingKeys.has(`${h.date}|${h.school}`))];
    setSpecialDays(merged);
  }, [localSpecialDays, sharedHolidays]);

  // メール通知送信（共通API）
  const sendEmailNotification = async ({ type, title, body, emails, senderName }) => {
    try {
      const res = await fetch("/api/send-notification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, title, body, emails, senderName }),
      });
      const data = await res.json();
      if (!res.ok) console.error("メール通知エラー:", data);
      else console.log("メール通知送信完了:", data);
      return data;
    } catch (e) {
      console.error("メール通知送信失敗:", e);
      return null;
    }
  };

  const handleRegister = async (spot, date) => {
    const d = date || selectedDate;
    if (specialDays.some(s => s.date === d && s.type === "holiday" && (s.school === "all" || s.school === spot.school))) {
      alert("休校日のため登録できません"); return;
    }
    if (registrations.find(r => r.spotId === spot.id && r.userId === currentUser.id && r.date === d)) {
      alert("すでに登録済みです"); return;
    }
    try {
      await addDoc(collection(db, "registrations"), {
        spotId: spot.id, userId: currentUser.id,
        nickname: currentUser.nickname, date: d,
        createdAt: new Date().toISOString(),
      });
      if (!date) alert(`✅ ${spot.name}\n${formatDateJP(d)}\n見守りに登録しました！`);
    } catch (e) {
      console.error("登録エラー:", e);
      alert("登録に失敗しました: " + e.message);
    }
  };

  const handleCancel = async (regId) => {
    if (!window.confirm("登録をキャンセルしますか？")) return;
    await deleteDoc(doc(db, "registrations", regId));
  };

  const handleAddSpecialDay = async (date, type, school, label) => {
    await addDoc(collection(db, "specialDays"), {
      date, type, school: school || "all", label: label || "",
      createdAt: new Date().toISOString(),
    });
    // メール通知（全ユーザー）
    const typeLabel = type === "holiday" ? "休校日" : "見守り強化デー";
    const schoolLabel = SCHOOLS.find(s => s.code === (school || "all"))?.label || "";
    fetchAllUserEmails().then(allEmails => {
      if (allEmails.length > 0) {
        sendEmailNotification({ type: "mimamori", title: `${typeLabel}の設定：${date}`, body: `${schoolLabel}の${date}が「${typeLabel}」に設定されました。${label ? `\n備考: ${label}` : ""}\n\n見守りナビで確認してください。`, emails: allEmails, senderName: "見守りナビ" });
      }
    });
  };

  const handleRemoveSpecialDay = async (id) => {
    await deleteDoc(doc(db, "specialDays", id));
  };

  if (!currentUser) return null;
  if (false) return (
    <div style={{ minHeight:"100svh",background:"linear-gradient(160deg,#0c1a2e 0%,#1a3a5c 60%,#0f4c75 100%)",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"Hiragino Kaku Gothic ProN, YuGothic, sans-serif",padding:20 }}>
      <div style={{ width:"100%",maxWidth:400 }}>
        <div style={{ textAlign:"center",marginBottom:24 }}>
          <div style={{ fontSize:58,display:"inline-block",filter:"drop-shadow(0 8px 24px rgba(56,189,248,0.5))" }}>👁️</div>
          <h1 style={{ margin:"10px 0 4px",fontSize:22,fontWeight:900,color:"white",letterSpacing:2 }}>見守りナビ</h1>
          <p style={{ margin:0,fontSize:12,color:"rgba(255,255,255,0.5)" }}>八木山中学校 登校見守り活動</p>
        </div>
        <div style={{ background:"rgba(255,255,255,0.07)",backdropFilter:"blur(20px)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:20,padding:"24px 20px" }}>
          <p style={{ margin:"0 0 16px",fontSize:14,fontWeight:700,color:"white",textAlign:"center" }}>八木中ネットアカウントでログイン</p>
          {loginErr && <div style={{ background:"rgba(220,38,38,0.2)",color:"#fca5a5",padding:"8px 12px",borderRadius:8,fontSize:12,marginBottom:12 }}>{loginErr}</div>}
          <div style={{ marginBottom:12 }}>
            <div style={{ fontSize:11,fontWeight:600,color:"rgba(255,255,255,0.5)",marginBottom:4 }}>メールアドレス</div>
            <input value={loginEmail} onChange={e=>setLoginEmail(e.target.value)} type="email" placeholder="example@mail.com" style={{ width:"100%",padding:"12px",borderRadius:10,border:"1px solid rgba(255,255,255,0.2)",background:"rgba(255,255,255,0.08)",color:"white",fontSize:14,outline:"none",boxSizing:"border-box" }} />
          </div>
          <div style={{ marginBottom:16 }}>
            <div style={{ fontSize:11,fontWeight:600,color:"rgba(255,255,255,0.5)",marginBottom:4 }}>パスワード</div>
            <input value={loginPw} onChange={e=>setLoginPw(e.target.value)} type="password" placeholder="8文字以上" onKeyDown={e=>e.key==="Enter"&&handleLogin()} style={{ width:"100%",padding:"12px",borderRadius:10,border:"1px solid rgba(255,255,255,0.2)",background:"rgba(255,255,255,0.08)",color:"white",fontSize:14,outline:"none",boxSizing:"border-box" }} />
          </div>
          <button onClick={handleLogin} style={{ width:"100%",padding:"14px",borderRadius:12,border:"none",background:"linear-gradient(135deg,#0284c7,#0369a1)",color:"white",fontWeight:800,fontSize:15,cursor:"pointer",boxShadow:"0 4px 16px rgba(2,132,199,0.4)" }}>ログイン</button>
        </div>
        <p style={{ marginTop:16,fontSize:11,color:"rgba(255,255,255,0.4)",textAlign:"center" }}>八木中ネットで登録したアカウントでログインできます</p>
      </div>
    </div>
  );
  if (loading) return (
    <div style={{ height:"100svh",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:12,background:"#0c1a2e" }}>
      <div style={{ fontSize:36 }}>👁️</div>
      <div style={{ color:"white",fontWeight:700,fontSize:14 }}>データを読み込み中...</div>
    </div>
  );

  const tabs=[
    {id:"map",label:"🗺️ マップ"},
    {id:"calendar",label:"📅 カレンダー"},
    ...(currentUser.role==="admin"?[{id:"calmanage",label:"🗓 管理"},{id:"spots",label:"📍 スポット"}]:[]),
  ];

  return (
    <div style={{ height:"100svh",display:"flex",flexDirection:"column",fontFamily:"Hiragino Kaku Gothic ProN, YuGothic, sans-serif",overflow:"hidden" }}>
      <style>{`*{box-sizing:border-box} .leaflet-container{font-family:inherit}`}</style>
      {/* トップバナー */}
      <div style={{ height:80, backgroundImage:"url('/bn.JPG')", backgroundRepeat:"no-repeat", backgroundSize:"cover", backgroundPosition:"center bottom", flexShrink:0 }}/>
      <header style={{ background:"linear-gradient(135deg,#0c1a2e,#1a3a5c)",flexShrink:0,boxShadow:"0 2px 16px rgba(0,0,0,0.3)" }}>
        <div style={{ display:"flex",alignItems:"center",gap:8,padding:"10px 12px 0" }}>
          <span style={{ fontSize:19 }}>👁️</span>
          <span style={{ fontWeight:900,fontSize:14,color:"white",letterSpacing:1,flex:1 }}>見守りナビ</span>
          <span style={{ fontSize:10,color:"rgba(255,255,255,0.6)",background:"rgba(255,255,255,0.1)",padding:"3px 8px",borderRadius:7 }}>{currentUser.role==="admin"?"👑":"👤"} {currentUser.nickname}</span>
          <button onClick={onBackToHome} style={{ padding:"5px 10px",borderRadius:7,border:"none",background:"linear-gradient(135deg,#0284c7,#0369a1)",color:"white",cursor:"pointer",fontSize:10,fontWeight:800,letterSpacing:1 }}>🏠 ホームに戻る</button>
        </div>
        <div style={{ display:"flex",gap:1,padding:"4px 8px 0" }}>
          {tabs.map(t=>(
            <button key={t.id} onClick={()=>setView(t.id)} style={{ padding:"7px 13px",border:"none",background:"transparent",color:view===t.id?"white":"rgba(255,255,255,0.45)",cursor:"pointer",fontSize:12,fontWeight:view===t.id?700:500,borderBottom:view===t.id?"2px solid #38bdf8":"2px solid transparent",transition:"all 0.15s",fontFamily:"inherit" }}>{t.label}</button>
          ))}
        </div>
      </header>

      {view==="map"&&(
        <div style={{ background:"white",borderBottom:"1px solid #e5e7eb",padding:"8px 10px",overflowX:"auto",flexShrink:0,WebkitOverflowScrolling:"touch" }}>
          <div style={{ display:"flex",gap:5,minWidth:"max-content" }}>
            {getDateRange().slice(0,14).map(date=>{
              const d=new Date(date+"T00:00:00");
              const isSel=date===selectedDate;
              const isToday=date===new Date().toISOString().split("T")[0];
              const dow=d.getDay();
              const isHoliday=specialDays.some(s=>s.date===date&&s.type==="holiday");
              const isEnhanced=specialDays.some(s=>s.date===date&&s.type==="enhanced");
              return (
                <button key={date} onClick={()=>setSelectedDate(date)} style={{ display:"flex",flexDirection:"column",alignItems:"center",padding:"4px 9px",borderRadius:9,border:`2px solid ${isSel?"#0284c7":"#e5e7eb"}`,background:isHoliday?"#f1f5f9":isEnhanced?"#fef9c3":isSel?"#e0f2fe":"white",cursor:"pointer",minWidth:42,transition:"all 0.15s",fontFamily:"inherit" }}>
                  <span style={{ fontSize:9,color:isSel?"#0284c7":dow===0?"#dc2626":dow===6?"#2563eb":"#94a3b8",fontWeight:600 }}>{"日月火水木金土"[dow]}</span>
                  <span style={{ fontSize:15,fontWeight:800,color:isHoliday?"#94a3b8":isSel?"#0284c7":"#334155",lineHeight:1.2 }}>{d.getDate()}</span>
                  {isToday&&<span style={{ fontSize:8,color:"#0284c7",fontWeight:700 }}>今日</span>}
                  {isHoliday&&<span style={{ fontSize:8,color:"#94a3b8",fontWeight:700 }}>🏫</span>}
                  {isEnhanced&&!isHoliday&&<span style={{ fontSize:8,color:"#92400e",fontWeight:700 }}>⭐</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {view==="map"&&<MapView spots={spots} registrations={registrations} selectedDate={selectedDate} currentUser={currentUser} onRegister={handleRegister} onCancel={handleCancel} specialDays={specialDays}/>}
      {view==="calendar"&&<CalendarView spots={spots} registrations={registrations} currentUser={currentUser} onRegister={handleRegister} onCancel={handleCancel} specialDays={specialDays}/>}
      {view==="calmanage"&&currentUser.role==="admin"&&<CalendarManageView specialDays={specialDays} onAdd={handleAddSpecialDay} onRemove={handleRemoveSpecialDay}/>}
      {view==="spots"&&currentUser.role==="admin"&&(
        <div style={{ flex:1,overflow:"auto",padding:14 }}>
          <h3 style={{ margin:"0 0 12px",fontSize:14,fontWeight:800,color:"#0c1a2e" }}>📍 見守りスポット一覧（{spots.length}箇所）</h3>
          <div style={{ display:"flex",flexDirection:"column",gap:8 }}>
            {spots.map(s=>(
              <div key={s.id} style={{ background:"white",borderRadius:11,padding:"10px 13px",boxShadow:"0 1px 5px rgba(0,0,0,0.06)",display:"flex",alignItems:"center",gap:10 }}>
                {s.imageUrl&&<img src={s.imageUrl} alt="" style={{ width:44,height:44,borderRadius:7,objectFit:"cover",flexShrink:0 }} onError={e=>e.target.style.display="none"}/>}
                <div style={{ flex:1,minWidth:0 }}>
                  <div style={{ fontWeight:700,fontSize:12,color:"#0c1a2e",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{s.name}</div>
                  <div style={{ fontSize:10,color:"#94a3b8",marginTop:1 }}>{s.lat.toFixed(4)}, {s.lng.toFixed(4)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
