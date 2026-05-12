import { useState, useEffect, useRef, useCallback } from "react";
import { eventnaviDb as db, db as sharedDb } from "./firebase";
import {
  collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, getDoc, serverTimestamp, orderBy, query, getDocs, where
} from "firebase/firestore";

// ========== 定数・初期データ ==========
const GRADE_TYPES = ["大人", "大学生", "高校生", "中学生", "小学生", "幼児"];
const STUDENT_GRADES = ["大学生", "高校生", "中学生", "小学生"];

const initialEvents = [
  {
    id: 1, type: "event",
    title: "春の地域清掃フェスティバル",
    description: "地域全体で公園・河川敷を清掃するイベントです。家族連れ大歓迎！終了後はバーベキューパーティーを開催します。",
    date: "2025-04-12", time: "09:00", location: "中央公園 集合広場",
    organizer: "緑の会 田中花子", organizerId: "org1",
    organizerName: "緑の会 田中花子", contactPerson: "田中 花子", contactPhone: "090-1111-2222",
    capacity: 50, capacityUnlimited: false, applicants: [],
    image: "🌸", status: "approved", category: "地域活動",
    fee: "無料", volunteers: 10, volunteerApplicants: [],
    createdAt: "2025-03-01",
    emergencyNotices: [
      { id: 1, type: "cancel", message: "雨天予報のため中止となりました。次回は4月19日（土）を予定しています。", createdAt: "2025-04-11 18:00", author: "緑の会 田中花子" }
    ]
  },
  {
    id: 2, type: "volunteer",
    title: "夏祭りボランティアスタッフ募集",
    description: "地域の夏祭りを盛り上げるボランティアスタッフを募集します。受付・案内・出店サポートなど役割多数あり。",
    date: "2025-07-19", time: "10:00", location: "市民広場",
    organizer: "夏祭り実行委員会 鈴木一郎", organizerId: "org1",
    organizerName: "夏祭り実行委員会 鈴木一郎", contactPerson: "鈴木 一郎", contactPhone: "090-3333-4444",
    capacity: 30, capacityUnlimited: false, applicants: [],
    image: "🎆", status: "pending", category: "ボランティア",
    volunteers: 20, volunteerApplicants: [],
    meetingPlace: "市民広場 正面入口", meetingTime: "09:30", dismissalTime: "21:00",
    createdAt: "2025-03-05", emergencyNotices: []
  },
  {
    id: 3, type: "event",
    title: "子ども読書フェア2025",
    description: "地域図書館主催の子ども向け読書イベント。絵本の読み聞かせ、工作、著者サイン会など盛りだくさん！",
    date: "2025-05-03", time: "11:00", location: "市立図書館 多目的ホール",
    organizer: "市立図書館 山田太郎", organizerId: "org2",
    organizerName: "市立図書館 山田太郎", contactPerson: "山田 太郎", contactPhone: "011-555-6666",
    capacity: 80, capacityUnlimited: false, applicants: [],
    image: "📚", status: "revision", category: "文化・教育",
    fee: "無料", volunteers: 5, volunteerApplicants: [],
    createdAt: "2025-03-08", emergencyNotices: []
  },
  {
    id: 4, type: "event",
    title: "健康ウォーキング大会",
    description: "市内の名所を巡る5kmウォーキングイベント。参加賞あり！完歩証明書を発行します。",
    date: "2025-06-08", time: "08:30", location: "市役所前 集合",
    organizer: "健康推進協会 伊藤健一", organizerId: "org2",
    organizerName: "健康推進協会 伊藤健一", contactPerson: "伊藤 健一", contactPhone: "090-7777-8888",
    capacity: 100, capacityUnlimited: false, applicants: [],
    image: "🚶", status: "approved", category: "スポーツ・健康",
    fee: "500円", volunteers: 8, volunteerApplicants: [],
    createdAt: "2025-03-10", emergencyNotices: []
  }
];

const ROLE_THEME = {
  participant: {
    primary: "#0284c7",
    secondary: "#38bdf8",
    light: "#e0f2fe",
    gradient: "linear-gradient(135deg,#38bdf8,#0284c7)",
    headerBg: "white",
    headerBorder: "#bae6fd",
    heroBg: "linear-gradient(135deg,#0ea5e9,#0284c7)",
    pageBg: "#f0f9ff",
    accent: "#0284c7",
  },
  organizer: {
    primary: "#d97706",
    secondary: "#fbbf24",
    light: "#fef9c3",
    gradient: "linear-gradient(135deg,#fbbf24,#f59e0b)",
    headerBg: "#fffbeb",
    headerBorder: "#fde68a",
    heroBg: "linear-gradient(135deg,#fbbf24,#f59e0b)",
    pageBg: "#fffbeb",
    accent: "#d97706",
  },
  admin: {
    primary: "#15803d",
    secondary: "#4ade80",
    light: "#dcfce7",
    gradient: "linear-gradient(135deg,#4ade80,#16a34a)",
    headerBg: "#f0fdf4",
    headerBorder: "#bbf7d0",
    heroBg: "linear-gradient(135deg,#22c55e,#15803d)",
    pageBg: "#f0fdf4",
    accent: "#15803d",
  },
};

// 管理者ロール（PTA本部役員 + 先生）
const ADMIN_ROLES = ["会長","副会長","監事","幹事","会計","事務長","校長","教頭","教務主任","先生"];
const isAdminRole = (role) => ADMIN_ROLES.includes(role);

// ユーザーメール取得ヘルパー（yagiyama-net の users コレクションから）
const fetchAllUserEmails = async () => {
  try {
    const snap = await getDocs(collection(sharedDb, "users"));
    return snap.docs.map(d => d.data().email).filter(Boolean);
  } catch (e) { console.error("ユーザーメール取得エラー:", e); return []; }
};
const fetchAdminEmails = async () => {
  try {
    const snap = await getDocs(collection(sharedDb, "users"));
    return snap.docs.map(d => d.data()).filter(u => isAdminRole(u.role)).map(u => u.email).filter(Boolean);
  } catch (e) { console.error("管理者メール取得エラー:", e); return []; }
};
const fetchUserEmail = async (uid) => {
  try {
    const snap = await getDoc(doc(sharedDb, "users", uid));
    return snap.exists() ? snap.data().email : null;
  } catch (e) { console.error("ユーザーメール取得エラー:", e); return null; }
};

const STATUS_LABELS = { approved: "承認済み", pending: "審査中", revision: "修正依頼", rejected: "非承認" };
const STATUS_COLORS = { approved: "#22c55e", pending: "#f59e0b", revision: "#d97706", rejected: "#dc2626" };

const NOTICE_TYPES = {
  cancel:     { label: "中止",     color: "#dc2626", bg: "#fef2f2", border: "#fecaca", icon: "🚫" },
  timechange: { label: "時間変更", color: "#d97706", bg: "#fffbeb", border: "#fde68a", icon: "🕐" },
  placechange:{ label: "場所変更", color: "#7c3aed", bg: "#f5f3ff", border: "#ddd6fe", icon: "📍" },
  other:      { label: "お知らせ", color: "#0369a1", bg: "#f0f9ff", border: "#bae6fd", icon: "📢" },
};

const CATEGORIES = ["すべて", "地域活動", "ボランティア", "文化・教育", "スポーツ・健康", "その他"];
const GRADE_COLORS = { "大人": "#667eea", "大学生": "#7c3aed", "高校生": "#0ea5e9", "中学生": "#22c55e", "小学生": "#f59e0b", "幼児": "#f43f5e" };

// ========== ユーティリティ ==========
function formatDate(d) {
  if (!d) return "";
  const dt = new Date(d);
  return `${dt.getFullYear()}年${dt.getMonth() + 1}月${dt.getDate()}日`;
}

// ── アイコン → テーマカラー マッピング ──
const ICON_THEMES = {
  "🌸": { from:"#f472b6", to:"#ec4899", accent:"#db2777", light:"#fdf2f8", border:"#f472b6", cardBg:"#fdf2f8" },
  "🎉": { from:"#667eea", to:"#764ba2", accent:"#667eea", light:"#f4f6ff", border:"#667eea", cardBg:"#f4f6ff" },
  "🎆": { from:"#f97316", to:"#dc2626", accent:"#ea580c", light:"#fff7ed", border:"#f97316", cardBg:"#fff7ed" },
  "📚": { from:"#0ea5e9", to:"#0369a1", accent:"#0284c7", light:"#f0f9ff", border:"#0ea5e9", cardBg:"#f0f9ff" },
  "🚶": { from:"#22c55e", to:"#16a34a", accent:"#16a34a", light:"#f0fdf4", border:"#22c55e", cardBg:"#f0fdf4" },
  "🎵": { from:"#a855f7", to:"#7c3aed", accent:"#9333ea", light:"#faf5ff", border:"#a855f7", cardBg:"#faf5ff" },
  "🍳": { from:"#fb923c", to:"#f59e0b", accent:"#ea580c", light:"#fff7ed", border:"#fb923c", cardBg:"#fff7ed" },
  "🌿": { from:"#4ade80", to:"#15803d", accent:"#16a34a", light:"#f0fdf4", border:"#4ade80", cardBg:"#f0fdf4" },
  "🏃": { from:"#06b6d4", to:"#0891b2", accent:"#0891b2", light:"#ecfeff", border:"#06b6d4", cardBg:"#ecfeff" },
  "🎨": { from:"#f43f5e", to:"#e11d48", accent:"#e11d48", light:"#fff1f2", border:"#f43f5e", cardBg:"#fff1f2" },
  "🤝": { from:"#10b981", to:"#047857", accent:"#059669", light:"#ecfdf5", border:"#10b981", cardBg:"#ecfdf5" },
  "🌈": { from:"#8b5cf6", to:"#6366f1", accent:"#7c3aed", light:"#f5f3ff", border:"#8b5cf6", cardBg:"#f5f3ff" },
};
function getTheme(icon) {
  return ICON_THEMES[icon] || ICON_THEMES["🎉"];
}

// ── フライヤー PDF（管理者・主催者用）──
// イベント情報 ＋ 下部切り取り申込フォーム（保護者同意欄付き・1人1枚）
function generateFlyerPDF(event) {
  const win = window.open("", "_blank");
  if (!win) { alert("ポップアップをブロックされています。ブラウザ設定をご確認ください。"); return; }

  // ── アイコンに対応したテーマを自動取得 ──
  const th = getTheme(event.image);

  const notices = (event.emergencyNotices || []).map(n => {
    const nt = NOTICE_TYPES[n.type] || NOTICE_TYPES.other;
    return `<div style="background:${nt.bg};border:2px solid ${nt.border};border-radius:8px;padding:10px 14px;margin-bottom:8px;">
      <strong style="color:${nt.color};font-size:13px">${nt.icon}【${nt.label}】</strong>
      <p style="margin:4px 0 0;color:${nt.color};font-weight:700;font-size:14px">${n.message}</p>
      <small style="color:#888">${n.createdAt}</small></div>`;
  }).join("");

  const dow = ["日","月","火","水","木","金","土"][new Date(event.date).getDay()];

  win.document.write(`<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8">
  <title>${event.title} — フライヤー</title>
  <style>
    * { box-sizing:border-box; margin:0; padding:0; }
    body { font-family:'Hiragino Kaku Gothic ProN','Meiryo',sans-serif; color:#1a1a2e; background:white; }
    .page { width:210mm; min-height:297mm; padding:9mm 11mm 7mm; }

    /* ── ヘッダー（アイコンに連動したテーマカラー） ── */
    .header { background:linear-gradient(135deg,${th.from},${th.to}); color:white; border-radius:12px; padding:13px 20px; margin-bottom:10px; display:flex; align-items:center; gap:14px; position:relative; overflow:hidden; }
    .header::after { content:''; position:absolute; bottom:-30px; right:-30px; width:120px; height:120px; background:rgba(255,255,255,0.08); border-radius:50%; }
    .header-icon { font-size:48px; line-height:1; z-index:1; }
    .header-body { flex:1; z-index:1; }
    .header-badge { display:inline-block; background:rgba(255,255,255,0.3); border:2px solid rgba(255,255,255,0.5); padding:6px 24px; border-radius:30px; font-size:30px; margin-bottom:8px; font-weight:900; letter-spacing:3px; }
    .header h1 { font-size:24px; font-weight:900; line-height:1.2; margin-bottom:4px; }
    .header-date { font-size:14px; opacity:0.95; font-weight:600; line-height:1.5; }

    /* ── 情報グリッド ── */
    .info-grid { display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-bottom:9px; }
    .info-card { background:${th.cardBg}; border-left:3px solid ${th.border}; border-radius:6px; padding:6px 10px; }
    .info-card.fee { background:#fef3c7; border-left-color:#f59e0b; }
    .info-label { font-size:11px; color:#888; margin-bottom:1px; letter-spacing:0.3px; }
    .info-value { font-size:13px; font-weight:700; color:#1e1b4b; line-height:1.3; }

    /* ── 詳細説明 + QR ── */
    .desc-row { display:flex; gap:10px; margin-bottom:9px; align-items:flex-start; }
    .description { flex:1; border:1px solid #e2e8f0; border-radius:8px; padding:8px 12px; line-height:1.7; font-size:13px; color:#374151; }
    .description h3 { font-size:12px; font-weight:800; color:${th.accent}; margin-bottom:4px; letter-spacing:1px; }
    .qr-col { display:flex; flex-direction:column; align-items:center; gap:5px; flex-shrink:0; }
    .qr-box { width:90px; height:90px; border-radius:8px; overflow:hidden; }
    .qr-box img { width:100%; height:100%; display:block; }
    .qr-lbl { font-size:11px; color:#94a3b8; }

    /* ── 切り取り線 ── */
    .cutline-wrap { position:relative; margin:8px 0 7px; }
    .cutline { border:none; border-top:2px dashed #94a3b8; }
    .cutline-label { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); background:white; padding:0 14px; font-size:13px; color:#94a3b8; letter-spacing:2px; white-space:nowrap; font-weight:600; }
    .cutline-wrap::before { content:'✂'; position:absolute; left:-2px; top:50%; transform:translateY(-50%); font-size:14px; color:#94a3b8; background:white; padding-right:4px; }

    /* ── 申込フォーム ── */
    .form-header { display:flex; align-items:center; gap:8px; margin-bottom:8px; flex-wrap:wrap; }
    .form-badge { background:linear-gradient(135deg,${th.from},${th.to}); color:white; padding:5px 18px; border-radius:20px; font-size:15px; font-weight:800; }
    .form-event { font-size:14px; color:#64748b; font-weight:500; }
    .form-note { margin-left:auto; font-size:11px; color:#94a3b8; text-align:right; line-height:1.6; }

    .form-grid { display:grid; grid-template-columns:1fr 1fr; gap:7px 12px; }
    .ff { } .ff.full { grid-column:span 2; }
    .fl { font-size:12px; font-weight:700; color:#475569; margin-bottom:2px; display:flex; align-items:center; gap:3px; }
    .fl .req { color:#ef4444; } .fl .opt { color:#94a3b8; font-size:11px; font-weight:400; }
    .wl { display:block; width:100%; height:22px; border:none; border-bottom:1.5px solid #334155; background:transparent; }
    .wa { display:block; width:100%; height:30px; border:none; border-bottom:1.5px solid #334155; background:transparent; }
    .hr { grid-column:span 2; border:none; border-top:1px solid #e2e8f0; margin:2px 0; }

    /* ── 区分チェック ── */
    .grade-checks { display:flex; flex-wrap:wrap; gap:3px 10px; padding:3px 0 1px; }
    .gc { display:flex; align-items:center; gap:4px; font-size:13px; color:#374151; }
    .cb { width:16px; height:16px; border:1.5px solid #475569; border-radius:3px; display:inline-block; flex-shrink:0; }

    /* ── 保護者同意欄 ── */
    .guardian { border:2px solid #f59e0b; border-radius:8px; background:#fffbeb; padding:7px 11px; }
    .guardian-title { font-size:13px; font-weight:800; color:#b45309; margin-bottom:3px; }
    .guardian-note { font-size:12px; color:#92400e; margin-bottom:5px; line-height:1.5; }
    .guardian-check { display:flex; gap:7px; align-items:flex-start; margin-bottom:6px; }
    .cb-lg { width:18px; height:18px; border:2px solid #b45309; border-radius:3px; display:inline-block; flex-shrink:0; margin-top:2px; }
    .guardian-check-text { font-size:12px; color:#374151; line-height:1.6; }
    .guardian-signs { display:flex; gap:14px; flex-wrap:wrap; }
    .gs { display:flex; flex-direction:column; gap:3px; flex:1; min-width:90px; }
    .gs-label { font-size:10px; font-weight:700; color:#b45309; }
    .gs-line { display:block; border-bottom:1.5px solid #b45309; height:16px; width:100%; }
    .gs-line.short { max-width:68px; }

    /* ── 同意・署名 ── */
    .submit-row { display:flex; justify-content:space-between; align-items:flex-end; margin-top:7px; gap:10px; }
    .agree-text { font-size:12px; color:#64748b; line-height:1.6; flex:1; }
    .sign-col { text-align:right; flex-shrink:0; }
    .sign-lbl { font-size:12px; color:#475569; margin-bottom:4px; }
    .sign-line { display:inline-block; border-bottom:1.5px solid #334155; width:130px; height:20px; }

    /* ── フッター ── */
    .footer { margin-top:7px; padding-top:6px; border-top:1px solid #e2e8f0; display:flex; justify-content:space-between; align-items:center; }
    .footer-left { font-size:11px; color:#94a3b8; }
    .footer-logo { font-size:14px; font-weight:800; color:${th.accent}; letter-spacing:1px; }

    /* 操作バー（印刷時は非表示） */
    .toolbar { position:fixed; top:0; left:0; right:0; background:#0f172a; color:white; padding:10px 16px; display:flex; align-items:center; justify-content:space-between; gap:10px; z-index:9999; box-shadow:0 2px 12px rgba(0,0,0,0.3); }
    .toolbar-title { font-size:14px; font-weight:700; }
    .toolbar-buttons { display:flex; gap:8px; }
    .toolbar-btn { background:rgba(255,255,255,0.15); border:none; color:white; padding:8px 16px; border-radius:8px; font-size:13px; font-weight:700; cursor:pointer; }
    .toolbar-btn.print { background:#0284c7; }
    .toolbar-btn:hover { background:rgba(255,255,255,0.25); }
    .toolbar-btn.print:hover { background:#0369a1; }
    .page { margin-top:52px; }

    @media print {
      body { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
      .page { padding:7mm 10mm; margin-top:0; }
      .toolbar { display:none !important; }
    }
  </style></head><body>
  <div class="toolbar">
    <span class="toolbar-title">📄 フライヤープレビュー</span>
    <div class="toolbar-buttons">
      <button class="toolbar-btn print" onclick="window.print()">🖨️ 印刷</button>
      <button class="toolbar-btn" onclick="window.close()">✕ 閉じる</button>
    </div>
  </div>
  <div class="page">

    <!-- ヘッダー -->
    <div class="header">
      <div class="header-icon">${event.image}</div>
      <div class="header-body">
        <div class="header-badge">${event.type === "event" ? "📅 イベント" : "🙋 ボランティア募集"}</div>
        <h1>${event.title}</h1>
        <div class="header-date">
          📅 ${formatDate(event.date)}（${dow}）　${event.time} 開始<br>
          📍 ${event.location}
        </div>
      </div>
    </div>

    ${notices ? `<div style="margin-bottom:13px"><div style="font-size:13px;font-weight:900;color:#dc2626;margin-bottom:7px">⚠️ 緊急連絡</div>${notices}</div>` : ""}

    <!-- 情報グリッド -->
    <div style="overflow:hidden">
      <div class="qr-col" style="float:right;margin:0 0 8px 14px;display:flex;flex-direction:row;gap:10px">
        <div style="display:flex;flex-direction:column;align-items:center;gap:4px">
          <div class="qr-box"><img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent("https://yagiyama-net.vercel.app?event=" + event.id)}" alt="QR"/></div>
          <div class="qr-lbl">スマホで申込</div>
        </div>
        ${event.externalUrl ? `
        <div style="display:flex;flex-direction:column;align-items:center;gap:4px">
          <div class="qr-box"><img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(event.externalUrl)}" alt="関連リンクQR"/></div>
          <div class="qr-lbl">🔗 関連情報</div>
        </div>` : ""}
      </div>
      <div class="info-grid">
        <div class="info-card"><div class="info-label">👤 主催者・団体名</div><div class="info-value">${event.organizerName || event.organizer}</div></div>
        <div class="info-card"><div class="info-label">👥 定員</div><div class="info-value">${event.capacityUnlimited ? "制限なし" : event.capacity + "名"}</div></div>
        ${event.fee ? `<div class="info-card fee"><div class="info-label">💴 参加費</div><div class="info-value">${event.fee}</div></div>` : ""}
        ${event.type === "volunteer" && event.meetingPlace ? `
        <div class="info-card"><div class="info-label">🗺️ 集合場所</div><div class="info-value">${event.meetingPlace}</div></div>
        <div class="info-card"><div class="info-label">🕐 集合 / 解散</div><div class="info-value">${event.meetingTime} ／ ${event.dismissalTime}</div></div>` : ""}
        <div class="info-card"><div class="info-label">🧑‍💼 担当者</div><div class="info-value">${event.contactPerson || "—"}</div></div>
        <div class="info-card"><div class="info-label">📞 担当者連絡先</div><div class="info-value">${event.contactPhone || "—"}</div></div>
        ${event.eligibility?.length ? `<div class="info-card"><div class="info-label">🎯 参加資格</div><div class="info-value">${event.eligibility.join("・")}</div></div>` : ""}
        ${event.targetArea && event.targetArea !== "指定なし" ? `<div class="info-card"><div class="info-label">🏘️ 対象地区</div><div class="info-value">${event.targetArea === "その他" ? (event.targetAreaOther || "その他") : event.targetArea}</div></div>` : ""}
        ${event.dressCode ? `<div class="info-card" style="grid-column:span 2"><div class="info-label">👕 服装・持ち物</div><div class="info-value">${event.dressCode.replace(/\n/g,"<br>")}</div></div>` : ""}
      </div>
    </div>

    <!-- 詳細説明 -->
    <div class="desc-row">
      <div class="description">
        <h3>▍ イベント詳細</h3>
        ${event.description}
      </div>
    </div>

    <!-- ✂ 切り取り線 -->
    <div class="cutline-wrap">
      <hr class="cutline">
      <span class="cutline-label">切り取ってご提出ください</span>
    </div>

    <!-- 申込フォームヘッダー -->
    <div class="form-header">
      <span class="form-badge">📝 参加申込書</span>
      <span class="form-event">「${event.title}」</span>
      <span class="form-note">※ お一人につき1枚ご記入ください　／　<span style="color:#ef4444;font-weight:700">*</span> は必須項目</span>
    </div>

    <!-- 申込フォーム本体 -->
    <div class="form-grid">

      <!-- 区分 -->
      <div class="ff full">
        <div class="fl">区分 <span class="req">*</span>（該当するものに ✓ を記入）</div>
        <div class="grade-checks">
          ${["大人","大学生","高校生","中学生","小学生","幼児"].map(g=>`<div class="gc"><span class="cb"></span>${g}</div>`).join("")}
        </div>
      </div>

      <!-- 氏名 -->
      <div class="ff full">
        <div class="fl">氏名（フルネーム） <span class="req">*</span></div>
        <div class="wl"></div>
      </div>

      <!-- 学校名・学年クラス -->
      <div class="ff">
        <div class="fl">学校名 <span class="opt">（学生の場合）</span></div>
        <div class="wl"></div>
      </div>
      <div class="ff">
        <div class="fl">学年・クラス <span class="opt">（学生の場合）</span></div>
        <div class="wl"></div>
      </div>

      <hr class="hr">

      <!-- メール -->
      <div class="ff full">
        <div class="fl">メールアドレス <span class="req">*</span></div>
        <div class="wl"></div>
        <div style="font-size:10px;color:#94a3b8;margin-top:3px">※ 変更・中止などの緊急連絡をお送りします</div>
      </div>

      <!-- 緊急連絡先 -->
      <div class="ff full">
        <div class="fl">緊急連絡先（電話番号） <span class="req">*</span></div>
        <div class="wl"></div>
      </div>

      <hr class="hr">

      <!-- 保護者同意欄 -->
      <div class="ff full">
        <div class="guardian">
          <div class="guardian-title">👪 保護者同意欄</div>
          <div class="guardian-note">参加者が<strong>中学生以下</strong>の場合は、保護者の方がご記入・ご署名ください。</div>
          <div class="guardian-check">
            <span class="cb-lg"></span>
            <span class="guardian-check-text">上記の申込内容を確認し、参加者（子ども）が本イベントに参加することに同意します。また、イベント中の事故・怪我等については、主催者が定めるルールの範囲内で対応することに同意します。</span>
          </div>
          <div class="guardian-signs">
            <div class="gs"><span class="gs-label">保護者氏名（自署）</span><span class="gs-line"></span></div>
            <div class="gs"><span class="gs-label">続柄</span><span class="gs-line short"></span></div>
            <div class="gs"><span class="gs-label">連絡先（電話番号）</span><span class="gs-line"></span></div>
          </div>
        </div>
      </div>

      <hr class="hr">

      <!-- 備考 -->
      <div class="ff full">
        <div class="fl">備考・ご要望 <span class="opt">（任意）</span></div>
        <div class="wa"></div>
      </div>

    </div>

    <!-- フッター -->
    <div class="footer">
      <div class="footer-left">出力日：${new Date().toLocaleDateString("ja-JP")}　／　提出先：${event.organizerName || event.organizer}　${event.contactPhone ? "TEL " + event.contactPhone : ""}</div>
      <div class="footer-logo">🎪 イベントナビ</div>
    </div>

  </div>
  </body></html>`);
  win.document.close();
  setTimeout(() => win.print(), 600);
}

