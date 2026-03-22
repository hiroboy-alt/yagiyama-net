import { useState, useEffect, useRef } from "react";
import { db } from "./firebase";
import { collection, doc, getDocs, setDoc, deleteDoc, onSnapshot, writeBatch } from "firebase/firestore";

// 軽量CSVパーサー（引用符内改行対応）
function parseCSVText(text) {
  const rows = [];
  let current = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i+1] === '"') { cell += '"'; i++; }
        else inQuotes = false;
      } else {
        cell += ch;
      }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { current.push(cell); cell = ""; }
      else if (ch === '\n' || (ch === '\r' && text[i+1] === '\n')) {
        if (ch === '\r') i++;
        current.push(cell); cell = "";
        if (current.some(c => c.trim())) rows.push(current);
        current = [];
      } else if (ch === '\r') {
        current.push(cell); cell = "";
        if (current.some(c => c.trim())) rows.push(current);
        current = [];
      } else {
        cell += ch;
      }
    }
  }
  current.push(cell);
  if (current.some(c => c.trim())) rows.push(current);
  return rows;
}

// Shift_JIS(CP932)デコード用テーブルローダー
async function decodeShiftJIS(buffer) {
  try {
    const decoder = new TextDecoder("shift_jis");
    return decoder.decode(buffer);
  } catch {
    // フォールバック: UTF-8
    const decoder2 = new TextDecoder("utf-8");
    return decoder2.decode(buffer);
  }
}

const ROLES = [
  { code:"会長",     label:"会長",     level:1 },
  { code:"副会長",   label:"副会長",   level:2 },
  { code:"監事",     label:"監事",     level:2 },
  { code:"幹事",     label:"幹事",     level:3 },
  { code:"会計",     label:"会計",     level:3 },
  { code:"事務長",   label:"事務長",   level:3 },
  { code:"委員長",   label:"委員長",   level:4 },
  { code:"校長",     label:"校長",     level:2 },
  { code:"教頭",     label:"教頭",     level:3 },
  { code:"教務主任", label:"教務主任", level:3 },
  { code:"先生",     label:"先生",     level:4 },
  { code:"一般",     label:"一般会員", level:5 },
];

const CHANNELS = [
  { id:"all",      name:"全体",       icon:"📢", desc:"全会員へのお知らせ", members:["all"], children:[] },
  { id:"grade",    name:"学年",       icon:"🎒", desc:"学年別チャンネル", members:["all"], children:[
    { id:"grade1", name:"1年", icon:"1️⃣", desc:"1年生保護者・担当" },
    { id:"grade2", name:"2年", icon:"2️⃣", desc:"2年生保護者・担当" },
    { id:"grade3", name:"3年", icon:"3️⃣", desc:"3年生保護者・担当" },
  ]},
  { id:"club",     name:"部活",       icon:"⚽", desc:"部活動保護者", members:["all"], children:[] },
  { id:"district", name:"地区",       icon:"🏘️", desc:"地区別連絡", members:["all"], children:[] },
  { id:"honbu",    name:"本部役員",   icon:"👑", desc:"会長・副会長・監事・幹事等", members:["honbu"], children:[] },
  { id:"unei",     name:"運営委員会", icon:"🏛️", desc:"本部役員＋実行委員", members:["unei"], children:[] },
];

// チャンネルアクセス判定（本部役員は全チャンネル閲覧可、他は所属のみ）
const isHonbuRole = (role) => HONBU_ROLES.includes(role) || SCHOOL_ROLES.includes(role);
const canAccessChannel = (ch, user) => {
  if (isHonbuRole(user.role)) return true; // 本部役員＋学校側は全チャンネルアクセス
  if (ch.members.includes("all")) return true;
  if (ch.members.includes(user.id)) return true;
  if (ch.members.includes("honbu") && HONBU_ROLES.includes(user.role)) return true;
  if (ch.members.includes("unei") && UNEI_ROLES.includes(user.role)) return true;
  return false;
};
const canWriteChannel = (ch, user) => {
  if (ch.members.includes("all")) return true;
  if (ch.members.includes(user.id)) return true;
  if (ch.members.includes("honbu") && HONBU_ROLES.includes(user.role)) return true;
  if (ch.members.includes("unei") && UNEI_ROLES.includes(user.role)) return true;
  return false; // 本部役員の閲覧のみはfalse
};

// USERS: Firestoreのusersコレクションから読み込み（GroupwareApp内のstateで管理）
// ※ ハードコードのダミーメンバーは削除済み

// 送り先カテゴリ（重要お知らせ用）
const NOTICE_TARGETS = [
  { id:"all", label:"全体", icon:"📢", subs:[] },
  { id:"grade", label:"学年", icon:"🎒", subs:[
    { id:"grade1", label:"1年" },{ id:"grade2", label:"2年" },{ id:"grade3", label:"3年" },
  ]},
  { id:"club", label:"部活", icon:"⚽", subs:[
    { id:"club_soccer", label:"サッカー部" },{ id:"club_baseball", label:"野球部" },
    { id:"club_basketball", label:"バスケ部" },{ id:"club_volleyball", label:"バレー部" },
    { id:"club_tennis", label:"テニス部" },{ id:"club_brass", label:"吹奏楽部" },
    { id:"club_art", label:"美術部" },{ id:"club_science", label:"科学部" },
  ]},
  { id:"district", label:"地区", icon:"🏘️", subs:[
    { id:"dist_yagiyama", label:"八木山本町" },{ id:"dist_midorigaoka", label:"緑ヶ丘" },
    { id:"dist_minamimachi", label:"南町" },{ id:"dist_higashi", label:"八木山東" },
    { id:"dist_minami", label:"八木山南" },
  ]},
  { id:"honbu", label:"本部役員", icon:"👑", subs:[] },
  { id:"unei", label:"運営委員会", icon:"🏛️", subs:[] },
];

// 権限判定
const HONBU_ROLES = ["会長","副会長","監事","幹事","会計","事務長"];
const SCHOOL_ROLES = ["校長","教頭","教務主任"];
const UNEI_ROLES = [...HONBU_ROLES, ...SCHOOL_ROLES, "委員長"];
const canPostImportant = (role) => HONBU_ROLES.includes(role) || SCHOOL_ROLES.includes(role);
const canPostNormal = (role) => UNEI_ROLES.includes(role);

// カレンダー予定カテゴリ
const EVENT_CATEGORIES = [
  { id:"school",   label:"学校行事",       color:"#0284c7", icon:"🏫" },
  { id:"pta",      label:"PTA行事",        color:"#dc2626", icon:"🤝" },
  { id:"holiday",  label:"休校日・短縮授業", color:"#f59e0b", icon:"📕" },
  { id:"club",     label:"部活関連",       color:"#059669", icon:"⚽" },
  { id:"district", label:"地区行事",       color:"#7c3aed", icon:"🏘️" },
];
const getCategoryById = (id) => EVENT_CATEGORIES.find(c=>c.id===id) || EVENT_CATEGORIES[0];

const INITIAL_EVENTS = [];

const INITIAL_NOTICES = [];

const INITIAL_MESSAGES = {
  all: [],
  grade1:[], grade2:[], grade3:[], club:[], district:[],
  honbu:[],
  unei:[],
};

function formatTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return "今";
  if (diff < 3600000) return `${Math.floor(diff/60000)}分前`;
  if (diff < 86400000) return `${d.getHours()}:${String(d.getMinutes()).padStart(2,"0")}`;
  return `${d.getMonth()+1}/${d.getDate()}`;
}

function formatDate(ts) {
  const d = new Date(ts);
  return `${d.getMonth()+1}月${d.getDate()}日`;
}

const CSS = `*{box-sizing:border-box} button,input,textarea{-webkit-tap-highlight-color:transparent; font-family:inherit} ::-webkit-scrollbar{display:none}`;

// CSVダウンロードヘルパー
function toCSVString(rows) {
  return rows.map(row => row.map(cell => {
    const s = String(cell ?? "");
    return s.includes(",") || s.includes('"') || s.includes("\n") ? '"' + s.replace(/"/g,'""') + '"' : s;
  }).join(",")).join("\n");
}
async function downloadExcel(sheetData, fileName) {
  const { rows } = sheetData[0];
  const csv = toCSVString(rows);
  const bom = "﻿";
  const blob = new Blob([bom + csv], { type:"text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = fileName.replace(/\.xlsx$/,".csv"); a.click();
  URL.revokeObjectURL(url);
}

// ============================================================
// 共通ヘッダー
// ============================================================
function Header({ title, onBack, onHome, right }) {
  return (
    <div style={{ background:"linear-gradient(135deg,#0f172a,#1e3a5f)", padding:"13px 16px", display:"flex", alignItems:"center", gap:10, flexShrink:0, boxShadow:"0 2px 12px rgba(0,0,0,0.3)" }}>
      {onBack && <button onClick={onBack} style={{ background:"rgba(255,255,255,0.15)", border:"none", color:"white", fontSize:20, fontWeight:800, cursor:"pointer", padding:"6px 12px", lineHeight:1, borderRadius:10, display:"flex", alignItems:"center", gap:4, flexShrink:0 }}>‹ 戻る</button>}
      {!onBack && <span style={{ fontSize:20 }}>💬</span>}
      <span style={{ fontWeight:900, fontSize:16, color:"white", flex:1, letterSpacing:1 }}>{title}</span>
      <div style={{ display:"flex", alignItems:"center", gap:8, flexShrink:0 }}>
        {right}
        {onHome && <button onClick={onHome} style={{ background:"rgba(255,255,255,0.15)", border:"none", color:"white", fontSize:14, fontWeight:800, cursor:"pointer", padding:"6px 12px", lineHeight:1, borderRadius:10, display:"flex", alignItems:"center", gap:4, flexShrink:0 }}>🏠</button>}
      </div>
    </div>
  );
}

// ============================================================
// ホーム画面
// ============================================================
function HomeScreen({ currentUser, notices, messages, events, onNavigate, onLogout, USERS, kiyakuPdf, setKiyakuPdf }) {
  const latestNotice = notices[0];
  const totalUnread = Object.values(messages).reduce((a,b)=>a+b.length,0);
  const [showKiyaku, setShowKiyaku] = useState(false);

  // 規約PDFアップロード
  const handleKiyakuUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setKiyakuPdf(reader.result);
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  // PTA規約表示画面
  if (showKiyaku) return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", background:"#f0f4f8" }}>
      <Header title="📜 PTA規約" onBack={()=>setShowKiyaku(false)}/>
      <div style={{ flex:1, overflow:"auto", padding:"16px" }}>
        {kiyakuPdf ? (
          <div style={{ background:"white", borderRadius:18, overflow:"hidden", boxShadow:"0 2px 12px rgba(0,0,0,0.06)", padding:16 }}>
            <div style={{ display:"flex", gap:8, marginBottom:12 }}>
              <a href={kiyakuPdf} download="PTA規約.pdf" style={{ flex:1, padding:"10px", borderRadius:10, border:"none", background:"linear-gradient(135deg,#059669,#047857)", color:"white", fontWeight:700, fontSize:13, cursor:"pointer", textDecoration:"none", textAlign:"center", display:"block" }}>📥 PDFをダウンロード</a>
              <button onClick={()=>{ window.open(kiyakuPdf, "_blank"); }} style={{ flex:1, padding:"10px", borderRadius:10, border:"none", background:"linear-gradient(135deg,#0284c7,#0369a1)", color:"white", fontWeight:700, fontSize:13, cursor:"pointer" }}>🔎 新しいタブで開く</button>
            </div>
            <div style={{ border:"1px solid #e5e7eb", borderRadius:12, overflow:"hidden" }}>
              <embed src={kiyakuPdf + "#toolbar=1&navpanes=1&scrollbar=1&view=FitH"} type="application/pdf" style={{ width:"100%", height:"calc(100svh - 240px)", display:"block" }}/>
            </div>
            <div style={{ marginTop:8, textAlign:"center" }}>
              <div style={{ fontSize:11, color:"#94a3b8" }}>PDFが表示されない場合は「新しいタブで開く」または「ダウンロード」をご利用ください</div>
              <label style={{ display:"inline-flex", alignItems:"center", gap:6, padding:"8px 16px", borderRadius:8, border:"2px solid #e5e7eb", background:"white", color:"#64748b", fontWeight:700, fontSize:12, cursor:"pointer", marginTop:8 }}>
                📄 別のPDFに差し替え
                <input type="file" accept="application/pdf" onChange={handleKiyakuUpload} style={{ display:"none" }}/>
              </label>
            </div>
          </div>
        ) : (
          <div style={{ background:"white", borderRadius:18, padding:"40px 20px", boxShadow:"0 2px 12px rgba(0,0,0,0.06)", textAlign:"center" }}>
            <div style={{ fontSize:48, marginBottom:16 }}>📜</div>
            <div style={{ fontSize:16, fontWeight:700, color:"#0f172a", marginBottom:8 }}>PTA規約</div>
            <div style={{ fontSize:13, color:"#94a3b8", marginBottom:20, lineHeight:1.6 }}>規約PDFがまだ登録されていません。<br/>PDFファイルをアップロードしてください。</div>
            <label style={{ display:"inline-flex", alignItems:"center", gap:8, padding:"14px 24px", borderRadius:12, border:"none", background:"linear-gradient(135deg,#0284c7,#0369a1)", color:"white", fontWeight:800, fontSize:14, cursor:"pointer" }}>
              📄 PDFをアップロード
              <input type="file" accept="application/pdf" onChange={handleKiyakuUpload} style={{ display:"none" }}/>
            </label>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", background:"#f0f4f8", overflow:"auto" }}>
      <Header
        title="グループウェア"
        right={
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ fontSize:12, color:"rgba(255,255,255,0.6)" }}>{currentUser.avatar} {currentUser.nickname}</span>
            <button onClick={onLogout} style={{ padding:"5px 10px", borderRadius:8, border:"none", background:"rgba(255,255,255,0.12)", color:"rgba(255,255,255,0.8)", cursor:"pointer", fontSize:11, fontWeight:700 }}>退出</button>
          </div>
        }
      />

      <div style={{ padding:"20px 16px", display:"flex", flexDirection:"column", gap:14 }}>
        {/* あいさつ */}
        <div style={{ background:"linear-gradient(135deg,#0f172a,#1e3a5f)", borderRadius:18, padding:"18px 20px", color:"white", position:"relative" }}>
          <button onClick={()=>setShowKiyaku(true)} style={{ position:"absolute", top:14, right:14, background:"rgba(255,255,255,0.15)", border:"none", borderRadius:10, padding:"6px 10px", cursor:"pointer", display:"flex", alignItems:"center", gap:4, color:"white", fontSize:11, fontWeight:700 }}>📜 規約</button>
          <div style={{ fontSize:13, color:"rgba(255,255,255,0.5)", marginBottom:4 }}>おはようございます</div>
          <div style={{ fontSize:18, fontWeight:800 }}>{currentUser.avatar} {currentUser.name} さん</div>
          <div style={{ fontSize:12, color:"rgba(255,255,255,0.5)", marginTop:4 }}>{ROLES.find(r=>r.code===currentUser.role)?.label}</div>
        </div>

        {/* ① お知らせ */}
        <div onClick={()=>onNavigate("notices")} style={{ background:"white", borderRadius:18, padding:"18px", boxShadow:"0 2px 12px rgba(0,0,0,0.06)", cursor:"pointer", border:"2px solid transparent", transition:"border 0.15s" }}>
          <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:12 }}>
            <div style={{ width:42, height:42, borderRadius:12, background:"linear-gradient(135deg,#dc2626,#b91c1c)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:22 }}>📣</div>
            <div style={{ flex:1 }}>
              <div style={{ fontWeight:800, fontSize:16, color:"#0f172a" }}>お知らせ</div>
              <div style={{ fontSize:11, color:"#94a3b8" }}>{notices.length}件</div>
            </div>
            <span style={{ color:"#cbd5e1", fontSize:20 }}>›</span>
          </div>
          {latestNotice && (
            <div style={{ background:"#fef2f2", borderRadius:10, padding:"12px 14px", borderLeft:"3px solid #dc2626" }}>
              <div style={{ fontSize:11, color:"#dc2626", fontWeight:700, marginBottom:4 }}>最新 · {formatDate(latestNotice.ts)}</div>
              <div style={{ fontSize:14, fontWeight:700, color:"#0f172a", marginBottom:4 }}>{latestNotice.title}</div>
              <div style={{ fontSize:12, color:"#64748b", overflow:"hidden", textOverflow:"ellipsis", display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical" }}>{latestNotice.body}</div>
            </div>
          )}
        </div>

        {/* ② カレンダー */}
        <div onClick={()=>onNavigate("calendar")} style={{ background:"white", borderRadius:18, padding:"18px", boxShadow:"0 2px 12px rgba(0,0,0,0.06)", cursor:"pointer" }}>
          <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:12 }}>
            <div style={{ width:42, height:42, borderRadius:12, background:"linear-gradient(135deg,#0284c7,#0369a1)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:22 }}>📅</div>
            <div style={{ flex:1 }}>
              <div style={{ fontWeight:800, fontSize:16, color:"#0f172a" }}>カレンダー</div>
              <div style={{ fontSize:11, color:"#94a3b8" }}>{events.length}件の予定</div>
            </div>
            <span style={{ color:"#cbd5e1", fontSize:20 }}>›</span>
          </div>
          <MiniCalendar events={events} />
          {(() => {
            const todayStr = `${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,"0")}-${String(new Date().getDate()).padStart(2,"0")}`;
            const next = events.filter(ev=>ev.date>=todayStr).sort((a,b)=>a.date.localeCompare(b.date)).slice(0,2);
            if (next.length === 0) return null;
            return (
              <div style={{ marginTop:10, borderTop:"1px solid #f1f5f9", paddingTop:10 }}>
                {next.map((ev,i) => {
                  const cat = getCategoryById(ev.category);
                  const d = new Date(ev.date+"T00:00:00");
                  return (
                    <div key={ev.id} style={{ display:"flex", alignItems:"center", gap:8, padding:"4px 0", fontSize:12 }}>
                      <div style={{ width:5, height:5, borderRadius:"50%", background:cat.color, flexShrink:0 }}/>
                      <span style={{ color:"#64748b" }}>{d.getMonth()+1}/{d.getDate()}</span>
                      <span style={{ color:"#0f172a", fontWeight:600 }}>{ev.title}</span>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>

        {/* ③ チャット */}
        <div onClick={()=>onNavigate("chat")} style={{ background:"white", borderRadius:18, padding:"18px", boxShadow:"0 2px 12px rgba(0,0,0,0.06)", cursor:"pointer" }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <div style={{ width:42, height:42, borderRadius:12, background:"linear-gradient(135deg,#059669,#047857)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:22 }}>💬</div>
            <div style={{ flex:1 }}>
              <div style={{ fontWeight:800, fontSize:16, color:"#0f172a" }}>チャット</div>
              <div style={{ fontSize:11, color:"#94a3b8" }}>チャンネル・ダイレクト</div>
            </div>
            {totalUnread > 0 && (
              <div style={{ background:"#dc2626", color:"white", fontSize:12, fontWeight:700, minWidth:22, height:22, borderRadius:11, display:"flex", alignItems:"center", justifyContent:"center", padding:"0 5px" }}>{totalUnread}</div>
            )}
            <span style={{ color:"#cbd5e1", fontSize:20 }}>›</span>
          </div>
        </div>

        {/* ④ 管理者メニュー（本部役員のみ表示） */}
        {HONBU_ROLES.includes(currentUser.role) && (
          <div onClick={()=>onNavigate("admin")} style={{ background:"white", borderRadius:18, padding:"18px", boxShadow:"0 2px 12px rgba(0,0,0,0.06)", cursor:"pointer", border:"2px solid #f59e0b20" }}>
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              <div style={{ width:42, height:42, borderRadius:12, background:"linear-gradient(135deg,#d97706,#b45309)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:22 }}>⚙️</div>
              <div style={{ flex:1 }}>
                <div style={{ fontWeight:800, fontSize:16, color:"#0f172a" }}>管理者設定</div>
                <div style={{ fontSize:11, color:"#94a3b8" }}>カレンダー・チャット・メンバー管理</div>
              </div>
              <span style={{ color:"#cbd5e1", fontSize:20 }}>›</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// ミニカレンダー
// ============================================================
function MiniCalendar({ events = [] }) {
  const today = new Date();
  const [offset, setOffset] = useState(0);
  const viewYear = new Date(today.getFullYear(), today.getMonth() + offset, 1).getFullYear();
  const viewMonth = new Date(today.getFullYear(), today.getMonth() + offset, 1).getMonth();
  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth+1, 0).getDate();
  const days = [];
  for (let i=0; i<firstDay; i++) days.push(null);
  for (let i=1; i<=daysInMonth; i++) days.push(i);
  const weeks = ["日","月","火","水","木","金","土"];
  const pad2 = n => String(n).padStart(2,"0");

  const eventDays = new Set();
  events.forEach(ev => {
    const prefix = `${viewYear}-${pad2(viewMonth+1)}-`;
    if (ev.date && ev.date.startsWith(prefix)) {
      const d = parseInt(ev.date.substring(8));
      if (d > 0) eventDays.add(d);
    }
  });

  const prev = (e) => { e.stopPropagation(); setOffset(o => o - 1); };
  const next = (e) => { e.stopPropagation(); setOffset(o => o + 1); };

  return (
    <div>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
        <button onClick={prev} style={{ background:"none", border:"none", fontSize:16, color:"#64748b", cursor:"pointer", padding:"2px 6px" }}>‹</button>
        <div style={{ fontWeight:700, fontSize:13, color:"#475569" }}>{viewYear}年{viewMonth+1}月</div>
        <button onClick={next} style={{ background:"none", border:"none", fontSize:16, color:"#64748b", cursor:"pointer", padding:"2px 6px" }}>›</button>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:2 }}>
        {weeks.map((w,i)=>(
          <div key={w} style={{ textAlign:"center", fontSize:10, fontWeight:700, color:i===0?"#dc2626":i===6?"#0284c7":"#94a3b8", padding:"2px 0" }}>{w}</div>
        ))}
        {days.map((d,i)=>{
          const isToday = d === today.getDate() && viewMonth === today.getMonth() && viewYear === today.getFullYear();
          const hasEvent = d && eventDays.has(d);
          return (
            <div key={i} style={{ textAlign:"center", fontSize:12, padding:"3px 2px", borderRadius:6, background:isToday?"#0284c7":hasEvent?"#eff6ff":"transparent", color:isToday?"white":i%7===0?"#dc2626":i%7===6?"#0284c7":"#334155", fontWeight:isToday||hasEvent?700:400, position:"relative" }}>
              {d||""}
              {hasEvent && !isToday && <div style={{ width:4, height:4, borderRadius:2, background:"#0284c7", margin:"1px auto 0" }}/>}
              {hasEvent && isToday && <div style={{ width:4, height:4, borderRadius:2, background:"white", margin:"1px auto 0" }}/>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
// お知らせ一覧・詳細
// ============================================================
function NoticesScreen({ notices, onBack, onHome, currentUser, onAdd, readRecords, onMarkRead, surveys, setSurveys, recruits, setRecruits, USERS }) {
  const [detail, setDetail] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [showReadList, setShowReadList] = useState(false);
  const [tab, setTab] = useState("notices"); // "notices" | "files"
  const [filePreview, setFilePreview] = useState(null); // ファイル保管庫プレビュー用
  // 重要お知らせフォーム
  const [showImportantForm, setShowImportantForm] = useState(false);
  const [impStep, setImpStep] = useState("category"); // "category" | "sub" | "compose"
  const [impCategory, setImpCategory] = useState(null);
  const [impTarget, setImpTarget] = useState(null);
  const [impTitle, setImpTitle] = useState("");
  const [impBody, setImpBody] = useState("");
  const [impFiles, setImpFiles] = useState([]); // attachments for important
  // 通常お知らせフォーム
  const [newTitle, setNewTitle] = useState("");
  const [newBody, setNewBody] = useState("");
  const [newFiles, setNewFiles] = useState([]); // attachments for normal
  // 詳細プレビュー
  const [previewIdx, setPreviewIdx] = useState(null);

  const isAdmin = canPostImportant(currentUser.role);

  // ファイル種別判定
  const getFileType = (mimeType) => {
    if (mimeType === "application/pdf") return "pdf";
    if (mimeType.startsWith("video/")) return "video";
    if (mimeType.startsWith("image/")) return "image";
    return null;
  };

  // 上限: PDF3, 写真10, 動画1, 合計10
  const FILE_LIMITS = { pdf:3, image:10, video:1, total:10 };
  const countByType = (files, type) => files.filter(f => f.fileType === type).length;

  const handleFileSelect = (e, setFiles, currentFiles) => {
    const files = Array.from(e.target.files);
    files.forEach(file => {
      const fileType = getFileType(file.type);
      if (!fileType) return;
      const reader = new FileReader();
      reader.onload = () => {
        setFiles(prev => {
          if (prev.length >= FILE_LIMITS.total) return prev;
          if (countByType(prev, fileType) >= FILE_LIMITS[fileType]) return prev;
          return [...prev, { name: file.name, size: file.size, dataUrl: reader.result, fileType }];
        });
      };
      reader.readAsDataURL(file);
    });
    e.target.value = "";
  };

  const formatFileSize = (bytes) => {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024*1024) return `${(bytes/1024).toFixed(1)}KB`;
    return `${(bytes/(1024*1024)).toFixed(1)}MB`;
  };

  // 添付UI共通コンポーネント
  const AttachArea = ({ files, setFiles }) => {
    const pdfCount = countByType(files,"pdf");
    const imgCount = countByType(files,"image");
    const vidCount = countByType(files,"video");
    const total = files.length;
    const atTotal = total >= FILE_LIMITS.total;

    return (
      <div style={{ marginTop:10 }}>
        <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:files.length>0?8:0 }}>
          {!atTotal && pdfCount < FILE_LIMITS.pdf && (
            <label style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"7px 12px", borderRadius:10, border:"2px dashed #cbd5e1", background:"#f8fafc", cursor:"pointer", fontSize:12, fontWeight:700, color:"#64748b" }}>
              📄 PDF（{pdfCount}/{FILE_LIMITS.pdf}）
              <input type="file" accept="application/pdf" multiple onChange={e=>handleFileSelect(e,setFiles,files)} style={{ display:"none" }}/>
            </label>
          )}
          {!atTotal && imgCount < FILE_LIMITS.image && (
            <label style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"7px 12px", borderRadius:10, border:"2px dashed #cbd5e1", background:"#f8fafc", cursor:"pointer", fontSize:12, fontWeight:700, color:"#64748b" }}>
              📷 写真（{imgCount}/{FILE_LIMITS.image}）
              <input type="file" accept="image/*" multiple onChange={e=>handleFileSelect(e,setFiles,files)} style={{ display:"none" }}/>
            </label>
          )}
          {!atTotal && vidCount < FILE_LIMITS.video && (
            <label style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"7px 12px", borderRadius:10, border:"2px dashed #cbd5e1", background:"#f8fafc", cursor:"pointer", fontSize:12, fontWeight:700, color:"#64748b" }}>
              🎥 動画（{vidCount}/{FILE_LIMITS.video}）
              <input type="file" accept="video/*" onChange={e=>handleFileSelect(e,setFiles,files)} style={{ display:"none" }}/>
            </label>
          )}
        </div>
        {total > 0 && (
          <div style={{ fontSize:11, color:"#94a3b8", marginBottom:6 }}>合計 {total}/{FILE_LIMITS.total} 件</div>
        )}
        {files.length > 0 && (
          <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
            {files.map((f,i) => (
              <div key={i} style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 12px", background:"#fff", borderRadius:8, border:"1px solid #e5e7eb" }}>
                {f.fileType==="image"
                  ? <img src={f.dataUrl} alt="" style={{ width:28, height:28, borderRadius:6, objectFit:"cover", flexShrink:0 }}/>
                  : f.fileType==="video"
                  ? <div style={{ width:28, height:28, borderRadius:6, background:"linear-gradient(135deg,#7c3aed,#5b21b6)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:14, flexShrink:0 }}>🎥</div>
                  : <div style={{ width:28, height:28, borderRadius:6, background:"linear-gradient(135deg,#dc2626,#b91c1c)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, color:"white", fontWeight:800, flexShrink:0 }}>PDF</div>
                }
                <div style={{ flex:1, overflow:"hidden" }}>
                  <div style={{ fontSize:12, fontWeight:600, color:"#0f172a", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{f.name}</div>
                  <div style={{ fontSize:10, color:"#94a3b8" }}>{formatFileSize(f.size)}</div>
                </div>
                <button onClick={()=>setFiles(prev=>prev.filter((_,j)=>j!==i))} style={{ background:"none", border:"none", color:"#dc2626", fontSize:16, cursor:"pointer", padding:"0 4px", lineHeight:1 }}>✕</button>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  // 詳細を開いた時に閲覧記録
  const openDetail = (n) => {
    setDetail(n);
    setShowReadList(false);
    onMarkRead(n.id, currentUser);
  };

  const resetImportantForm = () => {
    setShowImportantForm(false); setImpStep("category");
    setImpCategory(null); setImpTarget(null);
    setImpTitle(""); setImpBody(""); setImpFiles([]);
  };

  const handleSelectCategory = (cat) => {
    setImpCategory(cat);
    if (cat.subs.length === 0) {
      setImpTarget({ id:cat.id, label:cat.label });
      setImpStep("compose");
    } else {
      setImpStep("sub");
    }
  };
  const handleSelectSub = (sub) => {
    setImpTarget(sub);
    setImpStep("compose");
  };
  const handleSubmitImportant = () => {
    if (!impTitle.trim() || !impBody.trim() || !impTarget) return;
    onAdd(impTitle.trim(), impBody.trim(), currentUser, true, impTarget, impFiles);
    resetImportantForm();
  };

  // 詳細画面
  if (detail) {
    const readers = readRecords[detail.id] || [];
    const readNames = readers.map(r => r.name);
    const unreadUsers = USERS.filter(u => !readers.some(r => r.userId === u.id));
    const readCount = readers.length;
    const unreadCount = unreadUsers.length;

    return (
      <div style={{ display:"flex", flexDirection:"column", height:"100%", background:"#f0f4f8" }}>
        <Header title="お知らせ詳細" onBack={()=>{ setDetail(null); setShowReadList(false); }} onHome={onHome}/>
        <div style={{ flex:1, overflow:"auto", padding:"20px 16px" }}>
          <div style={{ background:"white", borderRadius:18, padding:"20px", boxShadow:"0 2px 12px rgba(0,0,0,0.06)" }}>
            {detail.important && <div style={{ display:"inline-block", background:"#dc2626", color:"white", fontSize:10, fontWeight:700, padding:"2px 8px", borderRadius:6, marginBottom:10 }}>重要</div>}
            {detail.target && <div style={{ display:"inline-block", background:"#0284c7", color:"white", fontSize:10, fontWeight:700, padding:"2px 8px", borderRadius:6, marginBottom:10, marginLeft:detail.important?6:0 }}>宛先：{detail.target.label}</div>}
            <div style={{ fontWeight:800, fontSize:18, color:"#0f172a", marginBottom:8, lineHeight:1.4 }}>{detail.title}</div>
            <div style={{ fontSize:12, color:"#94a3b8", marginBottom:16 }}>{detail.author} · {formatDate(detail.ts)}</div>
            <div style={{ fontSize:15, color:"#334155", lineHeight:1.8 }}>{detail.body}</div>

            {/* 添付ファイル一覧 */}
            {detail.attachments && detail.attachments.length > 0 && (
              <div style={{ marginTop:16, borderTop:"1px solid #f1f5f9", paddingTop:16 }}>
                <div style={{ fontSize:12, fontWeight:700, color:"#64748b", marginBottom:10, display:"flex", alignItems:"center", gap:6 }}>📎 添付ファイル（{detail.attachments.length}件）</div>
                <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                  {detail.attachments.map((att, i) => (
                    <div key={i} style={{ background:"#f8fafc", borderRadius:12, border:"1px solid #e5e7eb", overflow:"hidden" }}>
                      <div style={{ display:"flex", alignItems:"center", gap:10, padding:"12px 14px" }}>
                        {att.fileType==="image"
                          ? <img src={att.dataUrl} alt="" style={{ width:36, height:36, borderRadius:8, objectFit:"cover", flexShrink:0 }}/>
                          : att.fileType==="video"
                          ? <div style={{ width:36, height:36, borderRadius:8, background:"linear-gradient(135deg,#7c3aed,#5b21b6)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, flexShrink:0 }}>🎥</div>
                          : <div style={{ width:36, height:36, borderRadius:8, background:"linear-gradient(135deg,#dc2626,#b91c1c)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:16, color:"white", fontWeight:800, flexShrink:0 }}>PDF</div>
                        }
                        <div style={{ flex:1, overflow:"hidden" }}>
                          <div style={{ fontSize:13, fontWeight:700, color:"#0f172a", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{att.name}</div>
                          <div style={{ fontSize:11, color:"#94a3b8" }}>{formatFileSize(att.size)}</div>
                        </div>
                        <div style={{ display:"flex", gap:6, flexShrink:0 }}>
                          <button onClick={()=>setPreviewIdx(previewIdx===i?null:i)} style={{ padding:"6px 10px", borderRadius:8, border:"none", background:previewIdx===i?"#0284c7":"#e5e7eb", color:previewIdx===i?"white":"#475569", fontSize:11, fontWeight:700, cursor:"pointer" }}>{previewIdx===i?"閉じる":att.fileType==="video"?"再生":"プレビュー"}</button>
                          <a href={att.dataUrl} download={att.name} style={{ padding:"6px 10px", borderRadius:8, border:"none", background:"linear-gradient(135deg,#059669,#047857)", color:"white", fontSize:11, fontWeight:700, cursor:"pointer", textDecoration:"none", display:"flex", alignItems:"center" }}>保存</a>
                        </div>
                      </div>
                      {previewIdx===i && (
                        <div style={{ borderTop:"1px solid #e5e7eb", background:att.fileType==="pdf"?"#e5e7eb":"#f8fafc", padding:att.fileType==="pdf"?0:8 }}>
                          {att.fileType==="image" && (
                            <img src={att.dataUrl} alt={att.name} style={{ width:"100%", borderRadius:8, display:"block" }}/>
                          )}
                          {att.fileType==="video" && (
                            <video src={att.dataUrl} controls style={{ width:"100%", borderRadius:8, display:"block" }}/>
                          )}
                          {att.fileType==="pdf" && (
                            <iframe src={att.dataUrl} style={{ width:"100%", height:360, border:"none" }} title={att.name}/>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 閲覧状況（管理者のみ表示） */}
          {isAdmin && (
            <div style={{ marginTop:14 }}>
              <button onClick={()=>setShowReadList(p=>!p)} style={{ width:"100%", padding:"14px 16px", borderRadius:14, border:"none", background:"white", boxShadow:"0 2px 8px rgba(0,0,0,0.06)", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                  <span style={{ fontSize:18 }}>👁️</span>
                  <span style={{ fontWeight:700, fontSize:14, color:"#0f172a" }}>閲覧状況</span>
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <span style={{ fontSize:13, fontWeight:700, color:"#059669" }}>既読 {readCount}人</span>
                  <span style={{ fontSize:13, color:"#94a3b8" }}>/</span>
                  <span style={{ fontSize:13, fontWeight:700, color:"#dc2626" }}>未読 {unreadCount}人</span>
                  <span style={{ fontSize:16, color:"#94a3b8", transform:showReadList?"rotate(180deg)":"none", transition:"transform 0.2s" }}>▾</span>
                </div>
              </button>

              {showReadList && (
                <div style={{ background:"white", borderRadius:14, marginTop:8, padding:"16px", boxShadow:"0 2px 8px rgba(0,0,0,0.06)" }}>
                  {readCount > 0 && (
                    <div style={{ marginBottom: unreadCount > 0 ? 16 : 0 }}>
                      <div style={{ fontSize:12, fontWeight:700, color:"#059669", marginBottom:8, display:"flex", alignItems:"center", gap:6 }}>
                        <span style={{ width:8, height:8, borderRadius:4, background:"#059669", display:"inline-block" }}/>
                        既読（{readCount}人）
                      </div>
                      <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                        {readers.map(r => (
                          <div key={r.userId} style={{ fontSize:14, color:"#334155", padding:"6px 10px", background:"#f0fdf4", borderRadius:8 }}>{r.name}</div>
                        ))}
                      </div>
                    </div>
                  )}
                  {unreadCount > 0 && (
                    <div>
                      <div style={{ fontSize:12, fontWeight:700, color:"#dc2626", marginBottom:8, display:"flex", alignItems:"center", gap:6 }}>
                        <span style={{ width:8, height:8, borderRadius:4, background:"#dc2626", display:"inline-block" }}/>
                        未読（{unreadCount}人）
                      </div>
                      <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                        {unreadUsers.map(u => (
                          <div key={u.id} style={{ fontSize:14, color:"#94a3b8", padding:"6px 10px", background:"#fef2f2", borderRadius:8 }}>{u.name}</div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // 重要お知らせフォーム画面
  if (showImportantForm) {
    return (
      <div style={{ display:"flex", flexDirection:"column", height:"100%", background:"#f0f4f8" }}>
        <Header title="🚨 重要なお知らせを発信" onBack={resetImportantForm} onHome={onHome}/>
        <div style={{ flex:1, overflow:"auto", padding:"16px" }}>

          {/* STEP 1: カテゴリ選択 */}
          {impStep==="category" && (
            <div>
              <div style={{ fontSize:14, fontWeight:700, color:"#0f172a", marginBottom:4 }}>送り先を選択</div>
              <div style={{ fontSize:12, color:"#64748b", marginBottom:16 }}>お知らせを届けるグループを選んでください</div>
              <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                {NOTICE_TARGETS.map(cat=>(
                  <div key={cat.id} onClick={()=>handleSelectCategory(cat)} style={{ display:"flex", alignItems:"center", gap:14, padding:"16px", background:"white", borderRadius:14, boxShadow:"0 2px 8px rgba(0,0,0,0.06)", cursor:"pointer", border:"2px solid transparent", transition:"border 0.15s" }}>
                    <div style={{ width:44, height:44, borderRadius:12, background:"linear-gradient(135deg,#1e293b,#334155)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:22, flexShrink:0 }}>{cat.icon}</div>
                    <div style={{ flex:1 }}>
                      <div style={{ fontWeight:700, fontSize:15, color:"#0f172a" }}>{cat.label}</div>
                      {cat.subs.length>0 && <div style={{ fontSize:11, color:"#94a3b8", marginTop:2 }}>{cat.subs.length}件の選択肢</div>}
                    </div>
                    <span style={{ color:"#cbd5e1", fontSize:20 }}>›</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* STEP 2: サブカテゴリ選択 */}
          {impStep==="sub" && impCategory && (
            <div>
              <button onClick={()=>{ setImpStep("category"); setImpCategory(null); }} style={{ background:"#eff6ff", border:"2px solid #bfdbfe", color:"#0284c7", fontSize:14, fontWeight:800, cursor:"pointer", padding:"10px 16px", borderRadius:10, display:"flex", alignItems:"center", gap:6, marginBottom:12 }}>‹ カテゴリに戻る</button>
              <div style={{ fontSize:14, fontWeight:700, color:"#0f172a", marginBottom:4 }}>{impCategory.icon} {impCategory.label}</div>
              <div style={{ fontSize:12, color:"#64748b", marginBottom:16 }}>送り先を選んでください</div>
              <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                {impCategory.subs.map(sub=>(
                  <div key={sub.id} onClick={()=>handleSelectSub(sub)} style={{ display:"flex", alignItems:"center", gap:12, padding:"14px 16px", background:"white", borderRadius:12, boxShadow:"0 1px 6px rgba(0,0,0,0.05)", cursor:"pointer" }}>
                    <div style={{ width:8, height:8, borderRadius:4, background:"#0284c7", flexShrink:0 }}/>
                    <div style={{ fontWeight:600, fontSize:15, color:"#0f172a", flex:1 }}>{sub.label}</div>
                    <span style={{ color:"#cbd5e1", fontSize:18 }}>›</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* STEP 3: 内容入力 */}
          {impStep==="compose" && impTarget && (
            <div>
              <button onClick={()=>{ if(impCategory?.subs?.length>0){ setImpStep("sub"); setImpTarget(null); } else { setImpStep("category"); setImpCategory(null); setImpTarget(null); }}} style={{ background:"#eff6ff", border:"2px solid #bfdbfe", color:"#0284c7", fontSize:14, fontWeight:800, cursor:"pointer", padding:"10px 16px", borderRadius:10, display:"flex", alignItems:"center", gap:6, marginBottom:12 }}>‹ 送り先を変更</button>
              <div style={{ background:"#fef2f2", borderRadius:12, padding:"12px 16px", marginBottom:16, display:"flex", alignItems:"center", gap:10 }}>
                <div style={{ fontSize:20 }}>🚨</div>
                <div>
                  <div style={{ fontSize:11, color:"#dc2626", fontWeight:700 }}>重要なお知らせ</div>
                  <div style={{ fontSize:13, fontWeight:700, color:"#0f172a" }}>宛先：{impTarget.label}</div>
                </div>
              </div>
              <div style={{ background:"white", borderRadius:16, padding:"16px", boxShadow:"0 2px 12px rgba(0,0,0,0.08)" }}>
                <input value={impTitle} onChange={e=>setImpTitle(e.target.value)} placeholder="タイトル（例：緊急連絡）" style={{ width:"100%", padding:"12px 14px", borderRadius:10, border:"2px solid #e5e7eb", fontSize:15, marginBottom:10, outline:"none", fontWeight:600 }}/>
                <textarea value={impBody} onChange={e=>setImpBody(e.target.value)} placeholder="本文を入力..." rows={5} style={{ width:"100%", padding:"12px 14px", borderRadius:10, border:"2px solid #e5e7eb", fontSize:14, resize:"none", outline:"none", lineHeight:1.7 }}/>
                <AttachArea files={impFiles} setFiles={setImpFiles}/>
                <div style={{ display:"flex", gap:8, marginTop:12 }}>
                  <button onClick={handleSubmitImportant} disabled={!impTitle.trim()||!impBody.trim()} style={{ flex:1, padding:"14px", borderRadius:12, border:"none", background:impTitle.trim()&&impBody.trim()?"linear-gradient(135deg,#dc2626,#b91c1c)":"#e5e7eb", color:"white", fontWeight:800, fontSize:15, cursor:impTitle.trim()&&impBody.trim()?"pointer":"not-allowed", boxShadow:impTitle.trim()&&impBody.trim()?"0 4px 16px rgba(220,38,38,0.3)":"none" }}>🚨 重要お知らせを発信</button>
                </div>
                <div style={{ display:"flex", gap:8, marginTop:8 }}>
                  <button onClick={resetImportantForm} style={{ flex:1, padding:"12px", borderRadius:12, border:"none", background:"#f1f5f9", color:"#64748b", fontWeight:700, fontSize:13, cursor:"pointer" }}>キャンセル</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // 全添付ファイル一覧（時系列・新しい順）
  const allFiles = notices
    .filter(n => n.attachments && n.attachments.length > 0)
    .sort((a,b) => b.ts - a.ts)
    .flatMap(n => n.attachments.map(att => ({ ...att, noticeTitle: n.title, noticeTs: n.ts, noticeAuthor: n.author, noticeImportant: n.important })));

  // メイン一覧画面
  const showImportantBtn = canPostImportant(currentUser.role);
  const showNormalBtn = canPostNormal(currentUser.role);

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", background:"#f0f4f8" }}>
      <Header title="📣 お知らせ" onBack={onBack} onHome={onHome}/>

      {/* タブ */}
      <div style={{ display:"flex", background:"white", borderBottom:"1px solid #f1f5f9", flexShrink:0 }}>
        {[{id:"notices",label:"📣 お知らせ"},{id:"files",label:"📁 ファイル"},{id:"survey",label:"📊 アンケート"},{id:"recruit",label:"🙋 募集"}].map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)} style={{ flex:1, padding:"12px 4px", border:"none", background:"transparent", cursor:"pointer", fontSize:11, fontWeight:tab===t.id?700:400, color:tab===t.id?"#0284c7":"#94a3b8", borderBottom:tab===t.id?"2px solid #0284c7":"2px solid transparent" }}>{t.label}</button>
        ))}
      </div>

      {/* お知らせタブ */}
      {tab==="notices" && (
      <div style={{ flex:1, overflow:"auto" }}>

        {/* 発信ボタンエリア */}
        {(showImportantBtn || showNormalBtn) && (
          <div style={{ padding:"12px 16px 0", display:"flex", flexDirection:"column", gap:8 }}>
            {showImportantBtn && (
              <button onClick={()=>setShowImportantForm(true)} style={{ width:"100%", padding:"16px 10px", borderRadius:14, border:"none", background:"linear-gradient(135deg,#dc2626,#991b1b)", color:"white", fontWeight:800, fontSize:15, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:8, boxShadow:"0 4px 16px rgba(220,38,38,0.25)" }}>
                <span style={{ fontSize:20 }}>🚨</span>
                重要なお知らせを発信
              </button>
            )}
            {showNormalBtn && (
              <div style={{ display:"flex", gap:6 }}>
                <button onClick={()=>setShowForm(p=>!p)} style={{ flex:1, padding:"12px 6px", borderRadius:12, border:"none", background:"linear-gradient(135deg,#0284c7,#0369a1)", color:"white", fontWeight:800, fontSize:11, cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:4, boxShadow:"0 3px 12px rgba(2,132,199,0.2)" }}>
                  <span style={{ fontSize:18 }}>📝</span>
                  お知らせ
                </button>
                <button onClick={()=>setTab("survey")} style={{ flex:1, padding:"12px 6px", borderRadius:12, border:"none", background:"linear-gradient(135deg,#7c3aed,#5b21b6)", color:"white", fontWeight:800, fontSize:11, cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:4, boxShadow:"0 3px 12px rgba(124,58,237,0.2)" }}>
                  <span style={{ fontSize:18 }}>📊</span>
                  アンケート
                </button>
                <button onClick={()=>setTab("recruit")} style={{ flex:1, padding:"12px 6px", borderRadius:12, border:"none", background:"linear-gradient(135deg,#d97706,#b45309)", color:"white", fontWeight:800, fontSize:11, cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:4, boxShadow:"0 3px 12px rgba(217,119,6,0.2)" }}>
                  <span style={{ fontSize:18 }}>🙋</span>
                  募集
                </button>
              </div>
            )}
          </div>
        )}

        {/* 通常投稿フォーム */}
        {showForm && (
          <div style={{ background:"white", margin:"12px 16px", borderRadius:16, padding:"16px", boxShadow:"0 2px 12px rgba(0,0,0,0.08)" }}>
            <div style={{ fontSize:13, fontWeight:700, color:"#0f172a", marginBottom:10 }}>新しいお知らせ</div>
            <input value={newTitle} onChange={e=>setNewTitle(e.target.value)} placeholder="タイトル" style={{ width:"100%", padding:"10px 12px", borderRadius:10, border:"1.5px solid #e5e7eb", fontSize:14, marginBottom:8, outline:"none" }}/>
            <textarea value={newBody} onChange={e=>setNewBody(e.target.value)} placeholder="本文" rows={3} style={{ width:"100%", padding:"10px 12px", borderRadius:10, border:"1.5px solid #e5e7eb", fontSize:14, resize:"none", outline:"none" }}/>
            <AttachArea files={newFiles} setFiles={setNewFiles}/>
            <div style={{ display:"flex", gap:8, marginTop:8 }}>
              <button onClick={()=>{ if(newTitle.trim()&&newBody.trim()){ onAdd(newTitle.trim(),newBody.trim(),currentUser,false,null,newFiles); setNewTitle(""); setNewBody(""); setNewFiles([]); setShowForm(false); }}} style={{ flex:1, padding:"10px", borderRadius:10, border:"none", background:"linear-gradient(135deg,#0284c7,#0369a1)", color:"white", fontWeight:700, fontSize:13, cursor:"pointer" }}>投稿する</button>
              <button onClick={()=>{ setShowForm(false); setNewFiles([]); }} style={{ padding:"10px 16px", borderRadius:10, border:"none", background:"#f1f5f9", color:"#64748b", fontWeight:700, fontSize:13, cursor:"pointer" }}>キャンセル</button>
            </div>
          </div>
        )}

        {/* お知らせ一覧 */}
        <div style={{ padding:"8px 0" }}>
          {notices.map(n=>(
            <div key={n.id} onClick={()=>openDetail(n)} style={{ background:"white", margin:"6px 16px", borderRadius:14, padding:"16px", boxShadow:"0 1px 6px rgba(0,0,0,0.05)", cursor:"pointer", borderLeft:n.important?"4px solid #dc2626":"4px solid transparent" }}>
              <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:6, flexWrap:"wrap" }}>
                {n.important && <div style={{ display:"inline-block", background:"#fef2f2", color:"#dc2626", fontSize:10, fontWeight:700, padding:"2px 8px", borderRadius:6 }}>重要</div>}
                {n.target && <div style={{ display:"inline-block", background:"#eff6ff", color:"#0284c7", fontSize:10, fontWeight:700, padding:"2px 8px", borderRadius:6 }}>{n.target.label}</div>}
              </div>
              <div style={{ fontWeight:700, fontSize:15, color:"#0f172a", marginBottom:4 }}>{n.title}</div>
              <div style={{ fontSize:12, color:"#94a3b8", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", marginBottom:6 }}>{n.body}</div>
              <div style={{ fontSize:11, color:"#cbd5e1", display:"flex", alignItems:"center", gap:4, flexWrap:"wrap" }}>{n.author} · {formatDate(n.ts)}{n.attachments&&n.attachments.length>0&&<>{n.attachments.some(a=>a.fileType==="pdf")&&<span style={{ color:"#64748b" }}>📄</span>}{n.attachments.some(a=>a.fileType==="image")&&<span style={{ color:"#64748b" }}>📷</span>}{n.attachments.some(a=>a.fileType==="video")&&<span style={{ color:"#64748b" }}>🎥</span>}<span style={{ color:"#64748b" }}>{n.attachments.length}件</span></>}</div>
            </div>
          ))}
        </div>
      </div>
      )}

      {/* ファイル保管庫タブ */}
      {tab==="files" && (
      <div style={{ flex:1, overflow:"auto" }}>
        {allFiles.length === 0 ? (
          <div style={{ textAlign:"center", padding:"60px 20px" }}>
            <div style={{ fontSize:48, marginBottom:12 }}>📁</div>
            <div style={{ fontSize:15, fontWeight:700, color:"#0f172a", marginBottom:6 }}>ファイルはまだありません</div>
            <div style={{ fontSize:13, color:"#94a3b8" }}>お知らせに添付されたファイルが<br/>ここに一覧表示されます</div>
          </div>
        ) : (
          <div style={{ padding:"8px 0" }}>
            <div style={{ padding:"8px 16px", fontSize:12, color:"#64748b", fontWeight:700 }}>全{allFiles.length}件のファイル</div>
            {allFiles.map((f, i) => (
              <div key={i} style={{ background:"white", margin:"4px 16px", borderRadius:12, overflow:"hidden", boxShadow:"0 1px 6px rgba(0,0,0,0.05)" }}>
                <div style={{ display:"flex", alignItems:"center", gap:10, padding:"12px 14px", cursor:"pointer" }} onClick={()=>setFilePreview(filePreview===i?null:i)}>
                  {f.fileType==="image"
                    ? <img src={f.dataUrl} alt="" style={{ width:40, height:40, borderRadius:8, objectFit:"cover", flexShrink:0 }}/>
                    : f.fileType==="video"
                    ? <div style={{ width:40, height:40, borderRadius:8, background:"linear-gradient(135deg,#7c3aed,#5b21b6)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0 }}>🎥</div>
                    : <div style={{ width:40, height:40, borderRadius:8, background:"linear-gradient(135deg,#dc2626,#b91c1c)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:14, color:"white", fontWeight:800, flexShrink:0 }}>PDF</div>
                  }
                  <div style={{ flex:1, overflow:"hidden" }}>
                    <div style={{ fontSize:13, fontWeight:700, color:"#0f172a", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{f.name}</div>
                    <div style={{ fontSize:11, color:"#94a3b8", marginTop:2 }}>{f.noticeTitle} · {f.noticeAuthor} · {formatDate(f.noticeTs)}</div>
                  </div>
                  <div style={{ display:"flex", gap:6, flexShrink:0, alignItems:"center" }}>
                    <div style={{ fontSize:10, color:"#94a3b8" }}>{formatFileSize(f.size)}</div>
                    <span style={{ fontSize:14, color:"#94a3b8", transform:filePreview===i?"rotate(180deg)":"none", transition:"transform 0.2s" }}>▾</span>
                  </div>
                </div>
                {filePreview===i && (
                  <div style={{ borderTop:"1px solid #e5e7eb" }}>
                    <div style={{ padding:f.fileType==="pdf"?0:8, background:f.fileType==="pdf"?"#e5e7eb":"#f8fafc" }}>
                      {f.fileType==="image" && <img src={f.dataUrl} alt={f.name} style={{ width:"100%", borderRadius:8, display:"block" }}/>}
                      {f.fileType==="video" && <video src={f.dataUrl} controls style={{ width:"100%", borderRadius:8, display:"block" }}/>}
                      {f.fileType==="pdf" && <iframe src={f.dataUrl} style={{ width:"100%", height:360, border:"none" }} title={f.name}/>}
                    </div>
                    <div style={{ padding:"8px 14px", display:"flex", justifyContent:"flex-end" }}>
                      <a href={f.dataUrl} download={f.name} style={{ padding:"8px 16px", borderRadius:8, border:"none", background:"linear-gradient(135deg,#059669,#047857)", color:"white", fontSize:12, fontWeight:700, cursor:"pointer", textDecoration:"none" }}>📥 保存</a>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      )}

      {/* アンケートタブ */}
      {tab==="survey" && (
      <SurveyTab surveys={surveys} setSurveys={setSurveys} currentUser={currentUser} onHome={onHome} onAddNotice={onAdd}/>
      )}

      {/* 募集タブ */}
      {tab==="recruit" && (
      <RecruitTab recruits={recruits} setRecruits={setRecruits} currentUser={currentUser} onHome={onHome} onAddNotice={onAdd}/>
      )}
    </div>
  );
}

// ============================================================
// 募集タブ
// ============================================================
function RecruitTab({ recruits, setRecruits, currentUser, onHome, onAddNotice }) {
  const [view, setView] = useState("list"); // "list" | "create" | "detail"
  const [activeRecruit, setActiveRecruit] = useState(null);
  // 作成フォーム
  const [formTitle, setFormTitle] = useState("");
  const [formDateFrom, setFormDateFrom] = useState("");
  const [formDateTo, setFormDateTo] = useState("");
  const [formBody, setFormBody] = useState("");

  const isAdmin = canPostImportant(currentUser.role);

  const resetForm = () => {
    setFormTitle(""); setFormDateFrom(""); setFormDateTo(""); setFormBody("");
    setView("list");
  };

  const handlePublish = () => {
    if (!formTitle.trim() || !formBody.trim()) return;
    const recruit = {
      id: `rc_${Date.now()}`,
      title: formTitle.trim(),
      dateFrom: formDateFrom,
      dateTo: formDateTo,
      body: formBody.trim(),
      author: currentUser.name,
      authorId: currentUser.id,
      ts: Date.now(),
      responses: {}, // { userId: { name, status:"参加"|"不参加" } }
    };
    setRecruits(prev => [recruit, ...prev]);
    // 重要なお知らせとして自動投稿
    const period = formDateFrom ? (formDateTo ? `${formDateFrom}〜${formDateTo}` : formDateFrom) : "";
    onAddNotice(
      `🙋 募集：${formTitle.trim()}`,
      `募集「${formTitle.trim()}」が公開されました。${period ? `（期間：${period}）` : ""}お知らせ画面の「🙋 募集」タブから参加・不参加をご回答ください。`,
      currentUser,
      true,
      { id:"all", label:"全体" },
      []
    );
    resetForm();
  };

  const handleRespond = (recruitId, status) => {
    setRecruits(prev => prev.map(rc => rc.id===recruitId ? { ...rc, responses:{ ...rc.responses, [currentUser.id]:{ name:currentUser.name, status } } } : rc));
  };

  // 作成画面
  if (view==="create") return (
    <div style={{ flex:1, overflow:"auto", padding:"16px" }}>
      <div style={{ fontSize:16, fontWeight:800, color:"#0f172a", marginBottom:14 }}>🙋 新しい募集を作成</div>
      <div style={{ background:"white", borderRadius:16, padding:"16px", boxShadow:"0 2px 12px rgba(0,0,0,0.06)" }}>
        <div style={{ fontSize:12, fontWeight:700, color:"#64748b", marginBottom:6 }}>タイトル</div>
        <input value={formTitle} onChange={e=>setFormTitle(e.target.value)} placeholder="例：体育祭お手伝い募集" style={{ width:"100%", padding:"12px", borderRadius:10, border:"2px solid #e5e7eb", fontSize:15, outline:"none", fontWeight:600, marginBottom:12 }}/>
        <div style={{ fontSize:12, fontWeight:700, color:"#64748b", marginBottom:6 }}>日時・期間</div>
        <div style={{ display:"flex", gap:8, marginBottom:12, alignItems:"center" }}>
          <input type="date" value={formDateFrom} onChange={e=>setFormDateFrom(e.target.value)} style={{ flex:1, padding:"10px", borderRadius:10, border:"2px solid #e5e7eb", fontSize:14, outline:"none" }}/>
          <span style={{ color:"#94a3b8", fontSize:13 }}>〜</span>
          <input type="date" value={formDateTo} onChange={e=>setFormDateTo(e.target.value)} style={{ flex:1, padding:"10px", borderRadius:10, border:"2px solid #e5e7eb", fontSize:14, outline:"none" }}/>
        </div>
        <div style={{ fontSize:12, fontWeight:700, color:"#64748b", marginBottom:6 }}>内容</div>
        <textarea value={formBody} onChange={e=>setFormBody(e.target.value)} placeholder="募集内容の詳細を入力..." rows={5} style={{ width:"100%", padding:"12px", borderRadius:10, border:"2px solid #e5e7eb", fontSize:14, resize:"none", outline:"none", lineHeight:1.7, marginBottom:12 }}/>
        <button onClick={handlePublish} disabled={!formTitle.trim()||!formBody.trim()} style={{ width:"100%", padding:"14px", borderRadius:12, border:"none", background:formTitle.trim()&&formBody.trim()?"linear-gradient(135deg,#d97706,#b45309)":"#e5e7eb", color:"white", fontWeight:800, fontSize:15, cursor:formTitle.trim()&&formBody.trim()?"pointer":"not-allowed" }}>🙋 募集を公開</button>
        <button onClick={resetForm} style={{ width:"100%", padding:"12px", borderRadius:12, border:"none", background:"#f1f5f9", color:"#64748b", fontWeight:700, fontSize:13, cursor:"pointer", marginTop:8 }}>キャンセル</button>
      </div>
    </div>
  );

  // 詳細画面
  if (view==="detail" && activeRecruit) {
    const rc = activeRecruit;
    // 最新データを取得
    const current = recruits.find(r => r.id === rc.id) || rc;
    const myResponse = current.responses[currentUser.id];
    const allResponses = Object.values(current.responses);
    const joinList = allResponses.filter(r => r.status==="参加");
    const declineList = allResponses.filter(r => r.status==="不参加");
    const period = current.dateFrom ? (current.dateTo ? `${current.dateFrom} 〜 ${current.dateTo}` : current.dateFrom) : "未定";

    return (
      <div style={{ flex:1, overflow:"auto", padding:"16px" }}>
        <button onClick={()=>{ setView("list"); setActiveRecruit(null); }} style={{ background:"#eff6ff", border:"2px solid #bfdbfe", color:"#0284c7", fontSize:14, fontWeight:800, cursor:"pointer", padding:"10px 16px", borderRadius:10, display:"flex", alignItems:"center", gap:6, marginBottom:12 }}>‹ 一覧に戻る</button>

        <div style={{ background:"white", borderRadius:16, padding:"20px", boxShadow:"0 2px 12px rgba(0,0,0,0.06)", marginBottom:12 }}>
          <div style={{ fontSize:17, fontWeight:800, color:"#0f172a", marginBottom:6 }}>{current.title}</div>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12, flexWrap:"wrap" }}>
            <div style={{ fontSize:12, color:"#d97706", fontWeight:700, background:"#fffbeb", padding:"3px 10px", borderRadius:6 }}>📅 {period}</div>
            <div style={{ fontSize:12, color:"#94a3b8" }}>{current.author} · {formatDate(current.ts)}</div>
          </div>
          <div style={{ fontSize:14, color:"#334155", lineHeight:1.8, whiteSpace:"pre-wrap" }}>{current.body}</div>
        </div>

        {/* 参加・不参加ボタン */}
        <div style={{ background:"white", borderRadius:16, padding:"16px", boxShadow:"0 2px 12px rgba(0,0,0,0.06)", marginBottom:12 }}>
          <div style={{ fontSize:13, fontWeight:700, color:"#0f172a", marginBottom:10 }}>参加回答</div>
          {myResponse ? (
            <div style={{ textAlign:"center", padding:"8px 0" }}>
              <div style={{ fontSize:14, fontWeight:700, color:myResponse.status==="参加"?"#059669":"#dc2626" }}>
                {myResponse.status==="参加"?"✓ 参加で回答済み":"✕ 不参加で回答済み"}
              </div>
              <div style={{ fontSize:12, color:"#94a3b8", marginTop:4 }}>変更する場合は下のボタンを押してください</div>
            </div>
          ) : (
            <div style={{ fontSize:12, color:"#64748b", marginBottom:8 }}>参加・不参加を選んでください</div>
          )}
          <div style={{ display:"flex", gap:8 }}>
            <button onClick={()=>handleRespond(current.id,"参加")} style={{ flex:1, padding:"14px", borderRadius:12, border:myResponse?.status==="参加"?"3px solid #059669":"2px solid #e5e7eb", background:myResponse?.status==="参加"?"#f0fdf4":"white", color:myResponse?.status==="参加"?"#059669":"#334155", fontWeight:800, fontSize:15, cursor:"pointer" }}>🙋 参加</button>
            <button onClick={()=>handleRespond(current.id,"不参加")} style={{ flex:1, padding:"14px", borderRadius:12, border:myResponse?.status==="不参加"?"3px solid #dc2626":"2px solid #e5e7eb", background:myResponse?.status==="不参加"?"#fef2f2":"white", color:myResponse?.status==="不参加"?"#dc2626":"#334155", fontWeight:800, fontSize:15, cursor:"pointer" }}>✕ 不参加</button>
          </div>
        </div>

        {/* 参加状況（管理者のみ） */}
        {isAdmin && (
          <div style={{ background:"white", borderRadius:16, padding:"16px", boxShadow:"0 2px 12px rgba(0,0,0,0.06)" }}>
            <div style={{ fontSize:14, fontWeight:800, color:"#0f172a", marginBottom:12 }}>📋 参加状況（{allResponses.length}人回答）</div>

            <div style={{ marginBottom:joinList.length>0&&declineList.length>0?16:0 }}>
              <div style={{ fontSize:12, fontWeight:700, color:"#059669", marginBottom:8, display:"flex", alignItems:"center", gap:6 }}>
                <span style={{ width:8, height:8, borderRadius:4, background:"#059669", display:"inline-block" }}/>
                参加（{joinList.length}人）
              </div>
              {joinList.length > 0 ? (
                <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                  {joinList.map((r,i) => (
                    <div key={i} style={{ fontSize:14, color:"#334155", padding:"6px 10px", background:"#f0fdf4", borderRadius:8 }}>{r.name}</div>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize:12, color:"#94a3b8", padding:"4px 0" }}>まだいません</div>
              )}
            </div>

            <div>
              <div style={{ fontSize:12, fontWeight:700, color:"#dc2626", marginBottom:8, display:"flex", alignItems:"center", gap:6 }}>
                <span style={{ width:8, height:8, borderRadius:4, background:"#dc2626", display:"inline-block" }}/>
                不参加（{declineList.length}人）
              </div>
              {declineList.length > 0 ? (
                <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                  {declineList.map((r,i) => (
                    <div key={i} style={{ fontSize:14, color:"#94a3b8", padding:"6px 10px", background:"#fef2f2", borderRadius:8 }}>{r.name}</div>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize:12, color:"#94a3b8", padding:"4px 0" }}>まだいません</div>
              )}
            </div>

            {/* 未回答者 */}
            {(() => {
              const respondedIds = Object.keys(current.responses);
              const unresponded = USERS.filter(u => !respondedIds.includes(u.id));
              if (unresponded.length === 0) return null;
              return (
                <div style={{ marginTop:16 }}>
                  <div style={{ fontSize:12, fontWeight:700, color:"#94a3b8", marginBottom:8, display:"flex", alignItems:"center", gap:6 }}>
                    <span style={{ width:8, height:8, borderRadius:4, background:"#94a3b8", display:"inline-block" }}/>
                    未回答（{unresponded.length}人）
                  </div>
                  <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                    {unresponded.map(u => (
                      <div key={u.id} style={{ fontSize:14, color:"#94a3b8", padding:"6px 10px", background:"#f8fafc", borderRadius:8 }}>{u.name}</div>
                    ))}
                  </div>
                </div>
              );
            })()}
            <button onClick={()=>{
              const rows = [["氏名","回答"]];
              Object.values(current.responses).forEach(r => rows.push([r.name, r.status]));
              const respondedIds = Object.keys(current.responses);
              USERS.filter(u => !respondedIds.includes(u.id)).forEach(u => rows.push([u.name, "未回答"]));
              downloadExcel([{ name:"募集結果", rows }], `募集_${current.title}.xlsx`);
            }} style={{ width:"100%", padding:"12px", borderRadius:12, border:"none", background:"linear-gradient(135deg,#059669,#047857)", color:"white", fontWeight:800, fontSize:13, cursor:"pointer", marginTop:12, display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}>📥 Excelでダウンロード</button>
          </div>
        )}
      </div>
    );
  }

  // 一覧画面
  return (
    <div style={{ flex:1, overflow:"auto" }}>
      {isAdmin && (
        <div style={{ padding:"12px 16px 0" }}>
          <button onClick={()=>setView("create")} style={{ width:"100%", padding:"14px", borderRadius:14, border:"none", background:"linear-gradient(135deg,#d97706,#b45309)", color:"white", fontWeight:800, fontSize:14, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:8, boxShadow:"0 4px 16px rgba(217,119,6,0.25)" }}>
            <span style={{ fontSize:18 }}>🙋</span>
            新しい募集を作成
          </button>
        </div>
      )}

      {recruits.length === 0 ? (
        <div style={{ textAlign:"center", padding:"60px 20px" }}>
          <div style={{ fontSize:48, marginBottom:12 }}>🙋</div>
          <div style={{ fontSize:15, fontWeight:700, color:"#0f172a", marginBottom:6 }}>募集はまだありません</div>
          <div style={{ fontSize:13, color:"#94a3b8" }}>作成された募集がここに表示されます</div>
        </div>
      ) : (
        <div style={{ padding:"8px 0" }}>
          {recruits.map(rc => {
            const myResp = rc.responses[currentUser.id];
            const joinCount = Object.values(rc.responses).filter(r=>r.status==="参加").length;
            const totalResp = Object.keys(rc.responses).length;
            return (
              <div key={rc.id} onClick={()=>{ setActiveRecruit(rc); setView("detail"); }} style={{ background:"white", margin:"6px 16px", borderRadius:14, padding:"16px", boxShadow:"0 1px 6px rgba(0,0,0,0.05)", cursor:"pointer", borderLeft:`4px solid ${myResp?"#059669":"#d97706"}` }}>
                <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:6, flexWrap:"wrap" }}>
                  {myResp
                    ? <div style={{ display:"inline-block", background:myResp.status==="参加"?"#f0fdf4":"#fef2f2", color:myResp.status==="参加"?"#059669":"#dc2626", fontSize:10, fontWeight:700, padding:"2px 8px", borderRadius:6 }}>{myResp.status==="参加"?"✓ 参加":"✕ 不参加"}</div>
                    : <div style={{ display:"inline-block", background:"#fffbeb", color:"#d97706", fontSize:10, fontWeight:700, padding:"2px 8px", borderRadius:6 }}>未回答</div>
                  }
                  <div style={{ fontSize:10, color:"#94a3b8" }}>参加{joinCount}人 · {totalResp}人回答</div>
                </div>
                <div style={{ fontWeight:700, fontSize:15, color:"#0f172a", marginBottom:4 }}>{rc.title}</div>
                <div style={{ fontSize:12, color:"#94a3b8", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", marginBottom:4 }}>{rc.body}</div>
                <div style={{ fontSize:11, color:"#cbd5e1" }}>{rc.author} · {formatDate(rc.ts)}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================================
// アンケートタブ
// ============================================================
const QUESTION_TYPES = [
  { id:"single",  label:"単一選択",   icon:"◉" },
  { id:"multi",   label:"複数選択",   icon:"☑" },
  { id:"yesno",   label:"はい／いいえ", icon:"👍" },
  { id:"text",    label:"自由記述",   icon:"✏️" },
];

function SurveyTab({ surveys, setSurveys, currentUser, onHome, onAddNotice }) {
  const [view, setView] = useState("list"); // "list" | "create" | "detail" | "result"
  const [activeSurvey, setActiveSurvey] = useState(null);
  // 作成フォーム
  const [formTitle, setFormTitle] = useState("");
  const [formQuestions, setFormQuestions] = useState([{ id:"q1", type:"single", text:"", options:["",""] }]);

  const canCreate = canPostNormal(currentUser.role);
  const isAdmin = canPostImportant(currentUser.role);

  const resetForm = () => {
    setFormTitle("");
    setFormQuestions([{ id:"q1", type:"single", text:"", options:["",""] }]);
    setView("list");
  };

  const addQuestion = () => {
    setFormQuestions(prev => [...prev, { id:`q${Date.now()}`, type:"single", text:"", options:["",""] }]);
  };
  const updateQuestion = (idx, field, value) => {
    setFormQuestions(prev => prev.map((q,i) => i===idx ? { ...q, [field]:value } : q));
  };
  const removeQuestion = (idx) => {
    if (formQuestions.length <= 1) return;
    setFormQuestions(prev => prev.filter((_,i) => i!==idx));
  };
  const updateOption = (qIdx, oIdx, value) => {
    setFormQuestions(prev => prev.map((q,i) => i===qIdx ? { ...q, options:q.options.map((o,j) => j===oIdx ? value : o) } : q));
  };
  const addOption = (qIdx) => {
    setFormQuestions(prev => prev.map((q,i) => i===qIdx ? { ...q, options:[...q.options,""] } : q));
  };
  const removeOption = (qIdx, oIdx) => {
    setFormQuestions(prev => prev.map((q,i) => i===qIdx && q.options.length > 2 ? { ...q, options:q.options.filter((_,j) => j!==oIdx) } : q));
  };

  const handlePublish = () => {
    if (!formTitle.trim()) return;
    const validQs = formQuestions.filter(q => q.text.trim());
    if (validQs.length === 0) return;
    const survey = {
      id: `sv_${Date.now()}`,
      title: formTitle.trim(),
      author: currentUser.name,
      authorId: currentUser.id,
      ts: Date.now(),
      questions: validQs.map(q => ({
        ...q,
        text: q.text.trim(),
        options: (q.type==="yesno") ? ["はい","いいえ"] : (q.type==="text") ? [] : q.options.filter(o=>o.trim()).map(o=>o.trim()),
      })),
      responses: {}, // { userId: { qId: answer } }
    };
    setSurveys(prev => [survey, ...prev]);
    // 重要なお知らせとして自動投稿
    onAddNotice(
      `📊 アンケート：${formTitle.trim()}`,
      `アンケート「${formTitle.trim()}」が公開されました。お知らせ画面の「📊 アンケート」タブからご回答ください。（全${validQs.length}問）`,
      currentUser,
      true,
      { id:"all", label:"全体" },
      []
    );
    resetForm();
  };

  // 回答送信
  const handleSubmitResponse = (surveyId, answers) => {
    setSurveys(prev => prev.map(sv => sv.id===surveyId ? { ...sv, responses:{ ...sv.responses, [currentUser.id]:{ name:currentUser.name, answers } } } : sv));
    setView("list");
    setActiveSurvey(null);
  };

  // 作成画面
  if (view==="create") return (
    <div style={{ flex:1, overflow:"auto", padding:"16px" }}>
      <div style={{ fontSize:16, fontWeight:800, color:"#0f172a", marginBottom:14 }}>📊 新しいアンケートを作成</div>
      <div style={{ background:"white", borderRadius:16, padding:"16px", boxShadow:"0 2px 12px rgba(0,0,0,0.06)", marginBottom:12 }}>
        <div style={{ fontSize:12, fontWeight:700, color:"#64748b", marginBottom:6 }}>アンケートタイトル</div>
        <input value={formTitle} onChange={e=>setFormTitle(e.target.value)} placeholder="例：PTA総会の出欠確認" style={{ width:"100%", padding:"12px", borderRadius:10, border:"2px solid #e5e7eb", fontSize:15, outline:"none", fontWeight:600 }}/>
      </div>

      {formQuestions.map((q, qIdx) => (
        <div key={q.id} style={{ background:"white", borderRadius:16, padding:"16px", boxShadow:"0 2px 12px rgba(0,0,0,0.06)", marginBottom:10 }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
            <div style={{ fontSize:13, fontWeight:700, color:"#0f172a" }}>設問 {qIdx+1}</div>
            {formQuestions.length > 1 && <button onClick={()=>removeQuestion(qIdx)} style={{ background:"none", border:"none", color:"#dc2626", fontSize:14, cursor:"pointer" }}>✕ 削除</button>}
          </div>
          <input value={q.text} onChange={e=>updateQuestion(qIdx,"text",e.target.value)} placeholder="質問内容を入力" style={{ width:"100%", padding:"10px 12px", borderRadius:10, border:"1.5px solid #e5e7eb", fontSize:14, marginBottom:10, outline:"none" }}/>
          <div style={{ fontSize:12, fontWeight:700, color:"#64748b", marginBottom:6 }}>回答形式</div>
          <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:10 }}>
            {QUESTION_TYPES.map(qt => (
              <button key={qt.id} onClick={()=>updateQuestion(qIdx,"type",qt.id)} style={{ padding:"6px 12px", borderRadius:8, border:`2px solid ${q.type===qt.id?"#0284c7":"#e5e7eb"}`, background:q.type===qt.id?"#eff6ff":"white", color:q.type===qt.id?"#0284c7":"#64748b", fontSize:12, fontWeight:700, cursor:"pointer" }}>{qt.icon} {qt.label}</button>
            ))}
          </div>
          {(q.type==="single"||q.type==="multi") && (
            <div>
              <div style={{ fontSize:12, fontWeight:700, color:"#64748b", marginBottom:6 }}>選択肢</div>
              {q.options.map((o, oIdx) => (
                <div key={oIdx} style={{ display:"flex", alignItems:"center", gap:6, marginBottom:6 }}>
                  <span style={{ fontSize:14, color:"#94a3b8" }}>{q.type==="single"?"◉":"☐"}</span>
                  <input value={o} onChange={e=>updateOption(qIdx,oIdx,e.target.value)} placeholder={`選択肢${oIdx+1}`} style={{ flex:1, padding:"8px 10px", borderRadius:8, border:"1.5px solid #e5e7eb", fontSize:13, outline:"none" }}/>
                  {q.options.length>2 && <button onClick={()=>removeOption(qIdx,oIdx)} style={{ background:"none", border:"none", color:"#dc2626", fontSize:14, cursor:"pointer", padding:"0 4px" }}>✕</button>}
                </div>
              ))}
              <button onClick={()=>addOption(qIdx)} style={{ background:"none", border:"2px dashed #cbd5e1", borderRadius:8, padding:"6px 12px", fontSize:12, fontWeight:700, color:"#64748b", cursor:"pointer", width:"100%" }}>＋ 選択肢を追加</button>
            </div>
          )}
          {q.type==="yesno" && <div style={{ fontSize:12, color:"#94a3b8" }}>「はい」「いいえ」の二択で回答</div>}
          {q.type==="text" && <div style={{ fontSize:12, color:"#94a3b8" }}>自由にテキストで回答</div>}
        </div>
      ))}

      <button onClick={addQuestion} style={{ width:"100%", padding:"12px", borderRadius:12, border:"2px dashed #0284c7", background:"#eff6ff", color:"#0284c7", fontWeight:800, fontSize:13, cursor:"pointer", marginBottom:12 }}>＋ 設問を追加</button>

      <div style={{ display:"flex", gap:8 }}>
        <button onClick={handlePublish} disabled={!formTitle.trim()||!formQuestions.some(q=>q.text.trim())} style={{ flex:1, padding:"14px", borderRadius:12, border:"none", background:formTitle.trim()&&formQuestions.some(q=>q.text.trim())?"linear-gradient(135deg,#0284c7,#0369a1)":"#e5e7eb", color:"white", fontWeight:800, fontSize:15, cursor:formTitle.trim()?"pointer":"not-allowed" }}>📊 アンケートを公開</button>
      </div>
      <button onClick={resetForm} style={{ width:"100%", padding:"12px", borderRadius:12, border:"none", background:"#f1f5f9", color:"#64748b", fontWeight:700, fontSize:13, cursor:"pointer", marginTop:8 }}>キャンセル</button>
    </div>
  );

  // 回答・詳細画面
  if (view==="detail" && activeSurvey) {
    const sv = activeSurvey;
    const myResponse = sv.responses[currentUser.id];
    const [answers, setAnswers] = useState(() => {
      if (myResponse) return myResponse.answers;
      const init = {};
      sv.questions.forEach(q => { init[q.id] = q.type==="multi" ? [] : ""; });
      return init;
    });

    const handleAnswer = (qId, value, type) => {
      setAnswers(prev => {
        if (type==="multi") {
          const arr = prev[qId] || [];
          return { ...prev, [qId]: arr.includes(value) ? arr.filter(v=>v!==value) : [...arr, value] };
        }
        return { ...prev, [qId]: value };
      });
    };

    return (
      <div style={{ flex:1, overflow:"auto", padding:"16px" }}>
        <button onClick={()=>{ setView("list"); setActiveSurvey(null); }} style={{ background:"#eff6ff", border:"2px solid #bfdbfe", color:"#0284c7", fontSize:14, fontWeight:800, cursor:"pointer", padding:"10px 16px", borderRadius:10, display:"flex", alignItems:"center", gap:6, marginBottom:12 }}>‹ 一覧に戻る</button>

        <div style={{ background:"white", borderRadius:16, padding:"16px", boxShadow:"0 2px 12px rgba(0,0,0,0.06)", marginBottom:12 }}>
          <div style={{ fontSize:17, fontWeight:800, color:"#0f172a", marginBottom:4 }}>{sv.title}</div>
          <div style={{ fontSize:12, color:"#94a3b8" }}>{sv.author} · {formatDate(sv.ts)} · {Object.keys(sv.responses).length}人回答済み</div>
        </div>

        {sv.questions.map((q, qIdx) => (
          <div key={q.id} style={{ background:"white", borderRadius:14, padding:"16px", boxShadow:"0 1px 6px rgba(0,0,0,0.05)", marginBottom:8 }}>
            <div style={{ fontSize:14, fontWeight:700, color:"#0f172a", marginBottom:10 }}>Q{qIdx+1}. {q.text}</div>

            {(q.type==="single"||q.type==="yesno") && q.options.map((opt, oIdx) => (
              <div key={oIdx} onClick={!myResponse?()=>handleAnswer(q.id,opt,q.type):undefined} style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 12px", borderRadius:10, border:`2px solid ${answers[q.id]===opt?"#0284c7":"#e5e7eb"}`, background:answers[q.id]===opt?"#eff6ff":"white", marginBottom:6, cursor:myResponse?"default":"pointer" }}>
                <div style={{ width:20, height:20, borderRadius:"50%", border:`2px solid ${answers[q.id]===opt?"#0284c7":"#cbd5e1"}`, display:"flex", alignItems:"center", justifyContent:"center" }}>
                  {answers[q.id]===opt && <div style={{ width:10, height:10, borderRadius:"50%", background:"#0284c7" }}/>}
                </div>
                <span style={{ fontSize:14, color:"#334155", fontWeight:answers[q.id]===opt?700:400 }}>{opt}</span>
              </div>
            ))}

            {q.type==="multi" && q.options.map((opt, oIdx) => (
              <div key={oIdx} onClick={!myResponse?()=>handleAnswer(q.id,opt,q.type):undefined} style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 12px", borderRadius:10, border:`2px solid ${(answers[q.id]||[]).includes(opt)?"#0284c7":"#e5e7eb"}`, background:(answers[q.id]||[]).includes(opt)?"#eff6ff":"white", marginBottom:6, cursor:myResponse?"default":"pointer" }}>
                <div style={{ width:20, height:20, borderRadius:4, border:`2px solid ${(answers[q.id]||[]).includes(opt)?"#0284c7":"#cbd5e1"}`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, color:"#0284c7" }}>
                  {(answers[q.id]||[]).includes(opt) && "✓"}
                </div>
                <span style={{ fontSize:14, color:"#334155", fontWeight:(answers[q.id]||[]).includes(opt)?700:400 }}>{opt}</span>
              </div>
            ))}

            {q.type==="text" && (
              <textarea value={answers[q.id]||""} onChange={!myResponse?e=>handleAnswer(q.id,e.target.value,q.type):undefined} readOnly={!!myResponse} placeholder="回答を入力..." rows={3} style={{ width:"100%", padding:"10px 12px", borderRadius:10, border:"1.5px solid #e5e7eb", fontSize:14, resize:"none", outline:"none", background:myResponse?"#f8fafc":"white" }}/>
            )}
          </div>
        ))}

        {!myResponse && (
          <button onClick={()=>handleSubmitResponse(sv.id, answers)} style={{ width:"100%", padding:"14px", borderRadius:12, border:"none", background:"linear-gradient(135deg,#0284c7,#0369a1)", color:"white", fontWeight:800, fontSize:15, cursor:"pointer", marginTop:4 }}>回答を送信</button>
        )}
        {myResponse && <div style={{ textAlign:"center", color:"#059669", fontWeight:700, fontSize:14, padding:"12px 0" }}>✓ 回答済みです</div>}

        {/* 集計結果（管理者のみ） */}
        {isAdmin && Object.keys(sv.responses).length > 0 && (
          <div style={{ marginTop:12, background:"white", borderRadius:16, padding:"16px", boxShadow:"0 2px 12px rgba(0,0,0,0.06)" }}>
            <div style={{ fontSize:14, fontWeight:800, color:"#0f172a", marginBottom:12 }}>📊 集計結果（{Object.keys(sv.responses).length}人）</div>
            {sv.questions.map((q, qIdx) => (
              <div key={q.id} style={{ marginBottom:16 }}>
                <div style={{ fontSize:13, fontWeight:700, color:"#334155", marginBottom:8 }}>Q{qIdx+1}. {q.text}</div>
                {(q.type==="single"||q.type==="multi"||q.type==="yesno") && (() => {
                  const counts = {};
                  q.options.forEach(o => counts[o] = 0);
                  Object.values(sv.responses).forEach(r => {
                    const a = r.answers[q.id];
                    if (Array.isArray(a)) a.forEach(v => { if(counts[v]!==undefined) counts[v]++; });
                    else if (counts[a]!==undefined) counts[a]++;
                  });
                  const total = Object.values(sv.responses).length;
                  return q.options.map(opt => (
                    <div key={opt} style={{ marginBottom:6 }}>
                      <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, color:"#475569", marginBottom:3 }}>
                        <span>{opt}</span><span style={{ fontWeight:700 }}>{counts[opt]}人（{total>0?Math.round(counts[opt]/total*100):0}%）</span>
                      </div>
                      <div style={{ height:8, background:"#f1f5f9", borderRadius:4, overflow:"hidden" }}>
                        <div style={{ height:"100%", background:"linear-gradient(135deg,#0284c7,#0369a1)", borderRadius:4, width:`${total>0?counts[opt]/total*100:0}%`, transition:"width 0.3s" }}/>
                      </div>
                    </div>
                  ));
                })()}
                {q.type==="text" && (
                  <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                    {Object.values(sv.responses).map((r,i) => r.answers[q.id] ? (
                      <div key={i} style={{ fontSize:12, color:"#475569", padding:"6px 10px", background:"#f8fafc", borderRadius:8 }}><span style={{ fontWeight:700 }}>{r.name}:</span> {r.answers[q.id]}</div>
                    ) : null)}
                  </div>
                )}
              </div>
            ))}
            <button onClick={()=>{
              const header = ["回答者"];
              sv.questions.forEach((q,i) => header.push(`Q${i+1}. ${q.text}`));
              const rows = [header];
              Object.values(sv.responses).forEach(r => {
                const row = [r.name];
                sv.questions.forEach(q => {
                  const a = r.answers[q.id];
                  row.push(Array.isArray(a) ? a.join("、") : (a || ""));
                });
                rows.push(row);
              });
              downloadExcel([{ name:"アンケート結果", rows }], `アンケート_${sv.title}.xlsx`);
            }} style={{ width:"100%", padding:"12px", borderRadius:12, border:"none", background:"linear-gradient(135deg,#059669,#047857)", color:"white", fontWeight:800, fontSize:13, cursor:"pointer", marginTop:8, display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}>📥 Excelでダウンロード</button>
          </div>
        )}
      </div>
    );
  }

  // 一覧画面
  return (
    <div style={{ flex:1, overflow:"auto" }}>
      {canCreate && (
        <div style={{ padding:"12px 16px 0" }}>
          <button onClick={()=>setView("create")} style={{ width:"100%", padding:"14px", borderRadius:14, border:"none", background:"linear-gradient(135deg,#7c3aed,#5b21b6)", color:"white", fontWeight:800, fontSize:14, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:8, boxShadow:"0 4px 16px rgba(124,58,237,0.25)" }}>
            <span style={{ fontSize:18 }}>📊</span>
            新しいアンケートを作成
          </button>
        </div>
      )}

      {surveys.length === 0 ? (
        <div style={{ textAlign:"center", padding:"60px 20px" }}>
          <div style={{ fontSize:48, marginBottom:12 }}>📊</div>
          <div style={{ fontSize:15, fontWeight:700, color:"#0f172a", marginBottom:6 }}>アンケートはまだありません</div>
          <div style={{ fontSize:13, color:"#94a3b8" }}>作成されたアンケートがここに表示されます</div>
        </div>
      ) : (
        <div style={{ padding:"8px 0" }}>
          {surveys.map(sv => {
            const responded = !!sv.responses[currentUser.id];
            const respCount = Object.keys(sv.responses).length;
            return (
              <div key={sv.id} onClick={()=>{ setActiveSurvey(sv); setView("detail"); }} style={{ background:"white", margin:"6px 16px", borderRadius:14, padding:"16px", boxShadow:"0 1px 6px rgba(0,0,0,0.05)", cursor:"pointer", borderLeft:`4px solid ${responded?"#059669":"#7c3aed"}` }}>
                <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:6 }}>
                  {responded
                    ? <div style={{ display:"inline-block", background:"#f0fdf4", color:"#059669", fontSize:10, fontWeight:700, padding:"2px 8px", borderRadius:6 }}>✓ 回答済み</div>
                    : <div style={{ display:"inline-block", background:"#f5f3ff", color:"#7c3aed", fontSize:10, fontWeight:700, padding:"2px 8px", borderRadius:6 }}>未回答</div>
                  }
                  <div style={{ fontSize:10, color:"#94a3b8" }}>{sv.questions.length}問 · {respCount}人回答</div>
                </div>
                <div style={{ fontWeight:700, fontSize:15, color:"#0f172a", marginBottom:4 }}>{sv.title}</div>
                <div style={{ fontSize:11, color:"#cbd5e1" }}>{sv.author} · {formatDate(sv.ts)}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================================
// カレンダー画面
// ============================================================
function CalendarScreen({ onBack, onHome, events, setEvents, currentUser }) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState(null);
  const [filterCat, setFilterCat] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editEvent, setEditEvent] = useState(null);
  const [formDate, setFormDate] = useState("");
  const [formTitle, setFormTitle] = useState("");
  const [formCat, setFormCat] = useState("school");
  const [importMsg, setImportMsg] = useState(null);
  const [importPreview, setImportPreview] = useState(null); // { events:[], schools:[], selectedSchools:Set }
  const [importLoading, setImportLoading] = useState(false);

  const isAdmin = canPostImportant(currentUser.role);

  // 日本の祝日データ（2026-2027年度）
  const HOLIDAYS = {
    "2026-01-01":"元日","2026-01-12":"成人の日","2026-02-11":"建国記念の日","2026-02-23":"天皇誕生日",
    "2026-03-20":"春分の日","2026-04-29":"昭和の日","2026-05-03":"憲法記念日","2026-05-04":"みどりの日",
    "2026-05-05":"こどもの日","2026-05-06":"振替休日","2026-07-20":"海の日","2026-08-11":"山の日",
    "2026-09-21":"敬老の日","2026-09-22":"国民の休日","2026-09-23":"秋分の日","2026-10-12":"スポーツの日",
    "2026-11-03":"文化の日","2026-11-23":"勤労感謝の日","2027-01-01":"元日","2027-01-11":"成人の日",
    "2027-02-11":"建国記念の日","2027-02-23":"天皇誕生日","2027-03-21":"春分の日"
  };

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month+1, 0).getDate();
  const days = [];
  for (let i=0; i<firstDay; i++) days.push(null);
  for (let i=1; i<=daysInMonth; i++) days.push(i);
  const weeks = ["日","月","火","水","木","金","土"];

  const prevMonth = () => { if(month===0){setMonth(11);setYear(y=>y-1);}else setMonth(m=>m-1); };
  const nextMonth = () => { if(month===11){setMonth(0);setYear(y=>y+1);}else setMonth(m=>m+1); };

  const pad = (n) => String(n).padStart(2,"0");
  const dateStr = (y,m,d) => `${y}-${pad(m+1)}-${pad(d)}`;

  // 日付のイベント取得
  const getEventsForDate = (d) => {
    const ds = dateStr(year,month,d);
    return events.filter(ev => ev.date === ds && (!filterCat || ev.category === filterCat));
  };

  // 選択日の予定
  const todayStr = dateStr(today.getFullYear(),today.getMonth(),today.getDate());
  const selectedDateStr = selectedDate ? dateStr(year,month,selectedDate) : null;
  const selectedEvents = selectedDate ? events.filter(ev => ev.date === selectedDateStr && (!filterCat || ev.category === filterCat)) : [];

  // --- CSVパーサー（2形式対応）---
  // 形式A: 日付,学校名,タイトル,カテゴリ → 学校選択付きプレビュー
  // 形式B: 日付,タイトル,カテゴリ → 即インポート
  const parseCSV = (rows) => {
    const catMap = { "学校行事":"school","学校":"school","school":"school",
      "PTA行事":"pta","PTA":"pta","pta":"pta",
      "休校日":"holiday","短縮授業":"holiday","休校":"holiday","holiday":"holiday",
      "部活":"club","部活関連":"club","club":"club",
      "地区":"district","地区行事":"district","district":"district" };

    if (!rows || rows.length < 2) return null;

    // ヘッダー行で形式判定
    const header = rows[0].map(h => String(h||"").trim());
    const hasSchool = header.includes("学校名");
    const dateCol = header.indexOf("日付") >= 0 ? header.indexOf("日付") : 0;

    let schoolCol, titleCol, catCol;
    if (hasSchool) {
      schoolCol = header.indexOf("学校名");
      titleCol = header.indexOf("タイトル") >= 0 ? header.indexOf("タイトル") : (schoolCol === 1 ? 2 : 1);
      catCol = header.indexOf("カテゴリ") >= 0 ? header.indexOf("カテゴリ") : 3;
    } else {
      schoolCol = -1;
      titleCol = header.indexOf("タイトル") >= 0 ? header.indexOf("タイトル") : 1;
      catCol = header.indexOf("カテゴリ") >= 0 ? header.indexOf("カテゴリ") : 2;
    }

    const newEvents = [];
    rows.forEach((row, idx) => {
      if (idx === 0 && header.some(h => /日付|date|タイトル|学校/i.test(h))) return;
      const rawDate = String(row[dateCol]||"").trim();
      const title = String(row[titleCol]||"").trim();
      if (!rawDate || !title) return;

      const s = rawDate.replace(/\//g,"-");
      const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
      if (!m) return;
      const dateVal = `${m[1]}-${pad(parseInt(m[2]))}-${pad(parseInt(m[3]))}`;
      const school = schoolCol >= 0 ? String(row[schoolCol]||"").trim() : "";
      const catRaw = String(row[catCol]||"").trim();
      const category = catMap[catRaw] || "school";

      newEvents.push({ date: dateVal, title, school, category });
    });

    return newEvents.length > 0 ? { events: newEvents, hasSchool } : null;
  };

  // --- 健育カレンダーマトリクス形式パーサー ---
  const parseKeniku = (rows) => {
    const zenkaku = s => parseInt(String(s).replace(/[０-９]/g, c => "０１２３４５６７８９".indexOf(c)));
    const headerRows = [];
    rows.forEach((row, i) => { if (String(row[0]||"").trim() === "月" && String(row[1]||"").trim() === "学校名") headerRows.push(i); });
    if (headerRows.length === 0) return null;

    const yearEntries = [];
    rows.forEach((row, i) => {
      const v = String(row[0] || "");
      const m = v.match(/(２０[０-９]{2}|20\d{2})/);
      if (m) yearEntries.push({ row: i, year: zenkaku(m[1]) });
    });

    const monthMap = {"４":4,"５":5,"６":6,"７":7,"８":8,"９":9,"１０":10,"１１":11,"１２":12,"１":1,"２":2,"３":3};
    const parsed = [];

    headerRows.forEach(hrow => {
      let currentYear = 2026;
      yearEntries.forEach(ye => { if (ye.row < hrow) currentYear = ye.year; });

      const dayNums = {};
      for (let c = 2; c < (rows[hrow]||[]).length; c++) {
        const n = parseInt(String(rows[hrow][c]||"").trim());
        if (n > 0 && n <= 31) dayNums[c] = n;
      }

      const monthRow = hrow + 2;
      if (monthRow >= rows.length) return;
      const mVal = String(rows[monthRow][0]||"").replace(/\n/g,"").replace(/月/g,"").trim();
      let monthNum = monthMap[mVal];
      if (!monthNum) { const n = parseInt(mVal); if (n >= 1 && n <= 12) monthNum = n; }
      if (!monthNum) return;

      for (let r = monthRow; r < Math.min(monthRow + 6, rows.length); r++) {
        const school = String(rows[r][1]||"").trim();
        if (!school || school === "学校名") continue;
        for (const [cStr, day] of Object.entries(dayNums)) {
          const c = parseInt(cStr);
          const v = (rows[r][c]||"");
          if (!v || String(v).trim() === "") continue;
          const title = String(v).trim().replace(/\n/g," ");
          const dateStr2 = `${currentYear}-${pad(monthNum)}-${pad(day)}`;
          let cat = "school";
          if (school === "地域") cat = "district";
          else if (/PTA|Ｐ総会|P総会/.test(title)) cat = "pta";
          else if (/部活|大会/.test(title)) cat = "club";
          else if (/休業|休み$|振替休/.test(title)) cat = "holiday";
          parsed.push({ date: dateStr2, title, school, category: cat });
        }
      }
    });
    return parsed.length > 0 ? parsed : null;
  };

  // CSVインポート（マトリクス形式 + リスト形式 自動判定）
  const handleImport = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = "";
    setImportLoading(true);
    try {
      // Shift_JIS / UTF-8 両対応
      const buf = await file.arrayBuffer();
      let text;
      try { text = await decodeShiftJIS(buf); } catch { text = await file.text(); }

      const rows = parseCSVText(text);

      // まずマトリクス形式（健育カレンダー）を試行
      const kenikuResult = parseKeniku(rows);
      if (kenikuResult && kenikuResult.length > 0) {
        const schools = [...new Set(kenikuResult.map(e => e.school))];
        setImportPreview({ events: kenikuResult, schools, selectedSchools: new Set(schools), fileName: file.name });
        setImportLoading(false);
        return;
      }

      // フォールバック: リスト形式CSV
      const parsed = parseCSV(rows);

      if (parsed && parsed.events.length > 0) {
        if (parsed.hasSchool) {
          const schools = [...new Set(parsed.events.map(e => e.school))];
          setImportPreview({ events: parsed.events, schools, selectedSchools: new Set(schools), fileName: file.name });
        } else {
          const existingKeys = new Set(events.map(ev => `${ev.date}|${ev.title}`));
          const deduped = parsed.events.filter(ev => !existingKeys.has(`${ev.date}|${ev.title}`));
          const newEvents = deduped.map((ev, i) => ({ id:`ev_${Date.now()}_${i}`, date:ev.date, title:ev.title, category:ev.category }));
          if (newEvents.length > 0) {
            setEvents(prev => [...prev, ...newEvents]);
            setImportMsg(`${newEvents.length}件の予定をインポートしました`);
          } else {
            setImportMsg("すべて既存の予定と重複しています");
          }
          setTimeout(() => setImportMsg(null), 3000);
        }
      } else {
        setImportMsg("インポートできるデータがありませんでした");
        setTimeout(() => setImportMsg(null), 3000);
      }
    } catch (err) {
      console.error("Import error:", err);
      setImportMsg(`読み込みエラー: ${err.message || "不明なエラー"}`);
      setTimeout(() => setImportMsg(null), 5000);
    }
    setImportLoading(false);
  };

  // インポート確定
  const confirmImport = () => {
    if (!importPreview) return;
    const { events: parsed, selectedSchools } = importPreview;
    const filtered = parsed.filter(ev => selectedSchools.has(ev.school));
    const existingKeys = new Set(events.map(ev => `${ev.date}|${ev.title}`));
    const deduped = filtered.filter(ev => !existingKeys.has(`${ev.date}|${ev.title}`));
    const newEvents = deduped.map((ev, i) => ({
      id: `ev_${Date.now()}_${i}`,
      date: ev.date,
      title: ev.school !== "地域" ? `[${ev.school}] ${ev.title}` : `[地域] ${ev.title}`,
      category: ev.category
    }));
    if (newEvents.length > 0) {
      setEvents(prev => [...prev, ...newEvents]);
      setImportMsg(`${newEvents.length}件の予定をインポートしました`);
    } else {
      setImportMsg("インポートできる新しい予定はありませんでした");
    }
    setImportPreview(null);
    setTimeout(() => setImportMsg(null), 4000);
  };

  // 予定の追加・編集
  const openAddForm = (preDate) => {
    setEditEvent(null);
    setFormDate(preDate || dateStr(year,month,today.getDate()));
    setFormTitle(""); setFormCat("school");
    setShowForm(true);
  };
  const openEditForm = (ev) => {
    setEditEvent(ev);
    setFormDate(ev.date); setFormTitle(ev.title); setFormCat(ev.category);
    setShowForm(true);
  };
  const handleSave = () => {
    if (!formDate || !formTitle.trim()) return;
    if (editEvent) {
      setEvents(prev => prev.map(ev => ev.id === editEvent.id ? { ...ev, date:formDate, title:formTitle.trim(), category:formCat } : ev));
    } else {
      setEvents(prev => [...prev, { id:`ev_${Date.now()}`, date:formDate, title:formTitle.trim(), category:formCat }]);
    }
    setShowForm(false); setEditEvent(null);
  };
  const handleDelete = (evId) => {
    setEvents(prev => prev.filter(ev => ev.id !== evId));
  };

  // インポートプレビュー画面
  if (importPreview) {
    const { events: previewEvents, schools, selectedSchools, fileName } = importPreview;
    const toggleSchool = (s) => {
      setImportPreview(prev => {
        const next = new Set(prev.selectedSchools);
        next.has(s) ? next.delete(s) : next.add(s);
        return { ...prev, selectedSchools: next };
      });
    };
    const toggleAll = () => {
      setImportPreview(prev => {
        const allSelected = prev.selectedSchools.size === schools.length;
        return { ...prev, selectedSchools: allSelected ? new Set() : new Set(schools) };
      });
    };
    const filteredPreview = previewEvents.filter(ev => selectedSchools.has(ev.school));
    // 月別グループ
    const byMonth = {};
    filteredPreview.forEach(ev => {
      const ym = ev.date.substring(0,7);
      if (!byMonth[ym]) byMonth[ym] = [];
      byMonth[ym].push(ev);
    });
    const sortedMonths = Object.keys(byMonth).sort();

    return (
      <div style={{ display:"flex", flexDirection:"column", height:"100%", background:"#f0f4f8" }}>
        <Header title="📥 インポートプレビュー" onBack={()=>setImportPreview(null)} onHome={onHome}/>
        <div style={{ flex:1, overflow:"auto", padding:"16px" }}>
          {/* ファイル情報 */}
          <div style={{ background:"white", borderRadius:14, padding:"16px", marginBottom:12, boxShadow:"0 2px 8px rgba(0,0,0,0.06)" }}>
            <div style={{ fontSize:13, fontWeight:700, color:"#0f172a", marginBottom:4 }}>📄 {fileName}</div>
            <div style={{ fontSize:12, color:"#64748b" }}>学校別CSV形式を検出 — {previewEvents.length}件の予定を読み取りました</div>
          </div>

          {/* 学校選択 */}
          <div style={{ background:"white", borderRadius:14, padding:"16px", marginBottom:12, boxShadow:"0 2px 8px rgba(0,0,0,0.06)" }}>
            <div style={{ fontSize:13, fontWeight:700, color:"#0f172a", marginBottom:10 }}>インポートする学校・団体を選択</div>
            <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
              <button onClick={toggleAll} style={{ padding:"8px 14px", borderRadius:10, border:"2px solid #0f172a", background: selectedSchools.size === schools.length ? "#0f172a" : "white", color: selectedSchools.size === schools.length ? "white" : "#0f172a", fontSize:12, fontWeight:700, cursor:"pointer" }}>
                {selectedSchools.size === schools.length ? "✓ すべて" : "すべて"}
              </button>
              {schools.map(s => {
                const active = selectedSchools.has(s);
                const col = s === "地域" ? "#7c3aed" : "#0284c7";
                return (
                  <button key={s} onClick={()=>toggleSchool(s)} style={{ padding:"8px 14px", borderRadius:10, border:`2px solid ${active ? col : "#e5e7eb"}`, background: active ? col+"15" : "white", color: active ? col : "#94a3b8", fontSize:12, fontWeight:700, cursor:"pointer" }}>
                    {active ? "✓ " : ""}{s}
                  </button>
                );
              })}
            </div>
            <div style={{ fontSize:12, color:"#64748b", marginTop:8 }}>{filteredPreview.length}件が対象</div>
          </div>

          {/* プレビュー一覧 */}
          <div style={{ background:"white", borderRadius:14, padding:"16px", marginBottom:80, boxShadow:"0 2px 8px rgba(0,0,0,0.06)" }}>
            <div style={{ fontSize:13, fontWeight:700, color:"#0f172a", marginBottom:10 }}>プレビュー</div>
            {sortedMonths.length === 0 ? (
              <div style={{ color:"#94a3b8", fontSize:13, textAlign:"center", padding:"20px 0" }}>学校を選択してください</div>
            ) : sortedMonths.map(ym => {
              const [y,m] = ym.split("-");
              const evs = byMonth[ym].sort((a,b) => a.date.localeCompare(b.date));
              // 日付でグループ化
              const byDate = {};
              evs.forEach(ev => { if (!byDate[ev.date]) byDate[ev.date] = []; byDate[ev.date].push(ev); });
              const sortedDates = Object.keys(byDate).sort();
              return (
                <div key={ym} style={{ marginBottom:14 }}>
                  <div style={{ fontSize:13, fontWeight:800, color:"#0284c7", marginBottom:6, padding:"4px 10px", background:"#eff6ff", borderRadius:8, display:"inline-block" }}>{parseInt(y)}年{parseInt(m)}月（{evs.length}件）</div>
                  <div style={{ display:"flex", flexDirection:"column", gap:1 }}>
                    {sortedDates.slice(0, 20).map(date => {
                      const dayEvs = byDate[date];
                      const d = parseInt(date.split("-")[2]);
                      return (
                        <div key={date} style={{ display:"flex", gap:8, padding:"5px 8px", borderRadius:8, background:"#f8fafc", fontSize:12, alignItems:"flex-start" }}>
                          <span style={{ fontWeight:700, color:"#64748b", minWidth:28, paddingTop:2, flexShrink:0 }}>{d}日</span>
                          <div style={{ flex:1, display:"flex", flexDirection:"column", gap:2 }}>
                            {dayEvs.map((ev, j) => {
                              const cat = getCategoryById(ev.category);
                              return (
                                <div key={j} style={{ display:"flex", alignItems:"center", gap:6 }}>
                                  <span style={{ background:cat.color+"20", color:cat.color, padding:"1px 6px", borderRadius:4, fontSize:10, fontWeight:700, minWidth:40, textAlign:"center", flexShrink:0 }}>{ev.school}</span>
                                  <span style={{ color:"#0f172a" }}>{ev.title}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                    {sortedDates.length > 20 && <div style={{ fontSize:11, color:"#94a3b8", paddingLeft:8, paddingTop:4 }}>…他{sortedDates.length-20}日分</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 確定ボタン（固定フッター） */}
        <div style={{ padding:"12px 16px", background:"white", borderTop:"1px solid #e5e7eb", boxShadow:"0 -2px 8px rgba(0,0,0,0.05)" }}>
          <button onClick={confirmImport} disabled={filteredPreview.length === 0} style={{ width:"100%", padding:"14px", borderRadius:12, border:"none", background: filteredPreview.length > 0 ? "linear-gradient(135deg,#059669,#047857)" : "#e5e7eb", color:"white", fontWeight:800, fontSize:15, cursor: filteredPreview.length > 0 ? "pointer" : "not-allowed", display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}>
            📥 {filteredPreview.length}件をインポートする
          </button>
        </div>
      </div>
    );
  }

  // 予定フォームモーダル
  if (showForm) return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", background:"#f0f4f8" }}>
      <Header title={editEvent?"📅 予定を編集":"📅 予定を追加"} onBack={()=>setShowForm(false)} onHome={onHome}/>
      <div style={{ flex:1, overflow:"auto", padding:"16px" }}>
        <div style={{ background:"white", borderRadius:16, padding:"20px", boxShadow:"0 2px 12px rgba(0,0,0,0.06)" }}>
          <div style={{ fontSize:13, fontWeight:700, color:"#64748b", marginBottom:6 }}>日付</div>
          <input type="date" value={formDate} onChange={e=>setFormDate(e.target.value)} style={{ width:"100%", padding:"12px", borderRadius:10, border:"2px solid #e5e7eb", fontSize:15, marginBottom:14, outline:"none" }}/>
          <div style={{ fontSize:13, fontWeight:700, color:"#64748b", marginBottom:6 }}>タイトル</div>
          <input value={formTitle} onChange={e=>setFormTitle(e.target.value)} placeholder="例：PTA総会" style={{ width:"100%", padding:"12px", borderRadius:10, border:"2px solid #e5e7eb", fontSize:15, marginBottom:14, outline:"none" }}/>
          <div style={{ fontSize:13, fontWeight:700, color:"#64748b", marginBottom:6 }}>カテゴリ</div>
          <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:16 }}>
            {EVENT_CATEGORIES.map(cat => (
              <button key={cat.id} onClick={()=>setFormCat(cat.id)} style={{ padding:"8px 14px", borderRadius:10, border:`2px solid ${formCat===cat.id?cat.color:"#e5e7eb"}`, background:formCat===cat.id?cat.color+"18":"white", color:formCat===cat.id?cat.color:"#64748b", fontSize:13, fontWeight:700, cursor:"pointer", display:"flex", alignItems:"center", gap:4 }}>
                {cat.icon} {cat.label}
              </button>
            ))}
          </div>
          <button onClick={handleSave} disabled={!formDate||!formTitle.trim()} style={{ width:"100%", padding:"14px", borderRadius:12, border:"none", background:formDate&&formTitle.trim()?"linear-gradient(135deg,#0284c7,#0369a1)":"#e5e7eb", color:"white", fontWeight:800, fontSize:15, cursor:formDate&&formTitle.trim()?"pointer":"not-allowed" }}>
            {editEvent?"更新する":"追加する"}
          </button>
          {editEvent && (
            <button onClick={()=>{ handleDelete(editEvent.id); setShowForm(false); }} style={{ width:"100%", padding:"12px", borderRadius:12, border:"none", background:"#fef2f2", color:"#dc2626", fontWeight:700, fontSize:13, cursor:"pointer", marginTop:8 }}>この予定を削除</button>
          )}
        </div>
      </div>
    </div>
  );

  // 日付詳細画面
  if (selectedDate !== null) {
    const selStr = dateStr(year,month,selectedDate);
    const dayOfWeek = ["日","月","火","水","木","金","土"][new Date(year,month,selectedDate).getDay()];
    return (
      <div style={{ display:"flex", flexDirection:"column", height:"100%", background:"#f0f4f8" }}>
        <Header title={`📅 ${month+1}月${selectedDate}日（${dayOfWeek}）`} onBack={()=>setSelectedDate(null)} onHome={onHome}/>
        <div style={{ flex:1, overflow:"auto", padding:"16px" }}>
          {isAdmin && (
            <button onClick={()=>openAddForm(selStr)} style={{ width:"100%", padding:"14px", borderRadius:14, border:"2px dashed #0284c7", background:"#eff6ff", color:"#0284c7", fontWeight:800, fontSize:14, cursor:"pointer", marginBottom:12, display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}>＋ この日に予定を追加</button>
          )}
          {selectedEvents.length === 0 ? (
            <div style={{ textAlign:"center", color:"#94a3b8", fontSize:14, marginTop:40 }}>この日の予定はありません</div>
          ) : (
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              {selectedEvents.map(ev => {
                const cat = getCategoryById(ev.category);
                return (
                  <div key={ev.id} onClick={isAdmin?()=>openEditForm(ev):undefined} style={{ background:"white", borderRadius:14, padding:"16px", boxShadow:"0 2px 8px rgba(0,0,0,0.06)", borderLeft:`4px solid ${cat.color}`, cursor:isAdmin?"pointer":"default" }}>
                    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                      <span style={{ fontSize:18 }}>{cat.icon}</span>
                      <div style={{ flex:1 }}>
                        <div style={{ fontWeight:700, fontSize:15, color:"#0f172a" }}>{ev.title}</div>
                        <div style={{ fontSize:11, color:cat.color, fontWeight:700, marginTop:2 }}>{cat.label}</div>
                      </div>
                      {isAdmin && <span style={{ color:"#cbd5e1", fontSize:16 }}>✎</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  // メインカレンダー画面
  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", background:"#f0f4f8" }}>
      <Header title="📅 カレンダー" onBack={onBack} onHome={onHome}/>
      <div style={{ flex:1, overflow:"auto", padding:"16px" }}>

        {/* インポート通知 */}
        {importMsg && (
          <div style={{ background:"#059669", color:"white", padding:"10px 16px", borderRadius:12, fontSize:13, fontWeight:700, marginBottom:12, textAlign:"center" }}>{importMsg}</div>
        )}

        {/* 管理ボタン */}
        {isAdmin && (
          <div style={{ display:"flex", gap:8, marginBottom:12 }}>
            <button onClick={()=>openAddForm(null)} style={{ flex:1, padding:"12px", borderRadius:12, border:"none", background:"linear-gradient(135deg,#0284c7,#0369a1)", color:"white", fontWeight:800, fontSize:13, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}>＋ 予定追加</button>
          </div>
        )}

        {/* 学校フィルター */}
        <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:12 }}>
          <button onClick={()=>setFilterCat(null)} style={{ padding:"6px 12px", borderRadius:8, border:`2px solid ${!filterCat?"#0f172a":"#e5e7eb"}`, background:!filterCat?"#0f172a":"white", color:!filterCat?"white":"#64748b", fontSize:11, fontWeight:700, cursor:"pointer" }}>すべて</button>
          {[
            { id:"八木山中", color:"#0284c7", icon:"🏫" },
            { id:"八木山小", color:"#059669", icon:"🏫" },
            { id:"八木山南小", color:"#7c3aed", icon:"🏫" },
            { id:"芦口小", color:"#d97706", icon:"🏫" },
            { id:"地域", color:"#dc2626", icon:"🏘️" },
          ].map(s => (
            <button key={s.id} onClick={()=>setFilterCat(filterCat===s.id?null:s.id)} style={{ padding:"6px 12px", borderRadius:8, border:`2px solid ${filterCat===s.id?s.color:"#e5e7eb"}`, background:filterCat===s.id?s.color+"18":"white", color:filterCat===s.id?s.color:"#64748b", fontSize:11, fontWeight:700, cursor:"pointer", display:"flex", alignItems:"center", gap:3 }}>
              {s.icon} {s.id}
            </button>
          ))}
        </div>

        {/* 縦型カレンダー */}
        <div style={{ background:"white", borderRadius:18, padding:"16px", boxShadow:"0 2px 12px rgba(0,0,0,0.06)" }}>
          {/* 月ナビ */}
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
            <button onClick={prevMonth} style={{ background:"none", border:"none", fontSize:22, color:"#64748b", cursor:"pointer", padding:"4px 8px" }}>‹</button>
            <div style={{ fontWeight:800, fontSize:17, color:"#0f172a" }}>{year}年{month+1}月</div>
            <button onClick={nextMonth} style={{ background:"none", border:"none", fontSize:22, color:"#64748b", cursor:"pointer", padding:"4px 8px" }}>›</button>
          </div>
          {(() => {
            const SCHOOL_COLORS = {"八木山中":"#0284c7","八木山小":"#059669","八木山南小":"#7c3aed","芦口小":"#d97706","地域":"#dc2626"};
            const getSchoolFromTitle = (title) => {
              const m = title.match(/^\[(.+?)\]/);
              return m ? m[1] : null;
            };
            const matchFilter = (ev) => {
              if (!filterCat) return true;
              const school = getSchoolFromTitle(ev.title);
              return school === filterCat;
            };
            const dayNames = ["日","月","火","水","木","金","土"];
            const allDays = [];
            for (let d = 1; d <= daysInMonth; d++) {
              const ds = dateStr(year, month, d);
              const dt = new Date(year, month, d);
              const dow = dt.getDay();
              const holiday = HOLIDAYS[ds];
              const dayEvs = events.filter(ev => ev.date === ds && matchFilter(ev));
              allDays.push({ d, ds, dow, holiday, dayEvs });
            }
            return allDays.map(({ d, ds, dow, holiday, dayEvs }) => {
              const isSun = dow === 0;
              const isSat = dow === 6;
              const isHoliday = !!holiday;
              const isRed = isSun || isHoliday;
              const isTodayRow = ds === todayStr;
              const hasEvents = dayEvs.length > 0;
              return (
                <div key={d} onClick={()=>setSelectedDate(d)} style={{
                  display:"flex", gap:0, padding:"8px 10px", borderRadius:10, cursor:"pointer",
                  background: isTodayRow ? "#eff6ff" : hasEvents ? "#fafbfc" : "transparent",
                  borderBottom: "1px solid #f1f5f9",
                  borderLeft: isTodayRow ? "3px solid #0284c7" : "3px solid transparent"
                }}>
                  {/* 日付・曜日 */}
                  <div style={{ minWidth:54, flexShrink:0, display:"flex", alignItems:"flex-start", gap:4, paddingTop:2 }}>
                    <span style={{ fontWeight:800, fontSize:15, color: isRed ? "#dc2626" : isSat ? "#0284c7" : "#0f172a" }}>{d}</span>
                    <span style={{ fontSize:11, fontWeight:700, color: isRed ? "#dc2626" : isSat ? "#0284c7" : "#94a3b8", paddingTop:2 }}>{dayNames[dow]}</span>
                  </div>
                  {/* 予定エリア */}
                  <div style={{ flex:1, minHeight:20, display:"flex", flexDirection:"column", gap:2 }}>
                    {isHoliday && (
                      <span style={{ fontSize:11, fontWeight:700, color:"#dc2626", background:"#fef2f2", padding:"1px 6px", borderRadius:4, alignSelf:"flex-start" }}>🎌 {holiday}</span>
                    )}
                    {dayEvs.map((ev, j) => {
                      const school = getSchoolFromTitle(ev.title);
                      const sColor = school ? (SCHOOL_COLORS[school] || "#64748b") : "#64748b";
                      const displayTitle = ev.title.replace(/^\[.+?\]\s*/, "");
                      return (
                        <div key={j} style={{ display:"flex", alignItems:"center", gap:5, fontSize:12 }}>
                          {school && <span style={{ fontSize:9, fontWeight:700, color:sColor, background:sColor+"15", padding:"0px 5px", borderRadius:3, flexShrink:0 }}>{school}</span>}
                          <span style={{ color:"#0f172a" }}>{displayTitle}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            });
          })()}
        </div>

      </div>
    </div>
  );
}

// ============================================================
// 管理者設定画面
// ============================================================
function AdminScreen({ onBack, onHome, events, setEvents, currentUser, channels, setChannels, documents, setDocuments, publishForms, setPublishForms, USERS }) {
  const [tab, setTab] = useState("calendar");
  const [importMsg, setImportMsg] = useState(null);
  const [importLoading, setImportLoading] = useState(false);
  const [importPreview, setImportPreview] = useState(null);

  // --- チャットカテゴリ管理 ---
  const [newChName, setNewChName] = useState("");
  const [newChIcon, setNewChIcon] = useState("📌");
  const [newChDesc, setNewChDesc] = useState("");
  const [newChAccess, setNewChAccess] = useState("all");
  const [expandedCh, setExpandedCh] = useState(null);
  const [addSubParent, setAddSubParent] = useState(null);
  const [newSubName, setNewSubName] = useState("");
  const [newSubIcon, setNewSubIcon] = useState("📌");

  // --- ドキュメント管理 ---
  const [newDocName, setNewDocName] = useState("");
  const [newDocCat, setNewDocCat] = useState("会議資料");

  // --- メンバー絞り込み ---
  const [memberFilterCh, setMemberFilterCh] = useState(null);
  const [memberFilterSub, setMemberFilterSub] = useState(null);
  const [selectedMember, setSelectedMember] = useState(null); // メンバー詳細表示用
  const [confirmDelete, setConfirmDelete] = useState(null); // 削除確認用

  const isHonbu = HONBU_ROLES.includes(currentUser.role);

  // メンバー削除（FirestoreのusersコレクションとAuthから削除）
  const handleDeleteMember = async (userId) => {
    try {
      await deleteDoc(doc(db, "users", userId));
      setConfirmDelete(null);
      setSelectedMember(null);
    } catch (e) {
      console.error("メンバー削除エラー:", e);
      alert("削除に失敗しました: " + e.message);
    }
  };

  // --- 文書発行 ---
  // publishNav: 階層ナビ ["committee","unor_1","sidai"] のような配列
  const [publishNav, setPublishNav] = useState(publishForms?._activeNav || []);
  const [publishMsg, setPublishMsg] = useState(null);
  // 現在のフォームデータ（文書種別ごとにキーを分ける）
  const publishDocType = publishNav.length >= 3 ? publishNav[2] : null; // "sidai" or "meibo"
  const publishFormKey = publishNav.length >= 2
    ? (publishDocType ? `${publishDocType}_${publishNav[1]}` : `unei_${publishNav[1]}`)
    : null;
  const publishForm = publishFormKey ? (publishForms?.[publishFormKey] || {}) : {};
  const setPublishForm = (updater) => {
    if (!publishFormKey) return;
    setPublishForms(prev => {
      const current = prev[publishFormKey] || {};
      const next = typeof updater === "function" ? updater(current) : updater;
      return { ...prev, [publishFormKey]: next };
    });
  };
  const navTo = (path) => {
    setPublishNav(path);
    setPublishForms(prev => ({ ...prev, _activeNav: path }));
  };
  const navBack = () => {
    const next = publishNav.slice(0, -1);
    setPublishNav(next);
    setPublishForms(prev => ({ ...prev, _activeNav: next }));
  };

  // 運営委員会の回次データ（初回作成時のデフォルト値生成）
  const getDefaultUneiForm = (kai) => ({
    nendo: "令和８年度", kai, date: "", time: "18：00", place: "南校舎２Ｆ 視聴覚室",
    items: [
      { label:"開会", person:"事務長" },
      { label:"挨拶", person:"" },
      { label:"運営委員紹介", person:"" },
      { label:"報告・協議", person:"" },
      { label:"閉会", person:"事務長" },
    ],
    subitems: {
      1: ["会長", "校長"],
      2: ["本部役員→専門委員→地区委員→学年委員"],
      3: [
        `${kai === "第１回" ? "令和７" : "令和８"}年度活動報告について 【各委員・本部】`,
        `${kai === "第１回" ? "令和７" : "令和８"}年度決算および監査報告 【会計】`,
        "令和８年度活動計画案について",
        "令和８年度予算案について",
        "令和８年度健全育成活動について 【副会長・教頭先生】",
        "PTA会則、細則変更について",
        "その他",
      ],
    },
  });
  const ensureUneiForm = (key, kai) => {
    if (!publishForms?.[key]) {
      setPublishForms(prev => ({ ...prev, [key]: getDefaultUneiForm(kai) }));
    }
  };

  // 本部役員名簿のデフォルト値
  const getDefaultMeiboForm = () => ({
    nendo: "令和８年度",
    school: "仙台市立八木山中学校",
    members: [
      { no:"1", role:"参　与", name:"", student:"校　長" },
      { no:"2", role:"会　長", name:"伊藤 宏明", student:"" },
      { no:"3", role:"副会長", name:"", student:"" },
      { no:"4", role:"副会長", name:"", student:"" },
      { no:"5", role:"副会長", name:"", student:"教　頭" },
      { no:"6", role:"事務長", name:"", student:"" },
      { no:"7", role:"事務次長", name:"", student:"教務主任" },
      { no:"8", role:"会　計", name:"", student:"" },
      { no:"9", role:"幹　事", name:"", student:"" },
      { no:"10", role:"幹　事", name:"", student:"" },
      { no:"11", role:"監　事", name:"", student:"" },
      { no:"12", role:"監　事", name:"", student:"" },
    ],
  });
  const ensureMeiboForm = (key) => {
    if (!publishForms?.[key]) {
      setPublishForms(prev => ({ ...prev, [key]: getDefaultMeiboForm() }));
    }
  };

  // 活動報告のデフォルト値（本部委員会を参考）
  const getDefaultKatsudouForm = () => ({
    committee: "本部",
    activities: [
      { month:"4", day:"", dow:"", content:"第一回本部打合せ" },
      { month:"4", day:"", dow:"", content:"第一回本部役員会・運営委員会" },
      { month:"5", day:"", dow:"", content:"PTA総会" },
      { month:"6", day:"", dow:"", content:"第二回役員会／第二回運営委員会" },
      { month:"10", day:"", dow:"", content:"第三回役員会／第三回運営委員会" },
      { month:"2", day:"", dow:"", content:"第四回役員会／第四回運営委員会" },
      { month:"3", day:"", dow:"", content:"卒業式　お手伝い" },
      { month:"3", day:"", dow:"", content:"離任式　お手伝い" },
    ],
    reflection: "",
  });
  const ensureKatsudouForm = (key) => {
    if (!publishForms?.[key]) {
      setPublishForms(prev => ({ ...prev, [key]: getDefaultKatsudouForm() }));
    }
  };

  // 会計報告書のデフォルト値（PDFのp.10準拠）
  const getDefaultKaikeiForm = () => ({
    nendo: "令和６年度",
    date: "2025-03-27",
    school: "仙台市立八木山中学校ＰＴＡ",
    income: [
      { category:"会費", item:"保護者", budget:"1613200", actual:"1583600", diff:"-29600", note:"3700円×実家庭436" },
      { category:"会費", item:"教職員", budget:"111000", actual:"118400", diff:"7400", note:"3700円×30人" },
      { category:"繰越金", item:"", budget:"584861", actual:"584861", diff:"0", note:"" },
      { category:"市助成金", item:"", budget:"90000", actual:"90000", diff:"0", note:"" },
      { category:"雑収入", item:"", budget:"0", actual:"11700", diff:"11700", note:"前年度会費等" },
    ],
    expense: [
      { section:"事務費", category:"会議費", item:"会議費", budget:"20000", actual:"6368", diff:"13632", note:"運営委員会・会議費" },
      { section:"事務費", category:"報償費", item:"報償費", budget:"50000", actual:"12808", diff:"37192", note:"浄書御礼等" },
      { section:"事務費", category:"人件費", item:"旅費", budget:"60000", actual:"27000", diff:"33000", note:"各種会議参加交通費・日当" },
      { section:"事務費", category:"人件費", item:"諸手当", budget:"600000", actual:"576100", diff:"23900", note:"事務員手当" },
      { section:"事務費", category:"需要費", item:"消耗品費", budget:"60000", actual:"28327", diff:"31673", note:"コピー用紙 封筒等" },
      { section:"事務費", category:"需要費", item:"通信費", budget:"80000", actual:"80000", diff:"0", note:"サイボウズ・ZOOM利用料ウイルスバスター代" },
      { section:"事務費", category:"需要費", item:"印刷製本費", budget:"15000", actual:"0", diff:"15000", note:"封筒印刷代" },
      { section:"事務費", category:"需要費", item:"備品費", budget:"10000", actual:"0", diff:"10000", note:"" },
      { section:"事務費", category:"需要費", item:"慶弔費", budget:"150000", actual:"109440", diff:"40560", note:"祝い金・香典・餞別等" },
      { section:"事務費", category:"需要費", item:"記念品費", budget:"180000", actual:"146880", diff:"33120", note:"入学、卒業記念品" },
      { section:"事業費", category:"専門委員会費", item:"活動費", budget:"210000", actual:"259738", diff:"-49738", note:"PTA広報紙" },
      { section:"事業費", category:"専門委員会費", item:"運営費", budget:"23000", actual:"0", diff:"23000", note:"" },
      { section:"事業費", category:"地区費", item:"活動費", budget:"90100", actual:"41489", diff:"48611", note:"13地区+委員会の活動費" },
      { section:"事業費", category:"地区費", item:"運営費", budget:"25000", actual:"26000", diff:"-1000", note:"" },
      { section:"事業費", category:"役選費", item:"活動費", budget:"5000", actual:"0", diff:"5000", note:"" },
      { section:"事業費", category:"役選費", item:"運営費", budget:"6000", actual:"6000", diff:"0", note:"" },
      { section:"事業費", category:"学年費", item:"活動費", budget:"64000", actual:"21828", diff:"42172", note:"4,000円×16学級" },
      { section:"事業費", category:"学年費", item:"運営費", budget:"12000", actual:"12000", diff:"0", note:"" },
      { section:"事業費", category:"学年費", item:"卒業費", budget:"30000", actual:"30000", diff:"0", note:"卒業式職員用コサージュ他" },
      { section:"事業費", category:"本部費", item:"活動費", budget:"10000", actual:"3531", diff:"6469", note:"" },
      { section:"事業費", category:"本部費", item:"運営費", budget:"12000", actual:"12000", diff:"0", note:"" },
      { section:"事業費", category:"助成金", item:"健全育成費", budget:"40000", actual:"40000", diff:"0", note:"" },
      { section:"事業費", category:"助成金", item:"安全安心助成金", budget:"50000", actual:"50104", diff:"-104", note:"腕章代" },
      { section:"事業費", category:"負担金", item:"市Ｐ協", budget:"30000", actual:"18000", diff:"12000", note:"八木山防災連絡会等" },
      { section:"事業費", category:"負担金", item:"校外指導連盟他", budget:"10000", actual:"10090", diff:"-90", note:"" },
      { section:"", category:"雑費", item:"", budget:"5000", actual:"0", diff:"5000", note:"切手代 振込手数料等" },
      { section:"", category:"活動補助費", item:"", budget:"501961", actual:"65644", diff:"436317", note:"" },
      { section:"", category:"周年事業基金", item:"", budget:"50000", actual:"50000", diff:"0", note:"" },
    ],
    incomeTotal: { budget:"2399061", actual:"2388561", diff:"-10500" },
    expenseTotal: { budget:"2399061", actual:"1633347", diff:"765714" },
    balance: "755214",
    fundBalance: "620288",
    auditDate: "2025-03-27",
    auditor1: "大坂 茉由",
    auditor2: "長瀨 梨江",
  });
  const ensureKaikeiForm = (key) => {
    if (!publishForms?.[key]) {
      setPublishForms(prev => ({ ...prev, [key]: getDefaultKaikeiForm() }));
    }
  };

  // 予算案のデフォルト値（前年度会計報告書から自動参照）
  const getDefaultYosanForm = (prevKaikei) => {
    const pk = prevKaikei || {};
    const prevIncome = pk.income || [];
    const prevExpense = pk.expense || [];
    // 前年度の予算額をマッピング
    const findPrevIncome = (cat, item) => {
      const r = prevIncome.find(r => r.category === cat && r.item === item);
      return r ? r.budget : "";
    };
    const findPrevExpense = (cat, item) => {
      const r = prevExpense.find(r => r.category === cat && r.item === item);
      return r ? r.budget : "";
    };
    return {
      nendo: "令和８年度",
      date: "",
      school: "仙台市立八木山中学校ＰＴＡ",
      income: [
        { category:"会費", item:"保護者", prevBudget:findPrevIncome("会費","保護者"), newBudget:"", diff:"", note:"3600円×実家庭" },
        { category:"会費", item:"教職員", prevBudget:findPrevIncome("会費","教職員"), newBudget:"", diff:"", note:"3500円×30人" },
        { category:"繰越金", item:"", prevBudget:findPrevIncome("繰越金",""), newBudget:"", diff:"", note:"" },
        { category:"市助成金", item:"", prevBudget:findPrevIncome("市助成金",""), newBudget:"", diff:"", note:"" },
        { category:"雑収入", item:"", prevBudget:findPrevIncome("雑収入",""), newBudget:"", diff:"", note:"" },
      ],
      expense: prevExpense.length > 0
        ? prevExpense.map(r => ({
            section: r.section, category: r.category, item: r.item,
            prevBudget: r.budget, newBudget: "", diff: "", note: r.note,
          }))
        : [
          { section:"事務費", category:"会議費", item:"会議費", prevBudget:"20000", newBudget:"", diff:"", note:"運営委員会・会議費" },
          { section:"事務費", category:"報償費", item:"報償費", prevBudget:"50000", newBudget:"", diff:"", note:"浄書御礼等" },
          { section:"事務費", category:"人件費", item:"旅費", prevBudget:"60000", newBudget:"", diff:"", note:"各種会議参加交通費・日当" },
          { section:"事務費", category:"人件費", item:"諸手当", prevBudget:"600000", newBudget:"", diff:"", note:"事務員手当" },
          { section:"事務費", category:"需要費", item:"消耗品費", prevBudget:"60000", newBudget:"", diff:"", note:"コピー用紙・封筒等" },
          { section:"事務費", category:"需要費", item:"通信費", prevBudget:"80000", newBudget:"", diff:"", note:"サイボウズ・ZOOM利用料等" },
          { section:"事務費", category:"需要費", item:"印刷製本費", prevBudget:"15000", newBudget:"", diff:"", note:"封筒印刷代" },
          { section:"事務費", category:"需要費", item:"備品費", prevBudget:"10000", newBudget:"", diff:"", note:"" },
          { section:"事務費", category:"需要費", item:"慶弔費", prevBudget:"150000", newBudget:"", diff:"", note:"祝い金・香典・餞別等" },
          { section:"事務費", category:"需要費", item:"記念品費", prevBudget:"180000", newBudget:"", diff:"", note:"入学、卒業記念品" },
          { section:"事業費", category:"専門委員会費", item:"活動費", prevBudget:"210000", newBudget:"", diff:"", note:"PTA広報紙" },
          { section:"事業費", category:"専門委員会費", item:"運営費", prevBudget:"23000", newBudget:"", diff:"", note:"" },
          { section:"事業費", category:"地区費", item:"活動費", prevBudget:"90100", newBudget:"", diff:"", note:"13地区+委員会の活動費" },
          { section:"事業費", category:"地区費", item:"運営費", prevBudget:"25000", newBudget:"", diff:"", note:"" },
          { section:"事業費", category:"役選費", item:"活動費", prevBudget:"5000", newBudget:"", diff:"", note:"" },
          { section:"事業費", category:"役選費", item:"運営費", prevBudget:"6000", newBudget:"", diff:"", note:"" },
          { section:"事業費", category:"学年費", item:"活動費", prevBudget:"64000", newBudget:"", diff:"", note:"4,000円×学級数" },
          { section:"事業費", category:"学年費", item:"運営費", prevBudget:"12000", newBudget:"", diff:"", note:"" },
          { section:"事業費", category:"学年費", item:"卒業費", prevBudget:"30000", newBudget:"", diff:"", note:"卒業式職員用コサージュ他" },
          { section:"事業費", category:"本部費", item:"活動費", prevBudget:"10000", newBudget:"", diff:"", note:"" },
          { section:"事業費", category:"本部費", item:"運営費", prevBudget:"12000", newBudget:"", diff:"", note:"" },
          { section:"事業費", category:"助成金", item:"健全育成費", prevBudget:"40000", newBudget:"", diff:"", note:"" },
          { section:"事業費", category:"助成金", item:"安全安心助成金", prevBudget:"50000", newBudget:"", diff:"", note:"" },
          { section:"事業費", category:"負担金", item:"市Ｐ協", prevBudget:"30000", newBudget:"", diff:"", note:"八木山防災連絡会等" },
          { section:"事業費", category:"負担金", item:"校外指導連盟他", prevBudget:"10000", newBudget:"", diff:"", note:"" },
          { section:"", category:"雑費", item:"", prevBudget:"5000", newBudget:"", diff:"", note:"切手代 振込手数料等" },
          { section:"", category:"活動補助費", item:"", prevBudget:"501961", newBudget:"", diff:"", note:"" },
          { section:"", category:"周年事業基金", item:"", prevBudget:"50000", newBudget:"", diff:"", note:"" },
        ],
      fundBalance: pk.fundBalance || "",
    };
  };
  const ensureYosanForm = (key) => {
    if (!publishForms?.[key]) {
      // 同じ回次の会計報告書データを探す
      const kaikeiKey = key.replace("yosan_", "kaikei_");
      const prevKaikei = publishForms?.[kaikeiKey] || null;
      setPublishForms(prev => ({ ...prev, [key]: getDefaultYosanForm(prevKaikei) }));
    }
  };

  // 活動計画案のデフォルト値（PDFのp.19 PTA本部活動計画案 準拠）
  const getDefaultKeikakuForm = () => ({
    nendo: "令和８年度",
    title: "PTA本部活動計画（案）",
    activities: [
      { month:"4", day:"", content:"入学式（会長のみ）　ＰＴＡ入会式" },
      { month:"4", day:"", content:"第１回役員会／第１回運営委員会" },
      { month:"4", day:"", content:"八木中NET登録作業" },
      { month:"4", day:"", content:"ＰＴＡ総会（書面開催）" },
      { month:"5", day:"", content:"ＰＴＡ総会報告会" },
      { month:"5", day:"", content:"太白区ＰＴＡ連合会総会" },
      { month:"5", day:"", content:"八木山小学校区子どもを守る会" },
      { month:"5", day:"", content:"仙台市ＰＴＡ協議会代議員総会" },
      { month:"6", day:"", content:"第２回役員会／第２回運営委員会" },
      { month:"6", day:"", content:"八木山防犯協会総会" },
      { month:"7", day:"", content:"八木山フェスタ実行委員会" },
      { month:"7", day:"", content:"校長・ＰＴＡ会長教育研修会" },
      { month:"7", day:"", content:"八木山地区青少年健全育成会総会" },
      { month:"7", day:"", content:"芦口子どもを守る会総会" },
      { month:"8", day:"", content:"八木山連合町内会夏祭り巡視" },
      { month:"9", day:"", content:"八木山フェスタ実行委員会" },
      { month:"10", day:"", content:"ＰＴＡ会計・文化体育後援会会計中間監査" },
      { month:"10", day:"", content:"第３回役員会／第３回運営委員会（中間監査報告）" },
      { month:"10", day:"", content:"八木山地区総合防災訓練" },
      { month:"11", day:"", content:"八木山フェスタ" },
      { month:"11", day:"", content:"ＰＴＡフェスティバル" },
      { month:"1", day:"", content:"新入生保護者会説明会" },
      { month:"2", day:"", content:"第４回役員会／第４回運営委員会" },
      { month:"3", day:"", content:"中学校卒業式・新役員顔合わせ・新旧役員引継ぎ" },
      { month:"3", day:"", content:"各小学校卒業式参列（八木山南小・芦口小・金剛沢小・八木山小）" },
      { month:"3", day:"", content:"離任式" },
      { month:"3", day:"", content:"ＰＴＡ会計・文化体育後援会会計監査" },
    ],
    note: "",
  });
  const ensureKeikakuForm = (key) => {
    if (!publishForms?.[key]) {
      setPublishForms(prev => ({ ...prev, [key]: getDefaultKeikakuForm() }));
    }
  };

  // 総会資料補足説明のデフォルト値
  const getDefaultHosokuForm = () => ({
    nendo: "令和7年度",
    format: {
      desc: "昨年同様、総会資料を　ＷＥＢ（インターネット）にて配信の上、ＷＥＢ表決とします。",
      deadlineLabel: "表決締切",
      deadline: "4月21日（月）",
      reportLabel: "総会報告",
      report: "5月1日（木）",
      reportNote: "（併せて先生方との交流会を予定）",
    },
    sections: [
      { type:"heading", text:"１．協　議" },
      { type:"gian", number:"第1号議案", title:"令和６年度活動報告について（ｐ.1～9）", comments:[] },
      { type:"gian", number:"第2号議案", title:"令和６年度ＰＴＡ会計決算報告について（ｐ.10～13）", comments:[
        { heading:"2.支出の部", items:[
          "事業費：専門委員会費 → 職員紹介号の発行により印刷枚数の増加と広報紙印刷代高騰のため49,738円支出増",
          "事業費：地区費・学年費 → 地区についても学年についても活動にばらつきがあり、地区費48,611円、学年費42,172円の活動費が年度末に返金となり支出減",
        ]},
      ]},
      { type:"gian", number:"第3号議案", title:"令和７年度活動計画（案）について（ｐ.14～18）", comments:[
        { heading:"", items:[
          "実行委員会活動（案）p.20 昨年度までの専門委員会の活動をもとに、実行委員の年間活動の案を記載しています。この他、やってみたい活動などがあれば、新たな実行委員会を立ち上げることも可能です。",
        ]},
      ]},
      { type:"gian", number:"第4号議案", title:"令和７年度ＰＴＡ会計予算（案）について（ｐ.19～21）", comments:[
        { heading:"1. 収入の部", items:[
          "会費：保護者 → 昨年度会費3,700円から今年度3,600円へ減額",
          "会費：教職員 → 昨年度会費3,700円から今年度3,500円へ減額",
          "市助成金 → 来年度分の腕章を確保できたことから、安心安全助成金の申請を本年度の申請は実施しないため50,000円収入減",
        ]},
        { heading:"２．支出の部", items:[
          "事務費：報償費 → 昨年度まで活動補助費から支出していたPTA感謝状等の支出を今年度より報償費から支出するため40,000円支出増",
          "事業費：専門委員会費 → 広報紙印刷代高騰とボランティアで委員会活動が立ち上がった場合に活動費を支給するため90,000円支出増",
          "事業費：地区費活動費 → 地区活動の活発化対応のため、各地区に地区活動費を昨年度まで生徒数×100円＋3,000円/地区から生徒数×150円＋3,000円/地区とし21,900円支出増",
          "事業費：安全安心助成金 → 安全安心助成金を利用して購入している見守り腕章は来年度分まで入手済み。今年度は購入予定がないため50,000円支出減",
        ]},
        { heading:"令和７年度 文化体育後援会会計予算（案）について（ｐ.20～21）", items:[] },
        { heading:"2.支出の部", items:[
          "文化体育後援会部活動支援費（ユニフォーム等）ローテーション → 女子バレー部はR６年度部員減少のため、R７年度に移動。運動部も文化部同様にユニフォームに限らず、用具等の購入に充てても構わない。そのため、「部活動支援費」という名称とする。",
        ]},
      ]},
    ],
    closing: "以上",
  });
  const ensureHosokuForm = (key) => {
    if (!publishForms?.[key]) {
      setPublishForms(prev => ({ ...prev, [key]: getDefaultHosokuForm() }));
    }
  };

  const pad = (n) => String(n).padStart(2,"0");

  // カレンダーインポート（CalendarScreenと同じロジック）
  const zenkaku = s => parseInt(String(s).replace(/[０-９]/g, c => "０１２３４５６７８９".indexOf(c)));
  const parseKeniku = (rows) => {
    const headerRows = [];
    rows.forEach((row, i) => { if (String(row[0]||"").trim() === "月" && String(row[1]||"").trim() === "学校名") headerRows.push(i); });
    if (headerRows.length === 0) return null;
    const yearEntries = [];
    rows.forEach((row, i) => {
      const v = String(row[0] || "");
      const m = v.match(/(２０[０-９]{2}|20\d{2})/);
      if (m) yearEntries.push({ row: i, year: zenkaku(m[1]) });
    });
    const monthMap = {"４":4,"５":5,"６":6,"７":7,"８":8,"９":9,"１０":10,"１１":11,"１２":12,"１":1,"２":2,"３":3};
    const parsed = [];
    headerRows.forEach(hrow => {
      let currentYear = 2026;
      yearEntries.forEach(ye => { if (ye.row < hrow) currentYear = ye.year; });
      const dayNums = {};
      for (let c = 2; c < (rows[hrow]||[]).length; c++) {
        const n = parseInt(String(rows[hrow][c]||"").trim());
        if (n > 0 && n <= 31) dayNums[c] = n;
      }
      const monthRow = hrow + 2;
      if (monthRow >= rows.length) return;
      const mVal = String(rows[monthRow][0]||"").replace(/\n/g,"").replace(/月/g,"").trim();
      let monthNum = monthMap[mVal];
      if (!monthNum) { const n = parseInt(mVal); if (n >= 1 && n <= 12) monthNum = n; }
      if (!monthNum) return;
      for (let r = monthRow; r < Math.min(monthRow + 6, rows.length); r++) {
        const school = String(rows[r][1]||"").trim();
        if (!school || school === "学校名") continue;
        for (const [cStr, day] of Object.entries(dayNums)) {
          const c = parseInt(cStr);
          const v = (rows[r][c]||"");
          if (!v || String(v).trim() === "") continue;
          const title = String(v).trim().replace(/\n/g," ");
          const dateStr2 = `${currentYear}-${pad(monthNum)}-${pad(day)}`;
          let cat = "school";
          if (school === "地域") cat = "district";
          else if (/PTA|Ｐ総会|P総会/.test(title)) cat = "pta";
          else if (/部活|大会/.test(title)) cat = "club";
          else if (/休業|休み$|振替休/.test(title)) cat = "holiday";
          parsed.push({ date: dateStr2, title, school, category: cat });
        }
      }
    });
    return parsed.length > 0 ? parsed : null;
  };

  const handleImport = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = "";
    setImportLoading(true);
    try {
      const buf = await file.arrayBuffer();
      let text;
      try { text = await decodeShiftJIS(buf); } catch { text = await file.text(); }
      const rows = parseCSVText(text);
      const kenikuResult = parseKeniku(rows);
      if (kenikuResult && kenikuResult.length > 0) {
        const schools = [...new Set(kenikuResult.map(e => e.school))];
        setImportPreview({ events: kenikuResult, schools, selectedSchools: new Set(schools), fileName: file.name });
      } else {
        setImportMsg("インポートできるデータがありませんでした");
        setTimeout(() => setImportMsg(null), 3000);
      }
    } catch (err) {
      setImportMsg(`読み込みエラー: ${err.message || "不明なエラー"}`);
      setTimeout(() => setImportMsg(null), 5000);
    }
    setImportLoading(false);
  };

  const confirmImport = () => {
    if (!importPreview) return;
    const { events: parsed, selectedSchools } = importPreview;
    const filtered = parsed.filter(ev => selectedSchools.has(ev.school));
    const existingKeys = new Set(events.map(ev => `${ev.date}|${ev.title}`));
    const deduped = filtered.filter(ev => !existingKeys.has(`${ev.date}|${ev.title}`));
    const newEvents = deduped.map((ev, i) => ({
      id: `ev_${Date.now()}_${i}`,
      date: ev.date,
      title: `[${ev.school}] ${ev.title}`,
      category: ev.category
    }));
    if (newEvents.length > 0) {
      setEvents(prev => [...prev, ...newEvents]);
      setImportMsg(`${newEvents.length}件をインポートしました`);
    } else {
      setImportMsg("新しい予定はありませんでした");
    }
    setImportPreview(null);
    setTimeout(() => setImportMsg(null), 4000);
  };

  const addChannel = () => {
    if (!newChName.trim()) return;
    const id = `ch_${Date.now()}`;
    setChannels(prev => [...prev, { id, name: newChName.trim(), icon: newChIcon, desc: newChDesc.trim() || newChName.trim(), members: [newChAccess], children: [] }]);
    setNewChName(""); setNewChDesc(""); setNewChIcon("📌"); setNewChAccess("all");
  };

  const removeChannel = (id) => {
    if (["all","honbu","unei"].includes(id)) return;
    setChannels(prev => prev.filter(ch => ch.id !== id));
  };

  const addSubChannel = (parentId) => {
    if (!newSubName.trim()) return;
    const subId = `sub_${Date.now()}`;
    setChannels(prev => prev.map(ch => {
      if (ch.id !== parentId) return ch;
      const children = ch.children || [];
      return { ...ch, children: [...children, { id: subId, name: newSubName.trim(), icon: newSubIcon, desc: "" }] };
    }));
    setNewSubName(""); setNewSubIcon("📌"); setAddSubParent(null);
    setExpandedCh(parentId);
  };

  const removeSubChannel = (parentId, subId) => {
    setChannels(prev => prev.map(ch => {
      if (ch.id !== parentId) return ch;
      return { ...ch, children: (ch.children || []).filter(s => s.id !== subId) };
    }));
  };

  const addDocument = () => {
    if (!newDocName.trim()) return;
    setDocuments(prev => [...prev, { id: `doc_${Date.now()}`, name: newDocName.trim(), category: newDocCat, createdAt: new Date().toISOString().split("T")[0], author: currentUser.nickname }]);
    setNewDocName("");
  };

  const removeDocument = (id) => {
    setDocuments(prev => prev.filter(d => d.id !== id));
  };

  const tabs = [
    { id:"calendar", label:"📅 カレンダー", desc:"CSVインポート" },
    { id:"chat", label:"💬 チャット", desc:"カテゴリ管理" },
    { id:"members", label:"👥 メンバー", desc:"登録者一覧" },
    { id:"documents", label:"📁 資料管理", desc:"フォーマット保管" },
    { id:"publish", label:"📄 文書発行", desc:"PDF文書作成" },
  ];

  // インポートプレビュー画面
  if (importPreview) {
    const { events: previewEvents, schools, selectedSchools, fileName } = importPreview;
    const toggleSchool = (s) => {
      setImportPreview(prev => {
        const next = new Set(prev.selectedSchools);
        next.has(s) ? next.delete(s) : next.add(s);
        return { ...prev, selectedSchools: next };
      });
    };
    const filtered = previewEvents.filter(ev => selectedSchools.has(ev.school));
    const byMonth = {};
    filtered.forEach(ev => { const ym = ev.date.substring(0,7); if (!byMonth[ym]) byMonth[ym] = []; byMonth[ym].push(ev); });
    const sortedMonths = Object.keys(byMonth).sort();
    return (
      <div style={{ display:"flex", flexDirection:"column", height:"100%", background:"#f0f4f8" }}>
        <Header title="📥 インポートプレビュー" onBack={()=>setImportPreview(null)} onHome={onHome}/>
        <div style={{ flex:1, overflow:"auto", padding:"16px" }}>
          <div style={{ background:"white", borderRadius:14, padding:"16px", marginBottom:12, boxShadow:"0 2px 8px rgba(0,0,0,0.06)" }}>
            <div style={{ fontSize:13, fontWeight:700, color:"#0f172a", marginBottom:4 }}>📄 {fileName}</div>
            <div style={{ fontSize:12, color:"#64748b" }}>健育カレンダー形式を検出 — {previewEvents.length}件</div>
          </div>
          <div style={{ background:"white", borderRadius:14, padding:"16px", marginBottom:12, boxShadow:"0 2px 8px rgba(0,0,0,0.06)" }}>
            <div style={{ fontSize:13, fontWeight:700, color:"#0f172a", marginBottom:10 }}>学校を選択</div>
            <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
              {schools.map(s => {
                const active = selectedSchools.has(s);
                return (<button key={s} onClick={()=>toggleSchool(s)} style={{ padding:"8px 14px", borderRadius:10, border:`2px solid ${active?"#0284c7":"#e5e7eb"}`, background:active?"#0284c718":"white", color:active?"#0284c7":"#94a3b8", fontSize:12, fontWeight:700, cursor:"pointer" }}>{active?"✓ ":""}{s}</button>);
              })}
            </div>
            <div style={{ fontSize:12, color:"#64748b", marginTop:8 }}>{filtered.length}件が対象</div>
          </div>
          <div style={{ background:"white", borderRadius:14, padding:"16px", marginBottom:80, boxShadow:"0 2px 8px rgba(0,0,0,0.06)" }}>
            {sortedMonths.map(ym => {
              const [y,m] = ym.split("-");
              const byDate = {};
              byMonth[ym].sort((a,b)=>a.date.localeCompare(b.date)).forEach(ev => { if (!byDate[ev.date]) byDate[ev.date]=[]; byDate[ev.date].push(ev); });
              return (<div key={ym} style={{ marginBottom:14 }}>
                <div style={{ fontSize:13, fontWeight:800, color:"#0284c7", marginBottom:6, padding:"4px 10px", background:"#eff6ff", borderRadius:8, display:"inline-block" }}>{parseInt(y)}年{parseInt(m)}月（{byMonth[ym].length}件）</div>
                {Object.keys(byDate).sort().slice(0,20).map(date => {
                  const d = parseInt(date.split("-")[2]);
                  return (<div key={date} style={{ display:"flex", gap:8, padding:"5px 8px", borderRadius:8, background:"#f8fafc", fontSize:12 }}>
                    <span style={{ fontWeight:700, color:"#64748b", minWidth:28 }}>{d}日</span>
                    <div style={{ flex:1, display:"flex", flexDirection:"column", gap:2 }}>
                      {byDate[date].map((ev,j) => (<div key={j} style={{ display:"flex", gap:6, alignItems:"center" }}><span style={{ fontSize:9, fontWeight:700, color:"#0284c7", background:"#0284c715", padding:"0 5px", borderRadius:3 }}>{ev.school}</span><span>{ev.title}</span></div>))}
                    </div>
                  </div>);
                })}
              </div>);
            })}
          </div>
        </div>
        <div style={{ padding:"12px 16px", background:"white", borderTop:"1px solid #e5e7eb" }}>
          <button onClick={confirmImport} disabled={filtered.length===0} style={{ width:"100%", padding:"14px", borderRadius:12, border:"none", background:filtered.length>0?"linear-gradient(135deg,#059669,#047857)":"#e5e7eb", color:"white", fontWeight:800, fontSize:15, cursor:filtered.length>0?"pointer":"not-allowed" }}>📥 {filtered.length}件をインポート</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", background:"#f0f4f8" }}>
      <Header title="⚙️ 管理者設定" onBack={onBack} onHome={onHome}/>
      <div style={{ flex:1, overflow:"auto", padding:"16px" }}>

        {importMsg && (<div style={{ background:"#059669", color:"white", padding:"10px 16px", borderRadius:12, fontSize:13, fontWeight:700, marginBottom:12, textAlign:"center" }}>{importMsg}</div>)}

        {/* タブ */}
        <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:16 }}>
          {tabs.map(t => (
            <button key={t.id} onClick={()=>setTab(t.id)} style={{ padding:"8px 14px", borderRadius:10, border:`2px solid ${tab===t.id?"#d97706":"#e5e7eb"}`, background:tab===t.id?"#d9770618":"white", color:tab===t.id?"#d97706":"#64748b", fontSize:12, fontWeight:700, cursor:"pointer" }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* ① カレンダーCSVインポート */}
        {tab === "calendar" && (
          <div style={{ background:"white", borderRadius:16, padding:"20px", boxShadow:"0 2px 12px rgba(0,0,0,0.06)" }}>
            <div style={{ fontWeight:800, fontSize:15, color:"#0f172a", marginBottom:4 }}>📅 カレンダー管理</div>
            <div style={{ fontSize:12, color:"#64748b", marginBottom:16 }}>健育カレンダーのCSVファイルをインポートできます</div>

            <label style={{ display:"flex", padding:"14px", borderRadius:12, border:"2px dashed #d97706", background:"#fffbeb", color:"#d97706", fontWeight:800, fontSize:14, cursor:importLoading?"wait":"pointer", alignItems:"center", justifyContent:"center", gap:8 }}>
              {importLoading ? "⏳ 読み込み中…" : "📥 CSVファイルを選択"}
              <input type="file" accept=".csv" onChange={handleImport} disabled={importLoading} style={{ display:"none" }}/>
            </label>

            <div style={{ marginTop:16, fontSize:12, color:"#64748b", lineHeight:1.8 }}>
              <b>対応形式：</b>健育カレンダー（Excelから「CSV保存」したもの）<br/>
              <b>現在の予定数：</b>{events.length}件<br/>
              <span style={{ fontSize:11, color:"#94a3b8" }}>※ Shift_JIS / UTF-8 両対応。重複は自動スキップ。</span>
            </div>

            {events.length > 0 && (
              <button onClick={()=>{ if(confirm("全ての予定を削除しますか？")) setEvents([]); }} style={{ marginTop:12, width:"100%", padding:"10px", borderRadius:10, border:"none", background:"#fef2f2", color:"#dc2626", fontWeight:700, fontSize:12, cursor:"pointer" }}>
                🗑 全予定をクリア
              </button>
            )}
          </div>
        )}

        {/* ② チャットカテゴリ管理 */}
        {tab === "chat" && (
          <div style={{ background:"white", borderRadius:16, padding:"20px", boxShadow:"0 2px 12px rgba(0,0,0,0.06)" }}>
            <div style={{ fontWeight:800, fontSize:15, color:"#0f172a", marginBottom:4 }}>💬 チャットカテゴリ管理</div>
            <div style={{ fontSize:12, color:"#64748b", marginBottom:16 }}>チャンネルとサブチャンネルの管理ができます</div>

            {/* 既存チャンネル一覧（階層表示） */}
            <div style={{ marginBottom:16 }}>
              {channels.map(ch => {
                const isSystem = ["all","honbu","unei"].includes(ch.id);
                const subs = ch.children || [];
                const isExpanded = expandedCh === ch.id;
                return (
                  <div key={ch.id} style={{ marginBottom:6 }}>
                    {/* 親チャンネル */}
                    <div style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 12px", borderRadius:10, background:"#f8fafc" }}>
                      <span onClick={()=>setExpandedCh(isExpanded ? null : ch.id)} style={{ fontSize:12, cursor:"pointer", color:"#94a3b8", width:16 }}>{subs.length > 0 ? (isExpanded ? "▼" : "▶") : "　"}</span>
                      <span style={{ fontSize:18 }}>{ch.icon}</span>
                      <div style={{ flex:1 }}>
                        <div style={{ fontWeight:700, fontSize:13, color:"#0f172a" }}>{ch.name}{subs.length > 0 ? ` (${subs.length})` : ""}</div>
                        <div style={{ fontSize:10, color:"#94a3b8" }}>{ch.desc}</div>
                      </div>
                      {!isSystem && (
                        <button onClick={()=>removeChannel(ch.id)} style={{ background:"#fef2f2", color:"#dc2626", border:"none", borderRadius:6, padding:"4px 8px", fontSize:11, fontWeight:700, cursor:"pointer" }}>削除</button>
                      )}
                      <button onClick={()=>{ setAddSubParent(addSubParent===ch.id?null:ch.id); setNewSubName(""); setNewSubIcon("📌"); }} style={{ background:addSubParent===ch.id?"#d9770618":"#eff6ff", color:addSubParent===ch.id?"#d97706":"#0284c7", border:"none", borderRadius:6, padding:"4px 8px", fontSize:11, fontWeight:700, cursor:"pointer" }}>{addSubParent===ch.id?"✕":"＋下層"}</button>
                    </div>

                    {/* サブチャンネル一覧 */}
                    {isExpanded && subs.length > 0 && (
                      <div style={{ marginLeft:38, borderLeft:"2px solid #e5e7eb", paddingLeft:12, marginTop:4 }}>
                        {subs.map(sub => (
                          <div key={sub.id} style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 10px", borderRadius:8, background:"white", marginBottom:3 }}>
                            <span style={{ fontSize:14 }}>{sub.icon}</span>
                            <div style={{ flex:1 }}>
                              <div style={{ fontWeight:600, fontSize:12, color:"#0f172a" }}>{sub.name}</div>
                              {sub.desc && <div style={{ fontSize:9, color:"#94a3b8" }}>{sub.desc}</div>}
                            </div>
                            <button onClick={()=>removeSubChannel(ch.id, sub.id)} style={{ background:"#fef2f2", color:"#dc2626", border:"none", borderRadius:6, padding:"3px 6px", fontSize:10, fontWeight:700, cursor:"pointer" }}>削除</button>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* サブチャンネル追加フォーム */}
                    {addSubParent === ch.id && (
                      <div style={{ marginLeft:38, borderLeft:"2px solid #d97706", paddingLeft:12, marginTop:6, paddingBottom:6 }}>
                        <div style={{ fontSize:11, fontWeight:700, color:"#d97706", marginBottom:6 }}>「{ch.name}」にサブチャンネルを追加</div>
                        {/* 親チャンネル別アイコンセット */}
                        {(() => {
                          const iconSets = {
                            "部活": [
                              {ic:"⚽",lb:"サッカー"},{ic:"⚾",lb:"野球"},{ic:"🏀",lb:"バスケ"},{ic:"🏐",lb:"バレー"},
                              {ic:"🎾",lb:"テニス"},{ic:"🏸",lb:"バドミントン"},{ic:"🏓",lb:"卓球"},{ic:"🥊",lb:"ボクシング"},
                              {ic:"🥋",lb:"柔道/剣道"},{ic:"🏊",lb:"水泳"},{ic:"🏃",lb:"陸上"},{ic:"⛳",lb:"ゴルフ"},
                              {ic:"🎿",lb:"スキー"},{ic:"🚴",lb:"自転車"},{ic:"🏉",lb:"ラグビー"},{ic:"🥅",lb:"ハンドボール"},
                              {ic:"🎵",lb:"吹奏楽"},{ic:"🎹",lb:"合唱/音楽"},{ic:"🎨",lb:"美術"},{ic:"📚",lb:"文芸"},
                              {ic:"🔬",lb:"科学"},{ic:"💻",lb:"パソコン"},{ic:"📷",lb:"写真"},{ic:"🎭",lb:"演劇"},
                              {ic:"♟️",lb:"将棋/囲碁"},{ic:"🧮",lb:"数学"},{ic:"🌍",lb:"国際/英語"},{ic:"📰",lb:"新聞"},
                              {ic:"🍳",lb:"料理/家庭"},{ic:"🌱",lb:"園芸"},{ic:"🤖",lb:"ロボット"},{ic:"📌",lb:"その他"},
                            ],
                            "学年": [
                              {ic:"1️⃣",lb:"1年"},{ic:"2️⃣",lb:"2年"},{ic:"3️⃣",lb:"3年"},{ic:"4️⃣",lb:"4年"},
                              {ic:"5️⃣",lb:"5年"},{ic:"6️⃣",lb:"6年"},{ic:"📌",lb:"その他"},
                            ],
                            "地区": [
                              {ic:"🏘️",lb:"住宅地"},{ic:"🏙️",lb:"市街地"},{ic:"🏔️",lb:"山間"},{ic:"🌊",lb:"沿岸"},
                              {ic:"🏫",lb:"学校区"},{ic:"📌",lb:"その他"},
                            ],
                          };
                          const defaultIcons = [
                            {ic:"📌",lb:"ピン"},{ic:"📢",lb:"告知"},{ic:"🏫",lb:"学校"},{ic:"👥",lb:"グループ"},
                            {ic:"🔔",lb:"通知"},{ic:"📋",lb:"リスト"},{ic:"💼",lb:"業務"},{ic:"🎉",lb:"イベント"},
                          ];
                          const icons = iconSets[ch.name] || defaultIcons;
                          return (
                            <div style={{ display:"flex", flexWrap:"wrap", gap:4, marginBottom:8 }}>
                              {icons.map(({ic,lb}) => (
                                <button key={ic+lb} onClick={()=>setNewSubIcon(ic)} title={lb} style={{
                                  width:40, height:40, borderRadius:8, border:`2px solid ${newSubIcon===ic?"#d97706":"#e5e7eb"}`,
                                  background:newSubIcon===ic?"#d9770618":"white", fontSize:18, cursor:"pointer",
                                  display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:0
                                }}>
                                  <span style={{ fontSize:16, lineHeight:1 }}>{ic}</span>
                                  <span style={{ fontSize:7, color:"#94a3b8", lineHeight:1, marginTop:1 }}>{lb}</span>
                                </button>
                              ))}
                            </div>
                          );
                        })()}
                        <div style={{ display:"flex", gap:6 }}>
                          <input value={newSubName} onChange={e=>setNewSubName(e.target.value)} placeholder="サブチャンネル名" style={{ flex:1, padding:"8px", borderRadius:6, border:"2px solid #e5e7eb", fontSize:12 }}/>
                          <button onClick={()=>addSubChannel(ch.id)} disabled={!newSubName.trim()} style={{ padding:"8px 12px", borderRadius:6, border:"none", background:newSubName.trim()?"#d97706":"#e5e7eb", color:"white", fontWeight:700, fontSize:11, cursor:newSubName.trim()?"pointer":"not-allowed" }}>追加</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* 新規親チャンネル追加フォーム */}
            <div style={{ borderTop:"1px solid #e5e7eb", paddingTop:16 }}>
              <div style={{ fontSize:13, fontWeight:700, color:"#64748b", marginBottom:8 }}>新しいチャンネルを追加</div>
              <div style={{ display:"flex", gap:8, marginBottom:8 }}>
                <select value={newChIcon} onChange={e=>setNewChIcon(e.target.value)} style={{ padding:"10px", borderRadius:8, border:"2px solid #e5e7eb", fontSize:18, width:56 }}>
                  {["📌","📢","🏫","⚽","🎵","📚","🎉","🏘️","👥","💼","🔔","📋"].map(ic => <option key={ic} value={ic}>{ic}</option>)}
                </select>
                <input value={newChName} onChange={e=>setNewChName(e.target.value)} placeholder="チャンネル名" style={{ flex:1, padding:"10px", borderRadius:8, border:"2px solid #e5e7eb", fontSize:14 }}/>
              </div>
              <input value={newChDesc} onChange={e=>setNewChDesc(e.target.value)} placeholder="説明（任意）" style={{ width:"100%", padding:"10px", borderRadius:8, border:"2px solid #e5e7eb", fontSize:13, marginBottom:8 }}/>
              <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:10 }}>
                {[{id:"all",label:"全員"},{id:"honbu",label:"本部役員"},{id:"unei",label:"運営委員会"}].map(a => (
                  <button key={a.id} onClick={()=>setNewChAccess(a.id)} style={{ padding:"6px 12px", borderRadius:8, border:`2px solid ${newChAccess===a.id?"#d97706":"#e5e7eb"}`, background:newChAccess===a.id?"#d9770618":"white", color:newChAccess===a.id?"#d97706":"#64748b", fontSize:11, fontWeight:700, cursor:"pointer" }}>{a.label}</button>
                ))}
              </div>
              <button onClick={addChannel} disabled={!newChName.trim()} style={{ width:"100%", padding:"12px", borderRadius:10, border:"none", background:newChName.trim()?"linear-gradient(135deg,#d97706,#b45309)":"#e5e7eb", color:"white", fontWeight:800, fontSize:14, cursor:newChName.trim()?"pointer":"not-allowed" }}>＋ チャンネルを追加</button>
            </div>
          </div>
        )}

        {/* ③ メンバー一覧 */}
        {tab === "members" && (
          <div style={{ background:"white", borderRadius:16, padding:"20px", boxShadow:"0 2px 12px rgba(0,0,0,0.06)" }}>
            <div style={{ fontWeight:800, fontSize:15, color:"#0f172a", marginBottom:4 }}>👥 登録メンバー一覧</div>
            <div style={{ fontSize:12, color:"#64748b", marginBottom:12 }}>{USERS.length}名が登録されています</div>

            {/* 親チャンネルフィルター */}
            <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:8 }}>
              <button onClick={()=>{ setMemberFilterCh(null); setMemberFilterSub(null); }} style={{ padding:"6px 12px", borderRadius:8, border:`2px solid ${!memberFilterCh?"#d97706":"#e5e7eb"}`, background:!memberFilterCh?"#d9770618":"white", color:!memberFilterCh?"#d97706":"#64748b", fontSize:11, fontWeight:700, cursor:"pointer" }}>すべて</button>
              {channels.map(ch => (
                <button key={ch.id} onClick={()=>{ setMemberFilterCh(memberFilterCh===ch.id?null:ch.id); setMemberFilterSub(null); }} style={{ padding:"6px 12px", borderRadius:8, border:`2px solid ${memberFilterCh===ch.id?"#d97706":"#e5e7eb"}`, background:memberFilterCh===ch.id?"#d9770618":"white", color:memberFilterCh===ch.id?"#d97706":"#64748b", fontSize:11, fontWeight:700, cursor:"pointer", display:"flex", alignItems:"center", gap:3 }}>
                  {ch.icon} {ch.name}
                </button>
              ))}
            </div>

            {/* サブチャンネルフィルター（親が選択済み＆子がある場合） */}
            {memberFilterCh && (() => {
              const parent = channels.find(c => c.id === memberFilterCh);
              const subs = parent?.children || [];
              if (subs.length === 0) return null;
              return (
                <div style={{ display:"flex", gap:5, flexWrap:"wrap", marginBottom:12, paddingLeft:8, borderLeft:"3px solid #d97706" }}>
                  <button onClick={()=>setMemberFilterSub(null)} style={{ padding:"5px 10px", borderRadius:6, border:`2px solid ${!memberFilterSub?"#0284c7":"#e5e7eb"}`, background:!memberFilterSub?"#0284c718":"white", color:!memberFilterSub?"#0284c7":"#94a3b8", fontSize:10, fontWeight:700, cursor:"pointer" }}>全{parent.name}</button>
                  {subs.map(sub => (
                    <button key={sub.id} onClick={()=>setMemberFilterSub(memberFilterSub===sub.id?null:sub.id)} style={{ padding:"5px 10px", borderRadius:6, border:`2px solid ${memberFilterSub===sub.id?"#0284c7":"#e5e7eb"}`, background:memberFilterSub===sub.id?"#0284c718":"white", color:memberFilterSub===sub.id?"#0284c7":"#94a3b8", fontSize:10, fontWeight:700, cursor:"pointer", display:"flex", alignItems:"center", gap:3 }}>
                      {sub.icon} {sub.name}
                    </button>
                  ))}
                </div>
              );
            })()}

            {/* メンバーリスト */}
            {(() => {
              // チャンネル名→USERフィールドのマッピング
              const chFieldMap = { "学年":"grade", "部活":"club", "地区":"district" };
              const roleFieldMap = { "本部役員":"role", "運営委員会":"role" };
              
              let filtered = USERS;
              
              if (memberFilterCh) {
                const parent = channels.find(c => c.id === memberFilterCh);
                if (!parent) return null;
                
                const fieldKey = chFieldMap[parent.name];
                const roleKey = roleFieldMap[parent.name];
                
                if (memberFilterSub) {
                  // サブチャンネルで絞り込み
                  const sub = (parent.children||[]).find(s => s.id === memberFilterSub);
                  if (sub && fieldKey) {
                    filtered = USERS.filter(u => u[fieldKey] && u[fieldKey].includes(sub.name));
                  }
                } else if (fieldKey) {
                  // 親チャンネルのフィールドが空でないメンバー
                  filtered = USERS.filter(u => u[fieldKey] && u[fieldKey].trim() !== "");
                } else if (roleKey) {
                  // 役職ベース
                  if (parent.name === "本部役員") filtered = USERS.filter(u => HONBU_ROLES.includes(u.role));
                  else if (parent.name === "運営委員会") filtered = USERS.filter(u => UNEI_ROLES.includes(u.role));
                } else if (parent.name === "全体") {
                  filtered = USERS;
                } else {
                  // カスタムチャンネル → 全員表示
                  filtered = USERS;
                }
              }

              // フィルター結果をグループ表示
              if (!memberFilterCh) {
                // 全体表示: 役職別
                const groups = {};
                filtered.forEach(u => {
                  const r = ROLES.find(ro => ro.code === u.role);
                  const label = r ? r.label : u.role;
                  if (!groups[label]) groups[label] = [];
                  groups[label].push(u);
                });
                return Object.entries(groups).map(([role, users]) => (
                  <div key={role} style={{ marginBottom:14 }}>
                    <div style={{ fontSize:12, fontWeight:800, color:"#d97706", marginBottom:6, padding:"3px 10px", background:"#fffbeb", borderRadius:6, display:"inline-block" }}>{role}（{users.length}名）</div>
                    {users.map(u => (
                      <div key={u.id} onClick={()=>isHonbu&&setSelectedMember(u)} style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 12px", borderRadius:8, background:"#f8fafc", marginBottom:3, cursor:isHonbu?"pointer":"default" }}>
                        <span style={{ fontSize:20 }}>{u.avatar}</span>
                        <div style={{ flex:1 }}>
                          <div style={{ fontWeight:700, fontSize:13, color:"#0f172a" }}>{u.name}</div>
                          <div style={{ fontSize:10, color:"#94a3b8" }}>{[u.grade, u.club, u.district].filter(Boolean).join(" / ")}</div>
                        </div>
                        <div style={{ fontSize:10, color:"#64748b", background:"#f1f5f9", padding:"2px 8px", borderRadius:4, fontWeight:600 }}>{ROLES.find(r=>r.code===u.role)?.label}</div>
                        {isHonbu && <span style={{ fontSize:12, color:"#94a3b8" }}>›</span>}
                      </div>
                    ))}
                  </div>
                ));
              } else {
                // フィルター適用時: フラット表示
                return (
                  <div>
                    <div style={{ fontSize:12, fontWeight:800, color:"#0284c7", marginBottom:8 }}>該当：{filtered.length}名</div>
                    {filtered.length === 0 ? (
                      <div style={{ textAlign:"center", color:"#94a3b8", fontSize:13, padding:"20px 0" }}>該当するメンバーがいません</div>
                    ) : filtered.map(u => (
                      <div key={u.id} onClick={()=>isHonbu&&setSelectedMember(u)} style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 12px", borderRadius:8, background:"#f8fafc", marginBottom:3, cursor:isHonbu?"pointer":"default" }}>
                        <span style={{ fontSize:20 }}>{u.avatar}</span>
                        <div style={{ flex:1 }}>
                          <div style={{ fontWeight:700, fontSize:13, color:"#0f172a" }}>{u.name}</div>
                          <div style={{ fontSize:10, color:"#94a3b8" }}>{[u.grade, u.club, u.district].filter(Boolean).join(" / ")}</div>
                        </div>
                        <div style={{ fontSize:10, color:"#64748b", background:"#f1f5f9", padding:"2px 8px", borderRadius:4, fontWeight:600 }}>{ROLES.find(r=>r.code===u.role)?.label}</div>
                        {isHonbu && <span style={{ fontSize:12, color:"#94a3b8" }}>›</span>}
                      </div>
                    ))}
                  </div>
                );
              }
            })()}

            {/* メンバー詳細モーダル（本部役員のみ） */}
            {selectedMember && isHonbu && (
              <div onClick={()=>{setSelectedMember(null);setConfirmDelete(null);}} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", zIndex:9999, display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}>
                <div onClick={e=>e.stopPropagation()} style={{ background:"white", borderRadius:20, padding:"24px 20px", width:"100%", maxWidth:380, maxHeight:"80vh", overflow:"auto" }}>
                  <div style={{ textAlign:"center", marginBottom:16 }}>
                    <div style={{ fontSize:48, marginBottom:8 }}>{selectedMember.avatar}</div>
                    <div style={{ fontWeight:800, fontSize:18, color:"#0f172a" }}>{selectedMember.name}</div>
                    <div style={{ fontSize:13, color:"#64748b", marginTop:4 }}>{ROLES.find(r=>r.code===selectedMember.role)?.label || selectedMember.role}</div>
                  </div>

                  <div style={{ background:"#f8fafc", borderRadius:12, padding:16, marginBottom:12 }}>
                    <div style={{ fontWeight:700, fontSize:13, color:"#0f172a", marginBottom:10 }}>登録情報</div>
                    {[
                      { label:"カテゴリ", value: selectedMember.category },
                      { label:"メールアドレス", value: selectedMember.email },
                      { label:"地区", value: selectedMember.district },
                      { label:"役職", value: selectedMember.position },
                      { label:"PTA役割", value: selectedMember.role },
                    ].filter(item => item.value).map((item, i) => (
                      <div key={i} style={{ display:"flex", justifyContent:"space-between", padding:"6px 0", borderBottom:"1px solid #e5e7eb", fontSize:13 }}>
                        <span style={{ color:"#64748b" }}>{item.label}</span>
                        <span style={{ color:"#0f172a", fontWeight:600 }}>{item.value}</span>
                      </div>
                    ))}
                  </div>

                  {selectedMember.children && selectedMember.children.length > 0 && (
                    <div style={{ background:"#f0fdf4", borderRadius:12, padding:16, marginBottom:12 }}>
                      <div style={{ fontWeight:700, fontSize:13, color:"#0f172a", marginBottom:10 }}>お子さま情報</div>
                      {selectedMember.children.map((child, i) => (
                        <div key={i} style={{ padding:"8px 0", borderBottom: i < selectedMember.children.length - 1 ? "1px solid #d1fae5" : "none" }}>
                          <div style={{ fontWeight:700, fontSize:13, color:"#0f172a" }}>{child.name}</div>
                          <div style={{ fontSize:12, color:"#64748b", marginTop:2 }}>
                            {[child.school, child.grade, child.class_, child.club].filter(Boolean).join(" / ")}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {selectedMember.createdAt && (
                    <div style={{ fontSize:11, color:"#94a3b8", textAlign:"center", marginBottom:12 }}>
                      登録日: {new Date(selectedMember.createdAt).toLocaleDateString("ja-JP")}
                    </div>
                  )}

                  {/* 削除ボタン（本部役員のみ、自分自身は削除不可） */}
                  {selectedMember.id !== currentUser.id && (
                    <div>
                      {confirmDelete === selectedMember.id ? (
                        <div style={{ background:"#fef2f2", borderRadius:12, padding:16, textAlign:"center" }}>
                          <div style={{ fontWeight:700, fontSize:13, color:"#dc2626", marginBottom:10 }}>「{selectedMember.name}」を削除しますか？</div>
                          <div style={{ fontSize:11, color:"#64748b", marginBottom:12 }}>この操作は取り消せません</div>
                          <div style={{ display:"flex", gap:8, justifyContent:"center" }}>
                            <button onClick={()=>setConfirmDelete(null)} style={{ padding:"8px 20px", borderRadius:8, border:"2px solid #e5e7eb", background:"white", color:"#64748b", fontWeight:700, fontSize:13, cursor:"pointer" }}>キャンセル</button>
                            <button onClick={()=>handleDeleteMember(selectedMember.id)} style={{ padding:"8px 20px", borderRadius:8, border:"none", background:"#dc2626", color:"white", fontWeight:700, fontSize:13, cursor:"pointer" }}>削除する</button>
                          </div>
                        </div>
                      ) : (
                        <button onClick={()=>setConfirmDelete(selectedMember.id)} style={{ width:"100%", padding:"10px", borderRadius:10, border:"2px solid #fecaca", background:"#fef2f2", color:"#dc2626", fontWeight:700, fontSize:13, cursor:"pointer" }}>🗑 このメンバーを削除</button>
                      )}
                    </div>
                  )}

                  <button onClick={()=>{setSelectedMember(null);setConfirmDelete(null);}} style={{ width:"100%", padding:"12px", borderRadius:10, border:"none", background:"#f1f5f9", color:"#64748b", fontWeight:700, fontSize:14, cursor:"pointer", marginTop:12 }}>閉じる</button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ④ 資料管理 */}
        {tab === "documents" && (
          <div style={{ background:"white", borderRadius:16, padding:"20px", boxShadow:"0 2px 12px rgba(0,0,0,0.06)" }}>
            <div style={{ fontWeight:800, fontSize:15, color:"#0f172a", marginBottom:4 }}>📁 資料・フォーマット管理</div>
            <div style={{ fontSize:12, color:"#64748b", marginBottom:16 }}>会議資料やテンプレートを保管できます</div>

            {/* 既存ドキュメント一覧 */}
            {documents.length === 0 ? (
              <div style={{ textAlign:"center", color:"#94a3b8", fontSize:13, padding:"20px 0" }}>まだ資料が登録されていません</div>
            ) : (
              <div style={{ marginBottom:16 }}>
                {documents.map(doc => (
                  <div key={doc.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 12px", borderRadius:10, background:"#f8fafc", marginBottom:4 }}>
                    <span style={{ fontSize:18 }}>📄</span>
                    <div style={{ flex:1 }}>
                      <div style={{ fontWeight:700, fontSize:13, color:"#0f172a" }}>{doc.name}</div>
                      <div style={{ fontSize:10, color:"#94a3b8" }}>{doc.category} ・ {doc.createdAt} ・ {doc.author}</div>
                    </div>
                    <button onClick={()=>removeDocument(doc.id)} style={{ background:"#fef2f2", color:"#dc2626", border:"none", borderRadius:6, padding:"4px 8px", fontSize:11, fontWeight:700, cursor:"pointer" }}>削除</button>
                  </div>
                ))}
              </div>
            )}

            {/* 新規登録フォーム */}
            <div style={{ borderTop:"1px solid #e5e7eb", paddingTop:16 }}>
              <div style={{ fontSize:13, fontWeight:700, color:"#64748b", marginBottom:8 }}>新しい資料を登録</div>
              <input value={newDocName} onChange={e=>setNewDocName(e.target.value)} placeholder="資料名（例：PTA総会議事録テンプレート）" style={{ width:"100%", padding:"10px", borderRadius:8, border:"2px solid #e5e7eb", fontSize:13, marginBottom:8 }}/>
              <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:10 }}>
                {["会議資料","テンプレート","規約・規程","報告書","その他"].map(cat => (
                  <button key={cat} onClick={()=>setNewDocCat(cat)} style={{ padding:"6px 12px", borderRadius:8, border:`2px solid ${newDocCat===cat?"#d97706":"#e5e7eb"}`, background:newDocCat===cat?"#d9770618":"white", color:newDocCat===cat?"#d97706":"#64748b", fontSize:11, fontWeight:700, cursor:"pointer" }}>{cat}</button>
                ))}
              </div>
              <button onClick={addDocument} disabled={!newDocName.trim()} style={{ width:"100%", padding:"12px", borderRadius:10, border:"none", background:newDocName.trim()?"linear-gradient(135deg,#d97706,#b45309)":"#e5e7eb", color:"white", fontWeight:800, fontSize:14, cursor:newDocName.trim()?"pointer":"not-allowed" }}>＋ 資料を登録</button>
            </div>
          </div>
        )}

        {/* ⑤ 文書発行 */}
        {tab === "publish" && (
          <div style={{ background:"white", borderRadius:16, padding:"20px", boxShadow:"0 2px 12px rgba(0,0,0,0.06)" }}>
            {publishMsg && (<div style={{ background:"#059669", color:"white", padding:"10px 16px", borderRadius:12, fontSize:13, fontWeight:700, marginBottom:12, textAlign:"center" }}>{publishMsg}</div>)}

            {/* パンくずリスト */}
            {publishNav.length > 0 && (
              <div style={{ display:"flex", alignItems:"center", gap:4, marginBottom:12, flexWrap:"wrap" }}>
                <button onClick={()=>navTo([])} style={{ background:"none", border:"none", color:"#0284c7", fontWeight:700, fontSize:12, cursor:"pointer", padding:0 }}>文書発行</button>
                {publishNav.map((seg, i) => {
                  const labels = { "committee":"運営委員会", "unei_1":"第１回", "unei_2":"第２回", "unei_3":"第３回", "unei_4":"第４回", "sidai":"次第", "meibo":"本部役員名簿", "meibo_link":"本部役員名簿", "katsudou":"活動報告", "kaikei":"会計報告書", "yosan":"予算案", "keikaku":"活動計画案", "hosoku":"総会資料補足説明", "hosoku_edit":"総会資料補足説明", "soukai":"総会資料" };
                  return (<span key={i} style={{ display:"flex", alignItems:"center", gap:4 }}>
                    <span style={{ color:"#94a3b8", fontSize:12 }}>›</span>
                    <button onClick={()=>navTo(publishNav.slice(0, i+1))} style={{ background:"none", border:"none", color: i===publishNav.length-1 ? "#0f172a" : "#0284c7", fontWeight:700, fontSize:12, cursor:"pointer", padding:0 }}>
                      {labels[seg] || seg}
                    </button>
                  </span>);
                })}
              </div>
            )}

            {/* 階層0: 文書カテゴリ一覧 */}
            {publishNav.length === 0 && (
              <div>
                <div style={{ fontWeight:800, fontSize:15, color:"#0f172a", marginBottom:4 }}>📄 文書発行</div>
                <div style={{ fontSize:12, color:"#64748b", marginBottom:16 }}>文書カテゴリを選択してください</div>
                {[
                  { id:"committee", label:"運営委員会", icon:"🏛️", desc:"運営委員会の各種文書" },
                  { id:"soukai", label:"総会資料", icon:"📚", desc:"PTA総会資料の自動生成" },
                ].map(cat => (
                  <div key={cat.id} onClick={()=>navTo([cat.id])} style={{ display:"flex", alignItems:"center", gap:12, padding:"16px", borderRadius:12, background:"#f8fafc", cursor:"pointer", border:"2px solid #e5e7eb", marginBottom:8 }}>
                    <span style={{ fontSize:28 }}>{cat.icon}</span>
                    <div style={{ flex:1 }}>
                      <div style={{ fontWeight:700, fontSize:14, color:"#0f172a" }}>{cat.label}</div>
                      <div style={{ fontSize:11, color:"#94a3b8" }}>{cat.desc}</div>
                    </div>
                    <span style={{ color:"#cbd5e1", fontSize:20 }}>›</span>
                  </div>
                ))}
              </div>
            )}

            {/* 階層1: 運営委員会 → 回次一覧 */}
            {publishNav.length === 1 && publishNav[0] === "committee" && (
              <div>
                <div style={{ fontWeight:800, fontSize:15, color:"#0f172a", marginBottom:4 }}>🏛️ 運営委員会</div>
                <div style={{ fontSize:12, color:"#64748b", marginBottom:16 }}>回次を選択してください</div>
                {[
                  { id:"unei_1", label:"第１回運営委員会", kai:"第１回", desc:"4月開催" },
                  { id:"unei_2", label:"第２回運営委員会", kai:"第２回", desc:"6月開催" },
                  { id:"unei_3", label:"第３回運営委員会", kai:"第３回", desc:"10月開催" },
                  { id:"unei_4", label:"第４回運営委員会", kai:"第４回", desc:"2月開催" },
                ].map(item => {
                  const fk = `unei_${item.id}`;
                  const hasData = !!publishForms?.[fk]?.date;
                  return (
                    <div key={item.id} onClick={()=>navTo(["committee", item.id])} style={{ display:"flex", alignItems:"center", gap:12, padding:"14px", borderRadius:12, background:"#f8fafc", cursor:"pointer", border:"2px solid #e5e7eb", marginBottom:6 }}>
                      <span style={{ fontSize:22 }}>📋</span>
                      <div style={{ flex:1 }}>
                        <div style={{ fontWeight:700, fontSize:14, color:"#0f172a" }}>{item.label}</div>
                        <div style={{ fontSize:11, color:"#94a3b8" }}>{item.desc}{hasData ? " ✅ 入力済" : ""}</div>
                      </div>
                      <span style={{ color:"#cbd5e1", fontSize:20 }}>›</span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* 階層1: 総会資料 — タブ一覧 */}
            {publishNav.length === 1 && publishNav[0] === "soukai" && (
              <div>
                <div style={{ fontWeight:800, fontSize:15, color:"#0f172a", marginBottom:4 }}>📚 総会資料</div>
                <div style={{ fontSize:12, color:"#64748b", marginBottom:16 }}>総会資料の各セクションを編集できます</div>

                {[
                  { id:"mokuji", label:"総会資料目次", icon:"📑", desc:"表紙・目次の作成" },
                  { id:"meibo_link", label:"本部役員名簿", icon:"👥", desc:"PTA本部役員名簿" },
                  { id:"hosoku_link", label:"総会資料補足説明", icon:"📝", desc:"議案ごとの補足説明" },
                  { id:"gian1", label:"第1号議案　活動報告について", icon:"📊", desc:"各委員会の活動報告", prefix:"katsudou_unei_1_" },
                  { id:"gian2", label:"第2号議案　決算及び監査報告", icon:"💰", desc:"会計報告書・決算書" },
                  { id:"gian3", label:"第3号議案　活動計画(案)について", icon:"📅", desc:"各委員会の活動計画案", prefix:"keikaku_unei_1_" },
                  { id:"gian4", label:"第4号議案　予算(案)について", icon:"📋", desc:"会計予算案" },
                  { id:"houkoku", label:"報告・連絡", icon:"📌", desc:"八木山中学校の取組・その他配布資料" },
                ].map((doc, idx) => {
                  let ready = false;
                  let detail = "";
                  if (doc.id === "mokuji") { ready = !!publishForms?.soukai_mokuji; detail = ready ? "✅ 作成済み" : "⬜ 未作成"; }
                  else if (doc.id === "meibo_link") { ready = !!publishForms?.["meibo_unei_1"]; detail = ready ? "✅ 作成済み" : "⬜ 未作成"; }
                  else if (doc.id === "hosoku_link") { ready = !!publishForms?.["hosoku_unei_1"]; detail = ready ? "✅ 作成済み" : "⬜ 未作成"; }
                  else if (doc.id === "gian2") { const c = (publishForms?.soukai_gian2?.files||[]).length; ready = c>0; detail = ready ? `✅ ${c}件` : "未登録"; }
                  else if (doc.id === "gian4") { const c = (publishForms?.soukai_gian4?.files||[]).length; ready = c>0; detail = ready ? `✅ ${c}件` : "未登録"; }
                  else if (doc.prefix) { const c = Object.keys(publishForms||{}).filter(k=>k.startsWith(doc.prefix)).length; ready = c>0; detail = ready ? `✅ ${c}件` : "⬜ 未作成"; }
                  else if (doc.id === "houkoku") { const c = (publishForms?.soukai_houkoku?.files||[]).length; ready = c>0; detail = ready ? `✅ ${c}件` : "未登録"; }
                  return (
                    <div key={idx} onClick={()=>navTo(["soukai", doc.id])} style={{ display:"flex", alignItems:"center", gap:10, padding:"12px", borderRadius:10, background:"white", border:`1.5px solid ${ready ? "#059669" : "#e5e7eb"}`, marginBottom:4, cursor:"pointer" }}>
                      <span style={{ fontSize:20 }}>{doc.icon}</span>
                      <div style={{ flex:1 }}>
                        <div style={{ fontWeight:700, fontSize:13, color:"#0f172a" }}>{doc.label}</div>
                        <div style={{ fontSize:10, color:"#94a3b8" }}>{doc.desc}</div>
                      </div>
                      <div style={{ fontSize:10, fontWeight:700, color: ready ? "#059669" : "#94a3b8", flexShrink:0 }}>{detail}</div>
                      <span style={{ color:"#cbd5e1", fontSize:18 }}>›</span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* 階層2: 総会資料 → 各セクション */}
            {publishNav.length === 2 && publishNav[0] === "soukai" && (() => {
              const page = publishNav[1];

              // リンク系
              if (page === "meibo_link") {
                const fk = "meibo_unei_1";
                const form = publishForms?.[fk];
                return (
                  <div>
                    <div style={{ fontWeight:800, fontSize:15, color:"#0f172a", marginBottom:4 }}>👥 本部役員名簿</div>
                    <div style={{ fontSize:12, color:"#64748b", marginBottom:16 }}>第１回運営委員会で作成した本部役員名簿です</div>
                    {!form ? (
                      <div style={{ textAlign:"center", color:"#94a3b8", fontSize:13, padding:"30px 0", background:"#f8fafc", borderRadius:12, marginBottom:16 }}>
                        <div style={{ fontSize:28, marginBottom:8 }}>📭</div>
                        <div>まだ本部役員名簿が作成されていません</div>
                        <div style={{ fontSize:11, marginTop:6 }}>「運営委員会 → 第１回 → 本部役員名簿」から作成してください</div>
                      </div>
                    ) : (
                      <div>
                        <div style={{ padding:"14px", borderRadius:12, background:"white", border:"2px solid #e5e7eb", marginBottom:12 }}>
                          <div style={{ fontWeight:700, fontSize:14, color:"#0f172a", marginBottom:8 }}>{form.nendo} ＰＴＡ本部役員名簿</div>
                          <div style={{ fontSize:11, color:"#64748b", marginBottom:10 }}>{form.school}</div>
                          <div style={{ overflowX:"auto" }}>
                            <div style={{ display:"grid", gridTemplateColumns:"36px 70px 1fr 1fr", gap:2, padding:"6px 8px", background:"#d9770618", borderRadius:8, marginBottom:4 }}>
                              <div style={{ fontSize:10, fontWeight:800, color:"#d97706" }}>No</div>
                              <div style={{ fontSize:10, fontWeight:800, color:"#d97706" }}>役職</div>
                              <div style={{ fontSize:10, fontWeight:800, color:"#d97706" }}>氏名</div>
                              <div style={{ fontSize:10, fontWeight:800, color:"#d97706" }}>生徒名</div>
                            </div>
                            {(form.members||[]).map((m, idx) => (
                              <div key={idx} style={{ display:"grid", gridTemplateColumns:"36px 70px 1fr 1fr", gap:2, padding:"4px 8px", borderBottom:"1px solid #f1f5f9" }}>
                                <div style={{ fontSize:12, color:"#64748b", textAlign:"center" }}>{m.no}</div>
                                <div style={{ fontSize:11, fontWeight:700, color:"#0f172a" }}>{m.role}</div>
                                <div style={{ fontSize:12, color:"#0f172a" }}>{m.name}</div>
                                <div style={{ fontSize:12, color:"#0f172a" }}>{m.student}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div style={{ display:"flex", gap:8 }}>
                          <button onClick={()=>{
                            let html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + (form.nendo||"") + ' PTA本部役員名簿</title>';
                            html += '<style>@page{size:A4;margin:25mm 20mm 20mm 20mm}body{font-family:"Yu Mincho","YuMincho","Hiragino Mincho ProN",serif;color:#000;font-size:14px}';
                            html += '.title{text-align:center;font-size:20px;font-weight:bold;margin-bottom:6px}';
                            html += '.school{text-align:center;font-size:14px;margin-bottom:20px}';
                            html += 'table{width:100%;border-collapse:collapse;margin-top:10px}';
                            html += 'th,td{border:1px solid #333;padding:8px 10px;text-align:center;font-size:13px}';
                            html += 'th{background:#f5f5f5;font-weight:bold;font-size:12px}';
                            html += 'td.name{text-align:left;padding-left:14px}';
                            html += '@media print{body{-webkit-print-color-adjust:exact}}</style></head><body>';
                            html += '<div class="title">' + (form.nendo||"") + ' ＰＴＡ本部役員名簿</div>';
                            html += '<div class="school">' + (form.school||"") + '</div>';
                            html += '<table><thead><tr><th style="width:40px">№</th><th style="width:80px">役　職</th><th>氏　名</th><th>生　徒　名</th></tr></thead><tbody>';
                            (form.members||[]).forEach(m => { html += '<tr><td>' + m.no + '</td><td>' + m.role + '</td><td class="name">' + m.name + '</td><td class="name">' + m.student + '</td></tr>'; });
                            html += '</tbody></table></body></html>';
                            const pw = window.open("","_blank","width=800,height=1000");
                            if(pw){pw.document.write(html);pw.document.close();pw.focus();setTimeout(()=>pw.print(),500);}
                          }} style={{ flex:1, padding:"14px", borderRadius:12, border:"none", background:"linear-gradient(135deg,#d97706,#b45309)", color:"white", fontWeight:800, fontSize:15, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
                            🖨️ 出力（印刷 / 保存）
                          </button>
                          <button onClick={()=>{navTo(["committee","unei_1","meibo"]);}} style={{ padding:"14px 20px", borderRadius:12, border:"1.5px solid #e5e7eb", background:"white", color:"#64748b", fontWeight:800, fontSize:15, cursor:"pointer" }}>
                            ✏️ 編集
                          </button>
                        </div>
                        <div style={{ fontSize:11, color:"#94a3b8", textAlign:"center", marginTop:6 }}>印刷ダイアログで「印刷」または「PDFに保存」を選択できます</div>
                      </div>
                    )}
                    <div style={{ marginTop:12, padding:"10px 14px", borderRadius:10, background:"#f0f9ff", border:"1px solid #bae6fd", fontSize:11, color:"#0369a1" }}>
                      💡 名簿の編集は「運営委員会 → 第１回 → 本部役員名簿」から行えます。
                    </div>
                  </div>
                );
              }
              if (page === "hosoku_link") {
                const fk = "hosoku_unei_1";
                ensureHosokuForm(fk);
                navTo(["soukai","hosoku_edit"]);
                return null;
              }
              if (page === "gian1") {
                // 活動報告一覧を総会資料配下で表示（リダイレクトしない）
                const prefix = "katsudou_unei_1_";
                const existing = Object.keys(publishForms).filter(k => k.startsWith(prefix)).map(k => {
                  const data = publishForms[k];
                  return { key: k, committee: data.committee || k.replace(prefix, ""), data };
                });
                return (
                  <div>
                    <div style={{ fontWeight:800, fontSize:15, color:"#0f172a", marginBottom:4 }}>📊 第1号議案　令和６年度活動報告について</div>
                    <div style={{ fontSize:12, color:"#64748b", marginBottom:16 }}>運営委員会で作成した各委員会の活動報告一覧です。個別に出力できます。</div>
                    {existing.length === 0 ? (
                      <div style={{ textAlign:"center", color:"#94a3b8", fontSize:13, padding:"30px 0", background:"#f8fafc", borderRadius:12, marginBottom:16 }}>
                        <div style={{ fontSize:28, marginBottom:8 }}>📭</div>
                        <div>まだ活動報告が作成されていません</div>
                        <div style={{ fontSize:11, marginTop:6 }}>「運営委員会 → 第１回 → 活動報告」から作成してください</div>
                      </div>
                    ) : (
                      <div style={{ display:"flex", flexDirection:"column", gap:6, marginBottom:16 }}>
                        {existing.map(item => (
                          <div key={item.key} style={{ display:"flex", alignItems:"center", gap:10, padding:"12px 14px", borderRadius:12, background:"white", border:"2px solid #e5e7eb" }}>
                            <span style={{ fontSize:20 }}>📄</span>
                            <div style={{ flex:1 }}>
                              <div style={{ fontWeight:700, fontSize:14, color:"#0f172a" }}>ＰＴＡ（{item.committee}）委員会　活動報告</div>
                              <div style={{ fontSize:11, color:"#94a3b8" }}>{item.data.activities?.length || 0}件の活動記録{item.data.reflection ? " ／ 感想あり" : ""}</div>
                            </div>
                            <button onClick={()=>{
                              const cm = item.committee;
                              const f = item.data;
                              let html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>PTA（' + cm + '）委員会 活動報告</title>';
                              html += '<style>@page{size:A4;margin:20mm 15mm 15mm 15mm}body{font-family:"Yu Mincho","YuMincho","Hiragino Mincho ProN",serif;color:#000;font-size:13px;line-height:1.6}';
                              html += '.header{text-align:right;font-size:16px;font-weight:bold;margin-bottom:16px}';
                              html += 'table{width:100%;border-collapse:collapse}th,td{border:1px solid #333;padding:6px 8px;font-size:12px}';
                              html += 'th{background:#f5f5f5;font-weight:bold;text-align:center}td.center{text-align:center}td.content{text-align:left}';
                              html += '.section{font-weight:bold;font-size:14px;margin-top:20px;margin-bottom:8px}';
                              html += '.reflection{border:1px solid #333;padding:12px;min-height:120px;font-size:12px;line-height:1.8;white-space:pre-wrap}';
                              html += '@media print{body{-webkit-print-color-adjust:exact}}</style></head><body>';
                              html += '<div class="header">ＰＴＡ（　' + cm + '　）委員会 活動報告</div>';
                              html += '<div class="section">【活動報告】</div>';
                              html += '<table><thead><tr><th style="width:35px">月</th><th style="width:30px">日</th><th>活動報告</th></tr></thead><tbody>';
                              (f.activities||[]).forEach(a => { html += '<tr><td class="center">' + a.month + '</td><td class="center">' + a.day + '</td><td class="content">' + a.content + '</td></tr>'; });
                              html += '</tbody></table>';
                              html += '<div class="section">【感想・反省、次年度への提案等】</div>';
                              html += '<div class="reflection">' + (f.reflection||"").replace(/\n/g,"<br/>") + '</div>';
                              html += '</body></html>';
                              const pw = window.open("","_blank","width=800,height=1000");
                              if(pw){pw.document.write(html);pw.document.close();pw.focus();setTimeout(()=>pw.print(),500);}
                            }} style={{ padding:"8px 14px", borderRadius:8, border:"none", background:"linear-gradient(135deg,#d97706,#b45309)", color:"white", fontWeight:700, fontSize:11, cursor:"pointer", flexShrink:0, display:"flex", alignItems:"center", gap:4 }}>
                              🖨️ 出力
                            </button>
                            <button onClick={()=>{navTo(["committee","unei_1","katsudou",item.committee]);}} style={{ padding:"8px 10px", borderRadius:8, border:"1.5px solid #e5e7eb", background:"white", color:"#64748b", fontWeight:700, fontSize:11, cursor:"pointer", flexShrink:0 }}>
                              ✏️ 編集
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    {existing.length > 0 && (
                      <button onClick={()=>{
                        existing.forEach(item => {
                          const cm = item.committee;
                          const f = item.data;
                          let html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>PTA（' + cm + '）委員会 活動報告</title>';
                          html += '<style>@page{size:A4;margin:20mm 15mm 15mm 15mm}body{font-family:"Yu Mincho","YuMincho","Hiragino Mincho ProN",serif;color:#000;font-size:13px;line-height:1.6}';
                          html += '.header{text-align:right;font-size:16px;font-weight:bold;margin-bottom:16px}';
                          html += 'table{width:100%;border-collapse:collapse}th,td{border:1px solid #333;padding:6px 8px;font-size:12px}';
                          html += 'th{background:#f5f5f5;font-weight:bold;text-align:center}td.center{text-align:center}td.content{text-align:left}';
                          html += '.section{font-weight:bold;font-size:14px;margin-top:20px;margin-bottom:8px}';
                          html += '.reflection{border:1px solid #333;padding:12px;min-height:120px;font-size:12px;line-height:1.8;white-space:pre-wrap}';
                          html += '@media print{body{-webkit-print-color-adjust:exact}}</style></head><body>';
                          html += '<div class="header">ＰＴＡ（　' + cm + '　）委員会 活動報告</div>';
                          html += '<div class="section">【活動報告】</div>';
                          html += '<table><thead><tr><th style="width:35px">月</th><th style="width:30px">日</th><th>活動報告</th></tr></thead><tbody>';
                          (f.activities||[]).forEach(a => { html += '<tr><td class="center">' + a.month + '</td><td class="center">' + a.day + '</td><td class="content">' + a.content + '</td></tr>'; });
                          html += '</tbody></table>';
                          html += '<div class="section">【感想・反省、次年度への提案等】</div>';
                          html += '<div class="reflection">' + (f.reflection||"").replace(/\n/g,"<br/>") + '</div>';
                          html += '<div style="page-break-after:always"></div>';
                          html += '</body></html>';
                          const pw = window.open("","_blank","width=800,height=1000");
                          if(pw){pw.document.write(html);pw.document.close();pw.focus();setTimeout(()=>pw.print(),500);}
                        });
                        setPublishMsg("全" + existing.length + "件の活動報告を出力しました");
                        setTimeout(()=>setPublishMsg(null),4000);
                      }} style={{ width:"100%", padding:"14px", borderRadius:12, border:"none", background:"linear-gradient(135deg,#059669,#047857)", color:"white", fontWeight:800, fontSize:15, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
                        🖨️ 全{existing.length}件を一括出力
                      </button>
                    )}
                    <div style={{ marginTop:12, padding:"10px 14px", borderRadius:10, background:"#f0f9ff", border:"1px solid #bae6fd", fontSize:11, color:"#0369a1" }}>
                      💡 活動報告の作成・編集は「運営委員会 → 第１回 → 活動報告」から行えます。「編集」ボタンで直接ジャンプも可能です。
                    </div>
                  </div>
                );
              }
              if (page === "gian2") {
                const gian2Data = publishForms?.soukai_gian2 || { files:[] };
                if (!publishForms?.soukai_gian2) {
                  setPublishForms(prev => ({...prev, soukai_gian2: { files:[] }}));
                }
                return (
                <div>
                  <div style={{ fontSize:14, fontWeight:800, color:"#0f172a", marginBottom:4 }}>💰 第2号議案　令和６年度決算及び監査報告</div>
                  <div style={{ fontSize:12, color:"#64748b", marginBottom:16 }}>PTA会計報告書・周年基金会計決算書・文化体育後援会会計決算書等のPDFを管理します</div>

                  {(gian2Data.files||[]).length > 0 ? (
                    <div style={{ marginBottom:16 }}>
                      {gian2Data.files.map((f, idx) => (
                        <div key={idx} style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 12px", borderRadius:10, background:"white", border:"1.5px solid #e5e7eb", marginBottom:4 }}>
                          <span style={{ fontSize:18 }}>📄</span>
                          <div style={{ flex:1 }}>
                            <div style={{ fontWeight:600, fontSize:13, color:"#0f172a" }}>{f.name}</div>
                            <div style={{ fontSize:10, color:"#94a3b8" }}>{f.size} ・ {f.addedAt}</div>
                          </div>
                          <button onClick={()=>{
                            setPublishForms(prev => {
                              const cur = prev.soukai_gian2 || {files:[]};
                              return {...prev, soukai_gian2: {...cur, files: cur.files.filter((_,i)=>i!==idx)}};
                            });
                          }} style={{ background:"#fef2f2", color:"#dc2626", border:"none", borderRadius:6, padding:"4px 8px", fontSize:10, fontWeight:700, cursor:"pointer" }}>削除</button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ textAlign:"center", color:"#94a3b8", fontSize:13, padding:"24px 0", marginBottom:16 }}>まだ資料が登録されていません</div>
                  )}

                  <button onClick={()=>{
                    const input = document.createElement("input");
                    input.type = "file"; input.accept = ".pdf"; input.multiple = true;
                    input.onchange = (ev) => {
                      const files = Array.from(ev.target.files || []);
                      if (files.length === 0) return;
                      const newFiles = files.map(f => ({
                        name: f.name,
                        size: f.size > 1024*1024 ? `${(f.size/1024/1024).toFixed(1)}MB` : `${Math.round(f.size/1024)}KB`,
                        addedAt: new Date().toLocaleDateString("ja-JP"),
                      }));
                      setPublishForms(prev => {
                        const cur = prev.soukai_gian2 || {files:[]};
                        return {...prev, soukai_gian2: {...cur, files: [...cur.files, ...newFiles]}};
                      });
                      setPublishMsg(`${files.length}件のPDFファイルを登録しました`);
                      setTimeout(()=>setPublishMsg(null), 3000);
                    };
                    input.click();
                  }} style={{ width:"100%", padding:"14px", borderRadius:12, border:"2px dashed #0284c7", background:"white", color:"#0284c7", fontWeight:800, fontSize:14, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
                    📤 PDFファイルをインポート
                  </button>
                  <div style={{ fontSize:10, color:"#94a3b8", marginTop:6, textAlign:"center" }}>複数ファイル選択可能。PTA会計報告書、周年基金会計決算書、文化体育後援会会計決算書等</div>
                </div>
                );
              }
              if (page === "gian3") {
                const prefix = "keikaku_unei_1_";
                const existing = Object.keys(publishForms).filter(k => k.startsWith(prefix)).map(k => {
                  const data = publishForms[k];
                  return { key: k, committee: data.committee || k.replace(prefix, ""), data };
                });
                return (
                  <div>
                    <div style={{ fontWeight:800, fontSize:15, color:"#0f172a", marginBottom:4 }}>📅 第3号議案　令和７年度活動計画（案）について</div>
                    <div style={{ fontSize:12, color:"#64748b", marginBottom:16 }}>運営委員会で作成した各委員会の活動計画案一覧です。個別に出力できます。</div>
                    {existing.length === 0 ? (
                      <div style={{ textAlign:"center", color:"#94a3b8", fontSize:13, padding:"30px 0", background:"#f8fafc", borderRadius:12, marginBottom:16 }}>
                        <div style={{ fontSize:28, marginBottom:8 }}>📭</div>
                        <div>まだ活動計画案が作成されていません</div>
                        <div style={{ fontSize:11, marginTop:6 }}>「運営委員会 → 第１回 → 活動計画案」から作成してください</div>
                      </div>
                    ) : (
                      <div style={{ display:"flex", flexDirection:"column", gap:6, marginBottom:16 }}>
                        {existing.map(item => (
                          <div key={item.key} style={{ display:"flex", alignItems:"center", gap:10, padding:"12px 14px", borderRadius:12, background:"white", border:"2px solid #e5e7eb" }}>
                            <span style={{ fontSize:20 }}>📄</span>
                            <div style={{ flex:1 }}>
                              <div style={{ fontWeight:700, fontSize:14, color:"#0f172a" }}>{item.data.nendo || "令和７年度"} {item.data.title || `${item.committee}委員会年間活動計画（案）`}</div>
                              <div style={{ fontSize:11, color:"#94a3b8" }}>{item.data.activities?.length || 0}件の活動計画{item.data.note ? " ／ 備考あり" : ""}</div>
                            </div>
                            <button onClick={()=>{
                              const f = item.data;
                              let html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + (f.nendo||"") + ' ' + (f.title||"") + '</title>';
                              html += '<style>@page{size:A4;margin:20mm 15mm 15mm 15mm}body{font-family:"Yu Mincho","YuMincho","Hiragino Mincho ProN",serif;color:#000;font-size:13px;line-height:1.6}';
                              html += '.title{text-align:center;font-size:20px;font-weight:bold;margin-bottom:20px}';
                              html += 'table{width:100%;border-collapse:collapse;margin-bottom:16px}th,td{border:1px solid #333;padding:6px 8px;font-size:12px}';
                              html += 'th{background:#f5f5f5;font-weight:bold;text-align:center}td.center{text-align:center}td.content{text-align:left}';
                              html += '.section{font-weight:bold;font-size:14px;margin-top:16px;margin-bottom:8px}';
                              html += '.note-box{border:1px solid #333;padding:12px;min-height:80px;font-size:12px;line-height:1.8;white-space:pre-wrap}';
                              html += '@media print{body{-webkit-print-color-adjust:exact}}</style></head><body>';
                              html += '<div class="title">' + (f.nendo||"") + ' ' + (f.title||"") + '</div>';
                              html += '<div class="section">【活動計画】</div>';
                              html += '<table><thead><tr><th style="width:35px">月</th><th style="width:30px">日</th><th>活動内容</th></tr></thead><tbody>';
                              (f.activities||[]).forEach(a => { html += '<tr><td class="center">' + (a.month||"") + '</td><td class="center">' + (a.day||"") + '</td><td class="content">' + (a.content||"") + '</td></tr>'; });
                              html += '</tbody></table>';
                              if (f.note) { html += '<div class="section">【備考】</div><div class="note-box">' + (f.note||"").replace(/\n/g,"<br/>") + '</div>'; }
                              html += '</body></html>';
                              const pw = window.open("","_blank","width=800,height=1000");
                              if(pw){pw.document.write(html);pw.document.close();pw.focus();setTimeout(()=>pw.print(),500);}
                            }} style={{ padding:"8px 14px", borderRadius:8, border:"none", background:"linear-gradient(135deg,#d97706,#b45309)", color:"white", fontWeight:700, fontSize:11, cursor:"pointer", flexShrink:0, display:"flex", alignItems:"center", gap:4 }}>
                              🖨️ 出力
                            </button>
                            <button onClick={()=>{navTo(["committee","unei_1","keikaku",item.committee]);}} style={{ padding:"8px 10px", borderRadius:8, border:"1.5px solid #e5e7eb", background:"white", color:"#64748b", fontWeight:700, fontSize:11, cursor:"pointer", flexShrink:0 }}>
                              ✏️ 編集
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    {existing.length > 0 && (
                      <button onClick={()=>{
                        existing.forEach(item => {
                          const f = item.data;
                          let html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + (f.nendo||"") + ' ' + (f.title||"") + '</title>';
                          html += '<style>@page{size:A4;margin:20mm 15mm 15mm 15mm}body{font-family:"Yu Mincho","YuMincho","Hiragino Mincho ProN",serif;color:#000;font-size:13px;line-height:1.6}';
                          html += '.title{text-align:center;font-size:20px;font-weight:bold;margin-bottom:20px}';
                          html += 'table{width:100%;border-collapse:collapse;margin-bottom:16px}th,td{border:1px solid #333;padding:6px 8px;font-size:12px}';
                          html += 'th{background:#f5f5f5;font-weight:bold;text-align:center}td.center{text-align:center}td.content{text-align:left}';
                          html += '.section{font-weight:bold;font-size:14px;margin-top:16px;margin-bottom:8px}';
                          html += '.note-box{border:1px solid #333;padding:12px;min-height:80px;font-size:12px;line-height:1.8;white-space:pre-wrap}';
                          html += '@media print{body{-webkit-print-color-adjust:exact}}</style></head><body>';
                          html += '<div class="title">' + (f.nendo||"") + ' ' + (f.title||"") + '</div>';
                          html += '<div class="section">【活動計画】</div>';
                          html += '<table><thead><tr><th style="width:35px">月</th><th style="width:30px">日</th><th>活動内容</th></tr></thead><tbody>';
                          (f.activities||[]).forEach(a => { html += '<tr><td class="center">' + (a.month||"") + '</td><td class="center">' + (a.day||"") + '</td><td class="content">' + (a.content||"") + '</td></tr>'; });
                          html += '</tbody></table>';
                          if (f.note) { html += '<div class="section">【備考】</div><div class="note-box">' + (f.note||"").replace(/\n/g,"<br/>") + '</div>'; }
                          html += '<div style="page-break-after:always"></div></body></html>';
                          const pw = window.open("","_blank","width=800,height=1000");
                          if(pw){pw.document.write(html);pw.document.close();pw.focus();setTimeout(()=>pw.print(),500);}
                        });
                        setPublishMsg("全" + existing.length + "件の活動計画案を出力しました");
                        setTimeout(()=>setPublishMsg(null),4000);
                      }} style={{ width:"100%", padding:"14px", borderRadius:12, border:"none", background:"linear-gradient(135deg,#059669,#047857)", color:"white", fontWeight:800, fontSize:15, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
                        🖨️ 全{existing.length}件を一括出力
                      </button>
                    )}
                    <div style={{ marginTop:12, padding:"10px 14px", borderRadius:10, background:"#f0f9ff", border:"1px solid #bae6fd", fontSize:11, color:"#0369a1" }}>
                      💡 活動計画案の作成・編集は「運営委員会 → 第１回 → 活動計画案」から行えます。「編集」ボタンで直接ジャンプも可能です。
                    </div>
                  </div>
                );
              }
              if (page === "gian4") {
                const gian4Data = publishForms?.soukai_gian4 || { files:[] };
                if (!publishForms?.soukai_gian4) {
                  setPublishForms(prev => ({...prev, soukai_gian4: { files:[] }}));
                }
                return (
                <div>
                  <div style={{ fontSize:14, fontWeight:800, color:"#0f172a", marginBottom:4 }}>📋 第4号議案　令和７年度予算（案）について</div>
                  <div style={{ fontSize:12, color:"#64748b", marginBottom:16 }}>PTA会計予算案・文化体育後援会会計予算案等のPDFを管理します</div>

                  {(gian4Data.files||[]).length > 0 ? (
                    <div style={{ marginBottom:16 }}>
                      {gian4Data.files.map((f, idx) => (
                        <div key={idx} style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 12px", borderRadius:10, background:"white", border:"1.5px solid #e5e7eb", marginBottom:4 }}>
                          <span style={{ fontSize:18 }}>📄</span>
                          <div style={{ flex:1 }}>
                            <div style={{ fontWeight:600, fontSize:13, color:"#0f172a" }}>{f.name}</div>
                            <div style={{ fontSize:10, color:"#94a3b8" }}>{f.size} ・ {f.addedAt}</div>
                          </div>
                          <button onClick={()=>{
                            setPublishForms(prev => {
                              const cur = prev.soukai_gian4 || {files:[]};
                              return {...prev, soukai_gian4: {...cur, files: cur.files.filter((_,i)=>i!==idx)}};
                            });
                          }} style={{ background:"#fef2f2", color:"#dc2626", border:"none", borderRadius:6, padding:"4px 8px", fontSize:10, fontWeight:700, cursor:"pointer" }}>削除</button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ textAlign:"center", color:"#94a3b8", fontSize:13, padding:"24px 0", marginBottom:16 }}>まだ資料が登録されていません</div>
                  )}

                  <button onClick={()=>{
                    const input = document.createElement("input");
                    input.type = "file"; input.accept = ".pdf"; input.multiple = true;
                    input.onchange = (ev) => {
                      const files = Array.from(ev.target.files || []);
                      if (files.length === 0) return;
                      const newFiles = files.map(f => ({
                        name: f.name,
                        size: f.size > 1024*1024 ? `${(f.size/1024/1024).toFixed(1)}MB` : `${Math.round(f.size/1024)}KB`,
                        addedAt: new Date().toLocaleDateString("ja-JP"),
                      }));
                      setPublishForms(prev => {
                        const cur = prev.soukai_gian4 || {files:[]};
                        return {...prev, soukai_gian4: {...cur, files: [...cur.files, ...newFiles]}};
                      });
                      setPublishMsg(`${files.length}件のPDFファイルを登録しました`);
                      setTimeout(()=>setPublishMsg(null), 3000);
                    };
                    input.click();
                  }} style={{ width:"100%", padding:"14px", borderRadius:12, border:"2px dashed #0284c7", background:"white", color:"#0284c7", fontWeight:800, fontSize:14, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
                    📤 PDFファイルをインポート
                  </button>
                  <div style={{ fontSize:10, color:"#94a3b8", marginTop:6, textAlign:"center" }}>複数ファイル選択可能。PTA会計予算案、文化体育後援会会計予算案等</div>
                </div>
                );
              }

              // 総会資料目次
              if (page === "mokuji") {
                const defaultMokuji = {
                  nendo:"令和８年度", school:"仙台市立八木山中学校ＰＴＡ",
                  items:[
                    { type:"kyougi", label:"１．協　議" },
                    { type:"gian", number:"第１号議案", title:"令和７年度活動報告について", page:"1～9" },
                    { type:"gian", number:"第２号議案", title:"令和７年度決算および監査報告", page:"10～13" },
                    { type:"gian", number:"第３号議案", title:"令和８年度活動計画（案）について", page:"14～18" },
                    { type:"gian", number:"第４号議案", title:"令和８年度予算（案）について", page:"19～21" },
                    { type:"kyougi", label:"２．報告・連絡" },
                    { type:"item", title:"令和７年度八木山中学校の取組", page:"22～25" },
                    { type:"sub", indent:true, title:"「地域見守りあいさつ運動」のお願い", page:"" },
                    { type:"sub", indent:true, title:"みんなでチャレンジ！安全・安心なまちづくり", page:"" },
                    { type:"item", title:"仙台市ＰＴＡ協議会会費について", page:"26" },
                    { type:"item", title:"杜の都こども総合保険", page:"27" },
                    { type:"item", title:"仙台市ＰＴＡ協議会 傷害補償制度のご案内", page:"28" },
                    { type:"item", title:"三行詩募集", page:"29-30" },
                  ],
                };
                const form = publishForms?.soukai_mokuji || defaultMokuji;
                if (!publishForms?.soukai_mokuji) {
                  setPublishForms(prev => ({...prev, soukai_mokuji: defaultMokuji}));
                }
                const setMokuji = (updater) => {
                  setPublishForms(prev => {
                    const cur = prev.soukai_mokuji || {};
                    const next = typeof updater === "function" ? updater(cur) : updater;
                    return {...prev, soukai_mokuji: next};
                  });
                };
                return (
                <div>
                  <div style={{ fontSize:14, fontWeight:800, color:"#0f172a", marginBottom:12 }}>📑 総会資料目次</div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:16 }}>
                    <div>
                      <div style={{ fontSize:11, fontWeight:700, color:"#64748b", marginBottom:4 }}>年度</div>
                      <input value={form.nendo||""} onChange={e=>setMokuji(p=>({...p, nendo:e.target.value}))} style={{ width:"100%", padding:"10px", borderRadius:8, border:"2px solid #e5e7eb", fontSize:13 }}/>
                    </div>
                    <div>
                      <div style={{ fontSize:11, fontWeight:700, color:"#64748b", marginBottom:4 }}>学校名・団体名</div>
                      <input value={form.school||""} onChange={e=>setMokuji(p=>({...p, school:e.target.value}))} style={{ width:"100%", padding:"10px", borderRadius:8, border:"2px solid #e5e7eb", fontSize:13 }}/>
                    </div>
                  </div>

                  <div style={{ fontSize:13, fontWeight:700, color:"#0f172a", marginBottom:8, borderTop:"1px solid #e5e7eb", paddingTop:12 }}>目次項目</div>
                  {(form.items||[]).map((item, idx) => (
                    <div key={idx} style={{ display:"flex", gap:4, marginBottom:4, alignItems:"center", marginLeft: item.indent ? 20 : 0 }}>
                      <select value={item.type||"item"} onChange={e=>{const is=[...form.items];is[idx]={...is[idx],type:e.target.value};setMokuji(p=>({...p,items:is}));}} style={{ padding:"5px", borderRadius:4, border:"1.5px solid #e5e7eb", fontSize:9, width:48 }}>
                        <option value="kyougi">見出</option>
                        <option value="gian">議案</option>
                        <option value="item">項目</option>
                        <option value="sub">副項</option>
                      </select>
                      {item.type === "kyougi" ? (
                        <input value={item.label||""} onChange={e=>{const is=[...form.items];is[idx]={...is[idx],label:e.target.value};setMokuji(p=>({...p,items:is}));}} style={{ flex:1, padding:"7px 8px", borderRadius:6, border:"2px solid #d97706", fontSize:12, fontWeight:800 }}/>
                      ) : (
                        <>
                          {item.type==="gian" && <input value={item.number||""} onChange={e=>{const is=[...form.items];is[idx]={...is[idx],number:e.target.value};setMokuji(p=>({...p,items:is}));}} placeholder="第1号議案" style={{ width:68, padding:"6px", borderRadius:4, border:"1.5px solid #e5e7eb", fontSize:10, fontWeight:700 }}/>}
                          <input value={item.title||""} onChange={e=>{const is=[...form.items];is[idx]={...is[idx],title:e.target.value};setMokuji(p=>({...p,items:is}));}} placeholder="タイトル" style={{ flex:1, padding:"6px", borderRadius:4, border:"1.5px solid #e5e7eb", fontSize:11 }}/>
                          <input value={item.page||""} onChange={e=>{const is=[...form.items];is[idx]={...is[idx],page:e.target.value};setMokuji(p=>({...p,items:is}));}} placeholder="p." style={{ width:48, padding:"6px", borderRadius:4, border:"1.5px solid #e5e7eb", fontSize:10, textAlign:"center" }}/>
                        </>
                      )}
                      <button onClick={()=>{const is=form.items.filter((_,i)=>i!==idx);setMokuji(p=>({...p,items:is}));}} style={{ background:"#fef2f2", color:"#dc2626", border:"none", borderRadius:4, padding:"2px 5px", fontSize:9, cursor:"pointer" }}>✕</button>
                    </div>
                  ))}
                  <div style={{ display:"flex", gap:6, marginTop:8, marginBottom:16 }}>
                    <button onClick={()=>setMokuji(p=>({...p,items:[...(p.items||[]),{type:"kyougi",label:""}]}))} style={{ flex:1, padding:"7px", borderRadius:8, border:"2px dashed #d97706", background:"white", color:"#d97706", fontWeight:700, fontSize:10, cursor:"pointer" }}>＋見出し</button>
                    <button onClick={()=>setMokuji(p=>({...p,items:[...(p.items||[]),{type:"gian",number:"",title:"",page:""}]}))} style={{ flex:1, padding:"7px", borderRadius:8, border:"2px dashed #0284c7", background:"white", color:"#0284c7", fontWeight:700, fontSize:10, cursor:"pointer" }}>＋議案</button>
                    <button onClick={()=>setMokuji(p=>({...p,items:[...(p.items||[]),{type:"item",title:"",page:""}]}))} style={{ flex:1, padding:"7px", borderRadius:8, border:"2px dashed #64748b", background:"white", color:"#64748b", fontWeight:700, fontSize:10, cursor:"pointer" }}>＋項目</button>
                    <button onClick={()=>setMokuji(p=>({...p,items:[...(p.items||[]),{type:"sub",indent:true,title:"",page:""}]}))} style={{ flex:1, padding:"7px", borderRadius:8, border:"2px dashed #94a3b8", background:"white", color:"#94a3b8", fontWeight:700, fontSize:10, cursor:"pointer" }}>＋副項</button>
                  </div>

                  <button onClick={()=>{
                    let html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${form.nendo} PTA総会資料</title>`;
                    html += `<style>@page{size:A4;margin:30mm 25mm}body{font-family:"Yu Mincho","YuMincho","Hiragino Mincho ProN",serif;color:#000;font-size:14px;line-height:2}`;
                    html += `.nendo{text-align:center;font-size:22px;font-weight:bold;margin-top:40px;margin-bottom:6px}`;
                    html += `.main-title{text-align:center;font-size:18px;margin-bottom:30px}`;
                    html += `.school{text-align:right;font-size:14px;margin-bottom:30px}`;
                    html += `.section{font-weight:bold;font-size:15px;margin-top:14px;margin-bottom:6px}`;
                    html += `.gian{margin-left:1em;font-size:14px;margin-bottom:3px}`;
                    html += `.gian-num{font-weight:bold}`;
                    html += `.page-num{color:#333;font-size:13px}`;
                    html += `.sub-item{margin-left:2em;font-size:13px;margin-bottom:2px}`;
                    html += `.indent-item{margin-left:3em;font-size:13px;margin-bottom:2px}`;
                    html += `@media print{body{-webkit-print-color-adjust:exact}}</style></head><body>`;
                    html += `<div class="nendo">${form.nendo}</div>`;
                    html += `<div class="main-title">ＰＴＡ総会資料</div>`;
                    html += `<div class="school">${form.school}</div>`;
                    (form.items||[]).forEach(item => {
                      if (item.type === "kyougi") {
                        html += `<div class="section">${item.label}</div>`;
                      } else if (item.type === "gian") {
                        html += `<div class="gian"><span class="gian-num">${item.number}</span>　${item.title}${item.page ? ` <span class="page-num">（ｐ.${item.page}）</span>` : ""}</div>`;
                      } else if (item.type === "sub") {
                        html += `<div class="indent-item">${item.title}${item.page ? ` <span class="page-num">（ｐ.${item.page}）</span>` : ""}</div>`;
                      } else {
                        html += `<div class="sub-item">・${item.title}${item.page ? ` <span class="page-num">（ｐ.${item.page}）</span>` : ""}</div>`;
                      }
                    });
                    html += `</body></html>`;
                    const pw = window.open("","_blank","width=800,height=1000");
                    if(pw){pw.document.write(html);pw.document.close();pw.focus();setTimeout(()=>pw.print(),500);}
                    const docTitle = `${form.nendo} PTA総会資料 目次`;
                    const td8 = new Date().toISOString().split("T")[0];
                    if(!documents.some(d=>d.name===docTitle)){setDocuments(prev=>[...prev,{id:`doc_${Date.now()}`,name:docTitle,category:"会議資料",createdAt:td8,author:currentUser.nickname,templateId:"soukai_mokuji"}]);}
                    setPublishMsg("印刷画面を開きました。資料管理にも保存済みです。");
                    setTimeout(()=>setPublishMsg(null),4000);
                  }} style={{ width:"100%", padding:"14px", borderRadius:12, border:"none", background:"linear-gradient(135deg,#d97706,#b45309)", color:"white", fontWeight:800, fontSize:15, cursor:"pointer", marginBottom:8, display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
                    🖨️ 出力（印刷 / 保存）
                  </button>
                  <div style={{ fontSize:11, color:"#94a3b8", textAlign:"center" }}>印刷ダイアログで「印刷」または「PDFに保存」を選択できます</div>
                </div>
                );
              }

              // 報告・連絡（その他資料のPDFインポート）
              if (page === "houkoku") {
                const houkokuData = publishForms?.soukai_houkoku || { files:[] };
                if (!publishForms?.soukai_houkoku) {
                  setPublishForms(prev => ({...prev, soukai_houkoku: { files:[] }}));
                }
                return (
                <div>
                  <div style={{ fontSize:14, fontWeight:800, color:"#0f172a", marginBottom:4 }}>📌 報告・連絡</div>
                  <div style={{ fontSize:12, color:"#64748b", marginBottom:16 }}>総会資料に添付する報告・連絡資料（PDF）を管理します</div>

                  {(houkokuData.files||[]).length > 0 ? (
                    <div style={{ marginBottom:16 }}>
                      {houkokuData.files.map((f, idx) => (
                        <div key={idx} style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 12px", borderRadius:10, background:"white", border:"1.5px solid #e5e7eb", marginBottom:4 }}>
                          <span style={{ fontSize:18 }}>📄</span>
                          <div style={{ flex:1 }}>
                            <div style={{ fontWeight:600, fontSize:13, color:"#0f172a" }}>{f.name}</div>
                            <div style={{ fontSize:10, color:"#94a3b8" }}>{f.size} ・ {f.addedAt}</div>
                          </div>
                          <button onClick={()=>{
                            setPublishForms(prev => {
                              const cur = prev.soukai_houkoku || {files:[]};
                              return {...prev, soukai_houkoku: {...cur, files: cur.files.filter((_,i)=>i!==idx)}};
                            });
                          }} style={{ background:"#fef2f2", color:"#dc2626", border:"none", borderRadius:6, padding:"4px 8px", fontSize:10, fontWeight:700, cursor:"pointer" }}>削除</button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ textAlign:"center", color:"#94a3b8", fontSize:13, padding:"24px 0", marginBottom:16 }}>まだ資料が登録されていません</div>
                  )}

                  <button onClick={()=>{
                    const input = document.createElement("input");
                    input.type = "file"; input.accept = ".pdf"; input.multiple = true;
                    input.onchange = (ev) => {
                      const files = Array.from(ev.target.files || []);
                      if (files.length === 0) return;
                      const newFiles = files.map(f => ({
                        name: f.name,
                        size: f.size > 1024*1024 ? `${(f.size/1024/1024).toFixed(1)}MB` : `${Math.round(f.size/1024)}KB`,
                        addedAt: new Date().toLocaleDateString("ja-JP"),
                      }));
                      setPublishForms(prev => {
                        const cur = prev.soukai_houkoku || {files:[]};
                        return {...prev, soukai_houkoku: {...cur, files: [...cur.files, ...newFiles]}};
                      });
                      setPublishMsg(`${files.length}件のPDFファイルを登録しました`);
                      setTimeout(()=>setPublishMsg(null), 3000);
                    };
                    input.click();
                  }} style={{ width:"100%", padding:"14px", borderRadius:12, border:"2px dashed #0284c7", background:"white", color:"#0284c7", fontWeight:800, fontSize:14, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
                    📤 PDFファイルをインポート
                  </button>
                  <div style={{ fontSize:10, color:"#94a3b8", marginTop:6, textAlign:"center" }}>複数ファイル選択可能。八木山中学校の取組、市P協会費、保険案内、三行詩募集等</div>
                </div>
                );
              }

              return null;
            })()}

            {/* 階層2: 第N回 → 文書種別一覧 */}
            {publishNav.length === 2 && publishNav[0] === "committee" && (
              <div>
                {(() => {
                  const kl = { "unei_1":"第１回運営委員会", "unei_2":"第２回運営委員会", "unei_3":"第３回運営委員会", "unei_4":"第４回運営委員会" };
                  return (<div style={{ fontWeight:800, fontSize:15, color:"#0f172a", marginBottom:16 }}>📋 {kl[publishNav[1]] || publishNav[1]}</div>);
                })()}
                {(() => {
                  const isFirst = publishNav[1] === "unei_1";
                  const allDocs = [
                    { id:"sidai", label:"次第（要項）", icon:"📝", desc:"運営委員会の次第を作成・印刷", always:true },
                    { id:"meibo", label:"本部役員名簿", icon:"👥", desc:"PTA本部役員名簿を作成・印刷" },
                    { id:"katsudou", label:"活動報告", icon:"📊", desc:"委員会活動報告を作成・印刷" },
                    { id:"kaikei", label:"会計報告書", icon:"💰", desc:"PTA会計報告書を作成・印刷" },
                    { id:"yosan", label:"予算案", icon:"📋", desc:"PTA会計予算案を作成・印刷" },
                    { id:"keikaku", label:"活動計画案", icon:"📅", desc:"PTA本部活動計画案を作成・印刷" },
                  ];
                  const docs = isFirst ? allDocs : allDocs.filter(d => d.always);
                  return docs;
                })().map(doc => (
                  <div key={doc.id} onClick={()=>{
                    const kl2 = { "unei_1":"第１回", "unei_2":"第２回", "unui_3":"第３回", "unei_4":"第４回" };
                    if (doc.id === "sidai") {
                      const fk = `sidai_${publishNav[1]}`;
                      ensureUneiForm(fk, kl2[publishNav[1]] || "第１回");
                    } else if (doc.id === "meibo") {
                      const fk = `meibo_${publishNav[1]}`;
                      ensureMeiboForm(fk);
                    } else if (doc.id === "katsudou") {
                      const fk = `katsudou_${publishNav[1]}`;
                      ensureKatsudouForm(fk);
                    } else if (doc.id === "kaikei") {
                      const fk = `kaikei_${publishNav[1]}`;
                      ensureKaikeiForm(fk);
                    } else if (doc.id === "yosan") {
                      const fk = `yosan_${publishNav[1]}`;
                      ensureYosanForm(fk);
                    }
                    navTo([...publishNav, doc.id]);
                  }} style={{ display:"flex", alignItems:"center", gap:12, padding:"14px", borderRadius:12, background:"#f8fafc", cursor:"pointer", border:"2px solid #e5e7eb", marginBottom:6 }}>
                    <span style={{ fontSize:22 }}>{doc.icon}</span>
                    <div style={{ flex:1 }}>
                      <div style={{ fontWeight:700, fontSize:14, color:"#0f172a" }}>{doc.label}</div>
                      <div style={{ fontSize:11, color:"#94a3b8" }}>{doc.desc}</div>
                    </div>
                    <span style={{ color:"#cbd5e1", fontSize:20 }}>›</span>
                  </div>
                ))}
              </div>
            )}

            {/* 階層3: 次第 入力フォーム */}
            {publishNav.length === 3 && publishNav[2] === "sidai" && (
              <div>
                <div style={{ fontSize:14, fontWeight:800, color:"#0f172a", marginBottom:16 }}>📝 運営委員会次第</div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:12 }}>
                  <div>
                    <div style={{ fontSize:11, fontWeight:700, color:"#64748b", marginBottom:4 }}>年度</div>
                    <input value={publishForm.nendo||""} onChange={e=>setPublishForm(p=>({...p, nendo:e.target.value}))} style={{ width:"100%", padding:"10px", borderRadius:8, border:"2px solid #e5e7eb", fontSize:13 }}/>
                  </div>
                  <div>
                    <div style={{ fontSize:11, fontWeight:700, color:"#64748b", marginBottom:4 }}>回次</div>
                    <input value={publishForm.kai||""} onChange={e=>setPublishForm(p=>({...p, kai:e.target.value}))} style={{ width:"100%", padding:"10px", borderRadius:8, border:"2px solid #e5e7eb", fontSize:13 }}/>
                  </div>
                </div>
                <div style={{ marginBottom:12 }}>
                  <div style={{ fontSize:11, fontWeight:700, color:"#64748b", marginBottom:4 }}>日時</div>
                  <div style={{ display:"flex", gap:8 }}>
                    <input type="date" value={publishForm.date||""} onChange={e=>setPublishForm(p=>({...p, date:e.target.value}))} style={{ flex:1, padding:"10px", borderRadius:8, border:"2px solid #e5e7eb", fontSize:13 }}/>
                    <input value={publishForm.time||""} onChange={e=>setPublishForm(p=>({...p, time:e.target.value}))} placeholder="18：00" style={{ width:80, padding:"10px", borderRadius:8, border:"2px solid #e5e7eb", fontSize:13 }}/>
                  </div>
                </div>
                <div style={{ marginBottom:16 }}>
                  <div style={{ fontSize:11, fontWeight:700, color:"#64748b", marginBottom:4 }}>場所</div>
                  <input value={publishForm.place||""} onChange={e=>setPublishForm(p=>({...p, place:e.target.value}))} style={{ width:"100%", padding:"10px", borderRadius:8, border:"2px solid #e5e7eb", fontSize:13 }}/>
                </div>
                <div style={{ fontSize:13, fontWeight:700, color:"#0f172a", marginBottom:8, borderTop:"1px solid #e5e7eb", paddingTop:12 }}>次第項目</div>
                {(publishForm.items||[]).map((item, idx) => (
                  <div key={idx} style={{ marginBottom:12, padding:"12px", borderRadius:10, background:"#f8fafc", border:"1px solid #e5e7eb" }}>
                    <div style={{ display:"flex", gap:8, marginBottom:6 }}>
                      <span style={{ fontWeight:800, fontSize:14, color:"#d97706", minWidth:24 }}>{idx+1}.</span>
                      <input value={item.label} onChange={e=>{const items=[...publishForm.items];items[idx]={...items[idx],label:e.target.value};setPublishForm(p=>({...p,items}));}} style={{ flex:1, padding:"8px", borderRadius:6, border:"2px solid #e5e7eb", fontSize:13, fontWeight:700 }}/>
                      <input value={item.person} onChange={e=>{const items=[...publishForm.items];items[idx]={...items[idx],person:e.target.value};setPublishForm(p=>({...p,items}));}} placeholder="【担当】" style={{ width:80, padding:"8px", borderRadius:6, border:"2px solid #e5e7eb", fontSize:11 }}/>
                      {publishForm.items.length > 1 && (
                        <button onClick={()=>{const items=publishForm.items.filter((_,i)=>i!==idx);const subs={...publishForm.subitems};delete subs[idx];const ns={};Object.keys(subs).forEach(k=>{const ki=parseInt(k);ns[ki>idx?ki-1:ki]=subs[k];});setPublishForm(p=>({...p,items,subitems:ns}));}} style={{ background:"#fef2f2", color:"#dc2626", border:"none", borderRadius:6, padding:"4px 8px", fontSize:11, fontWeight:700, cursor:"pointer" }}>✕</button>
                      )}
                    </div>
                    {(publishForm.subitems?.[idx]||[]).map((sub, si) => (
                      <div key={si} style={{ display:"flex", gap:6, marginLeft:24, marginBottom:4 }}>
                        <span style={{ fontSize:11, color:"#94a3b8", minWidth:16 }}>{"①②③④⑤⑥⑦⑧⑨⑩"[si]||"・"}</span>
                        <input value={sub} onChange={e=>{const subs={...publishForm.subitems};subs[idx]=[...(subs[idx]||[])];subs[idx][si]=e.target.value;setPublishForm(p=>({...p,subitems:subs}));}} style={{ flex:1, padding:"6px 8px", borderRadius:6, border:"1.5px solid #e5e7eb", fontSize:11 }}/>
                        <button onClick={()=>{const subs={...publishForm.subitems};subs[idx]=(subs[idx]||[]).filter((_,i)=>i!==si);setPublishForm(p=>({...p,subitems:subs}));}} style={{ background:"#fef2f2", color:"#dc2626", border:"none", borderRadius:4, padding:"2px 6px", fontSize:10, cursor:"pointer" }}>✕</button>
                      </div>
                    ))}
                    <button onClick={()=>{const subs={...publishForm.subitems};subs[idx]=[...(subs[idx]||[]),""];setPublishForm(p=>({...p,subitems:subs}));}} style={{ marginLeft:24, marginTop:4, background:"none", border:"1.5px dashed #d97706", color:"#d97706", borderRadius:6, padding:"4px 10px", fontSize:10, fontWeight:700, cursor:"pointer" }}>＋ サブ項目追加</button>
                  </div>
                ))}
                <button onClick={()=>{setPublishForm(p=>({...p,items:[...(p.items||[]),{label:"",person:""}]}));}} style={{ width:"100%", padding:"10px", borderRadius:10, border:"2px dashed #e5e7eb", background:"white", color:"#64748b", fontWeight:700, fontSize:12, cursor:"pointer", marginBottom:16 }}>＋ 項目を追加</button>
                <button onClick={()=>{
                  const dateObj = publishForm.date ? new Date(publishForm.date+"T00:00:00") : null;
                  const dateStr = dateObj ? `令和${dateObj.getFullYear()-2018}年${dateObj.getMonth()+1}月${dateObj.getDate()}日（${"日月火水木金土"[dateObj.getDay()]}）` : "＿年＿月＿日（＿）";
                  let html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${publishForm.nendo} ${publishForm.kai}PTA運営委員会要項</title>`;
                  html += `<style>@page{size:A4;margin:25mm 20mm 20mm 20mm}body{font-family:"Yu Mincho","YuMincho","Hiragino Mincho ProN",serif;color:#000;line-height:1.8;font-size:14px}`;
                  html += `.title{text-align:center;font-size:22px;font-weight:bold;margin-bottom:8px}.subtitle{text-align:center;font-size:18px;font-weight:bold;margin-bottom:24px}`;
                  html += `.info{font-size:14px;margin-bottom:6px}.item-num{font-weight:bold;font-size:15px;margin-top:14px}`;
                  html += `.person{font-size:13px}.sub{margin-left:2em;font-size:13px;line-height:2}`;
                  html += `@media print{body{-webkit-print-color-adjust:exact}}</style></head><body>`;
                  html += `<div class="title">${publishForm.nendo}</div>`;
                  html += `<div class="subtitle">${publishForm.kai}ＰＴＡ運営委員会要項</div>`;
                  html += `<div class="info">日時：${dateStr} ${publishForm.time}～</div>`;
                  html += `<div class="info" style="margin-bottom:20px">場所：${publishForm.place}</div>`;
                  (publishForm.items||[]).forEach((item, i) => {
                    const ps = item.person ? ` <span class="person">【${item.person}】</span>` : "";
                    html += `<div class="item-num">${i+1}．${item.label}${ps}</div>`;
                    const subs = publishForm.subitems?.[i]||[];
                    if (subs.length > 0) {
                      html += `<div class="sub">`;
                      subs.forEach((sub, si) => {
                        const isG = item.label.includes("報告") || item.label.includes("協議");
                        const mk = isG ? ("①②③④⑤⑥⑦⑧⑨⑩"[si]||"・") : "〇";
                        html += `${mk} ${sub}<br/>`;
                      });
                      html += `</div>`;
                    }
                  });
                  html += `</body></html>`;
                  const pw = window.open("", "_blank", "width=800,height=1000");
                  if (pw) { pw.document.write(html); pw.document.close(); pw.focus(); setTimeout(() => pw.print(), 500); }
                  const docTitle = `${publishForm.nendo} ${publishForm.kai}PTA運営委員会要項`;
                  const td = new Date().toISOString().split("T")[0];
                  if (!documents.some(d => d.name === docTitle)) {
                    setDocuments(prev => [...prev, { id:`doc_${Date.now()}`, name:docTitle, category:"会議資料", createdAt:td, author:currentUser.nickname, templateId:publishFormKey }]);
                  }
                  setPublishMsg("印刷画面を開きました。資料管理にも保存済みです。");
                  setTimeout(()=>setPublishMsg(null), 4000);
                }} style={{ width:"100%", padding:"14px", borderRadius:12, border:"none", background:"linear-gradient(135deg,#d97706,#b45309)", color:"white", fontWeight:800, fontSize:15, cursor:"pointer", marginBottom:8, display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
                  🖨️ 出力（印刷 / 保存）
                </button>
                <div style={{ fontSize:11, color:"#94a3b8", textAlign:"center" }}>印刷ダイアログで「印刷」または「PDFに保存」を選択できます</div>
              </div>
            )}

            {/* 階層3: 本部役員名簿 入力フォーム */}
            {publishNav.length === 3 && publishNav[2] === "meibo" && (
              <div>
                <div style={{ fontSize:14, fontWeight:800, color:"#0f172a", marginBottom:16 }}>👥 ＰＴＡ本部役員名簿</div>

                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:16 }}>
                  <div>
                    <div style={{ fontSize:11, fontWeight:700, color:"#64748b", marginBottom:4 }}>年度</div>
                    <input value={publishForm.nendo||""} onChange={e=>setPublishForm(p=>({...p, nendo:e.target.value}))} style={{ width:"100%", padding:"10px", borderRadius:8, border:"2px solid #e5e7eb", fontSize:13 }}/>
                  </div>
                  <div>
                    <div style={{ fontSize:11, fontWeight:700, color:"#64748b", marginBottom:4 }}>学校名</div>
                    <input value={publishForm.school||""} onChange={e=>setPublishForm(p=>({...p, school:e.target.value}))} style={{ width:"100%", padding:"10px", borderRadius:8, border:"2px solid #e5e7eb", fontSize:13 }}/>
                  </div>
                </div>

                <div style={{ fontSize:13, fontWeight:700, color:"#0f172a", marginBottom:8, borderTop:"1px solid #e5e7eb", paddingTop:12 }}>役員一覧</div>
                <div style={{ display:"grid", gridTemplateColumns:"36px 70px 1fr 1fr", gap:4, marginBottom:6, padding:"6px 8px", background:"#d9770618", borderRadius:8 }}>
                  <div style={{ fontSize:10, fontWeight:800, color:"#d97706" }}>No</div>
                  <div style={{ fontSize:10, fontWeight:800, color:"#d97706" }}>役職</div>
                  <div style={{ fontSize:10, fontWeight:800, color:"#d97706" }}>氏名</div>
                  <div style={{ fontSize:10, fontWeight:800, color:"#d97706" }}>生徒名</div>
                </div>

                {(publishForm.members||[]).map((m, idx) => (
                  <div key={idx} style={{ display:"grid", gridTemplateColumns:"36px 70px 1fr 1fr 28px", gap:4, marginBottom:3, alignItems:"center" }}>
                    <input value={m.no} onChange={e=>{const ms=[...publishForm.members];ms[idx]={...ms[idx],no:e.target.value};setPublishForm(p=>({...p,members:ms}));}} style={{ padding:"7px 4px", borderRadius:6, border:"1.5px solid #e5e7eb", fontSize:12, textAlign:"center" }}/>
                    <input value={m.role} onChange={e=>{const ms=[...publishForm.members];ms[idx]={...ms[idx],role:e.target.value};setPublishForm(p=>({...p,members:ms}));}} style={{ padding:"7px 4px", borderRadius:6, border:"1.5px solid #e5e7eb", fontSize:11, fontWeight:700 }}/>
                    <input value={m.name} onChange={e=>{const ms=[...publishForm.members];ms[idx]={...ms[idx],name:e.target.value};setPublishForm(p=>({...p,members:ms}));}} placeholder="氏名" style={{ padding:"7px 6px", borderRadius:6, border:"1.5px solid #e5e7eb", fontSize:12 }}/>
                    <input value={m.student} onChange={e=>{const ms=[...publishForm.members];ms[idx]={...ms[idx],student:e.target.value};setPublishForm(p=>({...p,members:ms}));}} placeholder="生徒名" style={{ padding:"7px 6px", borderRadius:6, border:"1.5px solid #e5e7eb", fontSize:12 }}/>
                    {publishForm.members.length > 1 && (
                      <button onClick={()=>{const ms=publishForm.members.filter((_,i)=>i!==idx);setPublishForm(p=>({...p,members:ms}));}} style={{ background:"#fef2f2", color:"#dc2626", border:"none", borderRadius:4, padding:"2px", fontSize:10, cursor:"pointer", width:24, height:24, display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
                    )}
                  </div>
                ))}

                <button onClick={()=>{
                  const nextNo = String((publishForm.members||[]).length + 1);
                  setPublishForm(p=>({...p, members:[...(p.members||[]), {no:nextNo, role:"", name:"", student:""}]}));
                }} style={{ width:"100%", padding:"10px", borderRadius:10, border:"2px dashed #e5e7eb", background:"white", color:"#64748b", fontWeight:700, fontSize:12, cursor:"pointer", marginTop:8, marginBottom:16 }}>＋ 役員を追加</button>

                <button onClick={()=>{
                  let html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${publishForm.nendo} PTA本部役員名簿</title>`;
                  html += `<style>@page{size:A4;margin:25mm 20mm 20mm 20mm}body{font-family:"Yu Mincho","YuMincho","Hiragino Mincho ProN",serif;color:#000;font-size:14px}`;
                  html += `.title{text-align:center;font-size:20px;font-weight:bold;margin-bottom:6px}`;
                  html += `.school{text-align:center;font-size:14px;margin-bottom:20px}`;
                  html += `table{width:100%;border-collapse:collapse;margin-top:10px}`;
                  html += `th,td{border:1px solid #333;padding:8px 10px;text-align:center;font-size:13px}`;
                  html += `th{background:#f5f5f5;font-weight:bold;font-size:12px}`;
                  html += `td.name{text-align:left;padding-left:14px}`;
                  html += `@media print{body{-webkit-print-color-adjust:exact}}</style></head><body>`;
                  html += `<div class="title">${publishForm.nendo} ＰＴＡ本部役員名簿</div>`;
                  html += `<div class="school">${publishForm.school}</div>`;
                  html += `<table><thead><tr><th style="width:40px">№</th><th style="width:80px">役　職</th><th>氏　名</th><th>生　徒　名</th></tr></thead><tbody>`;
                  (publishForm.members||[]).forEach(m => {
                    html += `<tr><td>${m.no}</td><td>${m.role}</td><td class="name">${m.name}</td><td class="name">${m.student}</td></tr>`;
                  });
                  html += `</tbody></table></body></html>`;
                  const pw = window.open("", "_blank", "width=800,height=1000");
                  if (pw) { pw.document.write(html); pw.document.close(); pw.focus(); setTimeout(() => pw.print(), 500); }
                  const docTitle = `${publishForm.nendo} PTA本部役員名簿`;
                  const td2 = new Date().toISOString().split("T")[0];
                  if (!documents.some(d => d.name === docTitle)) {
                    setDocuments(prev => [...prev, { id:`doc_${Date.now()}`, name:docTitle, category:"会議資料", createdAt:td2, author:currentUser.nickname, templateId:publishFormKey }]);
                  }
                  setPublishMsg("印刷画面を開きました。資料管理にも保存済みです。");
                  setTimeout(()=>setPublishMsg(null), 4000);
                }} style={{ width:"100%", padding:"14px", borderRadius:12, border:"none", background:"linear-gradient(135deg,#d97706,#b45309)", color:"white", fontWeight:800, fontSize:15, cursor:"pointer", marginBottom:8, display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
                  🖨️ 出力（印刷 / 保存）
                </button>
                <div style={{ fontSize:11, color:"#94a3b8", textAlign:"center" }}>印刷ダイアログで「印刷」または「PDFに保存」を選択できます</div>
              </div>
            )}

            {/* 階層3: 活動報告 — 委員会一覧 */}
            {publishNav.length === 3 && publishNav[2] === "katsudou" && (
              <div>
                <div style={{ fontSize:14, fontWeight:800, color:"#0f172a", marginBottom:4 }}>📊 活動報告</div>
                <div style={{ fontSize:12, color:"#64748b", marginBottom:16 }}>委員会を選択、または新規作成してください</div>

                {/* 既存の委員会活動報告一覧 */}
                {(() => {
                  const prefix = `katsudou_${publishNav[1]}_`;
                  const existing = Object.keys(publishForms).filter(k => k.startsWith(prefix)).map(k => {
                    const data = publishForms[k];
                    return { key: k, committee: data.committee || k.replace(prefix, ""), data };
                  });
                  return existing.length > 0 ? (
                    <div style={{ display:"flex", flexDirection:"column", gap:6, marginBottom:16 }}>
                      {existing.map(item => (
                        <div key={item.key} onClick={()=>navTo([...publishNav, item.committee])} style={{ display:"flex", alignItems:"center", gap:12, padding:"14px", borderRadius:12, background:"#f8fafc", cursor:"pointer", border:"2px solid #e5e7eb" }}>
                          <span style={{ fontSize:20 }}>📄</span>
                          <div style={{ flex:1 }}>
                            <div style={{ fontWeight:700, fontSize:14, color:"#0f172a" }}>（{item.committee}）委員会</div>
                            <div style={{ fontSize:11, color:"#94a3b8" }}>{item.data.activities?.length || 0}件の活動記録</div>
                          </div>
                          <span style={{ color:"#cbd5e1", fontSize:20 }}>›</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ textAlign:"center", color:"#94a3b8", fontSize:13, padding:"20px 0", marginBottom:16 }}>まだ活動報告がありません</div>
                  );
                })()}

                {/* 新規作成 */}
                <div style={{ borderTop:"1px solid #e5e7eb", paddingTop:16 }}>
                  <div style={{ fontSize:13, fontWeight:700, color:"#64748b", marginBottom:8 }}>新しい活動報告を作成</div>
                  <div style={{ display:"flex", gap:8 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:4, flex:1 }}>
                      <span style={{ fontSize:12, color:"#0f172a", flexShrink:0 }}>（</span>
                      <input id="newKatsudouName" placeholder="本部" style={{ flex:1, padding:"10px", borderRadius:8, border:"2px solid #e5e7eb", fontSize:13, fontWeight:700, textAlign:"center" }}/>
                      <span style={{ fontSize:12, color:"#0f172a", flexShrink:0 }}>）</span>
                    </div>
                    <button onClick={()=>{
                      const input = document.getElementById("newKatsudouName");
                      const name = (input?.value || "").trim();
                      if (!name) return;
                      const fk = `katsudou_${publishNav[1]}_${name}`;
                      if (!publishForms?.[fk]) {
                        setPublishForms(prev => ({ ...prev, [fk]: {
                          committee: name,
                          activities: [{ month:"", day:"", content:"" }],
                          reflection: "",
                        }}));
                      }
                      input.value = "";
                      navTo([...publishNav, name]);
                    }} style={{ padding:"10px 16px", borderRadius:8, border:"none", background:"linear-gradient(135deg,#d97706,#b45309)", color:"white", fontWeight:800, fontSize:13, cursor:"pointer", flexShrink:0 }}>作成</button>
                  </div>
                </div>
              </div>
            )}

            {/* 階層4: 活動報告 入力フォーム */}
            {publishNav.length === 4 && publishNav[2] === "katsudou" && (() => {
              const cmName = publishNav[3];
              const fk = `katsudou_${publishNav[1]}_${cmName}`;
              const form = publishForms?.[fk] || {};
              const setForm = (updater) => {
                setPublishForms(prev => {
                  const current = prev[fk] || {};
                  const next = typeof updater === "function" ? updater(current) : updater;
                  return { ...prev, [fk]: next };
                });
              };
              return (
              <div>
                <div style={{ fontSize:14, fontWeight:800, color:"#0f172a", marginBottom:16 }}>📊 ＰＴＡ（{cmName}）委員会　活動報告</div>

                {/* 活動記録テーブル */}
                <div style={{ fontSize:13, fontWeight:700, color:"#0f172a", marginBottom:8 }}>【活動報告】</div>
                <div style={{ display:"grid", gridTemplateColumns:"40px 36px 1fr", gap:4, marginBottom:6, padding:"6px 8px", background:"#d9770618", borderRadius:8 }}>
                  <div style={{ fontSize:10, fontWeight:800, color:"#d97706" }}>月</div>
                  <div style={{ fontSize:10, fontWeight:800, color:"#d97706" }}>日</div>
                  <div style={{ fontSize:10, fontWeight:800, color:"#d97706" }}>活動報告</div>
                </div>

                {(form.activities||[]).map((a, idx) => (
                  <div key={idx} style={{ display:"grid", gridTemplateColumns:"40px 36px 1fr 28px", gap:4, marginBottom:3, alignItems:"center" }}>
                    <input value={a.month} onChange={e=>{const as=[...form.activities];as[idx]={...as[idx],month:e.target.value};setForm(p=>({...p,activities:as}));}} style={{ padding:"7px 2px", borderRadius:6, border:"1.5px solid #e5e7eb", fontSize:12, textAlign:"center" }}/>
                    <input value={a.day} onChange={e=>{const as=[...form.activities];as[idx]={...as[idx],day:e.target.value};setForm(p=>({...p,activities:as}));}} placeholder="日" style={{ padding:"7px 2px", borderRadius:6, border:"1.5px solid #e5e7eb", fontSize:12, textAlign:"center" }}/>
                    <input value={a.content} onChange={e=>{const as=[...form.activities];as[idx]={...as[idx],content:e.target.value};setForm(p=>({...p,activities:as}));}} placeholder="活動内容" style={{ padding:"7px 6px", borderRadius:6, border:"1.5px solid #e5e7eb", fontSize:12 }}/>
                    {form.activities.length > 1 && (
                      <button onClick={()=>{const as=form.activities.filter((_,i)=>i!==idx);setForm(p=>({...p,activities:as}));}} style={{ background:"#fef2f2", color:"#dc2626", border:"none", borderRadius:4, padding:"2px", fontSize:10, cursor:"pointer", width:24, height:24, display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
                    )}
                  </div>
                ))}

                <button onClick={()=>{
                  setForm(p=>({...p, activities:[...(p.activities||[]), {month:"",day:"",content:""}]}));
                }} style={{ width:"100%", padding:"10px", borderRadius:10, border:"2px dashed #e5e7eb", background:"white", color:"#64748b", fontWeight:700, fontSize:12, cursor:"pointer", marginTop:8, marginBottom:16 }}>＋ 活動を追加</button>

                <div style={{ fontSize:13, fontWeight:700, color:"#0f172a", marginBottom:8, borderTop:"1px solid #e5e7eb", paddingTop:12 }}>【感想・反省、次年度への提案等】</div>
                <textarea value={form.reflection||""} onChange={e=>setForm(p=>({...p, reflection:e.target.value}))} placeholder="感想・反省、次年度への提案等を入力してください" rows={6} style={{ width:"100%", padding:"12px", borderRadius:8, border:"2px solid #e5e7eb", fontSize:12, lineHeight:1.8, resize:"vertical", marginBottom:16 }}/>

                <button onClick={()=>{
                  let html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>PTA（${cmName}）委員会 活動報告</title>`;
                  html += `<style>@page{size:A4;margin:20mm 15mm 15mm 15mm}body{font-family:"Yu Mincho","YuMincho","Hiragino Mincho ProN",serif;color:#000;font-size:13px;line-height:1.6}`;
                  html += `.header{text-align:right;font-size:16px;font-weight:bold;margin-bottom:16px}`;
                  html += `table{width:100%;border-collapse:collapse}th,td{border:1px solid #333;padding:6px 8px;font-size:12px}`;
                  html += `th{background:#f5f5f5;font-weight:bold;text-align:center}td.center{text-align:center}td.content{text-align:left}`;
                  html += `.section{font-weight:bold;font-size:14px;margin-top:20px;margin-bottom:8px}`;
                  html += `.reflection{border:1px solid #333;padding:12px;min-height:120px;font-size:12px;line-height:1.8;white-space:pre-wrap}`;
                  html += `@media print{body{-webkit-print-color-adjust:exact}}</style></head><body>`;
                  html += `<div class="header">ＰＴＡ（　${cmName}　）委員会 活動報告</div>`;
                  html += `<div class="section">【活動報告】</div>`;
                  html += `<table><thead><tr><th style="width:35px">月</th><th style="width:30px">日</th><th>活動報告</th></tr></thead><tbody>`;
                  (form.activities||[]).forEach(a => {
                    html += `<tr><td class="center">${a.month}</td><td class="center">${a.day}</td><td class="content">${a.content}</td></tr>`;
                  });
                  html += `</tbody></table>`;
                  html += `<div class="section">【感想・反省、次年度への提案等】</div>`;
                  html += `<div class="reflection">${(form.reflection||"").replace(/\n/g,"<br/>")}</div>`;
                  html += `</body></html>`;
                  const pw = window.open("", "_blank", "width=800,height=1000");
                  if (pw) { pw.document.write(html); pw.document.close(); pw.focus(); setTimeout(() => pw.print(), 500); }
                  const docTitle = `PTA（${cmName}）委員会 活動報告`;
                  const td3 = new Date().toISOString().split("T")[0];
                  if (!documents.some(d => d.name === docTitle)) {
                    setDocuments(prev => [...prev, { id:`doc_${Date.now()}`, name:docTitle, category:"会議資料", createdAt:td3, author:currentUser.nickname, templateId:fk }]);
                  }
                  setPublishMsg("印刷画面を開きました。資料管理にも保存済みです。");
                  setTimeout(()=>setPublishMsg(null), 4000);
                }} style={{ width:"100%", padding:"14px", borderRadius:12, border:"none", background:"linear-gradient(135deg,#d97706,#b45309)", color:"white", fontWeight:800, fontSize:15, cursor:"pointer", marginBottom:8, display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
                  🖨️ 出力（印刷 / 保存）
                </button>
                <div style={{ fontSize:11, color:"#94a3b8", textAlign:"center" }}>印刷ダイアログで「印刷」または「PDFに保存」を選択できます</div>
              </div>
              );
            })()}

            {/* 階層3: 会計報告書 入力フォーム */}
            {publishNav.length === 3 && publishNav[2] === "kaikei" && (() => {
              const fk = `kaikei_${publishNav[1]}`;
              const form = publishForms?.[fk] || {};
              const setForm = (updater) => {
                setPublishForms(prev => {
                  const current = prev[fk] || {};
                  const next = typeof updater === "function" ? updater(current) : updater;
                  return { ...prev, [fk]: next };
                });
              };
              const num = (v) => { const n = parseInt(String(v||"").replace(/,/g,"")); return isNaN(n) ? 0 : n; };
              const fmt = (n) => n === 0 ? "" : n.toLocaleString();
              const incomeSum = (field) => (form.income||[]).reduce((s,r) => s + num(r[field]), 0);
              const expenseSum = (field) => (form.expense||[]).reduce((s,r) => s + num(r[field]), 0);
              const updateIncomeRow = (idx, field, value) => {
                const rows = [...(form.income||[])];
                rows[idx] = {...rows[idx], [field]: value};
                if (field === "budget" || field === "actual") {
                  const b = num(field==="budget" ? value : rows[idx].budget);
                  const a = num(field==="actual" ? value : rows[idx].actual);
                  rows[idx].diff = fmt(a - b);
                }
                setForm(p => ({...p, income: rows}));
              };
              const updateExpenseRow = (idx, field, value) => {
                const rows = [...(form.expense||[])];
                rows[idx] = {...rows[idx], [field]: value};
                if (field === "budget" || field === "actual") {
                  const b = num(field==="budget" ? value : rows[idx].budget);
                  const a = num(field==="actual" ? value : rows[idx].actual);
                  rows[idx].diff = fmt(b - a);
                }
                setForm(p => ({...p, expense: rows}));
              };
              const cellSt = { padding:"6px 4px", borderRadius:4, border:"1.5px solid #e5e7eb", fontSize:11, textAlign:"right" };
              const hdSt = { fontSize:9, fontWeight:800, color:"#d97706", padding:"4px 2px" };
              return (
              <div>
                <div style={{ fontSize:14, fontWeight:800, color:"#0f172a", marginBottom:12 }}>💰 ＰＴＡ会計報告書</div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:12 }}>
                  <div>
                    <div style={{ fontSize:11, fontWeight:700, color:"#64748b", marginBottom:4 }}>年度</div>
                    <input value={form.nendo||""} onChange={e=>setForm(p=>({...p, nendo:e.target.value}))} style={{ width:"100%", padding:"10px", borderRadius:8, border:"2px solid #e5e7eb", fontSize:13 }}/>
                  </div>
                  <div>
                    <div style={{ fontSize:11, fontWeight:700, color:"#64748b", marginBottom:4 }}>報告日</div>
                    <input type="date" value={form.date||""} onChange={e=>setForm(p=>({...p, date:e.target.value}))} style={{ width:"100%", padding:"10px", borderRadius:8, border:"2px solid #e5e7eb", fontSize:13 }}/>
                  </div>
                </div>
                <div style={{ fontSize:13, fontWeight:800, color:"#059669", marginBottom:8, borderTop:"2px solid #059669", paddingTop:10 }}>１．収入の部</div>
                <div style={{ overflowX:"auto", marginBottom:8 }}>
                  <div style={{ display:"grid", gridTemplateColumns:"60px 60px 72px 72px 60px 1fr", gap:2, marginBottom:4, padding:"0 4px" }}>
                    <div style={hdSt}>項目</div><div style={hdSt}>目</div><div style={hdSt}>予算額</div><div style={hdSt}>収入状況</div><div style={hdSt}>増減</div><div style={hdSt}>摘要</div>
                  </div>
                  {(form.income||[]).map((r, idx) => (
                    <div key={idx} style={{ display:"grid", gridTemplateColumns:"60px 60px 72px 72px 60px 1fr 24px", gap:2, marginBottom:2, alignItems:"center", padding:"0 4px" }}>
                      <input value={r.category||""} onChange={e=>updateIncomeRow(idx,"category",e.target.value)} style={{...cellSt, textAlign:"left", fontSize:10}}/>
                      <input value={r.item||""} onChange={e=>updateIncomeRow(idx,"item",e.target.value)} style={{...cellSt, textAlign:"left", fontSize:10}}/>
                      <input value={r.budget||""} onChange={e=>updateIncomeRow(idx,"budget",e.target.value)} style={cellSt}/>
                      <input value={r.actual||""} onChange={e=>updateIncomeRow(idx,"actual",e.target.value)} style={cellSt}/>
                      <input value={r.diff||""} readOnly style={{...cellSt, background:"#f8fafc", color:"#64748b"}}/>
                      <input value={r.note||""} onChange={e=>updateIncomeRow(idx,"note",e.target.value)} style={{...cellSt, textAlign:"left"}}/>
                      <button onClick={()=>{const rows=(form.income||[]).filter((_,i)=>i!==idx);setForm(p=>({...p,income:rows}));}} style={{ background:"#fef2f2", color:"#dc2626", border:"none", borderRadius:4, fontSize:9, cursor:"pointer", width:22, height:22 }}>✕</button>
                    </div>
                  ))}
                  <div style={{ display:"grid", gridTemplateColumns:"120px 72px 72px 60px 1fr", gap:2, padding:"4px", background:"#05966918", borderRadius:6, marginTop:4 }}>
                    <div style={{ fontSize:11, fontWeight:800, color:"#059669" }}>合　計</div>
                    <div style={{ fontSize:11, fontWeight:800, color:"#059669", textAlign:"right" }}>{fmt(incomeSum("budget"))}</div>
                    <div style={{ fontSize:11, fontWeight:800, color:"#059669", textAlign:"right" }}>{fmt(incomeSum("actual"))}</div>
                    <div style={{ fontSize:10, color:"#64748b", textAlign:"right" }}>{fmt(incomeSum("actual")-incomeSum("budget"))}</div>
                    <div/>
                  </div>
                </div>
                <button onClick={()=>{setForm(p=>({...p, income:[...(p.income||[]), {category:"",item:"",budget:"",actual:"",diff:"",note:""}]}));}} style={{ width:"100%", padding:"8px", borderRadius:8, border:"2px dashed #e5e7eb", background:"white", color:"#64748b", fontWeight:700, fontSize:11, cursor:"pointer", marginBottom:16 }}>＋ 収入項目を追加</button>

                <div style={{ fontSize:13, fontWeight:800, color:"#dc2626", marginBottom:8, borderTop:"2px solid #dc2626", paddingTop:10 }}>２．支出の部</div>
                <div style={{ overflowX:"auto", marginBottom:8 }}>
                  <div style={{ display:"grid", gridTemplateColumns:"40px 56px 56px 68px 68px 56px 1fr", gap:2, marginBottom:4, padding:"0 4px" }}>
                    <div style={hdSt}>款</div><div style={hdSt}>項目</div><div style={hdSt}>目</div><div style={hdSt}>予算額</div><div style={hdSt}>出額</div><div style={hdSt}>差引残額</div><div style={hdSt}>摘要</div>
                  </div>
                  {(form.expense||[]).map((r, idx) => (
                    <div key={idx} style={{ display:"grid", gridTemplateColumns:"40px 56px 56px 68px 68px 56px 1fr 24px", gap:2, marginBottom:2, alignItems:"center", padding:"0 4px" }}>
                      <input value={r.section||""} onChange={e=>updateExpenseRow(idx,"section",e.target.value)} style={{...cellSt, textAlign:"left", fontSize:9}}/>
                      <input value={r.category||""} onChange={e=>updateExpenseRow(idx,"category",e.target.value)} style={{...cellSt, textAlign:"left", fontSize:9}}/>
                      <input value={r.item||""} onChange={e=>updateExpenseRow(idx,"item",e.target.value)} style={{...cellSt, textAlign:"left", fontSize:9}}/>
                      <input value={r.budget||""} onChange={e=>updateExpenseRow(idx,"budget",e.target.value)} style={cellSt}/>
                      <input value={r.actual||""} onChange={e=>updateExpenseRow(idx,"actual",e.target.value)} style={cellSt}/>
                      <input value={r.diff||""} readOnly style={{...cellSt, background:"#f8fafc", color:"#64748b"}}/>
                      <input value={r.note||""} onChange={e=>updateExpenseRow(idx,"note",e.target.value)} style={{...cellSt, textAlign:"left"}}/>
                      <button onClick={()=>{const rows=(form.expense||[]).filter((_,i)=>i!==idx);setForm(p=>({...p,expense:rows}));}} style={{ background:"#fef2f2", color:"#dc2626", border:"none", borderRadius:4, fontSize:9, cursor:"pointer", width:22, height:22 }}>✕</button>
                    </div>
                  ))}
                  <div style={{ display:"grid", gridTemplateColumns:"152px 68px 68px 56px 1fr", gap:2, padding:"4px", background:"#dc262618", borderRadius:6, marginTop:4 }}>
                    <div style={{ fontSize:11, fontWeight:800, color:"#dc2626" }}>合　計</div>
                    <div style={{ fontSize:11, fontWeight:800, color:"#dc2626", textAlign:"right" }}>{fmt(expenseSum("budget"))}</div>
                    <div style={{ fontSize:11, fontWeight:800, color:"#dc2626", textAlign:"right" }}>{fmt(expenseSum("actual"))}</div>
                    <div style={{ fontSize:10, color:"#64748b", textAlign:"right" }}>{fmt(expenseSum("budget")-expenseSum("actual"))}</div>
                    <div/>
                  </div>
                </div>
                <button onClick={()=>{setForm(p=>({...p, expense:[...(p.expense||[]), {section:"",category:"",item:"",budget:"",actual:"",diff:"",note:""}]}));}} style={{ width:"100%", padding:"8px", borderRadius:8, border:"2px dashed #e5e7eb", background:"white", color:"#64748b", fontWeight:700, fontSize:11, cursor:"pointer", marginBottom:16 }}>＋ 支出項目を追加</button>

                <div style={{ background:"#f8fafc", borderRadius:10, padding:"12px", marginBottom:16, border:"1px solid #e5e7eb" }}>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, fontSize:12 }}>
                    <div>収　入：<b style={{ color:"#059669" }}>{fmt(incomeSum("actual"))}</b> 円</div>
                    <div>支　出：<b style={{ color:"#dc2626" }}>{fmt(expenseSum("actual"))}</b> 円</div>
                    <div>残　高：<b>{fmt(incomeSum("actual")-expenseSum("actual"))}</b> 円</div>
                    <div><span style={{ fontSize:11, color:"#64748b" }}>周年基金残高</span>
                      <input value={form.fundBalance||""} onChange={e=>setForm(p=>({...p, fundBalance:e.target.value}))} placeholder="円" style={{ marginLeft:4, padding:"4px 6px", borderRadius:4, border:"1.5px solid #e5e7eb", fontSize:11, width:80, textAlign:"right" }}/>
                    </div>
                  </div>
                </div>
                <div style={{ fontSize:13, fontWeight:700, color:"#0f172a", marginBottom:8, borderTop:"1px solid #e5e7eb", paddingTop:12 }}>監査報告</div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8, marginBottom:16 }}>
                  <div><div style={{ fontSize:10, color:"#64748b", marginBottom:4 }}>監査日</div>
                    <input type="date" value={form.auditDate||""} onChange={e=>setForm(p=>({...p, auditDate:e.target.value}))} style={{ width:"100%", padding:"8px", borderRadius:6, border:"1.5px solid #e5e7eb", fontSize:12 }}/></div>
                  <div><div style={{ fontSize:10, color:"#64748b", marginBottom:4 }}>監事①</div>
                    <input value={form.auditor1||""} onChange={e=>setForm(p=>({...p, auditor1:e.target.value}))} style={{ width:"100%", padding:"8px", borderRadius:6, border:"1.5px solid #e5e7eb", fontSize:12 }}/></div>
                  <div><div style={{ fontSize:10, color:"#64748b", marginBottom:4 }}>監事②</div>
                    <input value={form.auditor2||""} onChange={e=>setForm(p=>({...p, auditor2:e.target.value}))} style={{ width:"100%", padding:"8px", borderRadius:6, border:"1.5px solid #e5e7eb", fontSize:12 }}/></div>
                </div>

                {/* CSV エクスポート / インポート */}
                <div style={{ borderTop:"1px solid #e5e7eb", paddingTop:12, marginBottom:16 }}>
                  <div style={{ fontSize:13, fontWeight:700, color:"#0f172a", marginBottom:8 }}>データ入出力</div>
                  <div style={{ display:"flex", gap:8 }}>
                    <button onClick={()=>{
                      let csv = "\uFEFF";
                      csv += "種別,款,項目,目,予算額,実績額,差引,摘要\n";
                      (form.income||[]).forEach(r=>{
                        csv += `収入,,${r.category},${r.item},${r.budget},${r.actual},${r.diff},"${(r.note||"").replace(/"/g,'""')}"\n`;
                      });
                      (form.expense||[]).forEach(r=>{
                        csv += `支出,${r.section},${r.category},${r.item},${r.budget},${r.actual},${r.diff},"${(r.note||"").replace(/"/g,'""')}"\n`;
                      });
                      csv += `\n情報,年度,${form.nendo}\n`;
                      csv += `情報,報告日,${form.date}\n`;
                      csv += `情報,学校名,${form.school}\n`;
                      csv += `情報,周年基金残高,${form.fundBalance}\n`;
                      csv += `情報,監査日,${form.auditDate}\n`;
                      csv += `情報,監事1,${form.auditor1}\n`;
                      csv += `情報,監事2,${form.auditor2}\n`;
                      const blob = new Blob([csv], { type:"text/csv;charset=utf-8" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url; a.download = `${form.nendo||"会計報告書"}_会計報告書.csv`;
                      a.click(); URL.revokeObjectURL(url);
                      setPublishMsg("CSVファイルをダウンロードしました");
                      setTimeout(()=>setPublishMsg(null), 3000);
                    }} style={{ flex:1, padding:"12px", borderRadius:10, border:"2px solid #059669", background:"white", color:"#059669", fontWeight:800, fontSize:13, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}>
                      📥 CSVエクスポート
                    </button>
                    <button onClick={()=>{
                      const input = document.createElement("input");
                      input.type = "file"; input.accept = ".csv";
                      input.onchange = (ev) => {
                        const file = ev.target.files[0]; if (!file) return;
                        const reader2 = new FileReader();
                        reader2.onload = (e2) => {
                          try {
                            const text = e2.target.result;
                            const lines = text.split("\n").map(l => {
                              const result = []; let cur = ""; let inQ = false;
                              for (let i = 0; i < l.length; i++) {
                                const ch = l[i];
                                if (ch === '"') { inQ = !inQ; }
                                else if (ch === ',' && !inQ) { result.push(cur); cur = ""; }
                                else { cur += ch; }
                              }
                              result.push(cur);
                              return result.map(c => c.trim().replace(/\r/g,""));
                            });
                            const ni = []; const ne = []; const info = {};
                            lines.forEach(cols => {
                              if (cols[0] === "収入") { ni.push({ category:cols[2]||"", item:cols[3]||"", budget:cols[4]||"", actual:cols[5]||"", diff:cols[6]||"", note:cols[7]||"" }); }
                              else if (cols[0] === "支出") { ne.push({ section:cols[1]||"", category:cols[2]||"", item:cols[3]||"", budget:cols[4]||"", actual:cols[5]||"", diff:cols[6]||"", note:cols[7]||"" }); }
                              else if (cols[0] === "情報") { info[cols[1]] = cols[2] || ""; }
                            });
                            if (ni.length === 0 && ne.length === 0) { setPublishMsg("CSVにデータが見つかりませんでした"); setTimeout(()=>setPublishMsg(null), 3000); return; }
                            setForm(p => ({
                              ...p,
                              ...(ni.length > 0 ? { income: ni } : {}),
                              ...(ne.length > 0 ? { expense: ne } : {}),
                              ...(info["年度"] ? { nendo: info["年度"] } : {}),
                              ...(info["報告日"] ? { date: info["報告日"] } : {}),
                              ...(info["学校名"] ? { school: info["学校名"] } : {}),
                              ...(info["周年基金残高"] ? { fundBalance: info["周年基金残高"] } : {}),
                              ...(info["監査日"] ? { auditDate: info["監査日"] } : {}),
                              ...(info["監事1"] ? { auditor1: info["監事1"] } : {}),
                              ...(info["監事2"] ? { auditor2: info["監事2"] } : {}),
                            }));
                            setPublishMsg(`CSVインポート完了（収入${ni.length}件・支出${ne.length}件）`);
                            setTimeout(()=>setPublishMsg(null), 4000);
                          } catch (err) { setPublishMsg("CSVの読み込みに失敗しました"); setTimeout(()=>setPublishMsg(null), 3000); }
                        };
                        reader2.readAsText(file, "UTF-8");
                      };
                      input.click();
                    }} style={{ flex:1, padding:"12px", borderRadius:10, border:"2px solid #0284c7", background:"white", color:"#0284c7", fontWeight:800, fontSize:13, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}>
                      📤 CSVインポート
                    </button>
                  </div>
                  <div style={{ fontSize:10, color:"#94a3b8", marginTop:6 }}>エクスポートしたCSVをExcelで編集し、インポートで反映できます</div>
                </div>

                <button onClick={()=>{
                  const dObj = form.date ? new Date(form.date+"T00:00:00") : null;
                  const dStr = dObj ? `令和${dObj.getFullYear()-2018}年${dObj.getMonth()+1}月${dObj.getDate()}日` : "";
                  const adObj = form.auditDate ? new Date(form.auditDate+"T00:00:00") : null;
                  const adStr = adObj ? `令和${adObj.getFullYear()-2018}年${adObj.getMonth()+1}月${adObj.getDate()}日` : "";
                  let html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${form.nendo} PTA会計報告書</title>`;
                  html += `<style>@page{size:A4 landscape;margin:15mm 10mm}body{font-family:"Yu Mincho","YuMincho","Hiragino Mincho ProN",serif;color:#000;font-size:11px}`;
                  html += `.title{text-align:center;font-size:18px;font-weight:bold;margin-bottom:4px}.info{text-align:right;font-size:11px;margin-bottom:10px}`;
                  html += `.section{font-weight:bold;font-size:13px;margin-top:12px;margin-bottom:4px}`;
                  html += `table{width:100%;border-collapse:collapse;margin-bottom:8px}th,td{border:1px solid #333;padding:3px 6px;font-size:10px}`;
                  html += `th{background:#f0f0f0;font-weight:bold;text-align:center}td.num{text-align:right}.total td{font-weight:bold;background:#f8f8f8}`;
                  html += `.summary{margin-top:10px;font-size:12px}.audit{margin-top:10px;font-size:11px}`;
                  html += `@media print{body{-webkit-print-color-adjust:exact}}</style></head><body>`;
                  html += `<div class="title">${form.nendo} Ｐ Ｔ Ａ 会 計 報 告 書</div>`;
                  html += `<div class="info">${dStr}<br/>${form.school||"仙台市立八木山中学校ＰＴＡ"}</div>`;
                  html += `<div class="section">１．収入の部</div>`;
                  html += `<table><thead><tr><th>項</th><th>目</th><th>予算額</th><th>収入状況</th><th>増減</th><th>摘要</th></tr></thead><tbody>`;
                  (form.income||[]).forEach(r=>{html+=`<tr><td>${r.category}</td><td>${r.item}</td><td class="num">${r.budget}</td><td class="num">${r.actual}</td><td class="num">${r.diff}</td><td>${r.note}</td></tr>`;});
                  html+=`<tr class="total"><td colspan="2">合計</td><td class="num">${fmt(incomeSum("budget"))}</td><td class="num">${fmt(incomeSum("actual"))}</td><td class="num">${fmt(incomeSum("actual")-incomeSum("budget"))}</td><td></td></tr></tbody></table>`;
                  html += `<div class="section">２．支出の部</div>`;
                  html += `<table><thead><tr><th>款</th><th>項</th><th>目</th><th>予算額</th><th>出額</th><th>差引残額</th><th>摘要</th></tr></thead><tbody>`;
                  (form.expense||[]).forEach(r=>{html+=`<tr><td>${r.section}</td><td>${r.category}</td><td>${r.item}</td><td class="num">${r.budget}</td><td class="num">${r.actual}</td><td class="num">${r.diff}</td><td>${r.note}</td></tr>`;});
                  html+=`<tr class="total"><td colspan="3">合計</td><td class="num">${fmt(expenseSum("budget"))}</td><td class="num">${fmt(expenseSum("actual"))}</td><td class="num">${fmt(expenseSum("budget")-expenseSum("actual"))}</td><td></td></tr></tbody></table>`;
                  html+=`<div class="summary">収入 ${fmt(incomeSum("actual"))} 円 ／ 支出 ${fmt(expenseSum("actual"))} 円 ／ 残高 ${fmt(incomeSum("actual")-expenseSum("actual"))} 円</div>`;
                  html+=`<div class="summary">周年事業基金残高 ${form.fundBalance||""} 円</div>`;
                  if(adStr) html+=`<div class="audit">会計帳簿、書類等を監査の結果、報告書に相違ないことを認めます。<br/>${adStr}　監事 ${form.auditor1||""}　${form.auditor2||""}</div>`;
                  html+=`</body></html>`;
                  const pw=window.open("","_blank","width=1000,height=700");
                  if(pw){pw.document.write(html);pw.document.close();pw.focus();setTimeout(()=>pw.print(),500);}
                  const docTitle=`${form.nendo} PTA会計報告書`;
                  const td4=new Date().toISOString().split("T")[0];
                  if(!documents.some(d=>d.name===docTitle)){setDocuments(prev=>[...prev,{id:`doc_${Date.now()}`,name:docTitle,category:"会議資料",createdAt:td4,author:currentUser.nickname,templateId:fk}]);}
                  setPublishMsg("印刷画面を開きました。資料管理にも保存済みです。");
                  setTimeout(()=>setPublishMsg(null),4000);
                }} style={{ width:"100%", padding:"14px", borderRadius:12, border:"none", background:"linear-gradient(135deg,#d97706,#b45309)", color:"white", fontWeight:800, fontSize:15, cursor:"pointer", marginBottom:8, display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
                  🖨️ 出力（印刷 / 保存）
                </button>
                <div style={{ fontSize:11, color:"#94a3b8", textAlign:"center" }}>印刷ダイアログで「印刷」または「PDFに保存」を選択できます</div>
              </div>
              );
            })()}

            {/* 階層3: 予算案 入力フォーム */}
            {publishNav.length === 3 && publishNav[2] === "yosan" && (() => {
              const fk = `yosan_${publishNav[1]}`;
              const form = publishForms?.[fk] || {};
              const setForm = (updater) => {
                setPublishForms(prev => {
                  const current = prev[fk] || {};
                  const next = typeof updater === "function" ? updater(current) : updater;
                  return { ...prev, [fk]: next };
                });
              };
              const num = (v) => { const n = parseInt(String(v||"").replace(/,/g,"")); return isNaN(n) ? 0 : n; };
              const fmt = (n) => n === 0 ? "" : n.toLocaleString();
              const incomeSumF = (field) => (form.income||[]).reduce((s,r) => s + num(r[field]), 0);
              const expenseSumF = (field) => (form.expense||[]).reduce((s,r) => s + num(r[field]), 0);
              const updateIncRow = (idx, field, value) => {
                const rows = [...(form.income||[])];
                rows[idx] = {...rows[idx], [field]: value};
                if (field === "newBudget") {
                  const prev = num(rows[idx].prevBudget);
                  const nw = num(value);
                  rows[idx].diff = fmt(nw - prev);
                }
                setForm(p => ({...p, income: rows}));
              };
              const updateExpRow = (idx, field, value) => {
                const rows = [...(form.expense||[])];
                rows[idx] = {...rows[idx], [field]: value};
                if (field === "newBudget") {
                  const prev = num(rows[idx].prevBudget);
                  const nw = num(value);
                  rows[idx].diff = fmt(nw - prev);
                }
                setForm(p => ({...p, expense: rows}));
              };
              // 前年度データ再取得ボタン用
              const reloadPrev = () => {
                const kaikeiKey = fk.replace("yosan_", "kaikei_");
                const pk = publishForms?.[kaikeiKey];
                if (!pk) { setPublishMsg("前年度の会計報告書データがありません。先に会計報告書を作成してください。"); setTimeout(()=>setPublishMsg(null), 4000); return; }
                const newIncome = (form.income||[]).map(r => {
                  const pr = (pk.income||[]).find(p => p.category === r.category && p.item === r.item);
                  return { ...r, prevBudget: pr ? pr.budget : r.prevBudget };
                });
                const newExpense = (form.expense||[]).map(r => {
                  const pr = (pk.expense||[]).find(p => p.category === r.category && p.item === r.item);
                  return { ...r, prevBudget: pr ? pr.budget : r.prevBudget };
                });
                setForm(p => ({...p, income: newIncome, expense: newExpense}));
                setPublishMsg("前年度データを再取得しました");
                setTimeout(()=>setPublishMsg(null), 3000);
              };
              const cellSt = { padding:"6px 4px", borderRadius:4, border:"1.5px solid #e5e7eb", fontSize:11, textAlign:"right" };
              const hdSt = { fontSize:9, fontWeight:800, color:"#d97706", padding:"4px 2px" };
              return (
              <div>
                <div style={{ fontSize:14, fontWeight:800, color:"#0f172a", marginBottom:4 }}>📋 ＰＴＡ会計予算（案）</div>
                <div style={{ fontSize:11, color:"#64748b", marginBottom:12 }}>前年度予算額は会計報告書から自動参照されます</div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:8 }}>
                  <div>
                    <div style={{ fontSize:11, fontWeight:700, color:"#64748b", marginBottom:4 }}>年度</div>
                    <input value={form.nendo||""} onChange={e=>setForm(p=>({...p, nendo:e.target.value}))} style={{ width:"100%", padding:"10px", borderRadius:8, border:"2px solid #e5e7eb", fontSize:13 }}/>
                  </div>
                  <div>
                    <div style={{ fontSize:11, fontWeight:700, color:"#64748b", marginBottom:4 }}>作成日</div>
                    <input type="date" value={form.date||""} onChange={e=>setForm(p=>({...p, date:e.target.value}))} style={{ width:"100%", padding:"10px", borderRadius:8, border:"2px solid #e5e7eb", fontSize:13 }}/>
                  </div>
                </div>
                <button onClick={reloadPrev} style={{ width:"100%", padding:"8px", borderRadius:8, border:"2px solid #6366f1", background:"white", color:"#6366f1", fontWeight:700, fontSize:11, cursor:"pointer", marginBottom:16 }}>🔄 前年度の会計報告書からデータを再取得</button>

                <div style={{ fontSize:13, fontWeight:800, color:"#059669", marginBottom:8, borderTop:"2px solid #059669", paddingTop:10 }}>１．収入の部</div>
                <div style={{ overflowX:"auto", marginBottom:8 }}>
                  <div style={{ display:"grid", gridTemplateColumns:"60px 60px 72px 72px 60px 1fr", gap:2, marginBottom:4, padding:"0 4px" }}>
                    <div style={hdSt}>項目</div><div style={hdSt}>目</div><div style={{...hdSt, color:"#94a3b8"}}>前年度予算</div><div style={hdSt}>本年度予算</div><div style={hdSt}>増減</div><div style={hdSt}>摘要</div>
                  </div>
                  {(form.income||[]).map((r, idx) => (
                    <div key={idx} style={{ display:"grid", gridTemplateColumns:"60px 60px 72px 72px 60px 1fr 24px", gap:2, marginBottom:2, alignItems:"center", padding:"0 4px" }}>
                      <input value={r.category||""} onChange={e=>updateIncRow(idx,"category",e.target.value)} style={{...cellSt, textAlign:"left", fontSize:10}}/>
                      <input value={r.item||""} onChange={e=>updateIncRow(idx,"item",e.target.value)} style={{...cellSt, textAlign:"left", fontSize:10}}/>
                      <input value={r.prevBudget||""} readOnly style={{...cellSt, background:"#f1f5f9", color:"#94a3b8"}}/>
                      <input value={r.newBudget||""} onChange={e=>updateIncRow(idx,"newBudget",e.target.value)} style={{...cellSt, background:"#fffbeb"}}/>
                      <input value={r.diff||""} readOnly style={{...cellSt, background:"#f8fafc", color:"#64748b"}}/>
                      <input value={r.note||""} onChange={e=>updateIncRow(idx,"note",e.target.value)} style={{...cellSt, textAlign:"left"}}/>
                      <button onClick={()=>{const rows=(form.income||[]).filter((_,i)=>i!==idx);setForm(p=>({...p,income:rows}));}} style={{ background:"#fef2f2", color:"#dc2626", border:"none", borderRadius:4, fontSize:9, cursor:"pointer", width:22, height:22 }}>✕</button>
                    </div>
                  ))}
                  <div style={{ display:"grid", gridTemplateColumns:"120px 72px 72px 60px 1fr", gap:2, padding:"4px", background:"#05966918", borderRadius:6, marginTop:4 }}>
                    <div style={{ fontSize:11, fontWeight:800, color:"#059669" }}>合　計</div>
                    <div style={{ fontSize:11, color:"#94a3b8", textAlign:"right" }}>{fmt(incomeSumF("prevBudget"))}</div>
                    <div style={{ fontSize:11, fontWeight:800, color:"#059669", textAlign:"right" }}>{fmt(incomeSumF("newBudget"))}</div>
                    <div style={{ fontSize:10, color:"#64748b", textAlign:"right" }}>{fmt(incomeSumF("newBudget")-incomeSumF("prevBudget"))}</div>
                    <div/>
                  </div>
                </div>
                <button onClick={()=>{setForm(p=>({...p, income:[...(p.income||[]), {category:"",item:"",prevBudget:"",newBudget:"",diff:"",note:""}]}));}} style={{ width:"100%", padding:"8px", borderRadius:8, border:"2px dashed #e5e7eb", background:"white", color:"#64748b", fontWeight:700, fontSize:11, cursor:"pointer", marginBottom:16 }}>＋ 収入項目を追加</button>

                <div style={{ fontSize:13, fontWeight:800, color:"#dc2626", marginBottom:8, borderTop:"2px solid #dc2626", paddingTop:10 }}>２．支出の部</div>
                <div style={{ overflowX:"auto", marginBottom:8 }}>
                  <div style={{ display:"grid", gridTemplateColumns:"40px 52px 52px 66px 66px 56px 1fr", gap:2, marginBottom:4, padding:"0 4px" }}>
                    <div style={hdSt}>款</div><div style={hdSt}>項目</div><div style={hdSt}>目</div><div style={{...hdSt, color:"#94a3b8"}}>前年度予算</div><div style={hdSt}>本年度予算</div><div style={hdSt}>増減</div><div style={hdSt}>摘要</div>
                  </div>
                  {(form.expense||[]).map((r, idx) => (
                    <div key={idx} style={{ display:"grid", gridTemplateColumns:"40px 52px 52px 66px 66px 56px 1fr 24px", gap:2, marginBottom:2, alignItems:"center", padding:"0 4px" }}>
                      <input value={r.section||""} onChange={e=>updateExpRow(idx,"section",e.target.value)} style={{...cellSt, textAlign:"left", fontSize:9}}/>
                      <input value={r.category||""} onChange={e=>updateExpRow(idx,"category",e.target.value)} style={{...cellSt, textAlign:"left", fontSize:9}}/>
                      <input value={r.item||""} onChange={e=>updateExpRow(idx,"item",e.target.value)} style={{...cellSt, textAlign:"left", fontSize:9}}/>
                      <input value={r.prevBudget||""} readOnly style={{...cellSt, background:"#f1f5f9", color:"#94a3b8"}}/>
                      <input value={r.newBudget||""} onChange={e=>updateExpRow(idx,"newBudget",e.target.value)} style={{...cellSt, background:"#fffbeb"}}/>
                      <input value={r.diff||""} readOnly style={{...cellSt, background:"#f8fafc", color:"#64748b"}}/>
                      <input value={r.note||""} onChange={e=>updateExpRow(idx,"note",e.target.value)} style={{...cellSt, textAlign:"left"}}/>
                      <button onClick={()=>{const rows=(form.expense||[]).filter((_,i)=>i!==idx);setForm(p=>({...p,expense:rows}));}} style={{ background:"#fef2f2", color:"#dc2626", border:"none", borderRadius:4, fontSize:9, cursor:"pointer", width:22, height:22 }}>✕</button>
                    </div>
                  ))}
                  <div style={{ display:"grid", gridTemplateColumns:"144px 66px 66px 56px 1fr", gap:2, padding:"4px", background:"#dc262618", borderRadius:6, marginTop:4 }}>
                    <div style={{ fontSize:11, fontWeight:800, color:"#dc2626" }}>合　計</div>
                    <div style={{ fontSize:11, color:"#94a3b8", textAlign:"right" }}>{fmt(expenseSumF("prevBudget"))}</div>
                    <div style={{ fontSize:11, fontWeight:800, color:"#dc2626", textAlign:"right" }}>{fmt(expenseSumF("newBudget"))}</div>
                    <div style={{ fontSize:10, color:"#64748b", textAlign:"right" }}>{fmt(expenseSumF("newBudget")-expenseSumF("prevBudget"))}</div>
                    <div/>
                  </div>
                </div>
                <button onClick={()=>{setForm(p=>({...p, expense:[...(p.expense||[]), {section:"",category:"",item:"",prevBudget:"",newBudget:"",diff:"",note:""}]}));}} style={{ width:"100%", padding:"8px", borderRadius:8, border:"2px dashed #e5e7eb", background:"white", color:"#64748b", fontWeight:700, fontSize:11, cursor:"pointer", marginBottom:16 }}>＋ 支出項目を追加</button>

                {/* 基金情報 */}
                <div style={{ background:"#f8fafc", borderRadius:10, padding:"12px", marginBottom:16, border:"1px solid #e5e7eb" }}>
                  <div style={{ fontSize:12, fontWeight:700, marginBottom:4 }}>３．基　金</div>
                  <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                    <span style={{ fontSize:12, color:"#64748b" }}>周年事業基金残高</span>
                    <input value={form.fundBalance||""} onChange={e=>setForm(p=>({...p, fundBalance:e.target.value}))} placeholder="円" style={{ padding:"6px 8px", borderRadius:4, border:"1.5px solid #e5e7eb", fontSize:12, width:100, textAlign:"right" }}/>
                    <span style={{ fontSize:12, color:"#64748b" }}>円</span>
                  </div>
                </div>

                {/* 出力ボタン */}
                <button onClick={()=>{
                  const dObj = form.date ? new Date(form.date+"T00:00:00") : null;
                  const dStr = dObj ? `令和${dObj.getFullYear()-2018}年${dObj.getMonth()+1}月${dObj.getDate()}日` : "";
                  let html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${form.nendo} PTA会計予算（案）</title>`;
                  html += `<style>@page{size:A4 landscape;margin:15mm 10mm}body{font-family:"Yu Mincho","YuMincho","Hiragino Mincho ProN",serif;color:#000;font-size:11px}`;
                  html += `.title{text-align:center;font-size:18px;font-weight:bold;margin-bottom:4px}.info{text-align:right;font-size:11px;margin-bottom:10px}`;
                  html += `.section{font-weight:bold;font-size:13px;margin-top:12px;margin-bottom:4px}`;
                  html += `table{width:100%;border-collapse:collapse;margin-bottom:8px}th,td{border:1px solid #333;padding:3px 6px;font-size:10px}`;
                  html += `th{background:#f0f0f0;font-weight:bold;text-align:center}td.num{text-align:right}.total td{font-weight:bold;background:#f8f8f8}`;
                  html += `.fund{margin-top:12px;font-size:12px;font-weight:bold}`;
                  html += `@media print{body{-webkit-print-color-adjust:exact}}</style></head><body>`;
                  html += `<div class="title">${form.nendo} Ｐ Ｔ Ａ 会 計 予 算（案）</div>`;
                  html += `<div class="info">${dStr}<br/>${form.school||"仙台市立八木山中学校ＰＴＡ"}</div>`;
                  html += `<div class="section">１．収入の部</div>`;
                  html += `<table><thead><tr><th>項</th><th>目</th><th>前年度予算額</th><th>本年度予算額</th><th>増減</th><th>摘要</th></tr></thead><tbody>`;
                  (form.income||[]).forEach(r=>{html+=`<tr><td>${r.category}</td><td>${r.item}</td><td class="num">${r.prevBudget}</td><td class="num">${r.newBudget}</td><td class="num">${r.diff}</td><td>${r.note}</td></tr>`;});
                  html+=`<tr class="total"><td colspan="2">合計</td><td class="num">${fmt(incomeSumF("prevBudget"))}</td><td class="num">${fmt(incomeSumF("newBudget"))}</td><td class="num">${fmt(incomeSumF("newBudget")-incomeSumF("prevBudget"))}</td><td></td></tr></tbody></table>`;
                  html += `<div class="section">２．支出の部</div>`;
                  html += `<table><thead><tr><th>款</th><th>項</th><th>目</th><th>前年度予算額</th><th>本年度予算額</th><th>増減</th><th>摘要</th></tr></thead><tbody>`;
                  (form.expense||[]).forEach(r=>{html+=`<tr><td>${r.section}</td><td>${r.category}</td><td>${r.item}</td><td class="num">${r.prevBudget}</td><td class="num">${r.newBudget}</td><td class="num">${r.diff}</td><td>${r.note}</td></tr>`;});
                  html+=`<tr class="total"><td colspan="3">合計</td><td class="num">${fmt(expenseSumF("prevBudget"))}</td><td class="num">${fmt(expenseSumF("newBudget"))}</td><td class="num">${fmt(expenseSumF("newBudget")-expenseSumF("prevBudget"))}</td><td></td></tr></tbody></table>`;
                  if(form.fundBalance) html+=`<div class="fund">３．基金　周年事業基金残高　${form.fundBalance}円</div>`;
                  html+=`</body></html>`;
                  const pw=window.open("","_blank","width=1000,height=700");
                  if(pw){pw.document.write(html);pw.document.close();pw.focus();setTimeout(()=>pw.print(),500);}
                  const docTitle=`${form.nendo} PTA会計予算（案）`;
                  const td5=new Date().toISOString().split("T")[0];
                  if(!documents.some(d=>d.name===docTitle)){setDocuments(prev=>[...prev,{id:`doc_${Date.now()}`,name:docTitle,category:"会議資料",createdAt:td5,author:currentUser.nickname,templateId:fk}]);}
                  setPublishMsg("印刷画面を開きました。資料管理にも保存済みです。");
                  setTimeout(()=>setPublishMsg(null),4000);
                }} style={{ width:"100%", padding:"14px", borderRadius:12, border:"none", background:"linear-gradient(135deg,#d97706,#b45309)", color:"white", fontWeight:800, fontSize:15, cursor:"pointer", marginBottom:8, display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
                  🖨️ 出力（印刷 / 保存）
                </button>
                <div style={{ fontSize:11, color:"#94a3b8", textAlign:"center" }}>印刷ダイアログで「印刷」または「PDFに保存」を選択できます</div>
              </div>
              );
            })()}

            {/* 階層3: 活動計画案 — 委員会一覧 */}
            {publishNav.length === 3 && publishNav[2] === "keikaku" && (
              <div>
                <div style={{ fontSize:14, fontWeight:800, color:"#0f172a", marginBottom:4 }}>📅 活動計画案</div>
                <div style={{ fontSize:12, color:"#64748b", marginBottom:16 }}>委員会を選択、または新規作成してください</div>

                {(() => {
                  const prefix = `keikaku_${publishNav[1]}_`;
                  const existing = Object.keys(publishForms).filter(k => k.startsWith(prefix)).map(k => {
                    const data = publishForms[k];
                    return { key: k, committee: data.committee || k.replace(prefix, ""), data };
                  });
                  return existing.length > 0 ? (
                    <div style={{ display:"flex", flexDirection:"column", gap:6, marginBottom:16 }}>
                      {existing.map(item => (
                        <div key={item.key} onClick={()=>navTo([...publishNav, item.committee])} style={{ display:"flex", alignItems:"center", gap:12, padding:"14px", borderRadius:12, background:"#f8fafc", cursor:"pointer", border:"2px solid #e5e7eb" }}>
                          <span style={{ fontSize:20 }}>📄</span>
                          <div style={{ flex:1 }}>
                            <div style={{ fontWeight:700, fontSize:14, color:"#0f172a" }}>（{item.committee}）</div>
                            <div style={{ fontSize:11, color:"#94a3b8" }}>{item.data.activities?.length || 0}件の活動計画</div>
                          </div>
                          <span style={{ color:"#cbd5e1", fontSize:20 }}>›</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ textAlign:"center", color:"#94a3b8", fontSize:13, padding:"20px 0", marginBottom:16 }}>まだ活動計画がありません</div>
                  );
                })()}

                <div style={{ borderTop:"1px solid #e5e7eb", paddingTop:16 }}>
                  <div style={{ fontSize:13, fontWeight:700, color:"#64748b", marginBottom:8 }}>新しい活動計画を作成</div>
                  <div style={{ display:"flex", gap:8 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:4, flex:1 }}>
                      <span style={{ fontSize:12, color:"#0f172a", flexShrink:0 }}>（</span>
                      <input id="newKeikakuName" placeholder="本部" style={{ flex:1, padding:"10px", borderRadius:8, border:"2px solid #e5e7eb", fontSize:13, fontWeight:700, textAlign:"center" }}/>
                      <span style={{ fontSize:12, color:"#0f172a", flexShrink:0 }}>）</span>
                    </div>
                    <button onClick={()=>{
                      const input = document.getElementById("newKeikakuName");
                      const name = (input?.value || "").trim();
                      if (!name) return;
                      const fk2 = `keikaku_${publishNav[1]}_${name}`;
                      if (!publishForms?.[fk2]) {
                        setPublishForms(prev => ({ ...prev, [fk2]: {
                          committee: name,
                          nendo: "令和８年度",
                          title: `${name} 活動計画（案）`,
                          activities: [{ month:"", day:"", content:"" }],
                          note: "",
                        }}));
                      }
                      input.value = "";
                      navTo([...publishNav, name]);
                    }} style={{ padding:"10px 16px", borderRadius:8, border:"none", background:"linear-gradient(135deg,#d97706,#b45309)", color:"white", fontWeight:800, fontSize:13, cursor:"pointer", flexShrink:0 }}>作成</button>
                  </div>
                </div>
              </div>
            )}

            {/* 階層4: 活動計画案 入力フォーム */}
            {publishNav.length === 4 && publishNav[2] === "keikaku" && (() => {
              const cmName = publishNav[3];
              const fk = `keikaku_${publishNav[1]}_${cmName}`;
              const form = publishForms?.[fk] || {};
              const setForm = (updater) => {
                setPublishForms(prev => {
                  const current = prev[fk] || {};
                  const next = typeof updater === "function" ? updater(current) : updater;
                  return { ...prev, [fk]: next };
                });
              };
              return (
              <div>
                <div style={{ fontSize:14, fontWeight:800, color:"#0f172a", marginBottom:4 }}>📅 （{cmName}）活動計画（案）</div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:16 }}>
                  <div>
                    <div style={{ fontSize:11, fontWeight:700, color:"#64748b", marginBottom:4 }}>年度</div>
                    <input value={form.nendo||""} onChange={e=>setForm(p=>({...p, nendo:e.target.value}))} style={{ width:"100%", padding:"10px", borderRadius:8, border:"2px solid #e5e7eb", fontSize:13 }}/>
                  </div>
                  <div>
                    <div style={{ fontSize:11, fontWeight:700, color:"#64748b", marginBottom:4 }}>タイトル</div>
                    <input value={form.title||""} onChange={e=>setForm(p=>({...p, title:e.target.value}))} style={{ width:"100%", padding:"10px", borderRadius:8, border:"2px solid #e5e7eb", fontSize:13 }}/>
                  </div>
                </div>

                <div style={{ fontSize:13, fontWeight:700, color:"#0f172a", marginBottom:8 }}>【活動計画】</div>
                <div style={{ display:"grid", gridTemplateColumns:"40px 36px 1fr", gap:4, marginBottom:6, padding:"6px 8px", background:"#d9770618", borderRadius:8 }}>
                  <div style={{ fontSize:10, fontWeight:800, color:"#d97706" }}>月</div>
                  <div style={{ fontSize:10, fontWeight:800, color:"#d97706" }}>日</div>
                  <div style={{ fontSize:10, fontWeight:800, color:"#d97706" }}>活動内容</div>
                </div>

                {(form.activities||[]).map((a, idx) => (
                  <div key={idx} style={{ display:"grid", gridTemplateColumns:"40px 36px 1fr 28px", gap:4, marginBottom:3, alignItems:"center" }}>
                    <input value={a.month||""} onChange={e=>{const as=[...form.activities];as[idx]={...as[idx],month:e.target.value};setForm(p=>({...p,activities:as}));}} style={{ padding:"7px 2px", borderRadius:6, border:"1.5px solid #e5e7eb", fontSize:12, textAlign:"center" }}/>
                    <input value={a.day||""} onChange={e=>{const as=[...form.activities];as[idx]={...as[idx],day:e.target.value};setForm(p=>({...p,activities:as}));}} placeholder="日" style={{ padding:"7px 2px", borderRadius:6, border:"1.5px solid #e5e7eb", fontSize:12, textAlign:"center" }}/>
                    <input value={a.content||""} onChange={e=>{const as=[...form.activities];as[idx]={...as[idx],content:e.target.value};setForm(p=>({...p,activities:as}));}} placeholder="活動内容" style={{ padding:"7px 6px", borderRadius:6, border:"1.5px solid #e5e7eb", fontSize:12 }}/>
                    {form.activities.length > 1 && (
                      <button onClick={()=>{const as=form.activities.filter((_,i)=>i!==idx);setForm(p=>({...p,activities:as}));}} style={{ background:"#fef2f2", color:"#dc2626", border:"none", borderRadius:4, padding:"2px", fontSize:10, cursor:"pointer", width:24, height:24, display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
                    )}
                  </div>
                ))}

                <button onClick={()=>{
                  setForm(p=>({...p, activities:[...(p.activities||[]), {month:"",day:"",content:""}]}));
                }} style={{ width:"100%", padding:"10px", borderRadius:10, border:"2px dashed #e5e7eb", background:"white", color:"#64748b", fontWeight:700, fontSize:12, cursor:"pointer", marginTop:8, marginBottom:16 }}>＋ 活動を追加</button>

                <div style={{ fontSize:13, fontWeight:700, color:"#0f172a", marginBottom:8, borderTop:"1px solid #e5e7eb", paddingTop:12 }}>【備考】</div>
                <textarea value={form.note||""} onChange={e=>setForm(p=>({...p, note:e.target.value}))} placeholder="備考・特記事項を入力してください" rows={4} style={{ width:"100%", padding:"12px", borderRadius:8, border:"2px solid #e5e7eb", fontSize:12, lineHeight:1.8, resize:"vertical", marginBottom:16 }}/>

                <button onClick={()=>{
                  let html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${form.nendo} ${form.title}</title>`;
                  html += `<style>@page{size:A4;margin:20mm 15mm 15mm 15mm}body{font-family:"Yu Mincho","YuMincho","Hiragino Mincho ProN",serif;color:#000;font-size:13px;line-height:1.6}`;
                  html += `.title{text-align:center;font-size:20px;font-weight:bold;margin-bottom:20px}`;
                  html += `table{width:100%;border-collapse:collapse;margin-bottom:16px}th,td{border:1px solid #333;padding:6px 8px;font-size:12px}`;
                  html += `th{background:#f5f5f5;font-weight:bold;text-align:center}td.center{text-align:center}td.content{text-align:left}`;
                  html += `.section{font-weight:bold;font-size:14px;margin-top:16px;margin-bottom:8px}`;
                  html += `.note-box{border:1px solid #333;padding:12px;min-height:80px;font-size:12px;line-height:1.8;white-space:pre-wrap}`;
                  html += `@media print{body{-webkit-print-color-adjust:exact}}</style></head><body>`;
                  html += `<div class="title">${form.nendo} ${form.title}</div>`;
                  html += `<div class="section">【活動計画】</div>`;
                  html += `<table><thead><tr><th style="width:35px">月</th><th style="width:30px">日</th><th>活動内容</th></tr></thead><tbody>`;
                  (form.activities||[]).forEach(a => {
                    html += `<tr><td class="center">${a.month||""}</td><td class="center">${a.day||""}</td><td class="content">${a.content||""}</td></tr>`;
                  });
                  html += `</tbody></table>`;
                  if (form.note) {
                    html += `<div class="section">【備考】</div>`;
                    html += `<div class="note-box">${(form.note||"").replace(/\n/g,"<br/>")}</div>`;
                  }
                  html += `</body></html>`;
                  const pw = window.open("","_blank","width=800,height=1000");
                  if(pw){pw.document.write(html);pw.document.close();pw.focus();setTimeout(()=>pw.print(),500);}
                  const docTitle = `${form.nendo} ${form.title}`;
                  const td6 = new Date().toISOString().split("T")[0];
                  if(!documents.some(d=>d.name===docTitle)){setDocuments(prev=>[...prev,{id:`doc_${Date.now()}`,name:docTitle,category:"会議資料",createdAt:td6,author:currentUser.nickname,templateId:fk}]);}
                  setPublishMsg("印刷画面を開きました。資料管理にも保存済みです。");
                  setTimeout(()=>setPublishMsg(null),4000);
                }} style={{ width:"100%", padding:"14px", borderRadius:12, border:"none", background:"linear-gradient(135deg,#d97706,#b45309)", color:"white", fontWeight:800, fontSize:15, cursor:"pointer", marginBottom:8, display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
                  🖨️ 出力（印刷 / 保存）
                </button>
                <div style={{ fontSize:11, color:"#94a3b8", textAlign:"center" }}>印刷ダイアログで「印刷」または「PDFに保存」を選択できます</div>
              </div>
              );
            })()}

            {/* 階層3: 総会資料補足説明 入力フォーム（運営委員会経由 or 総会資料経由） */}
            {((publishNav.length === 3 && publishNav[2] === "hosoku") || (publishNav.length === 2 && publishNav[0] === "soukai" && publishNav[1] === "hosoku_edit")) && (() => {
              const fk = publishNav[0] === "soukai" ? "hosoku_unei_1" : `hosoku_${publishNav[1]}`;
              const form = publishForms?.[fk] || {};
              const setForm = (updater) => {
                setPublishForms(prev => {
                  const current = prev[fk] || {};
                  const next = typeof updater === "function" ? updater(current) : updater;
                  return { ...prev, [fk]: next };
                });
              };
              const updateFormat = (field, value) => {
                setForm(p => ({...p, format: {...(p.format||{}), [field]: value}}));
              };
              const updateSection = (idx, updates) => {
                const ss = [...(form.sections||[])];
                ss[idx] = {...ss[idx], ...updates};
                setForm(p => ({...p, sections: ss}));
              };
              const updateComment = (sIdx, cIdx, field, value) => {
                const ss = [...(form.sections||[])];
                const comments = [...(ss[sIdx].comments||[])];
                comments[cIdx] = {...comments[cIdx], [field]: value};
                ss[sIdx] = {...ss[sIdx], comments};
                setForm(p => ({...p, sections: ss}));
              };
              const updateItem = (sIdx, cIdx, iIdx, value) => {
                const ss = [...(form.sections||[])];
                const comments = [...(ss[sIdx].comments||[])];
                const items = [...(comments[cIdx].items||[])];
                items[iIdx] = value;
                comments[cIdx] = {...comments[cIdx], items};
                ss[sIdx] = {...ss[sIdx], comments};
                setForm(p => ({...p, sections: ss}));
              };
              const fmt = form.format || {};
              return (
              <div>
                <div style={{ fontSize:14, fontWeight:800, color:"#0f172a", marginBottom:12 }}>📝 総会資料　補足説明</div>

                {/* 年度 */}
                <div style={{ marginBottom:12 }}>
                  <div style={{ fontSize:11, fontWeight:700, color:"#64748b", marginBottom:4 }}>年度</div>
                  <input value={form.nendo||""} onChange={e=>setForm(p=>({...p, nendo:e.target.value}))} style={{ width:"100%", padding:"10px", borderRadius:8, border:"2px solid #e5e7eb", fontSize:13 }}/>
                </div>

                {/* 総会形式 */}
                <div style={{ background:"#f8fafc", borderRadius:10, padding:"14px", marginBottom:16, border:"1px solid #e5e7eb" }}>
                  <div style={{ fontSize:13, fontWeight:700, color:"#0f172a", marginBottom:8 }}>・総会の形式について</div>
                  <textarea value={fmt.desc||""} onChange={e=>updateFormat("desc",e.target.value)} rows={2} style={{ width:"100%", padding:"8px", borderRadius:6, border:"1.5px solid #e5e7eb", fontSize:12, lineHeight:1.6, resize:"vertical", marginBottom:8 }}/>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                    <div>
                      <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                        <input value={fmt.deadlineLabel||""} onChange={e=>updateFormat("deadlineLabel",e.target.value)} style={{ width:80, padding:"6px", borderRadius:4, border:"1.5px solid #e5e7eb", fontSize:11, fontWeight:700 }}/>
                        <input value={fmt.deadline||""} onChange={e=>updateFormat("deadline",e.target.value)} placeholder="4月21日（月）" style={{ flex:1, padding:"6px", borderRadius:4, border:"1.5px solid #e5e7eb", fontSize:11 }}/>
                      </div>
                    </div>
                    <div>
                      <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                        <input value={fmt.reportLabel||""} onChange={e=>updateFormat("reportLabel",e.target.value)} style={{ width:80, padding:"6px", borderRadius:4, border:"1.5px solid #e5e7eb", fontSize:11, fontWeight:700 }}/>
                        <input value={fmt.report||""} onChange={e=>updateFormat("report",e.target.value)} placeholder="5月1日（木）" style={{ flex:1, padding:"6px", borderRadius:4, border:"1.5px solid #e5e7eb", fontSize:11 }}/>
                      </div>
                      <input value={fmt.reportNote||""} onChange={e=>updateFormat("reportNote",e.target.value)} placeholder="（併せて先生方との交流会を予定）" style={{ width:"100%", marginTop:4, padding:"6px", borderRadius:4, border:"1.5px solid #e5e7eb", fontSize:10, color:"#64748b" }}/>
                    </div>
                  </div>
                </div>

                {/* 議案セクション */}
                <div style={{ fontSize:13, fontWeight:700, color:"#0f172a", marginBottom:8, borderTop:"1px solid #e5e7eb", paddingTop:12 }}>議案・セクション</div>
                {(form.sections||[]).map((sec, sIdx) => (
                  <div key={sIdx} style={{ marginBottom:12, padding:"12px", borderRadius:10, background: sec.type==="heading" ? "#d9770610" : "#f8fafc", border: sec.type==="heading" ? "2px solid #d97706" : "1px solid #e5e7eb" }}>
                    <div style={{ display:"flex", gap:6, marginBottom:8, alignItems:"center" }}>
                      <select value={sec.type||"gian"} onChange={e=>updateSection(sIdx,{type:e.target.value})} style={{ padding:"5px", borderRadius:4, border:"1.5px solid #e5e7eb", fontSize:11 }}>
                        <option value="heading">見出し</option>
                        <option value="gian">議案</option>
                      </select>
                      {sec.type === "heading" ? (
                        <input value={sec.text||""} onChange={e=>updateSection(sIdx,{text:e.target.value})} placeholder="１．協　議" style={{ flex:1, padding:"8px", borderRadius:6, border:"2px solid #d97706", fontSize:13, fontWeight:800 }}/>
                      ) : (
                        <>
                          <input value={sec.number||""} onChange={e=>updateSection(sIdx,{number:e.target.value})} placeholder="第1号議案" style={{ width:80, padding:"6px", borderRadius:4, border:"1.5px solid #e5e7eb", fontSize:11, fontWeight:700 }}/>
                          <input value={sec.title||""} onChange={e=>updateSection(sIdx,{title:e.target.value})} placeholder="議案タイトル" style={{ flex:1, padding:"6px", borderRadius:4, border:"1.5px solid #e5e7eb", fontSize:11 }}/>
                        </>
                      )}
                      {(form.sections||[]).length > 1 && (
                        <button onClick={()=>{const ss=(form.sections||[]).filter((_,i)=>i!==sIdx);setForm(p=>({...p,sections:ss}));}} style={{ background:"#fef2f2", color:"#dc2626", border:"none", borderRadius:4, padding:"2px 6px", fontSize:10, cursor:"pointer" }}>✕</button>
                      )}
                    </div>

                    {/* 議案のコメントブロック */}
                    {sec.type === "gian" && (sec.comments||[]).map((cm, cIdx) => (
                      <div key={cIdx} style={{ marginLeft:8, marginBottom:8, padding:"8px", borderRadius:8, background:"white", border:"1px solid #e5e7eb" }}>
                        <div style={{ display:"flex", gap:4, marginBottom:6, alignItems:"center" }}>
                          <input value={cm.heading||""} onChange={e=>updateComment(sIdx,cIdx,"heading",e.target.value)} placeholder="小見出し（例：2.支出の部）" style={{ flex:1, padding:"6px", borderRadius:4, border:"1.5px solid #e5e7eb", fontSize:11, fontWeight:700 }}/>
                          <button onClick={()=>{
                            const ss=[...(form.sections||[])];
                            ss[sIdx]={...ss[sIdx], comments:(ss[sIdx].comments||[]).filter((_,i)=>i!==cIdx)};
                            setForm(p=>({...p,sections:ss}));
                          }} style={{ background:"#fef2f2", color:"#dc2626", border:"none", borderRadius:4, padding:"2px 6px", fontSize:9, cursor:"pointer" }}>✕</button>
                        </div>
                        {(cm.items||[]).map((item, iIdx) => (
                          <div key={iIdx} style={{ display:"flex", gap:4, marginBottom:3, marginLeft:8 }}>
                            <span style={{ color:"#d97706", fontSize:12, flexShrink:0 }}>・</span>
                            <input value={item} onChange={e=>updateItem(sIdx,cIdx,iIdx,e.target.value)} placeholder="補足コメント" style={{ flex:1, padding:"5px 6px", borderRadius:4, border:"1.5px solid #e5e7eb", fontSize:11 }}/>
                            <button onClick={()=>{
                              const ss=[...(form.sections||[])];
                              const cms=[...(ss[sIdx].comments||[])];
                              cms[cIdx]={...cms[cIdx], items:(cms[cIdx].items||[]).filter((_,i)=>i!==iIdx)};
                              ss[sIdx]={...ss[sIdx], comments:cms};
                              setForm(p=>({...p,sections:ss}));
                            }} style={{ background:"#fef2f2", color:"#dc2626", border:"none", borderRadius:4, padding:"1px 4px", fontSize:9, cursor:"pointer" }}>✕</button>
                          </div>
                        ))}
                        <button onClick={()=>{
                          const ss=[...(form.sections||[])];
                          const cms=[...(ss[sIdx].comments||[])];
                          cms[cIdx]={...cms[cIdx], items:[...(cms[cIdx].items||[]), ""]};
                          ss[sIdx]={...ss[sIdx], comments:cms};
                          setForm(p=>({...p,sections:ss}));
                        }} style={{ marginLeft:8, marginTop:2, background:"none", border:"1.5px dashed #d97706", color:"#d97706", borderRadius:4, padding:"2px 8px", fontSize:9, fontWeight:700, cursor:"pointer" }}>＋ コメント追加</button>
                      </div>
                    ))}
                    {sec.type === "gian" && (
                      <button onClick={()=>{
                        const ss=[...(form.sections||[])];
                        ss[sIdx]={...ss[sIdx], comments:[...(ss[sIdx].comments||[]), {heading:"", items:[""]}]};
                        setForm(p=>({...p,sections:ss}));
                      }} style={{ marginLeft:8, background:"none", border:"1.5px dashed #0284c7", color:"#0284c7", borderRadius:6, padding:"4px 10px", fontSize:10, fontWeight:700, cursor:"pointer" }}>＋ 補足ブロック追加</button>
                    )}
                  </div>
                ))}

                <div style={{ display:"flex", gap:8, marginBottom:16 }}>
                  <button onClick={()=>{setForm(p=>({...p,sections:[...(p.sections||[]),{type:"heading",text:""}]}));}} style={{ flex:1, padding:"8px", borderRadius:8, border:"2px dashed #d97706", background:"white", color:"#d97706", fontWeight:700, fontSize:11, cursor:"pointer" }}>＋ 見出し追加</button>
                  <button onClick={()=>{setForm(p=>({...p,sections:[...(p.sections||[]),{type:"gian",number:"",title:"",comments:[]}]}));}} style={{ flex:1, padding:"8px", borderRadius:8, border:"2px dashed #0284c7", background:"white", color:"#0284c7", fontWeight:700, fontSize:11, cursor:"pointer" }}>＋ 議案追加</button>
                </div>

                {/* 末尾 */}
                <div style={{ marginBottom:16 }}>
                  <input value={form.closing||""} onChange={e=>setForm(p=>({...p, closing:e.target.value}))} placeholder="以上" style={{ width:100, padding:"8px", borderRadius:6, border:"1.5px solid #e5e7eb", fontSize:12, textAlign:"right" }}/>
                </div>

                {/* 出力ボタン */}
                <button onClick={()=>{
                  const f = form.format || {};
                  let html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${form.nendo}総会資料 補足説明</title>`;
                  html += `<style>@page{size:A4;margin:20mm}body{font-family:"Yu Mincho","YuMincho","Hiragino Mincho ProN",serif;color:#000;font-size:13px;line-height:1.8}`;
                  html += `.title{text-align:center;font-size:18px;font-weight:bold;margin-bottom:16px}`;
                  html += `.format-box{margin-bottom:20px}.format-label{font-weight:bold;margin-bottom:4px}`;
                  html += `.date-row{margin-left:2em;font-size:13px;margin-bottom:2px}`;
                  html += `.heading{font-weight:bold;font-size:15px;margin-top:16px;margin-bottom:8px}`;
                  html += `.gian-title{font-weight:bold;font-size:13px;margin-top:12px;margin-bottom:4px}`;
                  html += `.comment-heading{font-weight:bold;font-size:12px;margin-top:8px;margin-bottom:2px;margin-left:1em}`;
                  html += `.comment-item{font-size:12px;margin-left:2em;line-height:1.8}`;
                  html += `.closing{text-align:right;margin-top:24px;font-size:13px}`;
                  html += `@media print{body{-webkit-print-color-adjust:exact}}</style></head><body>`;
                  html += `<div class="title">${form.nendo}総会資料　補足説明</div>`;
                  html += `<div class="format-box">`;
                  html += `<div class="format-label">・総会の形式について</div>`;
                  html += `<div style="margin-left:1em">${(f.desc||"").replace(/\n/g,"<br/>")}</div>`;
                  if (f.deadline) html += `<div class="date-row">${f.deadlineLabel||""}　${f.deadline}</div>`;
                  if (f.report) html += `<div class="date-row">${f.reportLabel||""}　${f.report}${f.reportNote||""}</div>`;
                  html += `</div>`;
                  (form.sections||[]).forEach(sec => {
                    if (sec.type === "heading") {
                      html += `<div class="heading">${sec.text}</div>`;
                    } else {
                      html += `<div class="gian-title">${sec.number}　${sec.title}</div>`;
                      (sec.comments||[]).forEach(cm => {
                        if (cm.heading) html += `<div class="comment-heading">${cm.heading}</div>`;
                        (cm.items||[]).forEach(item => {
                          if (item.trim()) html += `<div class="comment-item">・${item}</div>`;
                        });
                      });
                    }
                  });
                  if (form.closing) html += `<div class="closing">${form.closing}</div>`;
                  html += `</body></html>`;
                  const pw = window.open("","_blank","width=800,height=1000");
                  if(pw){pw.document.write(html);pw.document.close();pw.focus();setTimeout(()=>pw.print(),500);}
                  const docTitle = `${form.nendo}総会資料 補足説明`;
                  const td7 = new Date().toISOString().split("T")[0];
                  if(!documents.some(d=>d.name===docTitle)){setDocuments(prev=>[...prev,{id:`doc_${Date.now()}`,name:docTitle,category:"会議資料",createdAt:td7,author:currentUser.nickname,templateId:fk}]);}
                  setPublishMsg("印刷画面を開きました。資料管理にも保存済みです。");
                  setTimeout(()=>setPublishMsg(null),4000);
                }} style={{ width:"100%", padding:"14px", borderRadius:12, border:"none", background:"linear-gradient(135deg,#d97706,#b45309)", color:"white", fontWeight:800, fontSize:15, cursor:"pointer", marginBottom:8, display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
                  🖨️ 出力（印刷 / 保存）
                </button>
                <div style={{ fontSize:11, color:"#94a3b8", textAlign:"center" }}>印刷ダイアログで「印刷」または「PDFに保存」を選択できます</div>
              </div>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// チャット画面群
// ============================================================
function MessageBubble({ msg, isMe }) {
  const [expandImg, setExpandImg] = useState(null);
  return (
    <div style={{ display:"flex", flexDirection:isMe?"row-reverse":"row", alignItems:"flex-start", gap:8, marginBottom:16 }}>
      {!isMe && <div style={{ width:38, height:38, borderRadius:"50%", background:"linear-gradient(135deg,#334155,#475569)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, flexShrink:0, marginTop:2 }}>{msg.avatar}</div>}
      <div style={{ maxWidth:"75%", display:"flex", flexDirection:"column", alignItems:isMe?"flex-end":"flex-start" }}>
        {!isMe && <div style={{ fontSize:11, color:"#64748b", marginBottom:3, fontWeight:600 }}>{msg.nickname}・{ROLES.find(r=>r.code===msg.role)?.label}</div>}
        {msg.text && (
          <div style={{ background:isMe?"linear-gradient(135deg,#0284c7,#0369a1)":"white", color:isMe?"white":"#1e293b", padding:"10px 14px", fontSize:14, lineHeight:1.6, borderRadius:isMe?"18px 18px 4px 18px":"18px 18px 18px 4px", boxShadow:isMe?"0 2px 12px rgba(2,132,199,0.3)":"0 2px 8px rgba(0,0,0,0.06)", wordBreak:"break-word" }}>{msg.text}</div>
        )}
        {/* 添付ファイル表示 */}
        {msg.attachments && msg.attachments.length > 0 && (
          <div style={{ display:"flex", flexDirection:"column", gap:6, marginTop:msg.text?6:0, maxWidth:"100%" }}>
            {msg.attachments.map((att,i) => (
              <div key={i} style={{ borderRadius:12, overflow:"hidden", boxShadow:"0 2px 8px rgba(0,0,0,0.1)" }}>
                {att.fileType==="image" && (
                  <img src={att.dataUrl} alt={att.name} onClick={()=>setExpandImg(expandImg===i?null:i)} style={{ maxWidth:220, borderRadius:12, cursor:"pointer", display:"block" }}/>
                )}
                {att.fileType==="video" && (
                  <video src={att.dataUrl} controls style={{ maxWidth:220, borderRadius:12, display:"block" }}/>
                )}
                {att.fileType==="pdf" && (
                  <a href={att.dataUrl} download={att.name} style={{ display:"flex", alignItems:"center", gap:8, padding:"10px 14px", background:isMe?"rgba(255,255,255,0.15)":"#f8fafc", borderRadius:12, textDecoration:"none" }}>
                    <div style={{ width:32, height:32, borderRadius:8, background:"#dc2626", display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, color:"white", fontWeight:800, flexShrink:0 }}>PDF</div>
                    <div style={{ flex:1, overflow:"hidden" }}>
                      <div style={{ fontSize:12, fontWeight:600, color:isMe?"white":"#0f172a", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{att.name}</div>
                      <div style={{ fontSize:10, color:isMe?"rgba(255,255,255,0.6)":"#94a3b8" }}>タップで保存</div>
                    </div>
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
        <div style={{ fontSize:10, color:"#94a3b8", marginTop:4 }}>{formatTime(msg.ts)}</div>
      </div>
    </div>
  );
}

function ChatRoomView({ channelId, channelName, channelDesc, messages, onSend, currentUser, onBack, onHome, readOnly }) {
  const [text, setText] = useState("");
  const [attachFiles, setAttachFiles] = useState([]);
  const [showFiles, setShowFiles] = useState(false);
  const bottomRef = useRef(null);
  const msgs = messages[channelId] || [];
  useEffect(()=>{ bottomRef.current?.scrollIntoView({ behavior:"smooth" }); }, [msgs.length]);

  const CHAT_ALLOWED = ["application/pdf","image/jpeg","image/png","image/gif","image/webp"];
  const handleFileAdd = (e) => {
    const files = Array.from(e.target.files);
    files.forEach(file => {
      const fileType = file.type==="application/pdf"?"pdf":file.type.startsWith("video/")?"video":file.type.startsWith("image/")?"image":null;
      if (!fileType) return;
      const reader = new FileReader();
      reader.onload = () => {
        setAttachFiles(prev => prev.length>=3?prev:[...prev, { name:file.name, size:file.size, dataUrl:reader.result, fileType }]);
      };
      reader.readAsDataURL(file);
    });
    e.target.value = "";
  };

  const handleSend = () => {
    if (!text.trim() && attachFiles.length===0) return;
    onSend(channelId, text.trim(), attachFiles);
    setText(""); setAttachFiles([]);
  };

  // チャンネル内の全添付ファイル
  const allChannelFiles = msgs.filter(m=>m.attachments&&m.attachments.length>0)
    .flatMap(m=>m.attachments.map(att=>({ ...att, sender:m.nickname, ts:m.ts })))
    .reverse();

  // ファイル保管庫画面
  if (showFiles) return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", background:"#f0f4f8" }}>
      <Header title={`📁 ${channelName}`} onBack={()=>setShowFiles(false)} onHome={onHome}/>
      <div style={{ flex:1, overflow:"auto" }}>
        {allChannelFiles.length===0 ? (
          <div style={{ textAlign:"center", padding:"60px 20px" }}>
            <div style={{ fontSize:48, marginBottom:12 }}>📁</div>
            <div style={{ fontSize:14, fontWeight:700, color:"#0f172a" }}>ファイルはまだありません</div>
          </div>
        ) : (
          <div style={{ padding:"8px 0" }}>
            {allChannelFiles.map((f,i) => (
              <div key={i} style={{ display:"flex", alignItems:"center", gap:10, padding:"12px 16px", background:"white", borderBottom:"1px solid #f1f5f9" }}>
                {f.fileType==="image"
                  ? <img src={f.dataUrl} alt="" style={{ width:40, height:40, borderRadius:8, objectFit:"cover", flexShrink:0 }}/>
                  : f.fileType==="video"
                  ? <div style={{ width:40, height:40, borderRadius:8, background:"linear-gradient(135deg,#7c3aed,#5b21b6)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0 }}>🎥</div>
                  : <div style={{ width:40, height:40, borderRadius:8, background:"linear-gradient(135deg,#dc2626,#b91c1c)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:14, color:"white", fontWeight:800, flexShrink:0 }}>PDF</div>
                }
                <div style={{ flex:1, overflow:"hidden" }}>
                  <div style={{ fontSize:13, fontWeight:700, color:"#0f172a", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{f.name}</div>
                  <div style={{ fontSize:11, color:"#94a3b8" }}>{f.sender} · {formatTime(f.ts)}</div>
                </div>
                <a href={f.dataUrl} download={f.name} style={{ padding:"6px 10px", borderRadius:8, background:"#059669", color:"white", fontSize:11, fontWeight:700, textDecoration:"none", flexShrink:0 }}>保存</a>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", background:"#f0f4f8" }}>
      <Header title={channelName} onBack={onBack} onHome={onHome} right={
        <button onClick={()=>setShowFiles(true)} style={{ background:"rgba(255,255,255,0.15)", border:"none", color:"white", fontSize:16, cursor:"pointer", padding:"6px 8px", borderRadius:8 }}>📁</button>
      }/>
      {readOnly && (
        <div style={{ background:"#fffbeb", padding:"8px 16px", fontSize:12, color:"#d97706", fontWeight:700, textAlign:"center", flexShrink:0 }}>👁️ 閲覧のみ（本部役員モード）</div>
      )}
      <div style={{ flex:1, overflow:"auto", padding:"16px 14px", WebkitOverflowScrolling:"touch" }}>
        {msgs.length===0
          ? <div style={{ textAlign:"center", color:"#94a3b8", fontSize:14, marginTop:60, lineHeight:2 }}>まだメッセージはありません<br/>最初のメッセージを送りましょう！</div>
          : msgs.map(msg=><MessageBubble key={msg.id} msg={msg} isMe={msg.userId===currentUser.id}/>)
        }
        <div ref={bottomRef}/>
      </div>
      {!readOnly && (
        <div style={{ background:"white", borderTop:"1px solid #e5e7eb", padding:"8px 12px", flexShrink:0 }}>
          {/* 添付プレビュー */}
          {attachFiles.length > 0 && (
            <div style={{ display:"flex", gap:6, marginBottom:8, overflowX:"auto", paddingBottom:4 }}>
              {attachFiles.map((f,i) => (
                <div key={i} style={{ position:"relative", flexShrink:0 }}>
                  {f.fileType==="image"
                    ? <img src={f.dataUrl} alt="" style={{ width:56, height:56, borderRadius:8, objectFit:"cover" }}/>
                    : <div style={{ width:56, height:56, borderRadius:8, background:f.fileType==="video"?"#7c3aed":"#dc2626", display:"flex", alignItems:"center", justifyContent:"center", color:"white", fontSize:f.fileType==="video"?24:11, fontWeight:800 }}>{f.fileType==="video"?"🎥":"PDF"}</div>
                  }
                  <button onClick={()=>setAttachFiles(prev=>prev.filter((_,j)=>j!==i))} style={{ position:"absolute", top:-4, right:-4, width:20, height:20, borderRadius:"50%", background:"#dc2626", color:"white", border:"none", fontSize:12, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", lineHeight:1 }}>✕</button>
                </div>
              ))}
            </div>
          )}
          <div style={{ display:"flex", gap:8, alignItems:"flex-end" }}>
            {attachFiles.length < 3 && (
              <label style={{ width:40, height:40, borderRadius:"50%", background:"#f1f5f9", display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", fontSize:18, flexShrink:0 }}>
                ＋
                <input type="file" accept="application/pdf,image/*,video/*" multiple onChange={handleFileAdd} style={{ display:"none" }}/>
              </label>
            )}
            <input value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>{ if(e.key==="Enter"&&!e.shiftKey){ e.preventDefault(); handleSend(); }}} placeholder="メッセージを入力..." style={{ flex:1, padding:"10px 16px", borderRadius:24, border:"2px solid #e5e7eb", fontSize:14, outline:"none", background:"#f8fafc", color:"#1e293b" }}/>
            <button onClick={handleSend} disabled={!text.trim()&&attachFiles.length===0} style={{ width:40, height:40, borderRadius:"50%", border:"none", background:(text.trim()||attachFiles.length>0)?"linear-gradient(135deg,#0284c7,#0369a1)":"#e5e7eb", color:"white", fontSize:18, cursor:(text.trim()||attachFiles.length>0)?"pointer":"not-allowed", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>➤</button>
          </div>
        </div>
      )}
    </div>
  );
}

function ChatScreen({ messages, dmMessages, onSendChannel, onSendDM, currentUser, onBack, onHome, USERS, channels }) {
  const [tab, setTab] = useState("channels");
  const [activeChannel, setActiveChannel] = useState(null);
  const [activeDM, setActiveDM] = useState(null);
  const [openCats, setOpenCats] = useState({}); // 折りたたみ制御

  // アクセス可能なチャンネルのみ表示
  const visibleChannels = (channels || CHANNELS).filter(ch => canAccessChannel(ch, currentUser));

  const others = USERS.filter(u=>u.id!==currentUser.id);
  const toggleCat = (catId) => setOpenCats(prev => ({ ...prev, [catId]: !prev[catId] }));

  // DMカテゴリ定義 — 管理者画面のchannelsから動的生成（childrenが空ならUSERSから自動収集）
  const chFieldMap = { "学年":"grade", "部活":"club", "地区":"district" };
  const safeChannels = channels || CHANNELS;
  const DM_CATEGORIES = [
    { id:"honbu_school", label:"本部役員・学校", icon:"👑", filter: u => HONBU_ROLES.includes(u.role) || SCHOOL_ROLES.includes(u.role) },
    { id:"unei_member", label:"運営委員会", icon:"🏛️", filter: u => u.role==="委員長" },
    { id:"teacher", label:"先生", icon:"🎓", filter: u => u.role==="先生" || u.category==="先生" },
    { id:"general", label:"一般会員", icon:"👤", filter: u => u.role==="一般" || (!HONBU_ROLES.includes(u.role) && !SCHOOL_ROLES.includes(u.role) && u.role!=="委員長" && u.role!=="先生"),
      subs: safeChannels
        .filter(ch => chFieldMap[ch.name])
        .map(ch => {
          const fieldKey = chFieldMap[ch.name];
          const groups = (ch.children && ch.children.length > 0)
            ? ch.children.map(sub => sub.name)
            : [...new Set(others.map(u => u[fieldKey]).filter(Boolean))].sort();
          if (groups.length === 0) return null;
          return {
            id: `gen_${ch.id}`,
            label: `${ch.name}から探す`,
            icon: ch.icon,
            groupBy: u => u[fieldKey],
            groups,
          };
        }).filter(Boolean)
    },
  ];

  // メンバー行の共通レンダー
  const renderMemberRow = (u, indent=64) => {
    const key = [currentUser.id, u.id].sort().join("_");
    const msgs = dmMessages[key]||[];
    const last = msgs[msgs.length-1];
    return (
      <div key={u.id} onClick={()=>setActiveDM(u)} style={{ display:"flex", alignItems:"center", gap:12, padding:`10px 18px 10px ${indent}px`, background:"#fafbfc", borderBottom:"1px solid #f1f5f9", cursor:"pointer" }}>
        <div style={{ width:38, height:38, borderRadius:"50%", background:"linear-gradient(135deg,#475569,#64748b)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, flexShrink:0 }}>{u.avatar}</div>
        <div style={{ flex:1, overflow:"hidden" }}>
          <div style={{ fontWeight:600, fontSize:13, color:"#0f172a" }}>{u.name}</div>
          <div style={{ fontSize:11, color:"#94a3b8", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{last?(last.text||"📎ファイル"):ROLES.find(r=>r.code===u.role)?.label}</div>
        </div>
        {last&&<div style={{ fontSize:10, color:"#94a3b8", flexShrink:0 }}>{formatTime(last.ts)}</div>}
      </div>
    );
  };

  if (activeChannel) {
    const readOnly = !canWriteChannel(activeChannel, currentUser);
    return (
      <ChatRoomView channelId={activeChannel.id} channelName={`${activeChannel.icon} ${activeChannel.name}`} channelDesc={activeChannel.desc} messages={messages} onSend={onSendChannel} currentUser={currentUser} onBack={()=>setActiveChannel(null)} onHome={onHome} readOnly={readOnly}/>
    );
  }
  if (activeDM) {
    const key = [currentUser.id, activeDM.id].sort().join("_");
    return (
      <ChatRoomView channelId={key} channelName={`💬 ${activeDM.name}`} channelDesc={`${ROLES.find(r=>r.code===activeDM.role)?.label} との個人チャット`} messages={dmMessages} onSend={(_,t,a)=>onSendDM(activeDM.id,t,a)} currentUser={currentUser} onBack={()=>setActiveDM(null)} onHome={onHome} readOnly={false}/>
    );
  }

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", background:"#f0f4f8" }}>
      <Header title="💬 チャット" onBack={onBack} onHome={onHome}/>
      <div style={{ display:"flex", background:"white", borderBottom:"1px solid #f1f5f9", flexShrink:0 }}>
        {[{id:"channels",label:"チャンネル"},{id:"dm",label:"ダイレクト"}].map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)} style={{ flex:1, padding:"12px 8px", border:"none", background:"transparent", cursor:"pointer", fontSize:13, fontWeight:tab===t.id?700:400, color:tab===t.id?"#0284c7":"#94a3b8", borderBottom:tab===t.id?"2px solid #0284c7":"2px solid transparent" }}>{t.label}</button>
        ))}
      </div>
      <div style={{ flex:1, overflow:"auto" }}>
        {tab==="channels" && visibleChannels.map(ch=>{
          const msgs = messages[ch.id]||[];
          const last = msgs[msgs.length-1];
          const readOnly = !canWriteChannel(ch, currentUser);
          const hasChildren = ch.children && ch.children.length > 0;
          const isExpanded = !!openCats[`ch_${ch.id}`];
          return (
            <div key={ch.id}>
              <div onClick={()=>{ if (hasChildren) { toggleCat(`ch_${ch.id}`); } else { setActiveChannel(ch); } }} style={{ display:"flex", alignItems:"center", gap:14, padding:"14px 18px", background:"white", borderBottom:"1px solid #f1f5f9", cursor:"pointer" }}>
                <div style={{ width:50, height:50, borderRadius:14, background:"linear-gradient(135deg,#1e293b,#334155)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:26, flexShrink:0 }}>{ch.icon}</div>
                <div style={{ flex:1, overflow:"hidden" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                    <div style={{ fontWeight:700, fontSize:15, color:"#0f172a" }}>{ch.name}</div>
                    {readOnly && <div style={{ fontSize:9, background:"#fffbeb", color:"#d97706", padding:"1px 6px", borderRadius:4, fontWeight:700 }}>閲覧</div>}
                    {hasChildren && <div style={{ fontSize:9, background:"#f0f9ff", color:"#0284c7", padding:"1px 6px", borderRadius:4, fontWeight:700 }}>{ch.children.length}</div>}
                  </div>
                  <div style={{ fontSize:12, color:"#94a3b8", marginTop:2, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{last?`${last.nickname}: ${last.text||"📎ファイル"}`:ch.desc}</div>
                </div>
                <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:4, flexShrink:0 }}>
                  {!hasChildren && last&&<div style={{ fontSize:10, color:"#94a3b8" }}>{formatTime(last.ts)}</div>}
                  {!hasChildren && msgs.length>0&&<div style={{ background:"#0284c7", color:"white", fontSize:10, fontWeight:700, minWidth:18, height:18, borderRadius:9, display:"flex", alignItems:"center", justifyContent:"center", padding:"0 4px" }}>{msgs.length}</div>}
                  {hasChildren && <span style={{ fontSize:16, color:"#94a3b8", transform:isExpanded?"rotate(180deg)":"none", transition:"transform 0.2s" }}>▾</span>}
                </div>
              </div>
              {/* 子チャンネル展開 */}
              {hasChildren && isExpanded && ch.children.map(sub => {
                const subMsgs = messages[sub.id]||[];
                const subLast = subMsgs[subMsgs.length-1];
                return (
                  <div key={sub.id} onClick={()=>setActiveChannel({...sub, members: ch.members})} style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 18px 10px 48px", background:"#f8fafc", borderBottom:"1px solid #f1f5f9", cursor:"pointer" }}>
                    <div style={{ width:36, height:36, borderRadius:10, background:"linear-gradient(135deg,#475569,#64748b)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:16, flexShrink:0 }}>{sub.icon || ch.icon}</div>
                    <div style={{ flex:1, overflow:"hidden" }}>
                      <div style={{ fontWeight:600, fontSize:13, color:"#334155" }}>{sub.name}</div>
                      <div style={{ fontSize:11, color:"#94a3b8", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{subLast?`${subLast.nickname}: ${subLast.text||"📎ファイル"}`:(sub.desc||"")}</div>
                    </div>
                    {subMsgs.length>0&&<div style={{ background:"#0284c7", color:"white", fontSize:10, fontWeight:700, minWidth:18, height:18, borderRadius:9, display:"flex", alignItems:"center", justifyContent:"center", padding:"0 4px" }}>{subMsgs.length}</div>}
                  </div>
                );
              })}
            </div>
          );
        })}

        {tab==="dm" && (
          <div>
            {/* DM履歴がある相手を上部に表示 */}
            {(() => {
              const withHistory = others.filter(u => {
                const key = [currentUser.id, u.id].sort().join("_");
                return (dmMessages[key]||[]).length > 0;
              });
              if (withHistory.length === 0) return null;
              return (
                <div style={{ marginBottom:8 }}>
                  <div style={{ padding:"10px 18px 6px", fontSize:11, fontWeight:700, color:"#64748b" }}>💬 最近のやり取り</div>
                  {withHistory.map(u => {
                    const key = [currentUser.id, u.id].sort().join("_");
                    const msgs = dmMessages[key]||[];
                    const last = msgs[msgs.length-1];
                    return (
                      <div key={u.id} onClick={()=>setActiveDM(u)} style={{ display:"flex", alignItems:"center", gap:14, padding:"12px 18px", background:"white", borderBottom:"1px solid #f1f5f9", cursor:"pointer" }}>
                        <div style={{ width:44, height:44, borderRadius:"50%", background:"linear-gradient(135deg,#334155,#475569)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:22, flexShrink:0 }}>{u.avatar}</div>
                        <div style={{ flex:1, overflow:"hidden" }}>
                          <div style={{ fontWeight:700, fontSize:14, color:"#0f172a" }}>{u.name}</div>
                          <div style={{ fontSize:12, color:"#94a3b8", marginTop:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{last?(last.text||"📎ファイル"):""}</div>
                        </div>
                        {last&&<div style={{ fontSize:10, color:"#94a3b8", flexShrink:0 }}>{formatTime(last.ts)}</div>}
                      </div>
                    );
                  })}
                </div>
              );
            })()}

            {/* カテゴリ別メンバー（折りたたみ） */}
            <div style={{ padding:"10px 18px 6px", fontSize:11, fontWeight:700, color:"#64748b" }}>👥 メンバーから探す</div>
            {DM_CATEGORIES.map(cat => {
              const members = others.filter(cat.filter);
              if (members.length === 0) return null;
              const isOpen = !!openCats[cat.id];
              return (
                <div key={cat.id}>
                  {/* カテゴリヘッダー */}
                  <div onClick={()=>toggleCat(cat.id)} style={{ display:"flex", alignItems:"center", gap:10, padding:"12px 18px", background:"white", borderBottom:"1px solid #f1f5f9", cursor:"pointer" }}>
                    <div style={{ width:36, height:36, borderRadius:10, background:"linear-gradient(135deg,#1e293b,#334155)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, flexShrink:0 }}>{cat.icon}</div>
                    <div style={{ flex:1 }}>
                      <div style={{ fontWeight:700, fontSize:14, color:"#0f172a" }}>{cat.label}</div>
                      <div style={{ fontSize:11, color:"#94a3b8" }}>{members.length}人</div>
                    </div>
                    <span style={{ fontSize:16, color:"#94a3b8", transform:isOpen?"rotate(180deg)":"none", transition:"transform 0.2s" }}>▾</span>
                  </div>

                  {/* サブカテゴリなし → 直接メンバー */}
                  {isOpen && !cat.subs && members.map(u => renderMemberRow(u))}

                  {/* サブカテゴリあり（一般会員） → 学年/部活/地区 */}
                  {isOpen && cat.subs && (
                    <div style={{ background:"#f8fafc" }}>
                      {cat.subs.map(sub => {
                        const subOpen = !!openCats[sub.id];
                        return (
                          <div key={sub.id}>
                            <div onClick={()=>toggleCat(sub.id)} style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 18px 10px 48px", background:"#f8fafc", borderBottom:"1px solid #f1f5f9", cursor:"pointer" }}>
                              <div style={{ width:30, height:30, borderRadius:8, background:"linear-gradient(135deg,#475569,#64748b)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:14, flexShrink:0 }}>{sub.icon}</div>
                              <div style={{ flex:1 }}>
                                <div style={{ fontWeight:700, fontSize:13, color:"#334155" }}>{sub.label}</div>
                              </div>
                              <span style={{ fontSize:14, color:"#94a3b8", transform:subOpen?"rotate(180deg)":"none", transition:"transform 0.2s" }}>▾</span>
                            </div>
                            {subOpen && sub.groups.map(grp => {
                              const grpMembers = members.filter(u => sub.groupBy(u) === grp);
                              if (grpMembers.length === 0) return null;
                              const grpKey = `${sub.id}_${grp}`;
                              const grpOpen = !!openCats[grpKey];
                              return (
                                <div key={grp}>
                                  <div onClick={()=>toggleCat(grpKey)} style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 18px 8px 78px", background:"#f0f4f8", borderBottom:"1px solid #e5e7eb", cursor:"pointer" }}>
                                    <div style={{ width:6, height:6, borderRadius:3, background:"#0284c7", flexShrink:0 }}/>
                                    <div style={{ flex:1, fontWeight:600, fontSize:12, color:"#475569" }}>{grp}</div>
                                    <div style={{ fontSize:11, color:"#94a3b8", marginRight:4 }}>{grpMembers.length}人</div>
                                    <span style={{ fontSize:12, color:"#94a3b8", transform:grpOpen?"rotate(180deg)":"none", transition:"transform 0.2s" }}>▾</span>
                                  </div>
                                  {grpOpen && grpMembers.map(u => renderMemberRow(u, 94))}
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// メインアプリ
// ============================================================
export default function GroupwareApp({ firebaseUser, onBackToHome }) {
  const [currentUser, setCurrentUser] = useState(() => {
    if (!firebaseUser) return null;
    return {
      id: firebaseUser.uid || "u1",
      name: firebaseUser.name || "ユーザー",
      nickname: (firebaseUser.name || "ユーザー").split(" ")[0],
      role: firebaseUser.role || firebaseUser.ptaRole || "一般",
      avatar: "👤",
      grade: firebaseUser.children?.[0]?.grade || "",
      club: firebaseUser.children?.[0]?.club || "",
      district: firebaseUser.district || "",
    };
  });
  const [screen, setScreen] = useState("home");

  // Firestore: usersコレクションからメンバー一覧をリアルタイム読み込み
  const [USERS, setUSERS] = useState([]);
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "users"), (snap) => {
      const data = snap.docs.map(d => {
        const raw = d.data();
        return {
          id: d.id,
          name: raw.name || "ユーザー",
          nickname: (raw.name || "ユーザー").split(" ")[0],
          role: raw.role || raw.ptaRole || "一般",
          avatar: raw.category === "先生" ? "🎓" : raw.category === "地域" ? "🏘️" : "👤",
          grade: raw.children?.[0]?.grade || "",
          club: raw.children?.[0]?.club || "",
          district: raw.district || "",
          category: raw.category || "保護者",
          email: raw.email || "",
          position: raw.position || "",
          children: raw.children || [],
          createdAt: raw.createdAt || "",
        };
      });
      setUSERS(data);
    });
    return unsub;
  }, []);

  const [notices, setNoticesLocal] = useState([]);

  // Firestore: noticesをリアルタイム読み込み
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "notices"), (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      data.sort((a, b) => (b.ts || 0) - (a.ts || 0));
      setNoticesLocal(data);
    });
    return unsub;
  }, []);

  const noticesRef = useRef([]);
  useEffect(() => { noticesRef.current = notices; }, [notices]);

  const setNotices = (updater) => {
    const prev = noticesRef.current;
    const next = typeof updater === "function" ? updater(prev) : updater;
    setNoticesLocal(next);
    // Firestoreに差分同期
    const prevIds = new Set(prev.map(n => n.id));
    const nextIds = new Set(next.map(n => n.id));
    // 追加
    for (const n of next) {
      if (!prevIds.has(n.id)) {
        const { id, ...data } = n;
        setDoc(doc(db, "notices", id), data).catch(e => console.error("Notice sync error:", e));
      }
    }
    // 削除
    for (const n of prev) {
      if (!nextIds.has(n.id)) {
        deleteDoc(doc(db, "notices", n.id)).catch(e => console.error("Notice delete error:", e));
      }
    }
  };
  const [messages, setMessagesLocal] = useState({});
  const [dmMessages, setDmMessagesLocal] = useState({});

  // Firestore: messagesをリアルタイム読み込み（単一ドキュメント方式）
  useEffect(() => {
    const unsub = onSnapshot(doc(db, "appdata", "messages"), (snap) => {
      if (snap.exists()) setMessagesLocal(snap.data());
    });
    return unsub;
  }, []);
  const setMessages = (updater) => {
    setMessagesLocal(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      setDoc(doc(db, "appdata", "messages"), next).catch(e => console.error("Messages sync error:", e));
      return next;
    });
  };

  // Firestore: dmMessagesをリアルタイム読み込み
  useEffect(() => {
    const unsub = onSnapshot(doc(db, "appdata", "dmMessages"), (snap) => {
      if (snap.exists()) setDmMessagesLocal(snap.data());
    });
    return unsub;
  }, []);
  const setDmMessages = (updater) => {
    setDmMessagesLocal(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      setDoc(doc(db, "appdata", "dmMessages"), next).catch(e => console.error("DM sync error:", e));
      return next;
    });
  };

  const [events, setEventsLocal] = useState([]);
  const eventsLoaded = useRef(false);

  // Firestore: eventsをリアルタイム読み込み
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "events"), (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setEventsLocal(data);
      eventsLoaded.current = true;
    });
    return unsub;
  }, []);

  // setEventsラッパー: ローカルstate更新 + Firestoreに差分書き込み
  const eventsRef = useRef([]);
  useEffect(() => { eventsRef.current = events; }, [events]);

  const setEvents = (updater) => {
    const prev = eventsRef.current;
    const next = typeof updater === "function" ? updater(prev) : updater;
    setEventsLocal(next);
    syncEventsToFirestore(prev, next);
  };

  const syncEventsToFirestore = async (prev, next) => {
    try {
      const prevMap = new Map(prev.map(e => [e.id, e]));
      const nextIds = new Set(next.map(e => e.id));
      const ops = [];
      for (const ev of next) {
        const old = prevMap.get(ev.id);
        if (!old || old.date !== ev.date || old.title !== ev.title || old.category !== ev.category) {
          ops.push({ type: "set", ev });
        }
      }
      for (const ev of prev) {
        if (!nextIds.has(ev.id)) {
          ops.push({ type: "delete", ev });
        }
      }
      if (ops.length === 0) return;
      for (let i = 0; i < ops.length; i += 450) {
        const chunk = ops.slice(i, i + 450);
        const batch = writeBatch(db);
        for (const op of chunk) {
          const ref = doc(db, "events", op.ev.id);
          if (op.type === "set") {
            const { id, ...data } = op.ev;
            batch.set(ref, data);
          } else {
            batch.delete(ref);
          }
        }
        await batch.commit();
      }
    } catch (e) {
      console.error("Firestore sync error:", e);
    }
  };

  // Firestore: surveys
  const [surveys, setSurveysLocal] = useState([]);
  useEffect(() => {
    const unsub = onSnapshot(doc(db, "appdata", "surveys"), (snap) => {
      if (snap.exists()) setSurveysLocal(snap.data().list || []);
    });
    return unsub;
  }, []);
  const setSurveys = (updater) => {
    setSurveysLocal(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      setDoc(doc(db, "appdata", "surveys"), { list: next }).catch(e => console.error("Surveys sync error:", e));
      return next;
    });
  };

  // Firestore: recruits
  const [recruits, setRecruitsLocal] = useState([]);
  useEffect(() => {
    const unsub = onSnapshot(doc(db, "appdata", "recruits"), (snap) => {
      if (snap.exists()) setRecruitsLocal(snap.data().list || []);
    });
    return unsub;
  }, []);
  const setRecruits = (updater) => {
    setRecruitsLocal(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      setDoc(doc(db, "appdata", "recruits"), { list: next }).catch(e => console.error("Recruits sync error:", e));
      return next;
    });
  };

  // Firestore: channels
  const [channels, setChannelsLocal] = useState(CHANNELS);
  useEffect(() => {
    const unsub = onSnapshot(doc(db, "appdata", "channels"), (snap) => {
      if (snap.exists()) setChannelsLocal(snap.data().list || CHANNELS);
    });
    return unsub;
  }, []);
  const setChannels = (updater) => {
    setChannelsLocal(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      setDoc(doc(db, "appdata", "channels"), { list: next }).catch(e => console.error("Channels sync error:", e));
      return next;
    });
  };

  // Firestore: documents
  const [documents, setDocumentsLocal] = useState([]);
  useEffect(() => {
    const unsub = onSnapshot(doc(db, "appdata", "documents"), (snap) => {
      if (snap.exists()) setDocumentsLocal(snap.data().list || []);
    });
    return unsub;
  }, []);
  const setDocuments = (updater) => {
    setDocumentsLocal(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      setDoc(doc(db, "appdata", "documents"), { list: next }).catch(e => console.error("Documents sync error:", e));
      return next;
    });
  };

  // Firestore: publishForms
  const [publishForms, setPublishFormsLocal] = useState({ _activeNav: [] });
  useEffect(() => {
    const unsub = onSnapshot(doc(db, "appdata", "publishForms"), (snap) => {
      if (snap.exists()) setPublishFormsLocal(snap.data());
    });
    return unsub;
  }, []);
  const setPublishForms = (updater) => {
    setPublishFormsLocal(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      setDoc(doc(db, "appdata", "publishForms"), next).catch(e => console.error("PublishForms sync error:", e));
      return next;
    });
  };

  // Firestore: readRecords
  const [readRecords, setReadRecordsLocal] = useState({});
  useEffect(() => {
    const unsub = onSnapshot(doc(db, "appdata", "readRecords"), (snap) => {
      if (snap.exists()) setReadRecordsLocal(snap.data());
    });
    return unsub;
  }, []);
  const setReadRecords = (updater) => {
    setReadRecordsLocal(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      setDoc(doc(db, "appdata", "readRecords"), next).catch(e => console.error("ReadRecords sync error:", e));
      return next;
    });
  };

  // Firestore: kiyakuPdf（規約PDF）
  const [kiyakuPdf, setKiyakuPdfLocal] = useState(null);
  useEffect(() => {
    const unsub = onSnapshot(doc(db, "appdata", "kiyakuPdf"), (snap) => {
      if (snap.exists()) setKiyakuPdfLocal(snap.data().data || null);
    });
    return unsub;
  }, []);
  const setKiyakuPdf = (value) => {
    setKiyakuPdfLocal(value);
    setDoc(doc(db, "appdata", "kiyakuPdf"), { data: value }).catch(e => console.error("KiyakuPdf sync error:", e));
  };

  if (!currentUser) { if (onBackToHome) onBackToHome(); return null; }

  const handleMarkRead = (noticeId, user) => {
    setReadRecords(prev => {
      const existing = prev[noticeId] || [];
      if (existing.some(r => r.userId === user.id)) return prev;
      return { ...prev, [noticeId]: [...existing, { userId: user.id, name: user.name }] };
    });
  };

  const handleSendChannel = (channelId, text, attachments=[]) => {
    const msg = { id:`m_${Date.now()}`, channelId, userId:currentUser.id, nickname:currentUser.nickname, avatar:currentUser.avatar, role:currentUser.role, text, ts:Date.now(), attachments };
    setMessages(prev=>({ ...prev, [channelId]:[...(prev[channelId]||[]), msg] }));
  };
  const handleSendDM = (partnerId, text, attachments=[]) => {
    const key = [currentUser.id, partnerId].sort().join("_");
    const msg = { id:`dm_${Date.now()}`, channelId:key, userId:currentUser.id, nickname:currentUser.nickname, avatar:currentUser.avatar, role:currentUser.role, text, ts:Date.now(), attachments };
    setDmMessages(prev=>({ ...prev, [key]:[...(prev[key]||[]), msg] }));
  };
  const handleAddNotice = (title, body, user, important=false, target=null, attachments=[]) => {
    setNotices(prev=>[{ id:`n_${Date.now()}`, title, body, author:user.nickname, ts:Date.now(), important, target, attachments }, ...prev]);
  };

  return (
    <div style={{ height:"100svh", display:"flex", flexDirection:"column", fontFamily:"Hiragino Kaku Gothic ProN, YuGothic, sans-serif", overflow:"hidden" }}>
      <style>{CSS}</style>
      {screen==="home" && <HomeScreen currentUser={currentUser} notices={notices} messages={messages} events={events} onNavigate={setScreen} onLogout={()=>{ if(onBackToHome) onBackToHome(); else setCurrentUser(null); }} USERS={USERS} kiyakuPdf={kiyakuPdf} setKiyakuPdf={setKiyakuPdf}/>}
      {screen==="notices" && <NoticesScreen notices={notices} onBack={()=>setScreen("home")} onHome={()=>setScreen("home")} currentUser={currentUser} onAdd={handleAddNotice} readRecords={readRecords} onMarkRead={handleMarkRead} surveys={surveys} setSurveys={setSurveys} recruits={recruits} setRecruits={setRecruits} USERS={USERS}/>}
      {screen==="calendar" && <CalendarScreen onBack={()=>setScreen("home")} onHome={()=>setScreen("home")} events={events} setEvents={setEvents} currentUser={currentUser}/>}
      {screen==="chat" && <ChatScreen messages={messages} dmMessages={dmMessages} onSendChannel={handleSendChannel} onSendDM={handleSendDM} currentUser={currentUser} onBack={()=>setScreen("home")} onHome={()=>setScreen("home")} USERS={USERS} channels={channels}/>}
      {screen==="admin" && <AdminScreen onBack={()=>setScreen("home")} onHome={()=>setScreen("home")} events={events} setEvents={setEvents} currentUser={currentUser} channels={channels} setChannels={setChannels} documents={documents} setDocuments={setDocuments} publishForms={publishForms} setPublishForms={setPublishForms} USERS={USERS}/>}
    </div>
  );
}