// ── 参加申込確認票 PDF（参加者持参用）──
// 申込内容をプリントアウトして主催者・管理者に提出できる形式
function generateApplicationPDF(event, applicant) {
  const win = window.open("", "_blank");
  if (!win) { alert("ポップアップをブロックされています。ブラウザ設定をご確認ください。"); return; }

  const members = applicant?.members || [];
  const memberRows = members.map((m, i) => `
    <tr style="background:${i % 2 === 0 ? "#f8faff" : "white"}">
      <td style="padding:9px 12px;border-bottom:1px solid #e2e8f0;font-weight:${i===0?"700":"400"}">${i === 0 ? "代表者" : `同行者${i}`}</td>
      <td style="padding:9px 12px;border-bottom:1px solid #e2e8f0">${m.name}</td>
      <td style="padding:9px 12px;border-bottom:1px solid #e2e8f0">${m.grade}</td>
      <td style="padding:9px 12px;border-bottom:1px solid #e2e8f0">${m.school || "—"}</td>
      <td style="padding:9px 12px;border-bottom:1px solid #e2e8f0">${m.schoolYear || "—"} ${m.schoolClass || ""}</td>
      <td style="padding:9px 12px;border-bottom:1px solid #e2e8f0">${m.email || "—"}</td>
      <td style="padding:9px 12px;border-bottom:1px solid #e2e8f0">${m.phone || "—"}</td>
    </tr>`).join("");

  // 申込未完了の場合は空白フォーム
  const blankRows = members.length === 0 ? `
    <tr><td colspan="7" style="padding:40px;text-align:center;color:#94a3b8;font-size:13px">
      ※ 手書きでご記入の上、提出してください
    </td></tr>` : memberRows;

  win.document.write(`<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8">
  <title>参加申込確認票 — ${event.title}</title>
  <style>
    * { box-sizing:border-box; margin:0; padding:0; }
    body { font-family:'Hiragino Kaku Gothic ProN','Meiryo',sans-serif; color:#1a1a2e; background:white; }
    .page { width:210mm; min-height:297mm; padding:14mm 14mm 10mm; }

    .ticket-header { background:linear-gradient(135deg,#667eea,#764ba2); color:white; border-radius:12px; padding:18px 24px; margin-bottom:20px; display:flex; align-items:center; gap:16px; }
    .ticket-header .icon { font-size:44px; }
    .ticket-header h1 { font-size:20px; font-weight:900; margin-bottom:4px; }
    .ticket-header p { font-size:12px; opacity:0.85; }

    .section { margin-bottom:20px; }
    .section-title { font-size:12px; font-weight:800; color:#667eea; letter-spacing:1px; border-bottom:2px solid #667eea; padding-bottom:4px; margin-bottom:12px; }

    .event-summary { background:#f4f6ff; border-radius:10px; padding:14px 18px; display:grid; grid-template-columns:1fr 1fr; gap:8px; }
    .ev-item { display:flex; gap:6px; align-items:flex-start; }
    .ev-label { font-size:10px; color:#888; min-width:60px; padding-top:2px; }
    .ev-value { font-size:13px; font-weight:700; color:#1e1b4b; }

    table { width:100%; border-collapse:collapse; font-size:12px; }
    th { background:#1e1b4b; color:white; padding:9px 12px; text-align:left; font-size:11px; }
    td { padding:9px 12px; border-bottom:1px solid #e2e8f0; }

    .confirm-box { border:2px solid #667eea; border-radius:10px; padding:14px 18px; display:flex; justify-content:space-between; align-items:center; margin-top:20px; }
    .confirm-text { font-size:13px; color:#374151; line-height:1.7; }
    .stamp-area { width:70px; height:70px; border:2px dashed #94a3b8; border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:10px; color:#94a3b8; text-align:center; }

    .footer { margin-top:20px; padding-top:12px; border-top:1px solid #e2e8f0; display:flex; justify-content:space-between; font-size:10px; color:#94a3b8; }

    /* 操作バー（印刷時は非表示） */
    .toolbar { position:fixed; top:0; left:0; right:0; background:#0f172a; color:white; padding:10px 16px; display:flex; align-items:center; justify-content:space-between; gap:10px; z-index:9999; box-shadow:0 2px 12px rgba(0,0,0,0.3); }
    .toolbar-title { font-size:14px; font-weight:700; }
    .toolbar-buttons { display:flex; gap:8px; }
    .toolbar-btn { background:rgba(255,255,255,0.15); border:none; color:white; padding:8px 16px; border-radius:8px; font-size:13px; font-weight:700; cursor:pointer; }
    .toolbar-btn.print { background:#0284c7; }
    .page { margin-top:52px; }

    @media print {
      body { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
      .page { margin-top:0; }
      .toolbar { display:none !important; }
    }
  </style></head><body>
  <div class="toolbar">
    <span class="toolbar-title">📄 申込確認票</span>
    <div class="toolbar-buttons">
      <button class="toolbar-btn print" onclick="window.print()">🖨️ 印刷</button>
      <button class="toolbar-btn" onclick="window.close()">✕ 閉じる</button>
    </div>
  </div>
  <div class="page">

    <!-- ヘッダー -->
    <div class="ticket-header">
      <div class="icon">${event.image}</div>
      <div>
        <h1>参加申込確認票</h1>
        <p>この書類を印刷して主催者・管理者窓口へご持参ください</p>
      </div>
      <div style="margin-left:auto;text-align:right;font-size:11px;opacity:0.8">
        発行日：${new Date().toLocaleDateString("ja-JP")}<br>
        🎪 イベントナビ
      </div>
    </div>

    <!-- イベント情報 -->
    <div class="section">
      <div class="section-title">▍ イベント情報</div>
      <div class="event-summary">
        <div class="ev-item"><span class="ev-label">イベント名</span><span class="ev-value" style="grid-column:span 2">${event.title}</span></div>
        <div class="ev-item"><span class="ev-label">📅 開催日時</span><span class="ev-value">${formatDate(event.date)}（${["日","月","火","水","木","金","土"][new Date(event.date).getDay()]}）　${event.time}</span></div>
        <div class="ev-item"><span class="ev-label">📍 開催場所</span><span class="ev-value">${event.location}</span></div>
        <div class="ev-item"><span class="ev-label">👤 主催者</span><span class="ev-value">${event.organizerName || event.organizer}</span></div>
        <div class="ev-item"><span class="ev-label">📞 連絡先</span><span class="ev-value">${event.contactPhone || "—"}</span></div>
        ${event.fee ? `<div class="ev-item"><span class="ev-label">💴 参加費</span><span class="ev-value">${event.fee}</span></div>` : ""}
      </div>
    </div>

    <!-- 参加者情報 -->
    <div class="section">
      <div class="section-title">▍ 参加者情報（${members.length > 0 ? members.length + "名" : "手書き記入欄"}）</div>
      <table>
        <thead>
          <tr>
            <th>種別</th><th>氏名</th><th>区分</th><th>学校名</th><th>学年・クラス</th><th>メールアドレス</th><th>緊急連絡先</th>
          </tr>
        </thead>
        <tbody>
          ${blankRows}
          ${members.length === 0 ? [1,2,3].map(n => `<tr><td style="padding:22px 12px;border-bottom:1px solid #e2e8f0;font-size:11px;color:#94a3b8">${n === 1 ? "代表者" : "同行者" + (n-1)}</td>${["","","","","",""].map(() => `<td style="padding:22px 12px;border-bottom:1px solid #e2e8f0;border-left:1px solid #f1f5f9"></td>`).join("")}</tr>`).join("") : ""}
        </tbody>
      </table>
    </div>

    <!-- 確認・受付印 -->
    <div class="confirm-box">
      <div class="confirm-text">
        上記の内容で参加を申し込みます。<br>
        イベントの変更・中止の際はメールアドレスに連絡いただくことに同意します。<br><br>
        氏名（自署）：＿＿＿＿＿＿＿＿＿＿＿＿　　日付：＿＿＿＿年＿＿月＿＿日
      </div>
      <div class="stamp-area">受付印</div>
    </div>

    <div class="footer">
      <span>提出先：${event.organizerName || event.organizer}　${event.contactPhone ? "TEL " + event.contactPhone : ""}</span>
      <span>🎪 イベントナビ　出力日：${new Date().toLocaleDateString("ja-JP")}</span>
    </div>

  </div>
  </body></html>`);
  win.document.close();
  setTimeout(() => win.print(), 600);
}

// 旧名の互換エイリアス（主催者カードボタンから呼ばれる）
const generatePDF = generateFlyerPDF;

function buildRosterRows(event) {
  const header = ["No.", "氏名", "区分", "学校名", "学年", "クラス", "メールアドレス", "緊急連絡先", "応募日"];
  const rows = event.applicants.flatMap((a, gi) =>
    a.members.map((m, mi) => [
      mi === 0 ? String(gi + 1) : "",
      m.name, m.grade,
      m.school || "", m.schoolYear || "", m.schoolClass || "",
      m.email || "", m.phone || "",
      mi === 0 ? a.date : ""
    ])
  );
  return { header, rows };
}

// 参加者名簿モーダル表示用コンポーネント
function RosterModal({ event, onClose }) {
  const [copied, setCopied] = useState(false);
  const { header, rows } = buildRosterRows(event);

  const csvText = [
    ["イベント名", event.title],
    ["開催日時", `${formatDate(event.date)} ${event.time}`],
    ["開催場所", event.location],
    ["主催者", event.organizerName || event.organizer],
    ["担当者", event.contactPerson || ""],
    ["担当者連絡先", event.contactPhone || ""],
    [],
    header,
    ...rows
  ].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");

  const handleCopy = () => {
    navigator.clipboard.writeText(csvText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }).catch(() => {
      // フォールバック
      const ta = document.createElement("textarea");
      ta.value = csvText;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000, padding: 16 }} onClick={onClose}>
      <div style={{ background: "white", borderRadius: 20, padding: "28px 30px", maxWidth: 820, width: "100%", maxHeight: "88vh", overflowY: "auto", boxShadow: "0 24px 60px rgba(0,0,0,0.3)" }} onClick={e => e.stopPropagation()}>
        {/* ヘッダー */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "#1e1b4b" }}>📊 参加者名簿</h2>
            <p style={{ margin: "4px 0 0", fontSize: 13, color: "#64748b" }}>{event.title}　／　{rows.length > 0 ? `${event.applicants.length}グループ・${rows.length}名` : "申込者なし"}</p>
          </div>
          <button onClick={onClose} style={{ background: "#f1f5f9", border: "none", borderRadius: 8, width: 32, height: 32, cursor: "pointer", fontSize: 18, color: "#64748b" }}>×</button>
        </div>

        {/* コピー案内 */}
        <div style={{ background: "#f0f9ff", border: "2px solid #bae6fd", borderRadius: 12, padding: "12px 16px", marginBottom: 18, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <p style={{ margin: 0, fontSize: 13, color: "#0369a1" }}>
            📋 CSVデータをコピーして、ExcelやGoogleスプレッドシートに貼り付けできます
          </p>
          <button onClick={handleCopy} style={{ padding: "8px 20px", borderRadius: 10, border: "none", background: copied ? "#22c55e" : "linear-gradient(135deg,#0ea5e9,#0369a1)", color: "white", cursor: "pointer", fontWeight: 700, fontSize: 13, whiteSpace: "nowrap", transition: "background 0.2s" }}>
            {copied ? "✅ コピーしました！" : "📋 CSVをコピー"}
          </button>
        </div>

        {/* テーブル */}
        {rows.length === 0 ? (
          <div style={{ textAlign: "center", padding: "48px 20px", color: "#94a3b8" }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>📭</div>
            <p style={{ fontSize: 16, fontWeight: 600 }}>まだ申込者がいません</p>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "linear-gradient(135deg,#667eea,#764ba2)" }}>
                  {header.map(h => (
                    <th key={h} style={{ padding: "10px 12px", color: "white", fontWeight: 700, textAlign: "left", whiteSpace: "nowrap", fontSize: 12 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i} style={{ background: i % 2 === 0 ? "white" : "#f8f9ff", borderBottom: "1px solid #e2e8f0" }}>
                    {row.map((cell, j) => (
                      <td key={j} style={{ padding: "9px 12px", color: "#374151", whiteSpace: "nowrap" }}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ========== 共通スタイル ==========
const labelStyle = { display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 6 };
const inputStyle = { width: "100%", padding: "10px 14px", borderRadius: 10, border: "2px solid #e2e8f0", fontSize: 14, outline: "none", boxSizing: "border-box", transition: "border-color 0.2s", fontFamily: "inherit", background: "white", color: "#1e1b4b" };

// ========== Toastコンポーネント ==========
function Toast({ message, type, onClose }) {
  useEffect(() => { const t = setTimeout(onClose, 3500); return () => clearTimeout(t); }, []);
  const colors = { success: "#22c55e", error: "#ef4444", info: "#667eea" };
  return (
    <div style={{ position: "fixed", bottom: 24, right: 24, zIndex: 9999, background: colors[type] || "#667eea", color: "white", padding: "14px 20px", borderRadius: 12, boxShadow: "0 8px 32px rgba(0,0,0,0.2)", animation: "slideUp 0.3s ease", maxWidth: 340, fontSize: 14, fontWeight: 500 }}>
      {type === "success" ? "✅ " : type === "error" ? "❌ " : "ℹ️ "}{message}
    </div>
  );
}

// ========== Modalコンポーネント ==========
function Modal({ title, children, onClose, wide }) {
  return (
    <div className="modal-overlay" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }} onClick={onClose}>
      <div className="modal-box" style={{ background: "white", borderRadius: 20, padding: "28px 30px", maxWidth: wide ? 740 : 600, width: "100%", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 24px 60px rgba(0,0,0,0.3)" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 22 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "#1e1b4b" }}>{title}</h2>
          <button onClick={onClose} style={{ background: "#f1f5f9", border: "none", borderRadius: 8, width: 32, height: 32, cursor: "pointer", fontSize: 18, color: "#64748b" }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function SectionHeader({ icon, title }) {
  return (
    <div style={{ gridColumn: "span 2", display: "flex", alignItems: "center", gap: 8, padding: "14px 0 6px", borderBottom: "2px solid #ede9fe", marginTop: 10 }}>
      <span style={{ fontSize: 17 }}>{icon}</span>
      <span style={{ fontSize: 13, fontWeight: 800, color: "#7c3aed", letterSpacing: 1 }}>{title}</span>
    </div>
  );
}

function FormField({ label, required, children, span2, note }) {
  return (
    <div style={{ gridColumn: span2 ? "span 2" : undefined }}>
      <label style={labelStyle}>{label}{required && <span style={{ color: "#ef4444", marginLeft: 3 }}>*</span>}</label>
      {children}
      {note && <p style={{ margin: "4px 0 0", fontSize: 11, color: "#94a3b8" }}>{note}</p>}
    </div>
  );
}

// ========== 緊急連絡バナー（カード内表示用） ==========
function EmergencyBanner({ notices }) {
  if (!notices || notices.length === 0) return null;
  const latest = notices[notices.length - 1];
  const nt = NOTICE_TYPES[latest.type] || NOTICE_TYPES.other;
  return (
    <div style={{ background: nt.bg, border: `2px solid ${nt.border}`, borderRadius: 10, padding: "10px 14px", marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
        <span style={{ fontSize: 16 }}>{nt.icon}</span>
        <span style={{ fontSize: 12, fontWeight: 800, color: nt.color, letterSpacing: 0.5 }}>【緊急連絡】{nt.label}</span>
        <span style={{ fontSize: 10, color: "#94a3b8", marginLeft: "auto" }}>{latest.createdAt}</span>
      </div>
      <p style={{ margin: 0, fontSize: 13, color: nt.color, fontWeight: 700, lineHeight: 1.5 }}>{latest.message}</p>
      {notices.length > 1 && <p style={{ margin: "4px 0 0", fontSize: 11, color: "#94a3b8" }}>他 {notices.length - 1}件の連絡あり → 詳細で確認</p>}
    </div>
  );
}

// ========== 緊急連絡フォーム（主催者用） ==========
function EmergencyForm({ event, onSave, onClose }) {
  const [form, setForm] = useState({ type: "cancel", message: "" });
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const placeholders = {
    cancel: "例：雨天のため中止となりました。次回は〇月〇日（〇）を予定しています。",
    timechange: "例：開始時間が10:00→11:00に変更となりました。",
    placechange: "例：開催場所が〇〇から〇〇に変更となりました。",
    other: "参加者への連絡内容を入力してください"
  };
  return (
    <div>
      <div style={{ background: "#fef2f2", border: "2px solid #fecaca", borderRadius: 12, padding: "12px 16px", marginBottom: 20 }}>
        <p style={{ margin: 0, fontSize: 13, color: "#dc2626", fontWeight: 600 }}>
          ⚠️ この連絡はイベント一覧の該当カードに赤字で表示され、登録済みメールアドレスに通知されます。
        </p>
      </div>
      <div style={{ marginBottom: 18 }}>
        <label style={labelStyle}>連絡種別 <span style={{ color: "#ef4444" }}>*</span></label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {Object.entries(NOTICE_TYPES).map(([key, nt]) => (
            <label key={key} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", background: form.type === key ? nt.bg : "#f8f9ff", border: `2px solid ${form.type === key ? nt.border : "transparent"}`, borderRadius: 10, padding: "10px 14px", transition: "all 0.15s" }}>
              <input type="radio" checked={form.type === key} onChange={() => set("type", key)} style={{ accentColor: nt.color }} />
              <span style={{ fontSize: 20 }}>{nt.icon}</span>
              <span style={{ fontWeight: 700, color: form.type === key ? nt.color : "#475569", fontSize: 13 }}>{nt.label}</span>
            </label>
          ))}
        </div>
      </div>
      <div style={{ marginBottom: 24 }}>
        <label style={labelStyle}>連絡内容 <span style={{ color: "#ef4444" }}>*</span></label>
        <textarea value={form.message} onChange={e => set("message", e.target.value)} rows={4} placeholder={placeholders[form.type]} style={{ ...inputStyle, resize: "vertical" }} />
      </div>
      <div style={{ display: "flex", gap: 12 }}>
        <button onClick={onClose} style={{ flex: 1, padding: "12px", borderRadius: 12, border: "2px solid #e2e8f0", background: "white", color: "#64748b", cursor: "pointer", fontWeight: 600 }}>キャンセル</button>
        <button onClick={() => {
          if (!form.message.trim()) { alert("連絡内容を入力してください"); return; }
          onSave({ ...form, id: Date.now(), createdAt: new Date().toLocaleString("ja-JP"), author: event.organizerName || event.organizer });
        }} style={{ flex: 2, padding: "12px", borderRadius: 12, border: "none", background: "linear-gradient(135deg, #ef4444, #dc2626)", color: "white", cursor: "pointer", fontWeight: 800, fontSize: 15 }}>
          📣 緊急連絡を送信する
        </button>
      </div>
    </div>
  );
}

// ========== 申込フォーム（参加者用） ==========
function ApplicationForm({ event, currentUserId, onSubmit, onClose }) {
  const emptyMember = () => ({ grade: "大人", name: "", school: "", schoolYear: "", schoolClass: "", email: "", phone: "" });
  const [count, setCount] = useState(1);
  const [members, setMembers] = useState([emptyMember()]);

  const handleCountChange = (n) => {
    const newCount = Math.max(1, Math.min(10, n));
    setCount(newCount);
    setMembers(prev => {
      const arr = [...prev];
      while (arr.length < newCount) arr.push(emptyMember());
      return arr.slice(0, newCount);
    });
  };

  const setMember = (idx, key, val) => setMembers(prev => prev.map((m, i) => i === idx ? { ...m, [key]: val } : m));

  const isStudent = (grade) => STUDENT_GRADES.includes(grade);

  const getSchoolYearOptions = (grade) => {
    if (grade === "大学生") return ["1年", "2年", "3年", "4年", "院1年", "院2年"];
    if (grade === "高校生") return ["1年", "2年", "3年"];
    if (grade === "中学生") return ["1年", "2年", "3年"];
    if (grade === "小学生") return ["1年", "2年", "3年", "4年", "5年", "6年"];
    return [];
  };

  const validate = () => {
    for (let i = 0; i < members.length; i++) {
      const m = members[i];
      const num = i + 1;
      if (!m.name.trim()) return `${num}人目の氏名を入力してください`;
      if (i === 0 && !m.email.trim()) return "代表者（1人目）のメールアドレスは必須です";
      if (i === 0 && !m.phone.trim()) return "代表者（1人目）の緊急連絡先は必須です";
      if (isStudent(m.grade) && !m.school.trim()) return `${num}人目の学校名を入力してください`;
    }
    return null;
  };

  // PIN設定削除済み

  return (
    <div>
      {/* イベントサマリ */}
      <div style={{ background: "linear-gradient(135deg, #667eea18, #764ba218)", border: "2px solid #ede9fe", borderRadius: 14, padding: "14px 18px", marginBottom: 24 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <span style={{ fontSize: 34 }}>{event.image}</span>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16, color: "#1e1b4b" }}>{event.title}</div>
            <div style={{ fontSize: 12, color: "#64748b", marginTop: 3 }}>📅 {formatDate(event.date)} {event.time}　📍 {event.location}</div>
            {event.fee && <div style={{ fontSize: 12, color: "#7c3aed", fontWeight: 700, marginTop: 2 }}>💴 参加費：{event.fee}</div>}
          </div>
        </div>
      </div>

      {/* 参加人数 */}
      <div style={{ marginBottom: 28, padding: "18px 20px", background: "#f8f9ff", borderRadius: 14, border: "2px solid #e2e8f0" }}>
        <label style={{ ...labelStyle, fontSize: 15, marginBottom: 12 }}>参加人数を選択してください <span style={{ color: "#ef4444" }}>*</span></label>
        {/* ±ボタンと人数表示 */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <button onClick={() => handleCountChange(count - 1)} style={{ width: 44, height: 44, borderRadius: 12, border: "2px solid #e2e8f0", background: count === 1 ? "#f1f5f9" : "white", fontSize: 24, cursor: count === 1 ? "not-allowed" : "pointer", fontWeight: 700, color: "#667eea", flexShrink: 0 }}>−</button>
          <div style={{ fontSize: 38, fontWeight: 900, color: "#1e1b4b", minWidth: 52, textAlign: "center" }}>{count}</div>
          <button onClick={() => handleCountChange(count + 1)} style={{ width: 44, height: 44, borderRadius: 12, border: "2px solid #667eea", background: "#ede9fe", fontSize: 24, cursor: "pointer", fontWeight: 700, color: "#667eea", flexShrink: 0 }}>＋</button>
          <span style={{ fontSize: 16, color: "#64748b", fontWeight: 600 }}>名</span>
        </div>
        {/* クイック選択ボタン（折り返し対応） */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {[1,2,3,4,5].map(n => (
            <button key={n} onClick={() => handleCountChange(n)} style={{ flex: "1 0 auto", minWidth: 48, height: 40, borderRadius: 10, border: "2px solid", borderColor: count === n ? "#667eea" : "#e2e8f0", background: count === n ? "#ede9fe" : "white", fontWeight: 700, fontSize: 14, cursor: "pointer", color: count === n ? "#667eea" : "#94a3b8" }}>{n}名</button>
          ))}
        </div>
      </div>

      {/* 各参加者フォーム */}
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {members.map((m, idx) => (
          <div key={idx} style={{ border: `2px solid ${idx === 0 ? "#667eea" : "#e2e8f0"}`, borderRadius: 16, padding: "20px 22px", background: idx === 0 ? "#fafaff" : "white", position: "relative" }}>
            {/* 人数バッジ */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
              <div style={{ width: 34, height: 34, borderRadius: "50%", background: idx === 0 ? "linear-gradient(135deg,#667eea,#764ba2)" : "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, color: idx === 0 ? "white" : "#94a3b8", fontSize: 14 }}>{idx + 1}</div>
              <div>
                <span style={{ fontWeight: 800, fontSize: 15, color: "#1e1b4b" }}>
                  {idx === 0 ? "代表者" : `${idx + 1}人目`}
                </span>
                {idx === 0 && <span style={{ marginLeft: 8, fontSize: 11, background: "#ede9fe", color: "#7c3aed", padding: "2px 8px", borderRadius: 20, fontWeight: 700 }}>メール・緊急連絡先 必須</span>}
                {idx > 0 && <span style={{ marginLeft: 8, fontSize: 11, color: "#94a3b8", fontWeight: 500 }}>メール・緊急連絡先は任意</span>}
              </div>
            </div>

            <div className="form-grid-2col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              {/* 区分 */}
              <div style={{ gridColumn: "span 2" }}>
                <label style={labelStyle}>区分 <span style={{ color: "#ef4444" }}>*</span></label>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {GRADE_TYPES.map(g => (
                    <button key={g} onClick={() => setMember(idx, "grade", g)} style={{ padding: "6px 14px", borderRadius: 20, border: "2px solid", borderColor: m.grade === g ? GRADE_COLORS[g] : "#e2e8f0", background: m.grade === g ? GRADE_COLORS[g] + "20" : "white", color: m.grade === g ? GRADE_COLORS[g] : "#64748b", cursor: "pointer", fontSize: 13, fontWeight: m.grade === g ? 700 : 500, transition: "all 0.15s" }}>{g}</button>
                  ))}
                </div>
              </div>

              {/* 氏名 */}
              <div style={{ gridColumn: "span 2" }}>
                <label style={labelStyle}>氏名 <span style={{ color: "#ef4444" }}>*</span></label>
                <input value={m.name} onChange={e => setMember(idx, "name", e.target.value)} placeholder="例：山田 太郎（フルネーム）" style={inputStyle} />
              </div>

              {/* 学生の場合の追加項目 */}
              {isStudent(m.grade) && (
                <>
                  <div style={{ gridColumn: "span 2" }}>
                    <label style={labelStyle}>学校名 <span style={{ color: "#ef4444" }}>*</span></label>
                    <input value={m.school} onChange={e => setMember(idx, "school", e.target.value)} placeholder="例：○○高等学校" style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>学年</label>
                    <select value={m.schoolYear} onChange={e => setMember(idx, "schoolYear", e.target.value)} style={{ ...inputStyle, cursor: "pointer" }}>
                      <option value="">選択してください</option>
                      {getSchoolYearOptions(m.grade).map(y => <option key={y} value={y}>{y}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={labelStyle}>クラス</label>
                    <input value={m.schoolClass} onChange={e => setMember(idx, "schoolClass", e.target.value)} placeholder="例：A組、1組" style={inputStyle} />
                  </div>
                </>
              )}

              {/* メールアドレス */}
              <div style={{ gridColumn: "span 2" }}>
                <label style={labelStyle}>
                  メールアドレス
                  {idx === 0 ? <span style={{ color: "#ef4444" }}> *</span> : <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 400 }}> （任意）</span>}
                </label>
                <input type="email" value={m.email} onChange={e => setMember(idx, "email", e.target.value)} placeholder="例：example@email.com" style={inputStyle} />
                {idx === 0 && <p style={{ margin: "5px 0 0", fontSize: 11, color: "#94a3b8" }}>📧 中止・変更などの緊急連絡をこちらのアドレスに送信します</p>}
              </div>

              {/* 緊急連絡先 */}
              <div style={{ gridColumn: "span 2" }}>
                <label style={labelStyle}>
                  緊急連絡先（電話番号）
                  {idx === 0 ? <span style={{ color: "#ef4444" }}> *</span> : <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 400 }}> （任意）</span>}
                </label>
                <input type="tel" value={m.phone} onChange={e => setMember(idx, "phone", e.target.value)} placeholder="例：090-1234-5678" style={inputStyle} />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 12, marginTop: 28 }}>
        <button onClick={onClose} style={{ flex: 1, padding: "13px", borderRadius: 12, border: "2px solid #e2e8f0", background: "white", color: "#64748b", cursor: "pointer", fontWeight: 600, fontSize: 14 }}>キャンセル</button>
        <button onClick={() => {
          const err = validate();
          if (err) { alert(err); return; }
          onSubmit({ id: currentUserId, members, date: new Date().toLocaleDateString("ja-JP") });
        }} style={{ flex: 2, padding: "13px", borderRadius: 12, border: "none", background: "linear-gradient(135deg, #667eea, #764ba2)", color: "white", cursor: "pointer", fontWeight: 800, fontSize: 15 }}>
          ✅ 申込を確定する
        </button>
      </div>
    </div>
  );
}

// ========== イベントカード ==========
function EventCard({ event, currentUser, onOpenApply, onViewDetail, onApprove, onRevision, onEdit, onEmergency, onRoster, onAdminAction, onFlyer, onCancelApply, onDelete }) {
  const isApplied = event.applicants.some(a => a.id === currentUser.id);
  const isVolApplied = event.volunteerApplicants?.some(a => a.id === currentUser.id);
  const isFull = !event.capacityUnlimited && event.applicants.length >= event.capacity;
  const hasNotice = event.emergencyNotices && event.emergencyNotices.length > 0;

  return (
    <div style={{ background: "white", borderRadius: 20, overflow: "hidden", boxShadow: hasNotice ? "0 4px 24px rgba(239,68,68,0.18)" : "0 4px 20px rgba(102,126,234,0.1)", transition: "transform 0.2s, box-shadow 0.2s", border: hasNotice ? "2px solid #fecaca" : "1px solid rgba(102,126,234,0.1)" }}
      onMouseEnter={e => e.currentTarget.style.transform = "translateY(-4px)"}
      onMouseLeave={e => e.currentTarget.style.transform = ""}
    >
      <div style={{ height: 6, background: hasNotice ? "linear-gradient(90deg,#ef4444,#f97316)" : event.type === "volunteer" ? "linear-gradient(90deg,#f59e0b,#ef4444)" : "linear-gradient(90deg,#667eea,#764ba2)" }} />

      <div style={{ padding: "18px 22px" }}>
        {/* 緊急連絡バナー（参加者には常時表示、他ロールも表示） */}
        <EmergencyBanner notices={event.emergencyNotices} />

        {/* バッジ行 */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
          <span style={{ background: event.type === "volunteer" ? "#fef3c7" : "#ede9fe", color: event.type === "volunteer" ? "#b45309" : "#7c3aed", padding: "3px 10px", borderRadius: 20, fontSize: 12, fontWeight: 600 }}>
            {event.type === "volunteer" ? "🙋 ボランティア" : "📅 イベント"}
          </span>
          {(currentUser.role === "admin" || currentUser.id === event.organizerId) && (
            <span style={{ background: STATUS_COLORS[event.status] + "20", color: STATUS_COLORS[event.status], padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700 }}>{STATUS_LABELS[event.status]}</span>
          )}
        </div>

        {/* タイトル */}
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start", marginBottom: 12 }}>
          <span style={{ fontSize: 34, lineHeight: 1 }}>{event.image}</span>
          <div style={{ flex: 1 }}>
            <h3 style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 800, color: "#1e1b4b", lineHeight: 1.4 }}>{event.title}</h3>
            <p style={{ margin: 0, fontSize: 12, color: "#64748b", lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{event.description}</p>
          </div>
        </div>

        {/* 情報グリッド */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 14 }}>
          {[["📅", formatDate(event.date) + " " + event.time], ["📍", event.location], ["👤", event.organizerName || event.organizer], ["👥", event.capacityUnlimited ? "定員なし" : `${event.applicants.length} / ${event.capacity}名`]].map(([icon, text]) => (
            <div key={icon} style={{ background: "#f8f9ff", borderRadius: 8, padding: "7px 10px", display: "flex", gap: 5, alignItems: "center" }}>
              <span style={{ fontSize: 13 }}>{icon}</span>
              <span style={{ fontSize: 11, color: "#475569", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{text}</span>
            </div>
          ))}
        </div>

        {/* 定員バー */}
        {!event.capacityUnlimited && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ height: 5, background: "#e2e8f0", borderRadius: 3, overflow: "hidden" }}>
              <div style={{ height: "100%", borderRadius: 3, width: `${Math.min((event.applicants.length / event.capacity) * 100, 100)}%`, background: isFull ? "#ef4444" : "linear-gradient(90deg,#667eea,#764ba2)", transition: "width 0.5s" }} />
            </div>
            <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 3, textAlign: "right" }}>残り{Math.max(event.capacity - event.applicants.length, 0)}名</div>
          </div>
        )}

        {/* ボタン群 */}
        <div className="card-buttons" style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
          <button onClick={() => onViewDetail(event)} style={{ flex: 1, padding: "8px 12px", borderRadius: 10, border: "2px solid #667eea", background: "white", color: "#667eea", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>詳細</button>

          {event.status === "approved" && currentUser.id !== event.organizerId && (
            <>
              <button onClick={() => onOpenApply(event, event.type === "volunteer" ? "volunteer" : "participant")} disabled={(isApplied || isVolApplied) || isFull} style={{ flex: 1, padding: "8px 12px", borderRadius: 10, border: "none", background: (isApplied || isVolApplied) ? "#dcfce7" : isFull ? "#fee2e2" : event.type === "volunteer" ? "linear-gradient(135deg,#f59e0b,#ef4444)" : "linear-gradient(135deg,#667eea,#764ba2)", color: (isApplied || isVolApplied) ? "#16a34a" : isFull ? "#dc2626" : "white", cursor: (isApplied || isVolApplied) || isFull ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 700 }}>
                {(isApplied || isVolApplied) ? "✓ 申込済み" : isFull ? "満員" : "参加申込"}
              </button>
              {(isApplied || isVolApplied) && (
                <button onClick={() => onCancelApply(event, currentUser.id)} style={{ padding: "8px 10px", borderRadius: 10, border: "2px solid #fecaca", background: "white", color: "#dc2626", cursor: "pointer", fontSize: 11, fontWeight: 700 }}>🗑 キャンセル</button>
              )}
              <button onClick={() => onFlyer(event)} style={{ padding: "8px 10px", borderRadius: 10, border: "none", background: "#fef3c7", color: "#b45309", cursor: "pointer", fontSize: 11, fontWeight: 700 }} title="申込票を印刷して持参できます">📄 申込票印刷</button>
            </>
          )}

          {currentUser.id === event.organizerId && (
            <>
              <button onClick={() => onEdit(event)} style={{ padding: "8px 10px", borderRadius: 10, border: "none", background: "#f1f5f9", color: "#475569", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>✏️ 編集</button>
              <button onClick={() => onEmergency(event)} style={{ padding: "8px 12px", borderRadius: 10, border: "none", background: "#fef2f2", color: "#dc2626", cursor: "pointer", fontSize: 12, fontWeight: 800 }}>📣 緊急連絡</button>
              <button onClick={() => generatePDF(event)} style={{ padding: "8px 10px", borderRadius: 10, border: "none", background: "#fef3c7", color: "#b45309", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>📄 PDF</button>
            </>
          )}

          {currentUser.role === "admin" && (
            <>
              <button onClick={() => onEdit(event)} style={{ padding: "8px 10px", borderRadius: 10, border: "none", background: "#f1f5f9", color: "#475569", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>✏️ 編集</button>
              {event.status !== "approved" && <button onClick={() => onApprove(event.id)} style={{ padding: "8px 10px", borderRadius: 10, border: "none", background: "#dcfce7", color: "#15803d", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>✅ 承認</button>}
              <button onClick={() => onAdminAction(event, "revision")} style={{ padding: "8px 10px", borderRadius: 10, border: "none", background: "#fffbeb", color: "#d97706", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>🔄 修正依頼</button>
              <button onClick={() => onAdminAction(event, "rejected")} style={{ padding: "8px 10px", borderRadius: 10, border: "none", background: "#fef2f2", color: "#dc2626", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>🚫 非承認</button>
              <button onClick={() => onFlyer(event)} style={{ padding: "8px 10px", borderRadius: 10, border: "none", background: "#fef3c7", color: "#b45309", cursor: "pointer", fontSize: 11, fontWeight: 700 }}>📄 PDF</button>
              <button onClick={() => onRoster(event)} style={{ padding: "8px 10px", borderRadius: 10, border: "none", background: "#dcfce7", color: "#15803d", cursor: "pointer", fontSize: 11, fontWeight: 700 }}>📊 名簿</button>
              <button onClick={() => onDelete(event.id)} style={{ padding: "8px 10px", borderRadius: 10, border: "none", background: "#fef2f2", color: "#dc2626", cursor: "pointer", fontSize: 11, fontWeight: 700 }}>🗑 削除</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ========== 管理者アクション（修正依頼 / 非承認）コメントモーダル ==========
function AdminActionModal({ event, actionType, onConfirm, onClose }) {
  const [comment, setComment] = useState("");
  const isRevision = actionType === "revision";
  const cfg = isRevision
    ? { title: "🔄 修正依頼を送信", color: "#d97706", bg: "#fffbeb", border: "#fde68a", btnBg: "linear-gradient(135deg,#f59e0b,#d97706)", placeholder: "修正してほしい内容を具体的に記入してください。\n例：開催場所の詳細住所を追加してください。連絡先電話番号の確認をお願いします。" }
    : { title: "🚫 非承認として返送", color: "#dc2626", bg: "#fef2f2", border: "#fecaca", btnBg: "linear-gradient(135deg,#ef4444,#dc2626)", placeholder: "非承認の理由を記入してください。\n例：投稿内容が利用規約に反しています。公序良俗に反する内容が含まれているため承認できません。" };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000, padding: 16 }} onClick={onClose}>
      <div style={{ background: "white", borderRadius: 20, padding: "28px 30px", maxWidth: 540, width: "100%", boxShadow: "0 24px 60px rgba(0,0,0,0.3)" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "#1e1b4b" }}>{cfg.title}</h2>
          <button onClick={onClose} style={{ background: "#f1f5f9", border: "none", borderRadius: 8, width: 32, height: 32, cursor: "pointer", fontSize: 18, color: "#64748b" }}>×</button>
        </div>

        {/* 対象イベント */}
        <div style={{ background: "#f8f9ff", border: "2px solid #e2e8f0", borderRadius: 12, padding: "12px 16px", marginBottom: 20, display: "flex", gap: 12, alignItems: "center" }}>
          <span style={{ fontSize: 30 }}>{event.image}</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: "#1e1b4b" }}>{event.title}</div>
            <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>主催者：{event.organizerName || event.organizer}</div>
          </div>
        </div>

        {/* 注意書き */}
        <div style={{ background: cfg.bg, border: `2px solid ${cfg.border}`, borderRadius: 12, padding: "12px 16px", marginBottom: 18 }}>
          <p style={{ margin: 0, fontSize: 13, color: cfg.color, fontWeight: 600 }}>
            ⚠️ このコメントは主催者の通知に届きます。{isRevision ? "修正内容を明確に記載してください。" : "非承認の理由を明確に記載してください。"}
          </p>
        </div>

        {/* コメント入力 */}
        <div style={{ marginBottom: 24 }}>
          <label style={{ display: "block", fontSize: 13, fontWeight: 700, color: "#374151", marginBottom: 8 }}>
            {isRevision ? "修正内容・コメント" : "非承認の理由"}
            <span style={{ color: "#ef4444", marginLeft: 3 }}>*</span>
          </label>
          <textarea
            value={comment}
            onChange={e => setComment(e.target.value)}
            rows={5}
            placeholder={cfg.placeholder}
            style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: "2px solid #e2e8f0", fontSize: 14, outline: "none", boxSizing: "border-box", resize: "vertical", fontFamily: "inherit", lineHeight: 1.7 }}
            autoFocus
          />
          <p style={{ margin: "5px 0 0", fontSize: 11, color: "#94a3b8" }}>
            {comment.length} 文字
          </p>
        </div>

        <div style={{ display: "flex", gap: 12 }}>
          <button onClick={onClose} style={{ flex: 1, padding: "13px", borderRadius: 12, border: "2px solid #e2e8f0", background: "white", color: "#64748b", cursor: "pointer", fontWeight: 600, fontSize: 14 }}>キャンセル</button>
          <button
            onClick={() => {
              if (!comment.trim()) { alert(`${isRevision ? "修正内容" : "非承認の理由"}を入力してください`); return; }
              onConfirm(actionType, comment.trim());
            }}
            style={{ flex: 2, padding: "13px", borderRadius: 12, border: "none", background: cfg.btnBg, color: "white", cursor: "pointer", fontWeight: 800, fontSize: 15 }}
          >
            {isRevision ? "🔄 修正依頼を送信する" : "🚫 非承認として送信する"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ========== PIN認証モーダル ==========
function PinModal({ title, description, icon, onConfirm, onClose }) {
  const [pin, setPin] = useState(["", "", "", ""]);
  const [error, setError] = useState("");
  const refs = [useRef(), useRef(), useRef(), useRef()];

  const handleChange = (i, v) => {
    if (!/^\d*$/.test(v)) return;
    const next = [...pin]; next[i] = v.slice(-1); setPin(next); setError("");
    if (v && i < 3) refs[i + 1].current?.focus();
  };
  const handleKeyDown = (i, e) => {
    if (e.key === "Backspace" && !pin[i] && i > 0) refs[i - 1].current?.focus();
  };
  const handleSubmit = () => {
    const code = pin.join("");
    if (code.length < 4) { setError("4桁すべて入力してください"); return; }
    const ok = onConfirm(code);
    if (ok === false) { setError("PINが正しくありません"); setPin(["","","",""]); setTimeout(() => refs[0].current?.focus(), 50); }
  };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:3000, padding:16 }} onClick={onClose}>
      <div style={{ background:"white", borderRadius:20, padding:"32px 36px", maxWidth:380, width:"100%", boxShadow:"0 24px 60px rgba(0,0,0,0.3)", textAlign:"center" }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize:48, marginBottom:10 }}>{icon}</div>
        <h2 style={{ margin:"0 0 8px", fontSize:18, fontWeight:800, color:"#1e1b4b" }}>{title}</h2>
        <p style={{ margin:"0 0 26px", fontSize:13, color:"#64748b", lineHeight:1.6 }}>{description}</p>
        <div style={{ display:"flex", gap:12, justifyContent:"center", marginBottom:10 }}>
          {pin.map((d, i) => (
            <input key={i} ref={refs[i]} value={d}
              onChange={e => handleChange(i, e.target.value)}
              onKeyDown={e => handleKeyDown(i, e)}
              maxLength={1} inputMode="numeric"
              autoFocus={i === 0}
              style={{ width:56, height:64, fontSize:28, fontWeight:800, textAlign:"center", border:`2px solid ${error ? "#ef4444" : d ? "#667eea" : "#e2e8f0"}`, borderRadius:12, outline:"none", color:"#1e1b4b", background: d ? "#f0f0ff" : "white", fontFamily:"inherit" }}
            />
          ))}
        </div>
        {error
          ? <p style={{ margin:"0 0 14px", fontSize:13, color:"#ef4444", fontWeight:600 }}>⚠ {error}</p>
          : <div style={{ height:28 }} />}
        <div style={{ display:"flex", gap:10 }}>
          <button onClick={onClose} style={{ flex:1, padding:"12px", borderRadius:11, border:"2px solid #e2e8f0", background:"white", color:"#64748b", cursor:"pointer", fontWeight:600, fontFamily:"inherit" }}>キャンセル</button>
          <button onClick={handleSubmit} style={{ flex:2, padding:"12px", borderRadius:11, border:"none", background:"linear-gradient(135deg,#667eea,#764ba2)", color:"white", cursor:"pointer", fontWeight:800, fontSize:15, fontFamily:"inherit" }}>確認する</button>
        </div>
        <p style={{ marginTop:14, fontSize:11, color:"#94a3b8" }}>※ PINを忘れた場合は管理者にお問い合わせください</p>
      </div>
    </div>
  );
}

// ========== PIN設定ステップ ==========
function PinSetupStep({ label, onConfirm, onBack }) {
  const [phase, setPhase] = useState("set");
  const [pin, setPin]         = useState(["","","",""]);
  const [confirm, setConfirm] = useState(["","","",""]);
  const [error, setError] = useState("");
  const refs1 = [useRef(), useRef(), useRef(), useRef()];
  const refs2 = [useRef(), useRef(), useRef(), useRef()];

  const change = (arr, setArr, refs, i, v) => {
    if (!/^\d*$/.test(v)) return;
    const n = [...arr]; n[i] = v.slice(-1); setArr(n); setError("");
    if (v && i < 3) refs[i+1].current?.focus();
  };
  const kdown = (arr, refs, i, e) => { if (e.key==="Backspace" && !arr[i] && i>0) refs[i-1].current?.focus(); };

  const boxes = (arr, setArr, refs, isC) => (
    <div style={{ display:"flex", gap:12, justifyContent:"center", marginBottom:10 }}>
      {arr.map((d,i) => (
        <input key={i} ref={refs[i]} value={d}
          onChange={e => change(arr,setArr,refs,i,e.target.value)}
          onKeyDown={e => kdown(arr,refs,i,e)}
          maxLength={1} inputMode="numeric" autoFocus={i===0}
          style={{ width:52, height:60, fontSize:26, fontWeight:800, textAlign:"center", border:`2px solid ${error&&isC ? "#ef4444" : d ? "#667eea" : "#e2e8f0"}`, borderRadius:12, outline:"none", color:"#1e1b4b", background:d?"#f0f0ff":"white", fontFamily:"inherit" }}
        />
      ))}
    </div>
  );

  const next = () => {
    if (pin.join("").length < 4) { setError("4桁すべて入力してください"); return; }
    setPhase("confirm"); setError("");
    setTimeout(() => refs2[0].current?.focus(), 50);
  };
  const finish = () => {
    if (confirm.join("").length < 4) { setError("4桁すべて入力してください"); return; }
    if (pin.join("") !== confirm.join("")) { setError("PINが一致しません。もう一度"); setConfirm(["","","",""]); setTimeout(()=>refs2[0].current?.focus(),50); return; }
    onConfirm(pin.join(""));
  };

  return (
    <div style={{ textAlign:"center", padding:"8px 0" }}>
      <div style={{ fontSize:40, marginBottom:10 }}>🔐</div>
      <h3 style={{ margin:"0 0 6px", fontSize:17, fontWeight:800, color:"#1e1b4b" }}>{phase==="set" ? `${label}用PINを設定` : "PINを再入力して確認"}</h3>
      <p style={{ margin:"0 0 22px", fontSize:12, color:"#64748b", lineHeight:1.7 }}>
        {phase==="set" ? "後から編集・変更する際に必要です。\n4桁の数字を設定してください。" : "確認のため、もう一度同じPINを入力してください。"}
      </p>
      {phase==="set" ? boxes(pin, setPin, refs1, false) : boxes(confirm, setConfirm, refs2, true)}
      {error ? <p style={{ margin:"0 0 14px", fontSize:13, color:"#ef4444", fontWeight:600 }}>⚠ {error}</p> : <div style={{ height:26 }} />}
      <div style={{ background:"#fffbeb", border:"2px solid #fde68a", borderRadius:10, padding:"10px 14px", marginBottom:20, textAlign:"left" }}>
        <p style={{ margin:0, fontSize:12, color:"#92400e", lineHeight:1.6 }}>⚠️ <strong>PINは必ずメモを。</strong>忘れた場合は編集・変更できなくなります。</p>
      </div>
      <div style={{ display:"flex", gap:10 }}>
        <button onClick={phase==="set" ? onBack : () => { setPhase("set"); setConfirm(["","","",""]); setError(""); }}
          style={{ flex:1, padding:"12px", borderRadius:11, border:"2px solid #e2e8f0", background:"white", color:"#64748b", cursor:"pointer", fontWeight:600, fontFamily:"inherit" }}>← 戻る</button>
        <button onClick={phase==="set" ? next : finish}
          style={{ flex:2, padding:"12px", borderRadius:11, border:"none", background:"linear-gradient(135deg,#667eea,#764ba2)", color:"white", cursor:"pointer", fontWeight:800, fontSize:15, fontFamily:"inherit" }}>
          {phase==="set" ? "次へ →" : "✅ 確定する"}
        </button>
      </div>
    </div>
  );
}

function EventForm({ event, onSave, onClose }) {
  const [form, setForm] = useState(event || { type: "event", title: "", description: "", date: "", time: "10:00", location: "", capacity: 30, capacityUnlimited: false, image: "🎉", volunteers: 0, volunteerApplicants: [], meetingPlace: "", meetingTime: "09:00", dismissalTime: "17:00", fee: "", organizerName: "", contactPerson: "", contactPhone: "", eligibility: [], targetArea: "指定なし", targetAreaOther: "", dressCode: "", externalUrl: "" });
  const emojis = ["🎉", "🌸", "🎆", "📚", "🚶", "🎵", "🍳", "🌿", "🏃", "🎨", "🤝", "🌈"];
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const validate = () => {
    if (!form.title.trim()) return "イベント名を入力してください";
    if (!form.date) return "開催日を入力してください";
    if (!form.location.trim()) return "開催場所を入力してください";
    if (!form.organizerName.trim()) return "主催者名を入力してください";
    if (!form.contactPerson.trim()) return "担当者名を入力してください";
    if (!form.contactPhone.trim()) return "担当者連絡先を入力してください";
    if (form.type === "volunteer" && !form.meetingPlace.trim()) return "集合場所を入力してください";
    return null;
  };

  // PIN設定ステップ削除（Firebase版では不要）
  return (
    <div>
      <div className="form-grid-2col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <SectionHeader icon="🏷️" title="種別" />
        <div style={{ gridColumn: "span 2", display: "flex", gap: 12 }}>
          {["event", "volunteer"].map(t => (
            <label key={t} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", flex: 1, background: form.type === t ? "#ede9fe" : "#f8f9ff", borderRadius: 10, padding: "10px 16px", border: `2px solid ${form.type === t ? "#7c3aed" : "transparent"}` }}>
              <input type="radio" value={t} checked={form.type === t} onChange={() => set("type", t)} />
              <span style={{ fontWeight: 700, color: form.type === t ? "#7c3aed" : "#475569", fontSize: 14 }}>{t === "event" ? "📅 イベント" : "🙋 ボランティア募集"}</span>
            </label>
          ))}
        </div>
        <div style={{ gridColumn: "span 2" }}>
          <label style={labelStyle}>アイコン</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{emojis.map(e => <button key={e} onClick={() => set("image", e)} style={{ width: 40, height: 40, borderRadius: 10, border: `2px solid ${form.image === e ? "#667eea" : "#e2e8f0"}`, background: form.image === e ? "#ede9fe" : "white", fontSize: 19, cursor: "pointer" }}>{e}</button>)}</div>
        </div>
        <SectionHeader icon="📋" title="基本情報" />
        <FormField label="イベント名" required span2><input value={form.title} onChange={e => set("title", e.target.value)} placeholder="例：春の地域清掃フェスティバル" style={inputStyle} /></FormField>
        <FormField label="説明" span2><textarea value={form.description} onChange={e => set("description", e.target.value)} rows={3} placeholder="イベントの詳細説明" style={{ ...inputStyle, resize: "vertical" }} /></FormField>
        <FormField label="関連リンク（任意）" span2><input type="url" value={form.externalUrl || ""} onChange={e => set("externalUrl", e.target.value)} placeholder="例: https://example.com/event-detail（主催者HPやイベント詳細ページのURL）" style={inputStyle} /></FormField>
        <SectionHeader icon="📅" title="日時・場所" />
        <FormField label="開催日" required><input type="date" value={form.date} onChange={e => set("date", e.target.value)} style={inputStyle} /></FormField>
        <FormField label="開催時間" required><input type="time" value={form.time} onChange={e => set("time", e.target.value)} style={inputStyle} /></FormField>
        <FormField label="開催場所" required span2><input value={form.location} onChange={e => set("location", e.target.value)} placeholder="例：中央公園 集合広場" style={inputStyle} /></FormField>
        {form.type === "volunteer" && <>
          <SectionHeader icon="🙋" title="ボランティア集合情報" />
          <FormField label="集合場所" required span2><input value={form.meetingPlace} onChange={e => set("meetingPlace", e.target.value)} placeholder="例：市役所前 正面入口" style={inputStyle} /></FormField>
          <FormField label="集合時間" required><input type="time" value={form.meetingTime} onChange={e => set("meetingTime", e.target.value)} style={inputStyle} /></FormField>
          <FormField label="解散予定時間" required><input type="time" value={form.dismissalTime} onChange={e => set("dismissalTime", e.target.value)} style={inputStyle} /></FormField>
          <SectionHeader icon="🎯" title="参加資格・対象地区" />
          <div style={{ gridColumn: "span 2" }}>
            <label style={labelStyle}>参加資格（複数選択可）</label>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {["中学生", "小学生", "大人"].map(e => (
                <label key={e} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", background: (form.eligibility || []).includes(e) ? "#ede9fe" : "#f8f9ff", border: `2px solid ${(form.eligibility || []).includes(e) ? "#7c3aed" : "#e2e8f0"}`, borderRadius: 10, padding: "8px 16px" }}>
                  <input type="checkbox" checked={(form.eligibility || []).includes(e)} onChange={() => {
                    const cur = form.eligibility || [];
                    set("eligibility", cur.includes(e) ? cur.filter(x => x !== e) : [...cur, e]);
                  }} />
                  <span style={{ fontSize: 13, fontWeight: 600, color: (form.eligibility || []).includes(e) ? "#7c3aed" : "#64748b" }}>{e}</span>
                </label>
              ))}
            </div>
          </div>
          <div style={{ gridColumn: "span 2" }}>
            <label style={labelStyle}>対象地区</label>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
              {["当該地区", "指定なし", "その他"].map(a => (
                <label key={a} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", background: (form.targetArea || "") === a ? "#e0f2fe" : "#f8f9ff", border: `2px solid ${(form.targetArea || "") === a ? "#0284c7" : "#e2e8f0"}`, borderRadius: 10, padding: "8px 16px" }}>
                  <input type="radio" name="targetArea" checked={(form.targetArea || "") === a} onChange={() => set("targetArea", a)} />
                  <span style={{ fontSize: 13, fontWeight: 600, color: (form.targetArea || "") === a ? "#0284c7" : "#64748b" }}>{a}</span>
                </label>
              ))}
            </div>
            {form.targetArea === "その他" && <input value={form.targetAreaOther || ""} onChange={e => set("targetAreaOther", e.target.value)} placeholder="対象地区を入力" style={inputStyle} />}
          </div>
        </>}
        <SectionHeader icon="👥" title="参加条件" />
        <div style={{ gridColumn: "span 2" }}>
          <label style={labelStyle}>定員</label>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", background: form.capacityUnlimited ? "#f0fdf4" : "#f8f9ff", border: `2px solid ${form.capacityUnlimited ? "#22c55e" : "#e2e8f0"}`, borderRadius: 10, padding: "8px 14px" }}>
              <input type="checkbox" checked={form.capacityUnlimited} onChange={e => set("capacityUnlimited", e.target.checked)} />
              <span style={{ fontSize: 13, fontWeight: 600, color: form.capacityUnlimited ? "#15803d" : "#64748b" }}>無（定員なし）</span>
            </label>
            {!form.capacityUnlimited && <div style={{ flex: 1 }}><input type="number" value={form.capacity} min={1} onChange={e => set("capacity", +e.target.value)} placeholder="定員人数" style={inputStyle} /></div>}
          </div>
        </div>
        {form.type === "event" && <FormField label="参加費" span2><input value={form.fee} onChange={e => set("fee", e.target.value)} placeholder="例：無料、500円、大人1,000円／子ども500円" style={inputStyle} /></FormField>}
        <SectionHeader icon="👕" title="当日の服装・持ち物" />
        <FormField label="服装・持ち物（参加者へのご案内）" span2><textarea value={form.dressCode || ""} onChange={e => set("dressCode", e.target.value)} rows={3} placeholder="例：動きやすい服装、軍手、タオル、飲み物、帽子など" style={{ ...inputStyle, resize: "vertical" }} /></FormField>
        <SectionHeader icon="👤" title="主催者・担当者" />
        <FormField label="主催者（団体名・氏名）" required span2><input value={form.organizerName} onChange={e => set("organizerName", e.target.value)} placeholder="例：緑の会 田中花子" style={inputStyle} /></FormField>
        <FormField label="担当者名" required><input value={form.contactPerson} onChange={e => set("contactPerson", e.target.value)} placeholder="例：山田 太郎" style={inputStyle} /></FormField>
        <FormField label="担当者連絡先（電話番号）" required><input type="tel" value={form.contactPhone} onChange={e => set("contactPhone", e.target.value)} placeholder="例：090-1234-5678" style={inputStyle} /></FormField>
      </div>
      <div style={{ display: "flex", gap: 12, marginTop: 28 }}>
        <button onClick={onClose} style={{ flex: 1, padding: "13px", borderRadius: 12, border: "2px solid #e2e8f0", background: "white", color: "#64748b", cursor: "pointer", fontWeight: 600 }}>キャンセル</button>
        <button onClick={() => { const err = validate(); if (err) { alert(err); return; } onSave(form); }} style={{ flex: 2, padding: "13px", borderRadius: 12, border: "none", background: "linear-gradient(135deg,#667eea,#764ba2)", color: "white", cursor: "pointer", fontWeight: 700, fontSize: 15 }}>
          {event ? "✏️ 更新する" : "🚀 投稿する"}
        </button>
      </div>
    </div>
  );
}

// ========== サイネージモード（完全版） ==========
const SIGNAGE_DEFAULTS = { slideDuration: 8, fadeDuration: 1.2, reloadInterval: 5, burnInProtection: true };
const SIGNAGE_CATEGORY_COLORS = {
  "地域活動": { bg: "linear-gradient(135deg,#059669,#047857)", accent: "#34d399" },
  "ボランティア": { bg: "linear-gradient(135deg,#2563eb,#1d4ed8)", accent: "#60a5fa" },
  "文化・教育": { bg: "linear-gradient(135deg,#7c3aed,#6d28d9)", accent: "#a78bfa" },
  "スポーツ・健康": { bg: "linear-gradient(135deg,#dc2626,#b91c1c)", accent: "#fca5a5" },
  "default": { bg: "linear-gradient(135deg,#0284c7,#0369a1)", accent: "#7dd3fc" },
};
function getSCColor(cat) { return SIGNAGE_CATEGORY_COLORS[cat] || SIGNAGE_CATEGORY_COLORS["default"]; }

function formatSignageDate(dateStr) {
  const d = new Date(dateStr); const days = ["日","月","火","水","木","金","土"];
  return `${d.getMonth()+1}月${d.getDate()}日（${days[d.getDay()]}）`;
}
function daysUntil(dateStr) {
  const now = new Date(); now.setHours(0,0,0,0);
  const target = new Date(dateStr); target.setHours(0,0,0,0);
  const diff = Math.ceil((target - now) / 86400000);
  if (diff === 0) return "今日"; if (diff === 1) return "明日"; if (diff < 0) return "終了"; return `あと${diff}日`;
}
function deadlineLabel(dateStr) {
  const d = daysUntil(dateStr);
  if (d === "終了") return "締切済み"; if (d === "今日") return "本日締切！"; if (d === "明日") return "明日締切！";
  return `締切 ${formatSignageDate(dateStr)}`;
}
function useCurrentTime() {
  const [t, setT] = useState(new Date());
  useEffect(() => { const id = setInterval(() => setT(new Date()), 1000); return () => clearInterval(id); }, []);
  return t;
}
function useBurnInOffset(on) {
  const [o, setO] = useState({ x: 0, y: 0 });
  useEffect(() => {
    if (!on) { setO({ x: 0, y: 0 }); return; }
    const id = setInterval(() => setO({ x: Math.round((Math.random()-0.5)*6), y: Math.round((Math.random()-0.5)*4) }), 60000);
    return () => clearInterval(id);
  }, [on]);
  return o;
}

function SignageClock({ now }) {
  const h = String(now.getHours()).padStart(2,"0"), m = String(now.getMinutes()).padStart(2,"0"), s = String(now.getSeconds()).padStart(2,"0");
  const days = ["日","月","火","水","木","金","土"];
  const ds = `${now.getFullYear()}年${now.getMonth()+1}月${now.getDate()}日（${days[now.getDay()]}）`;
  return <div style={{ display:"flex", alignItems:"baseline", gap:16 }}>
    <span style={{ fontFamily:"'Courier Prime','SF Mono',monospace", fontSize:42, fontWeight:700, color:"white", letterSpacing:2, lineHeight:1, textShadow:"0 2px 20px rgba(0,0,0,0.3)" }}>{h}:{m}<span style={{ fontSize:24, opacity:0.6 }}>:{s}</span></span>
    <span style={{ fontSize:16, color:"rgba(255,255,255,0.8)", fontWeight:500 }}>{ds}</span>
  </div>;
}

function SignageWeather({ weather }) {
  if (!weather) return null;
  return <div style={{ display:"flex", alignItems:"center", gap:20, background:"rgba(255,255,255,0.12)", backdropFilter:"blur(10px)", borderRadius:16, padding:"12px 24px" }}>
    <div style={{ fontSize:14, color:"rgba(255,255,255,0.7)", fontWeight:600, whiteSpace:"nowrap" }}>🕐 下校時刻の天気</div>
    <div style={{ width:1, height:28, background:"rgba(255,255,255,0.2)" }}/>
    <div style={{ fontSize:36 }}>{weather.icon}</div>
    <div><div style={{ fontSize:22, fontWeight:700, color:"white" }}>{weather.temp}°C</div><div style={{ fontSize:13, color:"rgba(255,255,255,0.7)" }}>{weather.description}</div></div>
    <div style={{ width:1, height:28, background:"rgba(255,255,255,0.2)" }}/>
    <div style={{ display:"flex", gap:16 }}>
      {[["湿度",weather.humidity+"%"],["風速",weather.wind+"m/s"],["降水確率",weather.rain+"%"]].map(([l,v])=>
        <div key={l} style={{ textAlign:"center" }}><div style={{ fontSize:11, color:"rgba(255,255,255,0.5)" }}>{l}</div><div style={{ fontSize:15, fontWeight:600, color: l==="降水確率"&&weather.rain>=50?"#fbbf24":"white" }}>{v}</div></div>
      )}
    </div>
  </div>;
}

function SignageSlide({ event, visible, fadeDuration }) {
  const color = getSCColor(event.category);
  const remaining = daysUntil(event.date);
  const appCount = (event.applicants||[]).length;
  const cap = event.capacity || 0;
  const fillPct = cap > 0 ? Math.min((appCount / cap) * 100, 100) : 0;
  const isVol = event.type === "volunteer";
  const latestNotice = event.emergencyNotices?.length > 0 ? event.emergencyNotices[event.emergencyNotices.length - 1] : null;
  const nt = latestNotice ? (NOTICE_TYPES[latestNotice.type] || NOTICE_TYPES.other) : null;

  return <div style={{ position:"absolute", inset:0, opacity:visible?1:0, transition:`opacity ${fadeDuration}s ease-in-out`, display:"flex", flexDirection:"column", padding:"0 60px 40px 60px", pointerEvents:visible?"auto":"none" }}>
    {/* 緊急連絡バナー */}
    {latestNotice && <div style={{ background:nt.color+"dd", border:`2px solid ${nt.border}`, borderRadius:14, padding:"12px 24px", marginBottom:16, textAlign:"center" }}>
      <span style={{ fontSize:16, fontWeight:800, color:"white" }}>{nt.icon} 【緊急】{nt.label}：{latestNotice.message}</span>
    </div>}
    {/* タイプバッジ */}
    <div style={{ display:"flex", alignItems:"center", gap:16, marginBottom:20 }}>
      <div style={{ background:isVol?"linear-gradient(135deg,#f59e0b,#d97706)":"linear-gradient(135deg,#10b981,#059669)", borderRadius:16, padding:"12px 32px", fontSize:26, fontWeight:900, color:"white", boxShadow:isVol?"0 4px 20px rgba(245,158,11,0.4)":"0 4px 20px rgba(16,185,129,0.4)", letterSpacing:2 }}>
        {isVol ? "📢 ボランティア募集" : "📅 イベント案内"}
      </div>
      <div style={{ background:remaining==="今日"?"rgba(250,204,21,0.25)":"rgba(255,255,255,0.1)", borderRadius:30, padding:"8px 20px", fontSize:15, fontWeight:700, color:remaining==="今日"?"#fbbf24":"rgba(255,255,255,0.8)", border:remaining==="今日"?"1px solid rgba(250,204,21,0.4)":"1px solid rgba(255,255,255,0.15)" }}>{remaining}</div>
      <div style={{ background:"rgba(255,255,255,0.08)", borderRadius:30, padding:"8px 18px", fontSize:14, fontWeight:500, color:"rgba(255,255,255,0.6)" }}>{event.category}</div>
      {isVol && event.deadline && <div style={{ background:"rgba(239,68,68,0.25)", border:"1px solid rgba(239,68,68,0.5)", borderRadius:30, padding:"8px 22px", fontSize:15, fontWeight:800, color:"#fca5a5", display:"flex", alignItems:"center", gap:8 }}><span style={{ fontSize:18 }}>⏰</span>{deadlineLabel(event.deadline)}</div>}
    </div>
    {/* タイトル */}
    <div style={{ display:"flex", alignItems:"center", gap:24, marginBottom:20 }}>
      <div style={{ fontSize:72, lineHeight:1, filter:"drop-shadow(0 4px 20px rgba(0,0,0,0.2))" }}>{event.image}</div>
      <h1 style={{ fontSize:52, fontWeight:900, color:"white", lineHeight:1.2, margin:0, letterSpacing:-1, textShadow:"0 4px 30px rgba(0,0,0,0.3)", fontFamily:"'Noto Sans JP','Hiragino Kaku Gothic ProN',sans-serif" }}>{event.title}</h1>
    </div>
    {/* 説明 */}
    <p style={{ fontSize:22, lineHeight:1.8, color:"rgba(255,255,255,0.85)", margin:"0 0 32px", maxWidth:900, fontFamily:"'Noto Sans JP','Hiragino Kaku Gothic ProN',sans-serif" }}>{event.description}</p>
    {/* 情報カード */}
    <div style={{ display:"flex", gap:20, flexWrap:"wrap" }}>
      {[["📅","日時",`${formatSignageDate(event.date)}　${event.time||""}`],["📍","場所",event.location],["👥","主催",event.organizerName||event.organizer]].map(([ic,lb,vl])=>
        <div key={lb} style={{ background:"rgba(255,255,255,0.1)", backdropFilter:"blur(8px)", borderRadius:20, padding:"18px 28px", border:"1px solid rgba(255,255,255,0.12)", minWidth:200 }}>
          <div style={{ fontSize:13, color:"rgba(255,255,255,0.5)", marginBottom:6, fontWeight:600 }}>{ic} {lb}</div>
          <div style={{ fontSize:20, fontWeight:700, color:"white", lineHeight:1.4 }}>{vl}</div>
        </div>
      )}
      <div style={{ background:"rgba(255,255,255,0.1)", backdropFilter:"blur(8px)", borderRadius:20, padding:"18px 28px", border:"1px solid rgba(255,255,255,0.12)", minWidth:220 }}>
        <div style={{ fontSize:13, color:"rgba(255,255,255,0.5)", marginBottom:6, fontWeight:600 }}>👤 参加状況</div>
        <div style={{ fontSize:24, fontWeight:800, color:"white", marginBottom:10 }}>{event.capacityUnlimited ? `${appCount}名参加` : `${appCount} / ${cap}名`}</div>
        {!event.capacityUnlimited && <><div style={{ height:8, borderRadius:4, background:"rgba(255,255,255,0.15)", overflow:"hidden" }}>
          <div style={{ height:"100%", borderRadius:4, width:`${fillPct}%`, background:fillPct>=80?"linear-gradient(90deg,#fbbf24,#f59e0b)":`linear-gradient(90deg,${color.accent},white)`, transition:"width 1s ease" }}/>
        </div>{fillPct >= 80 && <div style={{ fontSize:12, color:"#fbbf24", marginTop:6, fontWeight:700 }}>まもなく定員！</div>}</>}
      </div>
    </div>
  </div>;
}

function SignageProgressDots({ total, current, progress }) {
  return <div style={{ display:"flex", gap:8, alignItems:"center" }}>
    {Array.from({ length: total }).map((_, i) => <div key={i} style={{ width:i===current?40:10, height:10, borderRadius:5, background:i===current?"rgba(255,255,255,0.3)":"rgba(255,255,255,0.15)", overflow:"hidden", position:"relative", transition:"width 0.5s ease" }}>
      {i===current && <div style={{ position:"absolute", left:0, top:0, bottom:0, width:`${progress}%`, background:"white", borderRadius:5, transition:"width 0.1s linear" }}/>}
    </div>)}
  </div>;
}

function SignageAdminPanel({ settings, onUpdate, onClose, countdown }) {
  const [local, setLocal] = useState({ ...settings });
  const ss = { width:"100%", height:6, borderRadius:3, appearance:"none", background:"#334155", outline:"none", cursor:"pointer" };
  return <div style={{ position:"fixed", inset:0, zIndex:1000, background:"rgba(0,0,0,0.7)", backdropFilter:"blur(8px)", display:"flex", alignItems:"center", justifyContent:"center" }}>
    <div style={{ background:"#1e293b", borderRadius:24, padding:40, width:480, maxHeight:"80vh", overflow:"auto", border:"1px solid rgba(255,255,255,0.1)", boxShadow:"0 20px 60px rgba(0,0,0,0.5)" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:32 }}>
        <h2 style={{ margin:0, fontSize:22, fontWeight:800, color:"white" }}>⚙️ サイネージ設定</h2>
        <button onClick={onClose} style={{ background:"rgba(255,255,255,0.1)", border:"none", borderRadius:10, width:36, height:36, color:"white", fontSize:18, cursor:"pointer" }}>✕</button>
      </div>
      {[
        ["スライド表示時間", "slideDuration", 3, 30, 1, "秒", "3秒", "30秒"],
        ["フェード速度", "fadeDuration", 0.3, 3, 0.1, "秒", "速い 0.3秒", "ゆっくり 3秒"],
        ["データ自動リロード", "reloadInterval", 1, 30, 1, "分ごと", "1分", "30分"],
      ].map(([label, key, min, max, step, unit, minL, maxL]) => <div key={key} style={{ marginBottom:28 }}>
        <div style={{ display:"flex", justifyContent:"space-between", marginBottom:10 }}>
          <label style={{ fontSize:14, fontWeight:600, color:"rgba(255,255,255,0.8)" }}>{label}</label>
          <span style={{ fontSize:14, fontWeight:700, color:"#60a5fa" }}>{local[key]}{unit}</span>
        </div>
        <input type="range" min={min} max={max} step={step} value={local[key]} onChange={e => setLocal(p => ({ ...p, [key]: Number(e.target.value) }))} style={ss}/>
        <div style={{ display:"flex", justifyContent:"space-between", marginTop:4, fontSize:11, color:"rgba(255,255,255,0.3)" }}><span>{minL}</span><span>{maxL}</span></div>
      </div>)}
      <div style={{ marginBottom:8, fontSize:12, color:"rgba(255,255,255,0.4)" }}>次回リロードまで：約{countdown}分</div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:36 }}>
        <label style={{ fontSize:14, fontWeight:600, color:"rgba(255,255,255,0.8)" }}>画面焼き付き防止</label>
        <button onClick={() => setLocal(p => ({ ...p, burnInProtection: !p.burnInProtection }))} style={{ width:52, height:28, borderRadius:14, border:"none", cursor:"pointer", background:local.burnInProtection?"#3b82f6":"#475569", position:"relative", transition:"background 0.2s" }}>
          <div style={{ width:22, height:22, borderRadius:11, background:"white", position:"absolute", top:3, left:local.burnInProtection?27:3, transition:"left 0.2s", boxShadow:"0 2px 4px rgba(0,0,0,0.3)" }}/>
        </button>
      </div>
      <div style={{ display:"flex", gap:12 }}>
        <button onClick={() => { onUpdate(local); onClose(); }} style={{ flex:1, padding:"14px 0", borderRadius:14, border:"none", background:"linear-gradient(135deg,#3b82f6,#2563eb)", color:"white", fontSize:16, fontWeight:700, cursor:"pointer" }}>保存して閉じる</button>
        <button onClick={onClose} style={{ padding:"14px 24px", borderRadius:14, border:"1px solid rgba(255,255,255,0.15)", background:"transparent", color:"rgba(255,255,255,0.6)", fontSize:14, fontWeight:600, cursor:"pointer" }}>キャンセル</button>
      </div>
    </div>
  </div>;
}

function SignageIdleScreen({ now, weather, offset }) {
  const h = String(now.getHours()).padStart(2,"0"), m = String(now.getMinutes()).padStart(2,"0"), s = String(now.getSeconds()).padStart(2,"0");
  const days = ["日","月","火","水","木","金","土"];
  const ds = `${now.getFullYear()}年${now.getMonth()+1}月${now.getDate()}日（${days[now.getDay()]}）`;
  return <div style={{ width:"100%", height:"100vh", background:"linear-gradient(135deg,#0f172a,#1e293b)", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", fontFamily:"'Noto Sans JP','Hiragino Kaku Gothic ProN',sans-serif", position:"relative", overflow:"hidden", transform:`translate(${offset.x}px,${offset.y}px)`, transition:"transform 2s ease" }}>
    <div style={{ position:"absolute", inset:0, pointerEvents:"none", backgroundImage:"radial-gradient(circle at 30% 70%,rgba(59,130,246,0.08) 0%,transparent 50%),radial-gradient(circle at 70% 30%,rgba(139,92,246,0.06) 0%,transparent 50%)" }}/>
    <div style={{ textAlign:"center", position:"relative", zIndex:1 }}>
      <div style={{ fontFamily:"'Courier Prime','SF Mono',monospace", fontSize:120, fontWeight:700, color:"white", letterSpacing:4, lineHeight:1, textShadow:"0 4px 40px rgba(59,130,246,0.3)" }}>{h}:{m}<span style={{ fontSize:60, opacity:0.4 }}>:{s}</span></div>
      <div style={{ fontSize:28, color:"rgba(255,255,255,0.5)", marginTop:16, fontWeight:500, letterSpacing:4 }}>{ds}</div>
    </div>
    <SignageWeather weather={weather}/>
    <div style={{ marginTop:48, fontSize:18, color:"rgba(255,255,255,0.25)", fontWeight:500, letterSpacing:2 }}>現在表示するイベントはありません</div>
    <div style={{ position:"absolute", bottom:40, fontSize:14, color:"rgba(255,255,255,0.15)", fontWeight:600 }}>イベントナビ — 八木中ネット</div>
  </div>;
}

// ダミー天気（本番はOpenWeatherMap API）
const SIGNAGE_WEATHER = { temp:18, description:"くもり時々晴れ", icon:"⛅", humidity:55, wind:3.2, rain:10 };

function SignagePage({ events }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [settings, setSettings] = useState(SIGNAGE_DEFAULTS);
  const [showAdmin, setShowAdmin] = useState(false);
  const [lastReload, setLastReload] = useState(Date.now());
  const [countdown, setCountdown] = useState(SIGNAGE_DEFAULTS.reloadInterval);
  const now = useCurrentTime();
  const offset = useBurnInOffset(settings.burnInProtection);
  // サイネージ: 向こう3ヶ月以内の承認済みイベントのみ
  const signageLimit = new Date(); signageLimit.setMonth(signageLimit.getMonth() + 3);
  const signageLimitStr = `${signageLimit.getFullYear()}-${String(signageLimit.getMonth()+1).padStart(2,"0")}-${String(signageLimit.getDate()).padStart(2,"0")}`;
  const activeEvents = events.filter(e => e.status === "approved" && daysUntil(e.date) !== "終了" && (!e.date || e.date <= signageLimitStr));

  // リロードカウントダウン
  useEffect(() => {
    const id = setInterval(() => { setCountdown(Math.max(0, Math.round(settings.reloadInterval - (Date.now() - lastReload) / 60000))); }, 10000);
    return () => clearInterval(id);
  }, [lastReload, settings.reloadInterval]);

  // ページ自動リロード（Firestoreはリアルタイムだが、ブラウザ長時間稼働対策）
  useEffect(() => {
    const id = setInterval(() => { setLastReload(Date.now()); }, settings.reloadInterval * 60000);
    return () => clearInterval(id);
  }, [settings.reloadInterval]);

  // スライド自動切り替え
  useEffect(() => {
    if (activeEvents.length <= 0) return;
    const dur = settings.slideDuration * 1000;
    const start = Date.now();
    const id = setInterval(() => {
      const elapsed = Date.now() - start;
      setProgress(Math.min((elapsed / dur) * 100, 100));
      if (elapsed >= dur) { setCurrentIndex(prev => (prev + 1) % activeEvents.length); setProgress(0); clearInterval(id); }
    }, 50);
    return () => clearInterval(id);
  }, [currentIndex, activeEvents.length, settings.slideDuration]);

  useEffect(() => { if (activeEvents.length > 0 && currentIndex >= activeEvents.length) setCurrentIndex(0); }, [activeEvents.length, currentIndex]);

  // キーボード「A」で管理者パネル
  useEffect(() => {
    const handler = (e) => { if (e.key === "a" || e.key === "A") setShowAdmin(prev => !prev); };
    window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler);
  }, []);

  if (activeEvents.length === 0) return <>
    <SignageIdleScreen now={now} weather={SIGNAGE_WEATHER} offset={offset}/>
    {showAdmin && <SignageAdminPanel settings={settings} onUpdate={setSettings} onClose={() => setShowAdmin(false)} countdown={countdown}/>}
  </>;

  const ev = activeEvents[currentIndex] || activeEvents[0];
  const color = getSCColor(ev.category);

  return <div style={{ width:"100%", height:"100vh", background:color.bg, fontFamily:"'Noto Sans JP','Hiragino Kaku Gothic ProN','Yu Gothic',sans-serif", overflow:"hidden", position:"relative", transition:`background ${settings.fadeDuration}s ease-in-out`, transform:`translate(${offset.x}px,${offset.y}px)` }}>
    <div style={{ position:"absolute", inset:0, pointerEvents:"none", backgroundImage:"radial-gradient(circle at 20% 80%,rgba(255,255,255,0.06) 0%,transparent 50%),radial-gradient(circle at 80% 20%,rgba(255,255,255,0.04) 0%,transparent 50%),radial-gradient(circle at 50% 50%,rgba(0,0,0,0.1) 0%,transparent 70%)" }}/>
    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"24px 60px", position:"relative", zIndex:10 }}>
      <SignageClock now={now}/>
      <SignageWeather weather={SIGNAGE_WEATHER}/>
    </div>
    <div style={{ position:"relative", height:"calc(100vh - 160px)" }}>
      {activeEvents.map((event, i) => <SignageSlide key={event.firestoreId||event.id} event={event} visible={i === currentIndex} fadeDuration={settings.fadeDuration}/>)}
    </div>
    <div style={{ position:"absolute", bottom:0, left:0, right:0, display:"flex", alignItems:"center", justifyContent:"space-between", padding:"20px 60px", background:"linear-gradient(transparent,rgba(0,0,0,0.3))" }}>
      <SignageProgressDots total={activeEvents.length} current={currentIndex} progress={progress}/>
      <div style={{ display:"flex", alignItems:"center", gap:16 }}>
        <div style={{ textAlign:"right" }}><div style={{ fontSize:14, color:"rgba(255,255,255,0.7)", fontWeight:600 }}>詳細・参加申込はこちら →</div><div style={{ fontSize:12, color:"rgba(255,255,255,0.4)", marginTop:2 }}>イベントナビ（八木中ネット）</div></div>
        <div style={{ width:80, height:80, background:"white", borderRadius:12, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}><div style={{ textAlign:"center" }}><div style={{ fontSize:28, lineHeight:1 }}>📱</div><div style={{ fontSize:8, color:"#64748b", fontWeight:700, marginTop:2 }}>SCAN</div></div></div>
      </div>
    </div>
    <div style={{ position:"absolute", top:80, right:60, fontSize:11, color:"rgba(255,255,255,0.2)" }}>次回更新：{countdown}分後</div>
    {showAdmin && <SignageAdminPanel settings={settings} onUpdate={setSettings} onClose={() => setShowAdmin(false)} countdown={countdown}/>}
  </div>;
}

// ========== メインアプリ ==========
export default function EventNavi({ currentUser: externalUser, onBackToHome }) {
  // currentUser を親コンポーネントから受け取り、イベントナビ用のロールに変換
  const currentUser = externalUser ? {
    ...externalUser,
    role: isAdminRole(externalUser.actualRole || externalUser.role) ? "admin" : "participant",
  } : null;

  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  // URLパラメータ ?mode=signage で直接サイネージモードを表示
  const isSignageDirect = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("mode") === "signage";

  // URLパラメータ ?event=ID でイベント詳細を自動表示（QRコードからのアクセス用、初回のみ）
  const autoOpenedRef = useRef(false);
  useEffect(() => {
    if (autoOpenedRef.current) return;
    const urlEventId = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("event");
    if (urlEventId && events.length > 0 && currentUser) {
      const ev = events.find(e => String(e.id) === urlEventId);
      if (ev) {
        autoOpenedRef.current = true;
        setSelectedEvent(ev);
        setModalType("detail");
        // URLからeventパラメータを削除（再オープン防止）
        const url = new URL(window.location.href);
        url.searchParams.delete("event");
        window.history.replaceState({}, "", url);
      }
    }
  }, [events, currentUser]);

  // Firestoreからイベントをリアルタイム取得
  useEffect(() => {
    const q = query(collection(db, "events"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      const data = snap.docs.map(d => ({ ...d.data(), firestoreId: d.id }));
      setEvents(data);
      setLoading(false);
    }, () => {
      // Firestore接続失敗時はサンプルデータで動作
      setEvents(initialEvents);
      setLoading(false);
    });
    return () => unsub();
  }, []);
  const [page, setPage] = useState("home");
  const [modalType, setModalType] = useState(null);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [applyType, setApplyType] = useState("participant");
  const [rosterEvent, setRosterEvent] = useState(null);
  const [adminActionTarget, setAdminActionTarget] = useState(null);
  const [pinCheckTarget, setPinCheckTarget] = useState(null); // { type:"edit"|"cancel", event?, applicantId? }
  const [filter, setFilter] = useState("すべて");
  const [searchQ, setSearchQ] = useState("");
  const [toast, setToast] = useState(null);
  const [notifications, setNotifications] = useState([
    { id: 1, message: "「春の地域清掃フェスティバル」が承認されました", time: "10分前", read: false },
    { id: 2, message: "【緊急連絡】「春の地域清掃フェスティバル」が中止になりました", time: "30分前", read: false },
  ]);

  const showToast = (message, type = "success") => setToast({ message, type });
  const unread = notifications.filter(n => !n.read).length;

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

  // 表示対象: 向こう3ヶ月以内のイベントのみ（過去は除外、3ヶ月超は非表示）
  const threeMonthsLater = new Date(); threeMonthsLater.setMonth(threeMonthsLater.getMonth() + 3);
  const threeMonthsStr = `${threeMonthsLater.getFullYear()}-${String(threeMonthsLater.getMonth()+1).padStart(2,"0")}-${String(threeMonthsLater.getDate()).padStart(2,"0")}`;
  const filteredEvents = events.filter(ev => {
    const roleOk = currentUser?.role === "admin" || ev.status === "approved" || ev.organizerId === currentUser?.id;
    const catOk = filter === "すべて" || ev.type === filter;
    const searchOk = !searchQ || ev.title.includes(searchQ) || ev.description.includes(searchQ);
    const notExpired = daysUntil(ev.date) !== "終了";
    const withinRange = !ev.date || ev.date <= threeMonthsStr;
    return roleOk && catOk && searchOk && notExpired && withinRange;
  });

  const handleApply = async (applicant) => {
    const ev = selectedEvent;
    try {
      if (ev.firestoreId) {
        const field = applyType === "volunteer" ? "volunteerApplicants" : "applicants";
        const current = ev[field] || [];
        await updateDoc(doc(db, "events", ev.firestoreId), {
          [field]: [...current, { ...applicant, type: applyType }]
        });
      }
    } catch (e) { console.error(e); }
    const totalNames = applicant.members.length > 1 ? `${applicant.members[0].name}さん 他${applicant.members.length - 1}名` : `${applicant.members[0].name}さん`;
    setNotifications(prev => [{ id: Date.now(), message: `「${ev.title}」への申込が完了しました（${totalNames}）`, time: "たった今", read: false }, ...prev]);
    showToast(`申込完了！`, "success");
    setModalType(null); setSelectedEvent(null);
  };

  const handleSaveEvent = async (form) => {
    const organizerDisplay = form.organizerName || currentUser.name;
    try {
      if (selectedEvent && selectedEvent.firestoreId) {
        // 既存イベントの更新
        await updateDoc(doc(db, "events", selectedEvent.firestoreId), {
          ...form, organizer: organizerDisplay, updatedAt: serverTimestamp()
        });
        showToast("イベントを更新しました", "success");
      } else {
        // 新規イベントの追加
        await addDoc(collection(db, "events"), {
          ...form,
          id: Date.now(),
          organizer: organizerDisplay,
          organizerId: currentUser.id,
          applicants: [],
          volunteerApplicants: [],
          status: "pending",
          createdAt: serverTimestamp(),
          emergencyNotices: [],
        });
        setNotifications(prev => [{ id: Date.now(), message: `新しいイベント「${form.title}」を投稿しました（審査待ち）`, time: "たった今", read: false }, ...prev]);
        showToast("投稿しました！審査をお待ちください", "info");
        // 管理者にメール通知
        // 管理者（本部役員＋先生）にメール通知
        fetchAdminEmails().then(emails => {
          if (emails.length > 0) sendEmailNotification({ type: "event-new", title: `新規イベント申請「${form.title}」`, body: `${organizerDisplay} さんが新しいイベントを申請しました。\n\nイベント名: ${form.title}\n${form.description || ""}\n\nイベントナビにログインして審査してください。`, emails, senderName: "イベントナビ" });
        });
      }
    } catch (e) {
      console.error(e);
      showToast("保存に失敗しました。もう一度お試しください", "error");
    }
    setModalType(null); setSelectedEvent(null);
  };

  const handleAdminActionConfirm = async (actionType, comment) => {
    const ev = adminActionTarget.event;
    const isRevision = actionType === "revision";
    const label = isRevision ? "修正依頼" : "非承認";
    const icon = isRevision ? "🔄" : "🚫";
    try {
      if (ev.firestoreId) {
        await updateDoc(doc(db, "events", ev.firestoreId), {
          status: actionType,
          adminComment: { type: actionType, comment, sentAt: new Date().toLocaleString("ja-JP"), adminName: currentUser.name }
        });
      }
    } catch (e) { console.error(e); }
    setNotifications(prev => [
      { id: Date.now(), message: `${icon}【管理者より${label}】「${ev.title}」— ${comment.slice(0, 50)}${comment.length > 50 ? "…" : ""}`, time: "たった今", read: false, isAdminAction: true },
      ...prev
    ]);
    showToast(`${label}を送信しました`, isRevision ? "info" : "error");
    // グループウェアのカレンダーから該当イベントを削除
    try {
      const snap = await getDocs(collection(sharedDb, "events"));
      snap.docs.forEach(d => {
        if (d.data().source === "eventnavi" && d.data().sourceId === String(ev.id)) {
          deleteDoc(doc(sharedDb, "events", d.id)).catch(console.error);
        }
      });
    } catch (e) { console.error("グループウェア連携削除エラー:", e); }
    // 主催者にメール通知
    // 主催者本人にメール通知
    if (ev.organizerId) {
      fetchUserEmail(ev.organizerId).then(email => {
        if (email) sendEmailNotification({ type: isRevision ? "event-revision" : "event-rejected", title: `${label}「${ev.title}」`, body: `管理者（${currentUser.name}）より${label}がありました。\n\n${label}理由:\n${comment}\n\nイベントナビにログインして確認してください。`, emails: [email], senderName: "イベントナビ" });
      });
    }
    setAdminActionTarget(null);
  };

  // PIN照合 → 編集 or キャンセル実行
  const handlePinConfirm = (enteredPin) => {
    if (!pinCheckTarget) return false;
    if (pinCheckTarget.type === "edit") {
      const ev = pinCheckTarget.event;
      if (!ev.editPin) { // PINなし（旧データ）は管理者のみ編集可
        setPinCheckTarget(null); setSelectedEvent(ev); setModalType("edit"); return true;
      }
      if (ev.editPin !== enteredPin) return false;
      setPinCheckTarget(null); setSelectedEvent(ev); setModalType("edit"); return true;
    }
    if (pinCheckTarget.type === "cancel") {
      const ev = pinCheckTarget.event;
      const applicant = ev.applicants.find(a => a.id === pinCheckTarget.applicantId);
      if (!applicant) return false;
      if (applicant.pin && applicant.pin !== enteredPin) return false;
      setEvents(prev => prev.map(e => e.id === ev.id ? { ...e, applicants: e.applicants.filter(a => a.id !== pinCheckTarget.applicantId) } : e));
      setNotifications(prev => [{ id: Date.now(), message: `「${ev.title}」の申込をキャンセルしました`, time: "たった今", read: false }, ...prev]);
      showToast("申込をキャンセルしました", "info");
      setPinCheckTarget(null); return true;
    }
    return false;
  };

  // イベント承認（共通化）
  const handleApproveEvent = async (eventId) => {
    const ev = events.find(e => e.id === eventId);
    if (ev?.firestoreId) await updateDoc(doc(db, "events", ev.firestoreId), { status: "approved" }).catch(console.error);
    showToast("承認しました", "success");
    // グループウェアのカレンダーに「地域」イベントとして追加
    if (ev?.date && ev?.title) {
      try {
        await addDoc(collection(sharedDb, "events"), {
          date: ev.date,
          title: `[地域] ${ev.title}`,
          category: "district",
          source: "eventnavi",
          sourceId: String(ev.id),
        });
        console.log("グループウェアカレンダーに連携:", ev.title);
      } catch (e) {
        console.error("グループウェア連携エラー:", e);
      }
    }
    // 主催者にメール通知
    // 全ユーザーにメール通知（新規イベント公開）
    fetchAllUserEmails().then(emails => {
      if (emails.length > 0) sendEmailNotification({ type: "event-approved-organizer", title: `新しいイベント「${ev?.title || ""}」が公開されました`, body: `「${ev?.title || ""}」が承認され、イベントナビで公開されています。\n\n詳細はイベントナビからご確認ください。`, emails, senderName: "イベントナビ" });
    });
  };

  // イベント削除（管理者用）
  const handleDeleteEvent = async (eventId) => {
    const ev = events.find(e => e.id === eventId);
    if (!confirm(`「${ev?.title || ""}」を完全に削除しますか？この操作は取り消せません。`)) return;
    try {
      if (ev?.firestoreId) await deleteDoc(doc(db, "events", ev.firestoreId));
      // グループウェアのカレンダーからも削除
      try {
        const snap = await getDocs(collection(sharedDb, "events"));
        snap.docs.forEach(d => {
          if (d.data().source === "eventnavi" && d.data().sourceId === String(ev.id)) {
            deleteDoc(doc(sharedDb, "events", d.id)).catch(console.error);
          }
        });
      } catch (e) { console.error("グループウェア連携削除エラー:", e); }
      showToast("イベントを削除しました", "info");
      setModalType(null); setSelectedEvent(null);
    } catch (e) {
      console.error("削除エラー:", e);
      showToast("削除に失敗しました", "error");
    }
  };

  const handleEmergencySave = async (notice) => {
    const nt = NOTICE_TYPES[notice.type];
    setEvents(prev => prev.map(ev => ev.id === selectedEvent.id ? { ...ev, emergencyNotices: [...(ev.emergencyNotices || []), notice] } : ev));
    setNotifications(prev => [{ id: Date.now(), message: `【緊急連絡】「${selectedEvent.title}」：${nt.icon}${nt.label} — ${notice.message.slice(0, 35)}…`, time: "たった今", read: false }, ...prev]);
    showToast("緊急連絡を送信しました。参加者に通知されます", "success");
    // 全ユーザーにメール通知（テスト用）
    const emergencyEmails = await fetchAllUserEmails();
    if (emergencyEmails.length > 0) {
      sendEmailNotification({ type: "event-emergency", title: `【緊急】${selectedEvent.title}：${nt.label}`, body: notice.message, emails: emergencyEmails, senderName: "イベントナビ" });
    }
    setModalType(null); setSelectedEvent(null);
  };

  // URLパラメータ ?mode=signage の場合、ログイン不要でサイネージ直接表示
  if (isSignageDirect) {
    if (loading) return <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100vh", background:"#0f172a", color:"white", fontSize:18 }}>読み込み中...</div>;
    return <SignagePage events={events} />;
  }

  if (!currentUser) return null;
  if (false) return (
    <div style={{ display: "none" }}>

      {/* ━━━ 背景SVGイラスト ━━━ */}
      <svg style={{ position:"absolute", inset:0, width:"100%", height:"100%", zIndex:0 }} viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="bgGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#38bdf8"/>
            <stop offset="55%" stopColor="#7dd3fc"/>
            <stop offset="100%" stopColor="#bbf7d0"/>
          </linearGradient>
          <linearGradient id="skyGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#0ea5e9"/>
            <stop offset="100%" stopColor="#7dd3fc"/>
          </linearGradient>
          <linearGradient id="sunGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#fde68a"/>
            <stop offset="100%" stopColor="#fbbf24"/>
          </linearGradient>
          <radialGradient id="glowA" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#bae6fd" stopOpacity="0.5"/>
            <stop offset="100%" stopColor="#bae6fd" stopOpacity="0"/>
          </radialGradient>
          <radialGradient id="glowB" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#fef08a" stopOpacity="0.45"/>
            <stop offset="100%" stopColor="#fef08a" stopOpacity="0"/>
          </radialGradient>
        </defs>

        {/* 空のグラデーション */}
        <rect width="1200" height="800" fill="url(#bgGrad)"/>

        {/* 光のグロー */}
        <ellipse cx="200" cy="180" rx="320" ry="280" fill="url(#glowA)"/>
        <ellipse cx="1000" cy="600" rx="350" ry="300" fill="url(#glowB)"/>

        {/* 太陽 */}
        <circle cx="980" cy="130" r="72" fill="url(#sunGrad)" opacity="0.9"/>
        {[0,30,60,90,120,150,180,210,240,270,300,330].map((deg, i) => {
          const rad = deg * Math.PI / 180;
          const x1 = 980 + 82 * Math.cos(rad); const y1 = 130 + 82 * Math.sin(rad);
          const x2 = 980 + 100 * Math.cos(rad); const y2 = 130 + 100 * Math.sin(rad);
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#fbbf24" strokeWidth="4" strokeLinecap="round" opacity="0.8"/>;
        })}

        {/* 草の丘（左） */}
        <ellipse cx="0" cy="760" rx="380" ry="200" fill="#4ade80" opacity="0.9"/>
        <ellipse cx="120" cy="720" rx="260" ry="140" fill="#22c55e" opacity="0.95"/>

        {/* 草の丘（右） */}
        <ellipse cx="1200" cy="780" rx="380" ry="200" fill="#4ade80" opacity="0.9"/>
        <ellipse cx="1100" cy="740" rx="260" ry="140" fill="#22c55e" opacity="0.95"/>

        {/* 地面 */}
        <ellipse cx="600" cy="830" rx="700" ry="180" fill="#16a34a" opacity="0.85"/>

        {/* 旗ガーランド */}
        <path d="M50,200 Q300,160 600,180 Q900,200 1150,160" stroke="rgba(255,255,255,0.4)" strokeWidth="2.5" fill="none"/>
        {[
          {x:80,y:196,c:"#ef4444"},{x:160,y:185,c:"#f97316"},{x:240,y:177,c:"#eab308"},
          {x:320,y:172,c:"#22c55e"},{x:400,y:170,c:"#3b82f6"},{x:480,y:170,c:"#a855f7"},
          {x:560,y:172,c:"#ec4899"},{x:640,y:176,c:"#ef4444"},{x:720,y:180,c:"#f97316"},
          {x:800,y:184,c:"#eab308"},{x:880,y:182,c:"#22c55e"},{x:960,y:176,c:"#3b82f6"},
          {x:1040,y:170,c:"#a855f7"},{x:1120,y:164,c:"#ec4899"},
        ].map((f,i) => (
          <polygon key={i} points={`${f.x-10},${f.y} ${f.x+10},${f.y} ${f.x},${f.y+18}`} fill={f.c} opacity="0.9"/>
        ))}

        {/* 2本目のガーランド */}
        <path d="M50,300 Q300,260 600,280 Q900,300 1150,260" stroke="rgba(255,255,255,0.3)" strokeWidth="2" fill="none"/>
        {[
          {x:100,y:295,c:"#fbbf24"},{x:200,y:278,c:"#34d399"},{x:300,y:268,c:"#f472b6"},
          {x:400,y:265,c:"#60a5fa"},{x:500,y:266,c:"#fb923c"},{x:600,y:270,c:"#a78bfa"},
          {x:700,y:275,c:"#34d399"},{x:800,y:280,c:"#fbbf24"},{x:900,y:280,c:"#f472b6"},
          {x:1000,y:275,c:"#60a5fa"},{x:1100,y:264,c:"#fb923c"},
        ].map((f,i) => (
          <polygon key={i} points={`${f.x-9},${f.y} ${f.x+9},${f.y} ${f.x},${f.y+16}`} fill={f.c} opacity="0.85"/>
        ))}

        {/* 左側：テント */}
        <polygon points="60,640 200,480 340,640" fill="#f87171" opacity="0.95"/>
        <polygon points="90,640 200,500 310,640" fill="#fca5a5" opacity="0.5"/>
        <rect x="155" y="590" width="90" height="50" rx="4" fill="#b91c1c" opacity="0.8"/>
        {/* テント縞 */}
        <polygon points="60,640 120,550 150,640" fill="#dc2626" opacity="0.5"/>
        <polygon points="250,550 310,640 340,640 280,550" fill="#dc2626" opacity="0.5"/>

        {/* 右側：テント */}
        <polygon points="860,650 1000,490 1140,650" fill="#a78bfa" opacity="0.95"/>
        <polygon points="890,650 1000,510 1110,650" fill="#c4b5fd" opacity="0.5"/>
        <rect x="955" y="600" width="90" height="50" rx="4" fill="#5b21b6" opacity="0.8"/>
        <polygon points="860,650 920,560 950,650" fill="#6d28d9" opacity="0.5"/>
        <polygon points="1050,560 1110,650 1140,650 1080,560" fill="#6d28d9" opacity="0.5"/>

        {/* 中央：ステージ */}
        <rect x="420" y="620" width="360" height="120" rx="12" fill="#1e1b4b" opacity="0.7"/>
        <rect x="440" y="600" width="320" height="30" rx="6" fill="#312e81" opacity="0.8"/>
        {/* ステージライト */}
        {[460,520,580,640,700].map((x,i) => (
          <g key={i}>
            <circle cx={x} cy="598" r="9" fill={["#fbbf24","#f472b6","#34d399","#60a5fa","#fb923c"][i]} opacity="0.95"/>
            <line x1={x} y1="607" x2={x + (i-2)*30} y2="660" stroke={["#fbbf24","#f472b6","#34d399","#60a5fa","#fb923c"][i]} strokeWidth="18" strokeOpacity="0.12"/>
          </g>
        ))}

        {/* 人々のシルエット */}
        {[
          {x:160,s:1},{x:230,s:-1},{x:300,s:1},{x:370,s:-1},{x:450,s:1},
          {x:540,s:-1},{x:620,s:1},{x:700,s:-1},{x:780,s:1},{x:860,s:-1},
          {x:940,s:1},{x:1020,s:-1},{x:1090,s:1},
        ].map((p,i) => (
          <g key={i} transform={`translate(${p.x},700) scale(${p.s},1)`}>
            <circle cx="0" cy="-52" r="11" fill="rgba(255,255,255,0.55)"/>
            <rect x="-8" y="-40" width="16" height="28" rx="5" fill="rgba(255,255,255,0.45)"/>
            <line x1="-8" y1="-30" x2="-18" y2="-16" stroke="rgba(255,255,255,0.4)" strokeWidth="5" strokeLinecap="round"/>
            <line x1="8" y1="-30" x2="18" y2="-20" stroke="rgba(255,255,255,0.4)" strokeWidth="5" strokeLinecap="round"/>
            <line x1="-4" y1="-12" x2="-8" y2="8" stroke="rgba(255,255,255,0.4)" strokeWidth="5" strokeLinecap="round"/>
            <line x1="4" y1="-12" x2="8" y2="8" stroke="rgba(255,255,255,0.4)" strokeWidth="5" strokeLinecap="round"/>
          </g>
        ))}

        {/* 紙吹雪・丸 */}
        {[
          {x:130,y:350,r:8,c:"#fbbf24"},{x:220,y:420,r:6,c:"#f472b6"},{x:80,y:500,r:10,c:"#34d399"},
          {x:1050,y:350,r:8,c:"#60a5fa"},{x:1120,y:440,r:6,c:"#fbbf24"},{x:1080,y:520,r:9,c:"#f472b6"},
          {x:400,y:380,r:7,c:"#a78bfa"},{x:800,y:360,r:8,c:"#34d399"},{x:650,y:320,r:6,c:"#fbbf24"},
          {x:300,y:460,r:5,c:"#60a5fa"},{x:900,y:430,r:7,c:"#fb923c"},
        ].map((b,i) => <circle key={i} cx={b.x} cy={b.y} r={b.r} fill={b.c} opacity="0.7"/>)}

        {/* 紙吹雪・星型 */}
        {[
          {x:170,y:390,c:"#f472b6"},{x:1060,y:390,c:"#fbbf24"},{x:580,y:340,c:"#34d399"},
          {x:350,y:430,c:"#60a5fa"},{x:850,y:400,c:"#fb923c"},
        ].map((s,i) => (
          <text key={i} x={s.x} y={s.y} fontSize="18" fill={s.c} opacity="0.8" textAnchor="middle">★</text>
        ))}

        {/* 音符 */}
        {[
          {x:500,y:400,c:"#fde68a"},{x:700,y:380,c:"#fde68a"},{x:140,y:450,c:"#fde68a"},
        ].map((m,i) => (
          <text key={i} x={m.x} y={m.y} fontSize="24" fill={m.c} opacity="0.6" textAnchor="middle">♪</text>
        ))}

        {/* 上部：雲 */}
        {[
          {x:200,y:80,s:1.2},{x:450,y:60,s:0.9},{x:750,y:90,s:1.1},
        ].map((cl,i) => (
          <g key={i} transform={`translate(${cl.x},${cl.y}) scale(${cl.s})`} opacity="0.85">
            <ellipse cx="0" cy="0" rx="50" ry="28" fill="white"/>
            <ellipse cx="-30" cy="8" rx="32" ry="22" fill="white"/>
            <ellipse cx="30" cy="8" rx="35" ry="22" fill="white"/>
          </g>
        ))}
      </svg>

      {/* 背景オーバーレイ（カードが読みやすくなるよう少し暗く） */}
      <div style={{ position:"absolute", inset:0, background:"rgba(255,255,255,0.08)", zIndex:1, pointerEvents:"none" }}/>

      <div className="login-box" style={{ background: "rgba(255,255,255,0.22)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", borderRadius: 28, padding: "40px 36px", maxWidth: 440, width: "100%", boxShadow: "0 8px 40px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.4)", border: "1px solid rgba(255,255,255,0.35)", textAlign: "center", position: "relative", zIndex: 2 }}>
        {/* タイトル */}
        <div style={{ marginBottom: 6 }}>
          <div style={{ fontSize: 64, lineHeight: 1, marginBottom: 10, filter: "drop-shadow(0 4px 8px rgba(0,0,0,0.3))" }}>🎪</div>
          <h1 style={{ fontSize: 32, fontWeight: 900, margin: "0 0 6px", color: "#1e3a5f", textShadow: "0 2px 8px rgba(255,255,255,0.6)" }}>イベントナビ</h1>
          <p style={{ color: "#1e4060", fontSize: 13, margin: "0 0 6px", fontWeight: 600 }}>地域のイベントをつなぐプラットフォーム</p>
        </div>

        {/* イベントアイコン帯 */}
        <div style={{ display: "flex", justifyContent: "center", gap: 8, margin: "16px 0 24px", flexWrap: "wrap" }}>
          {["🌸","🎵","🏃","🍳","📚","🎨","🤝","🎆"].map(e => (
            <div key={e} style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(255,255,255,0.25)", backdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, boxShadow: "0 2px 8px rgba(0,0,0,0.15)", border: "1px solid rgba(255,255,255,0.4)" }}>{e}</div>
          ))}
        </div>

        <div style={{ background: "rgba(255,255,255,0.2)", backdropFilter: "blur(8px)", border: "1px solid rgba(255,255,255,0.4)", borderRadius: 14, padding: "12px 16px", marginBottom: 20 }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: "#1e3a5f" }}>🎉 楽しいイベントがあなたを待っています！</p>
        </div>

        <div style={{ background: "rgba(255,255,255,0.85)", backdropFilter: "blur(12px)", borderRadius: 16, padding: "24px 20px", border: "1px solid rgba(255,255,255,0.5)" }}>
          <p style={{ fontSize: 14, fontWeight: 800, color: "#1e3a5f", marginBottom: 16, textAlign: "center" }}>八木中ネットアカウントでログイン</p>
          {loginErr && <div style={{ background: "#fef2f2", color: "#dc2626", padding: "8px 12px", borderRadius: 8, fontSize: 12, marginBottom: 12 }}>{loginErr}</div>}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#475569", marginBottom: 4 }}>メールアドレス</div>
            <input value={loginEmail} onChange={e => setLoginEmail(e.target.value)} type="email" placeholder="example@mail.com" style={{ width: "100%", padding: "12px", borderRadius: 10, border: "2px solid #e2e8f0", fontSize: 14, outline: "none", boxSizing: "border-box" }} />
          </div>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#475569", marginBottom: 4 }}>パスワード</div>
            <input value={loginPw} onChange={e => setLoginPw(e.target.value)} type="password" placeholder="8文字以上" onKeyDown={e => e.key === "Enter" && handleLogin()} style={{ width: "100%", padding: "12px", borderRadius: 10, border: "2px solid #e2e8f0", fontSize: 14, outline: "none", boxSizing: "border-box" }} />
          </div>
          <button onClick={handleLogin} style={{ width: "100%", padding: "14px", borderRadius: 12, border: "none", background: "linear-gradient(135deg,#667eea,#764ba2)", color: "white", fontWeight: 800, fontSize: 15, cursor: "pointer" }}>ログイン</button>
        </div>

        <p style={{ marginTop: 16, fontSize: 11, color: "#1e4060", textAlign: "center" }}>八木中ネットで登録したアカウントでログインできます</p>
      </div>
    </div>
  );

  if (page === "signage") return (
    <div>
      <button onClick={() => setPage("home")} style={{ position: "fixed", top: 16, right: 16, zIndex: 100, background: "rgba(255,255,255,0.2)", border: "none", color: "white", padding: "8px 16px", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>← 戻る</button>
      <SignagePage events={events} />
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: ROLE_THEME[currentUser.role].pageBg, fontFamily: "Hiragino Kaku Gothic ProN, YuGothic, sans-serif", transition: "background 0.4s" }}>
      <style>{`
        @keyframes slideUp { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
        input:focus, select:focus, textarea:focus { border-color:#667eea !important; box-shadow:0 0 0 3px rgba(102,126,234,0.12); }
        * { box-sizing:border-box; } button { font-family:inherit; }

        /* ===== スマホ対応 ===== */
        @media (max-width: 640px) {
          .header-search { display:none !important; }
          .header-signage { display:none !important; }
          .header-user-name { display:none !important; }
          .hero { padding:16px !important; flex-direction:column !important; align-items:flex-start !important; }
          .hero h2 { font-size:16px !important; }
          .hero-stats { gap:8px !important; flex-wrap:wrap !important; }
          .hero-stat { padding:10px 12px !important; }
          .hero-stat-num { font-size:18px !important; }
          .filter-bar { gap:6px !important; }
          .filter-chip { font-size:11px !important; padding:5px 10px !important; }
          .event-grid { grid-template-columns:1fr !important; gap:14px !important; }
          .card-buttons { flex-wrap:wrap !important; }
          .card-buttons button { font-size:11px !important; padding:7px 8px !important; min-width:calc(50% - 4px) !important; }
          .modal-overlay { align-items:flex-end !important; padding:0 !important; }
          .modal-box { border-radius:20px 20px 0 0 !important; max-height:92vh !important; width:100% !important; max-width:100% !important; margin:0 !important; }
          .detail-grid { grid-template-columns:1fr !important; }
          .detail-buttons { flex-direction:column !important; }
          .detail-buttons button { width:100% !important; }
          .login-box { padding:28px 18px !important; margin:16px !important; }
          .form-grid-2col { grid-template-columns:1fr !important; }
        }
        @media (max-width: 400px) {
          .hero-stats { display:none !important; }
        }
      `}</style>

      {/* バナー画像 + オレンジ色ナビバーオーバーレイ */}
      <div style={{ position: "relative", width: "100%", height: 200, backgroundImage: "url('/bn.JPG')", backgroundRepeat: "no-repeat", backgroundSize: "100% auto", backgroundPosition: "0 -120px", flexShrink: 0 }}>

      {/* ヘッダー */}
      <header style={{ position: "absolute", top: 0, left: 0, right: 0, background: "linear-gradient(135deg,#d97706,#b45309)", boxShadow: "0 2px 12px rgba(0,0,0,0.3)", zIndex: 100 }}>
        <div className="header-inner" style={{ maxWidth: 1200, margin: "0 auto", padding: "0 20px", display: "flex", alignItems: "center", gap: 8, minHeight: 62, flexWrap: "wrap" }}>
          <span style={{ fontSize: 26 }}>🎪</span>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: "white", letterSpacing: 1 }}>イベントナビ</h1>
          <div style={{ flex: 1 }} />
          <input value={searchQ} onChange={e => setSearchQ(e.target.value)} placeholder="🔍 イベントを検索..." className="header-search" style={{ ...inputStyle, width: 200, background: "#f8f9ff", border: "2px solid #e2e8f0" }} />
          <button onClick={() => setPage("signage")} className="header-signage" style={{ padding: "7px 13px", borderRadius: 9, border: "none", background: "#1e1b4b", color: "white", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>📺 サイネージ</button>
          <button onClick={() => setModalType("notifications")} style={{ position: "relative", background: unread ? "#ede9fe" : "#f8f9ff", border: "none", borderRadius: 9, padding: "7px 11px", cursor: "pointer", fontSize: 19 }}>
            🔔{unread > 0 && <span style={{ position: "absolute", top: 3, right: 3, background: "#ef4444", color: "white", borderRadius: "50%", width: 16, height: 16, fontSize: 10, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}>{unread}</span>}
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 8, background: ROLE_THEME[currentUser.role].light, borderRadius: 10, padding: "5px 12px", border: `1px solid ${ROLE_THEME[currentUser.role].headerBorder}` }}>
            <span style={{ fontSize: 17 }}>{currentUser.role === "admin" ? "⚙️" : "👤"}</span>
            <div><div className="header-user-name" style={{ fontSize: 12, fontWeight: 700, color: "#1e1b4b" }}>{currentUser.name}</div><div style={{ fontSize: 10, color: "#94a3b8" }}>{currentUser.role === "admin" ? "管理者" : (currentUser.actualRole || "参加者")}</div></div>
          </div>
          <button onClick={onBackToHome} style={{ padding: "9px 14px", borderRadius: 10, border: "none", background: "linear-gradient(135deg,#0284c7,#0369a1)", color: "white", cursor: "pointer", fontSize: 12, fontWeight: 800, letterSpacing: 1 }}>🏠 ホームに戻る</button>
        </div>
      </header>
      </div>

      {loading && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(255,255,255,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999, flexDirection: "column", gap: 16 }}>
          <div style={{ fontSize: 48 }}>🎪</div>
          <p style={{ fontWeight: 700, color: "#667eea", fontSize: 16 }}>イベントを読み込み中...</p>
        </div>
      )}
      <main style={{ maxWidth: 1200, margin: "0 auto", padding: "28px 20px" }}>
        {/* ヒーロー */}
        <div className="hero" style={{ background: ROLE_THEME[currentUser.role].heroBg, borderRadius: 22, padding: "26px 34px", marginBottom: 26, color: "white", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 18, transition: "background 0.4s" }}>
          <div>
            <h2 style={{ margin: "0 0 6px", fontSize: 22, fontWeight: 800 }}>{currentUser.role === "admin" ? "⚙️ 管理者メニュー" : "🎉 イベントを探して参加しよう！"}</h2>
            <p style={{ margin: 0, opacity: 0.85, fontSize: 14 }}>{currentUser.role === "admin" ? "イベントの承認・管理ができます" : "イベントの閲覧・申込・投稿ができます"}</p>
          </div>
          <div className="hero-stats" style={{ display: "flex", gap: 14 }}>
            {[["🎪", events.filter(e => e.status === "approved").length, "承認済み"], ["⏳", events.filter(e => e.status === "pending").length, "審査中"], ["📣", events.reduce((s, e) => s + (e.emergencyNotices?.length || 0), 0), "緊急連絡"]].map(([icon, n, label]) => (
              <div key={label} className="hero-stat" style={{ background: "rgba(255,255,255,0.2)", borderRadius: 14, padding: "13px 18px", textAlign: "center" }}>
                <div style={{ fontSize: 20 }}>{icon}</div>
                <div style={{ fontSize: 24, fontWeight: 800, lineHeight: 1.2 }}>{n}</div>
                <div style={{ fontSize: 10, opacity: 0.8 }}>{label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* フィルター + 新規投稿 */}
        <div className="filter-bar" style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 22, flexWrap: "wrap" }}>
          {currentUser.role !== "admin" && (
            <div style={{ display: "flex", gap: 7, flexWrap: "wrap", flex: 1 }}>
              {[["すべて","すべて"],["event","📅 イベント"],["volunteer","🙋 ボランティア募集"]].map(([val, label]) => (
                <button key={val} onClick={() => setFilter(val)} className="filter-chip" style={{ padding: "6px 14px", borderRadius: 20, border: "2px solid", borderColor: filter === val ? ROLE_THEME[currentUser.role].primary : "#e2e8f0", background: filter === val ? ROLE_THEME[currentUser.role].light : "white", color: filter === val ? ROLE_THEME[currentUser.role].primary : "#64748b", cursor: "pointer", fontSize: 12, fontWeight: filter === val ? 700 : 500 }}>{label}</button>
              ))}
            </div>
          )}
          {currentUser.role !== "participant" && <div style={{ flex: 1 }} />}
          {currentUser && (
            <button onClick={() => { setSelectedEvent(null); setModalType("create"); }} style={{ padding: "9px 20px", borderRadius: 13, border: "none", background: ROLE_THEME[currentUser.role].gradient, color: "white", cursor: "pointer", fontWeight: 700, fontSize: 13, boxShadow: `0 4px 15px ${ROLE_THEME[currentUser.role].primary}40` }}>＋ 新規投稿</button>
          )}
        </div>

        {/* グリッド */}
        {filteredEvents.length === 0 ? (
          <div style={{ textAlign: "center", padding: "80px 20px", color: "#94a3b8" }}><div style={{ fontSize: 60, marginBottom: 14 }}>🔍</div><p style={{ fontSize: 17, fontWeight: 600 }}>イベントが見つかりませんでした</p></div>
        ) : (
          <div className="event-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 22 }}>
            {filteredEvents.map(ev => (
              <EventCard key={ev.id} event={ev} currentUser={currentUser}
                onOpenApply={(ev, type) => { setSelectedEvent(ev); setApplyType(type); setModalType("apply"); }}
                onViewDetail={ev => { setSelectedEvent(ev); setModalType("detail"); }}
                onApprove={handleApproveEvent}
                onRevision={id => { setEvents(prev => prev.map(e => e.id === id ? { ...e, status: "revision" } : e)); showToast("修正依頼を送信しました", "info"); }}
                onEdit={ev => { setSelectedEvent(ev); setModalType("edit"); }}
                onEmergency={ev => { setSelectedEvent(ev); setModalType("emergency"); }}
                onRoster={ev => setRosterEvent(ev)}
                onAdminAction={(ev, type) => setAdminActionTarget({ event: ev, type })}
                onFlyer={ev => generateFlyerPDF(ev)}
                onCancelApply={(ev, applicantId) => {
                  if (confirm(`「${ev.title}」の申込をキャンセルしますか？`)) {
                    setEvents(prev => prev.map(e => e.id === ev.id ? { ...e, applicants: e.applicants.filter(a => a.id !== applicantId) } : e));
                    setNotifications(prev => [{ id: Date.now(), message: `「${ev.title}」の申込をキャンセルしました`, time: "たった今", read: false }, ...prev]);
                    showToast("申込をキャンセルしました", "info");
                  }
                }}
                onDelete={handleDeleteEvent}
              />
            ))}
          </div>
        )}
      </main>

      {/* ===== モーダル群 ===== */}

      {(modalType === "create" || modalType === "edit") && (
        <Modal title={modalType === "create" ? "🚀 新規イベント投稿" : "✏️ イベント編集"} onClose={() => { setModalType(null); setSelectedEvent(null); }}>
          <EventForm event={selectedEvent} onSave={handleSaveEvent} onClose={() => { setModalType(null); setSelectedEvent(null); }} />
        </Modal>
      )}

      {modalType === "apply" && selectedEvent && (
        <Modal title={applyType === "volunteer" ? "🙋 ボランティア申込フォーム" : "📝 参加申込フォーム"} onClose={() => { setModalType(null); setSelectedEvent(null); }} wide>
          <ApplicationForm event={selectedEvent} currentUserId={currentUser.id} onSubmit={handleApply} onClose={() => { setModalType(null); setSelectedEvent(null); }} />
        </Modal>
      )}

      {modalType === "emergency" && selectedEvent && (
        <Modal title="📣 緊急連絡を送信" onClose={() => { setModalType(null); setSelectedEvent(null); }}>
          <EmergencyForm event={selectedEvent} onSave={handleEmergencySave} onClose={() => { setModalType(null); setSelectedEvent(null); }} />
        </Modal>
      )}

      {modalType === "detail" && selectedEvent && (
        <Modal title="📋 イベント詳細" onClose={() => { setModalType(null); setSelectedEvent(null); }}>
          <div>
            {/* 管理者コメント（修正依頼 / 非承認） */}
            {selectedEvent.adminComment && (
              <div style={{ marginBottom: 20, background: selectedEvent.adminComment.type === "rejected" ? "#fef2f2" : "#fffbeb", border: `2px solid ${selectedEvent.adminComment.type === "rejected" ? "#fecaca" : "#fde68a"}`, borderRadius: 14, padding: "14px 18px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <span style={{ fontSize: 18 }}>{selectedEvent.adminComment.type === "rejected" ? "🚫" : "🔄"}</span>
                  <span style={{ fontWeight: 800, fontSize: 14, color: selectedEvent.adminComment.type === "rejected" ? "#dc2626" : "#d97706" }}>
                    管理者より【{selectedEvent.adminComment.type === "rejected" ? "非承認" : "修正依頼"}】
                  </span>
                  <span style={{ fontSize: 11, color: "#94a3b8", marginLeft: "auto" }}>{selectedEvent.adminComment.sentAt}</span>
                </div>
                <p style={{ margin: "0 0 8px", fontSize: 14, color: "#1e1b4b", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{selectedEvent.adminComment.comment}</p>
                <p style={{ margin: 0, fontSize: 11, color: "#94a3b8" }}>送信者：{selectedEvent.adminComment.adminName}</p>
              </div>
            )}

            {selectedEvent.emergencyNotices?.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <h3 style={{ margin: "0 0 10px", fontSize: 14, fontWeight: 800, color: "#dc2626" }}>⚠️ 緊急連絡履歴</h3>
                {[...selectedEvent.emergencyNotices].reverse().map(n => {
                  const nt = NOTICE_TYPES[n.type] || NOTICE_TYPES.other;
                  return (
                    <div key={n.id} style={{ background: nt.bg, border: `1px solid ${nt.border}`, borderRadius: 10, padding: "10px 14px", marginBottom: 8 }}>
                      <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4 }}>
                        <span>{nt.icon}</span>
                        <span style={{ fontSize: 12, fontWeight: 800, color: nt.color }}>【{nt.label}】</span>
                        <span style={{ fontSize: 10, color: "#94a3b8", marginLeft: "auto" }}>{n.createdAt}</span>
                      </div>
                      <p style={{ margin: 0, fontSize: 13, color: nt.color, fontWeight: 700 }}>{n.message}</p>
                    </div>
                  );
                })}
              </div>
            )}
            <div style={{ textAlign: "center", marginBottom: 20 }}>
              <div style={{ fontSize: 58 }}>{selectedEvent.image}</div>
              <h2 style={{ fontSize: 21, fontWeight: 800, color: "#1e1b4b", margin: "8px 0 4px" }}>{selectedEvent.title}</h2>
            </div>
            <p style={{ lineHeight: 1.8, color: "#374151", background: "#f8f9ff", borderRadius: 12, padding: 14, marginBottom: 16 }}>{selectedEvent.description}</p>
            <div className="detail-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
              {[
                ["📅 開催日時", `${formatDate(selectedEvent.date)} ${selectedEvent.time}`],
                ["📍 開催場所", selectedEvent.location],
                ["👤 主催者", selectedEvent.organizerName || selectedEvent.organizer],
                ["👥 定員", selectedEvent.capacityUnlimited ? "無（定員なし）" : `${selectedEvent.applicants.length} / ${selectedEvent.capacity}名`],
                ...(selectedEvent.fee ? [["💴 参加費", selectedEvent.fee]] : []),
                ...(selectedEvent.type === "volunteer" && selectedEvent.meetingPlace ? [["🗺️ 集合場所", selectedEvent.meetingPlace], ["🕐 集合時間", selectedEvent.meetingTime], ["🕔 解散予定", selectedEvent.dismissalTime]] : []),
                ...(selectedEvent.contactPerson ? [["🧑‍💼 担当者", selectedEvent.contactPerson]] : []),
                ...(selectedEvent.contactPhone ? [["📞 担当者連絡先", selectedEvent.contactPhone]] : []),
                ...(selectedEvent.eligibility?.length ? [["🎯 参加資格", selectedEvent.eligibility.join("・")]] : []),
                ...(selectedEvent.targetArea && selectedEvent.targetArea !== "指定なし" ? [["🏘️ 対象地区", selectedEvent.targetArea === "その他" ? (selectedEvent.targetAreaOther || "その他") : selectedEvent.targetArea]] : []),
                ...(selectedEvent.dressCode ? [["👕 服装・持ち物", selectedEvent.dressCode]] : []),
                ...(selectedEvent.externalUrl ? [["🔗 関連リンク", selectedEvent.externalUrl]] : []),
              ].map(([label, val]) => (
                <div key={label} style={{ background: "#f8f9ff", borderRadius: 10, padding: "10px 13px", borderLeft: "3px solid #667eea" }}>
                  <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 3 }}>{label}</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#1e1b4b" }}>{val}</div>
                </div>
              ))}
            </div>
            <div className="detail-buttons" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {selectedEvent.status === "approved" && (() => {
                const isApplied = selectedEvent.applicants?.some(a => a.id === currentUser.id);
                const isVolApplied = selectedEvent.volunteerApplicants?.some(a => a.id === currentUser.id);
                const isFull = !selectedEvent.capacityUnlimited && selectedEvent.applicants?.length >= selectedEvent.capacity;
                return (
                  <>
                    <button onClick={() => { setApplyType(selectedEvent.type === "volunteer" ? "volunteer" : "participant"); setModalType("apply"); }} disabled={(isApplied || isVolApplied) || isFull} style={{ flex: 1, padding: "11px", borderRadius: 11, border: "none", background: (isApplied || isVolApplied) ? "#dcfce7" : isFull ? "#fee2e2" : "linear-gradient(135deg,#667eea,#764ba2)", color: (isApplied || isVolApplied) ? "#16a34a" : isFull ? "#dc2626" : "white", cursor: (isApplied || isVolApplied) || isFull ? "not-allowed" : "pointer", fontWeight: 700, fontSize: 13 }}>
                      {(isApplied || isVolApplied) ? "✓ 申込済み" : isFull ? "満員" : "📝 参加申込"}
                    </button>
                    {isApplied && <button onClick={() => generateApplicationPDF(selectedEvent, selectedEvent.applicants.find(a => a.id === currentUser.id))} style={{ flex: 1, padding: "11px", borderRadius: 11, border: "none", background: "#fef3c7", color: "#b45309", cursor: "pointer", fontWeight: 700, fontSize: 13 }}>📄 申込票を印刷</button>}
                  </>
                );
              })()}
              {selectedEvent.externalUrl && (
                <button onClick={() => window.open(selectedEvent.externalUrl, "_blank")} style={{ flex: 1, padding: "11px", borderRadius: 11, border: "none", background: "linear-gradient(135deg,#0284c7,#0369a1)", color: "white", cursor: "pointer", fontWeight: 700, fontSize: 13 }}>🔗 関連リンクを開く</button>
              )}
              {(currentUser.id === selectedEvent.organizerId || currentUser.role === "admin") && (
                <>
                  <button onClick={() => { setSelectedEvent(selectedEvent); setModalType("edit"); }} style={{ flex: 1, padding: "11px", borderRadius: 11, border: "none", background: "#f1f5f9", color: "#475569", cursor: "pointer", fontWeight: 700, fontSize: 13 }}>✏️ 編集</button>
                  <button onClick={() => setModalType("emergency")} style={{ flex: 1, padding: "11px", borderRadius: 11, border: "none", background: "#fef2f2", color: "#dc2626", cursor: "pointer", fontWeight: 700, fontSize: 13 }}>📣 緊急連絡</button>
                  <button onClick={() => generateFlyerPDF(selectedEvent)} style={{ flex: 1, padding: "11px", borderRadius: 11, border: "none", background: "#fef3c7", color: "#b45309", cursor: "pointer", fontWeight: 700, fontSize: 13 }}>📄 フライヤー印刷</button>
                </>
              )}
              {currentUser.role === "admin" && (
                <>
                  {selectedEvent.status !== "approved" && <button onClick={() => { handleApproveEvent(selectedEvent.id); setModalType(null); }} style={{ flex: 1, padding: "11px", borderRadius: 11, border: "none", background: "#dcfce7", color: "#15803d", cursor: "pointer", fontWeight: 700 }}>✅ 承認</button>}
                  <button onClick={() => { setModalType(null); setTimeout(() => setAdminActionTarget({ event: selectedEvent, type: "revision" }), 50); }} style={{ flex: 1, padding: "11px", borderRadius: 11, border: "none", background: "#fffbeb", color: "#d97706", cursor: "pointer", fontWeight: 700 }}>🔄 修正依頼</button>
                  <button onClick={() => { setModalType(null); setTimeout(() => setAdminActionTarget({ event: selectedEvent, type: "rejected" }), 50); }} style={{ flex: 1, padding: "11px", borderRadius: 11, border: "none", background: "#fef2f2", color: "#dc2626", cursor: "pointer", fontWeight: 700 }}>🚫 非承認</button>
                  <button onClick={() => generateFlyerPDF(selectedEvent)} style={{ flex: 1, padding: "11px", borderRadius: 11, border: "none", background: "#fef3c7", color: "#b45309", cursor: "pointer", fontWeight: 700 }}>📄 フライヤー</button>
                  <button onClick={() => setRosterEvent(selectedEvent)} style={{ flex: 1, padding: "11px", borderRadius: 11, border: "none", background: "#dcfce7", color: "#15803d", cursor: "pointer", fontWeight: 700 }}>📊 名簿</button>
                  <button onClick={() => handleDeleteEvent(selectedEvent.id)} style={{ flex: 1, padding: "11px", borderRadius: 11, border: "none", background: "#fef2f2", color: "#dc2626", cursor: "pointer", fontWeight: 700 }}>🗑 削除</button>
                </>
              )}
            </div>
          </div>
        </Modal>
      )}

      {modalType === "notifications" && (
        <Modal title="🔔 通知" onClose={() => { setModalType(null); setNotifications(prev => prev.map(n => ({ ...n, read: true }))); }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {notifications.length === 0 ? (
              <div style={{ textAlign: "center", padding: 40, color: "#94a3b8" }}>通知はありません</div>
            ) : notifications.map(n => (
              <div key={n.id} style={{ padding: "12px 14px", borderRadius: 11, background: n.isAdminAction ? (n.message.includes("非承認") ? "#fef2f2" : "#fffbeb") : (n.read ? "#f8f9ff" : "#ede9fe"), borderLeft: `3px solid ${n.isAdminAction ? (n.message.includes("非承認") ? "#fecaca" : "#fde68a") : (n.read ? "#e2e8f0" : "#667eea")}`, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                <div>
                  <p style={{ margin: "0 0 3px", fontSize: 13, fontWeight: n.read ? 400 : 700, color: "#1e1b4b" }}>{n.message}</p>
                  <span style={{ fontSize: 11, color: "#94a3b8" }}>{n.time}</span>
                </div>
                {!n.read && <span style={{ background: "#667eea", width: 8, height: 8, borderRadius: "50%", flexShrink: 0, marginTop: 3 }} />}
              </div>
            ))}
          </div>
        </Modal>
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {rosterEvent && <RosterModal event={rosterEvent} onClose={() => setRosterEvent(null)} />}

      {adminActionTarget && (
        <AdminActionModal
          event={adminActionTarget.event}
          actionType={adminActionTarget.type}
          onConfirm={handleAdminActionConfirm}
          onClose={() => setAdminActionTarget(null)}
        />
      )}

      {/* PIN認証廃止 — ログイン認証で本人確認済み */}
    </div>
  );
}
