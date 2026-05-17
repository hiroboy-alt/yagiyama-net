import { useState, useEffect, useRef } from "react";
import { auth, db } from "./firebase";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
} from "firebase/auth";
import {
  doc, setDoc, getDoc, addDoc, deleteDoc, collection, getDocs, onSnapshot, writeBatch,
} from "firebase/firestore";
import GroupwareApp, { CalendarScreen } from "./Groupware.jsx";
import EventNavi from "./EventNavi.jsx";
import MimamoriApp from "./MimamoriNavi.jsx";

const MAX_W = 540;

// ======== マスターデータ（将来は管理者画面から設定、Firestoreに保存） ========
const MASTER = {
  schools: ["八木山中学校","八木山小学校","八木山南小学校","芦口小学校","金剛沢小学校"],
  grades: {
    "八木山中学校": ["1年","2年","3年"],
    "八木山小学校": ["1年","2年","3年","4年","5年","6年"],
    "八木山南小学校": ["1年","2年","3年","4年","5年","6年"],
    "芦口小学校": ["1年","2年","3年","4年","5年","6年"],
    "金剛沢小学校": ["1年","2年","3年","4年","5年","6年"],
  },
  classes: ["1組","2組","3組","4組","5組"],
  clubs: ["サッカー部","野球部","バスケットボール部","バレーボール部","ソフトテニス部","卓球部","剣道部","陸上部","新体操部","バドミントン部","吹奏楽部","美術部","探究部","その他","なし"],
  districts: ["八木山本町1丁目","八木山本町2丁目","八木山南①","八木山南②","八木山東","緑ヶ丘","青山","芦の口","西の平","桜木町","若葉恵和町","大塒","松が丘","金剛沢","その他"],
  ptaRoles: ["一般会員","会長","副会長","監事","幹事","会計","事務長","委員長","なし"],
};

// ======== スタイル定数 ========
const BG = "#f0f4f8";
const PRIMARY = "#1a73e8";
const PRIMARY_DARK = "#1557b0";
const CARD_BG = "#ffffff";
const TEXT = "#1e293b";
const TEXT2 = "#64748b";
const BORDER = "#e2e8f0";
const RADIUS = 14;
const inputSt = { width:"100%", padding:"12px 14px", borderRadius:10, border:`1.5px solid ${BORDER}`, fontSize:15, color:TEXT, background:"#fff", boxSizing:"border-box", outline:"none", fontFamily:"inherit" };
const btnSt = { width:"100%", padding:"15px", borderRadius:12, border:"none", background:PRIMARY, color:"#fff", fontSize:16, fontWeight:700, cursor:"pointer", fontFamily:"inherit" };
const labelSt = { fontSize:12, fontWeight:600, color:TEXT2, marginBottom:4, display:"block" };

// ======== メインApp ========
export default function App() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [screen, setScreen] = useState("login"); // login | register | home

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        const snap = await getDoc(doc(db, "users", u.uid));
        if (snap.exists()) { setProfile(snap.data()); setScreen("home"); }
        else { setScreen("register"); }
      } else {
        setProfile(null);
        setScreen("login");
      }
      setLoading(false);
    });
    return unsub;
  }, []);

  // 地域カテゴリのユーザーがグループウェアにアクセスしようとした場合は強制的にホームに戻す
  useEffect(() => {
    if (screen === "groupware" && profile?.category === "地域") {
      setScreen("home");
    }
  }, [screen, profile?.category]);

  // カレンダー用: Firestore events & schoolHolidays
  const [calEvents, setCalEventsLocal] = useState([]);
  const calEventsRef = useRef([]);
  useEffect(() => { calEventsRef.current = calEvents; }, [calEvents]);
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "events"), (snap) => {
      setCalEventsLocal(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, []);
  const setCalEvents = (updater) => {
    const prev = calEventsRef.current;
    const next = typeof updater === "function" ? updater(prev) : updater;
    setCalEventsLocal(next);
    // Firestoreに差分同期
    const prevMap = new Map(prev.map(e => [e.id, e]));
    const nextIds = new Set(next.map(e => e.id));
    const ops = [];
    for (const ev of next) {
      const old = prevMap.get(ev.id);
      if (!old || old.date !== ev.date || old.title !== ev.title || old.category !== ev.category) ops.push({ type: "set", ev });
    }
    for (const ev of prev) { if (!nextIds.has(ev.id)) ops.push({ type: "delete", ev }); }
    if (ops.length > 0) {
      const batch = writeBatch(db);
      ops.forEach(op => {
        const ref = doc(db, "events", op.ev.id);
        if (op.type === "set") { const { id, ...data } = op.ev; batch.set(ref, data); }
        else batch.delete(ref);
      });
      batch.commit().catch(e => console.error("Calendar sync error:", e));
    }
  };
  const [calHolidays, setCalHolidays] = useState([]);
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "schoolHolidays"), (snap) => {
      setCalHolidays(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, []);
  const addCalHoliday = async (date, school, label) => {
    await addDoc(collection(db, "schoolHolidays"), { date, school, label: label || "", createdAt: new Date().toISOString() });
  };
  const removeCalHoliday = async (id) => {
    await deleteDoc(doc(db, "schoolHolidays", id));
  };

  // カレンダー用の仮ユーザー（roleで管理者判定）
  const calUser = profile ? {
    id: user?.uid || "u0",
    name: profile.name,
    nickname: profile.name,
    role: profile.role || (profile.category === "保護者" ? (profile.ptaRole || "一般") : profile.category),
    avatar: "👤",
  } : null;

  if (loading) return (
    <div style={{ minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", background:BG, position:"relative" }}>
      <div style={{ position:"fixed", inset:0, backgroundImage:"url('/bg.JPG')", backgroundRepeat:"repeat", backgroundSize:"400px auto", opacity:0.4, pointerEvents:"none" }}/>
      <div style={{ textAlign:"center", position:"relative", zIndex:1 }}>
        <div style={{ fontSize:36, marginBottom:8 }}>🏫</div>
        <div style={{ fontSize:15, color:TEXT2 }}>読み込み中...</div>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight:"100vh", background:BG, fontFamily:"'Hiragino Sans','Hiragino Kaku Gothic ProN','Noto Sans JP',sans-serif", position:"relative" }}>
      {/* 背景画像（薄く表示） */}
      <div style={{ position:"fixed", inset:0, backgroundImage:"url('/bg.JPG')", backgroundRepeat:"repeat", backgroundSize:"400px auto", opacity:0.4, pointerEvents:"none", zIndex:0 }}/>
      <div style={{ maxWidth:MAX_W, margin:"0 auto", padding:"0 16px", position:"relative", zIndex:1 }}>
        {screen === "login" && <LoginScreen onSwitch={()=>setScreen("register")} onLogin={()=>{}} />}
        {screen === "register" && <RegisterScreen user={user} onComplete={(p)=>{setProfile(p);setScreen("home");}} onSwitch={()=>setScreen("login")} />}
        {screen === "home" && <HomeScreen profile={profile} onLogout={async()=>{await signOut(auth);setProfile(null);setScreen("login");}} onOpenApp={(appId)=>setScreen(appId)} onOpenProfile={()=>setScreen("profile")} />}
        {screen === "profile" && user && profile && (
          <ProfileEditScreen
            uid={user.uid}
            initialProfile={profile}
            onSave={(updated)=>{ setProfile({...profile, ...updated}); setScreen("home"); }}
            onCancel={()=>setScreen("home")}
            isAdmin={false}
            viewerRole={profile.role}
          />
        )}
        {screen === "groupware" && profile?.category !== "地域" && <GroupwareApp firebaseUser={{...profile, uid:user?.uid}} onBackToHome={()=>setScreen("home")} />}
        {screen === "calendar" && calUser && (
          <div style={{ height:"100svh", display:"flex", flexDirection:"column", fontFamily:"Hiragino Kaku Gothic ProN, YuGothic, sans-serif", overflow:"hidden" }}>
            <CalendarScreen onBack={()=>setScreen("home")} onHome={()=>setScreen("home")} events={calEvents} setEvents={setCalEvents} currentUser={calUser} schoolHolidays={calHolidays} addSchoolHoliday={addCalHoliday} removeSchoolHoliday={removeCalHoliday} />
          </div>
        )}
        {screen === "eventnavi" && calUser && (
          <EventNavi currentUser={{
            id: user?.uid || "u0",
            name: profile.name,
            nickname: (profile.name || "").split(" ")[0],
            role: profile.role || profile.ptaRole || "一般",
            actualRole: profile.role || profile.ptaRole || "一般",
            email: profile.email,
            category: profile.category,
          }} onBackToHome={()=>setScreen("home")} />
        )}
        {screen === "mimamori" && calUser && (
          <MimamoriApp currentUser={{
            id: user?.uid || "u0",
            name: profile.name,
            nickname: (profile.name || "").split(" ")[0],
            role: profile.role || profile.ptaRole || "一般",
            actualRole: profile.role || profile.ptaRole || "一般",
            email: profile.email,
            category: profile.category,
          }} onBackToHome={()=>setScreen("home")} />
        )}
      </div>
    </div>
  );
}

// ======== ログイン画面 ========
function LoginScreen({ onSwitch }) {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [showReset, setShowReset] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetMsg, setResetMsg] = useState("");
  const [resetErr, setResetErr] = useState("");
  const [resetBusy, setResetBusy] = useState(false);

  const handleLogin = async () => {
    setErr("");
    if (!email || !pw) { setErr("メールアドレスとパスワードを入力してください"); return; }
    setBusy(true);
    try {
      await signInWithEmailAndPassword(auth, email, pw);
    } catch (e) {
      if (e.code === "auth/user-not-found" || e.code === "auth/invalid-credential") setErr("メールアドレスまたはパスワードが違います");
      else if (e.code === "auth/wrong-password") setErr("パスワードが違います");
      else setErr("ログインに失敗しました");
    }
    setBusy(false);
  };

  const handlePasswordReset = async () => {
    setResetErr("");
    setResetMsg("");
    if (!resetEmail.trim()) { setResetErr("メールアドレスを入力してください"); return; }
    setResetBusy(true);
    try {
      await sendPasswordResetEmail(auth, resetEmail.trim());
      setResetMsg("リセット用メールを送信しました。メールをご確認の上、リンクをクリックして新しいパスワードを設定してください。");
      setResetEmail("");
    } catch (e) {
      if (e.code === "auth/user-not-found") setResetErr("このメールアドレスは登録されていません");
      else if (e.code === "auth/invalid-email") setResetErr("メールアドレスの形式が正しくありません");
      else setResetErr("送信に失敗しました：" + (e.message || ""));
    }
    setResetBusy(false);
  };

  return (
    <div style={{ paddingTop:60, paddingBottom:40 }}>
      <div style={{ textAlign:"center", marginBottom:32 }}>
        <div style={{ fontSize:44, marginBottom:8 }}>🏫</div>
        <div style={{ fontSize:24, fontWeight:800, color:TEXT }}>八木中ネット</div>
        <div style={{ fontSize:13, color:TEXT2, marginTop:4 }}>仙台市立八木山中学校PTA</div>
      </div>

      <div style={{ background:CARD_BG, borderRadius:RADIUS, padding:"28px 24px", border:`1px solid ${BORDER}` }}>
        <div style={{ fontSize:18, fontWeight:700, color:TEXT, marginBottom:20, textAlign:"center" }}>ログイン</div>

        {err && <div style={{ background:"#fef2f2", color:"#dc2626", padding:"10px 14px", borderRadius:10, fontSize:13, marginBottom:16 }}>{err}</div>}

        <div style={{ marginBottom:14 }}>
          <label style={labelSt}>メールアドレス</label>
          <input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="example@mail.com" style={inputSt} />
        </div>
        <div style={{ marginBottom:20 }}>
          <label style={labelSt}>パスワード</label>
          <input type="password" value={pw} onChange={e=>setPw(e.target.value)} placeholder="8文字以上" style={inputSt} onKeyDown={e=>{if(e.key==="Enter")handleLogin();}} />
        </div>

        <button onClick={handleLogin} disabled={busy} style={{...btnSt, opacity:busy?0.6:1}}>{busy ? "ログイン中..." : "ログイン"}</button>

        <div style={{ textAlign:"center", marginTop:14 }}>
          <span onClick={()=>{ setShowReset(true); setResetEmail(email); setResetMsg(""); setResetErr(""); }} style={{ color:PRIMARY, fontSize:13, fontWeight:600, cursor:"pointer", textDecoration:"underline" }}>パスワードをお忘れの方はこちら</span>
        </div>
      </div>

      <div style={{ textAlign:"center", marginTop:20, fontSize:14, color:TEXT2 }}>
        アカウントをお持ちでない方は
        <span onClick={onSwitch} style={{ color:PRIMARY, fontWeight:700, cursor:"pointer", marginLeft:4 }}>新規登録</span>
      </div>

      {/* パスワードリセットモーダル */}
      {showReset && (
        <div onClick={()=>setShowReset(false)} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:9999, padding:20 }}>
          <div onClick={e=>e.stopPropagation()} style={{ background:"white", borderRadius:18, padding:"24px 20px", maxWidth:420, width:"100%", boxShadow:"0 8px 32px rgba(0,0,0,0.3)" }}>
            <div style={{ fontSize:18, fontWeight:800, color:TEXT, marginBottom:8, textAlign:"center" }}>🔑 パスワードリセット</div>
            <div style={{ fontSize:12, color:TEXT2, marginBottom:16, textAlign:"center", lineHeight:1.6 }}>
              登録時のメールアドレスを入力してください。<br/>パスワードリセット用のメールをお送りします。
            </div>

            {resetErr && <div style={{ background:"#fef2f2", color:"#dc2626", padding:"10px 14px", borderRadius:10, fontSize:13, marginBottom:12 }}>{resetErr}</div>}
            {resetMsg && <div style={{ background:"#f0fdf4", color:"#15803d", padding:"10px 14px", borderRadius:10, fontSize:12, marginBottom:12, lineHeight:1.6 }}>✅ {resetMsg}</div>}

            <div style={{ marginBottom:16 }}>
              <label style={labelSt}>メールアドレス</label>
              <input type="email" value={resetEmail} onChange={e=>setResetEmail(e.target.value)} placeholder="example@mail.com" style={inputSt} />
            </div>

            <div style={{ display:"flex", gap:10 }}>
              <button onClick={()=>setShowReset(false)} style={{ flex:1, padding:"12px", borderRadius:10, border:`1.5px solid ${BORDER}`, background:"white", color:TEXT2, fontSize:14, fontWeight:600, cursor:"pointer", fontFamily:"inherit" }}>閉じる</button>
              <button onClick={handlePasswordReset} disabled={resetBusy} style={{ flex:2, padding:"12px", borderRadius:10, border:"none", background:PRIMARY, color:"white", fontSize:14, fontWeight:700, cursor:resetBusy?"wait":"pointer", opacity:resetBusy?0.6:1, fontFamily:"inherit" }}>{resetBusy ? "送信中..." : "リセットメール送信"}</button>
            </div>

            <div style={{ marginTop:14, padding:"10px 12px", background:"#fef9c3", borderRadius:8, fontSize:11, color:"#92400e", lineHeight:1.6 }}>
              💡 メールが届かない場合：迷惑メールフォルダもご確認ください。受信ドメインの設定で <b>noreply@yagiyama-net.com</b> を許可してください。
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ======== 新規登録画面 ========
function RegisterScreen({ user, onComplete, onSwitch }) {
  const [step, setStep] = useState(1);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  // Step1
  const [category, setCategory] = useState("保護者");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [district, setDistrict] = useState(MASTER.districts[0]);
  const [position, setPosition] = useState("");
  const [ptaRole, setPtaRole] = useState("一般会員");

  // Step2
  const [children, setChildren] = useState([{ name:"", school:MASTER.schools[0], grade:"1年", class_:"1組", club:"なし" }]);

  const addChild = () => setChildren(p => [...p, { name:"", school:MASTER.schools[0], grade:"1年", class_:"1組", club:"なし" }]);
  const removeChild = (i) => setChildren(p => p.filter((_,idx) => idx !== i));
  const updateChild = (i, field, val) => {
    const c = [...children];
    c[i] = { ...c[i], [field]: val };
    if (field === "school") {
      const grades = MASTER.grades[val] || ["1年"];
      c[i].grade = grades[0];
    }
    setChildren(c);
  };

  const handleStep1 = () => {
    setErr("");
    if (!name.trim()) { setErr("氏名を入力してください"); return; }
    if (!user && !email.trim()) { setErr("メールアドレスを入力してください"); return; }
    if (!user && pw.length < 8) { setErr("パスワードは8文字以上で入力してください"); return; }
    if (category !== "保護者") { setStep(3); return; }
    setStep(2);
  };

  const handleStep2 = () => {
    setErr("");
    const hasEmpty = children.some(c => !c.name.trim());
    if (hasEmpty) { setErr("お子さまの氏名を入力してください"); return; }
    setStep(3);
  };

  const handleSubmit = async () => {
    setErr("");
    setBusy(true);
    try {
      let uid = user?.uid;
      if (!uid) {
        const cred = await createUserWithEmailAndPassword(auth, email, pw);
        uid = cred.user.uid;
      }
      const profileData = {
        category,
        name: name.trim(),
        email: user?.email || email,
        district: category === "保護者" ? district : "",
        position: category !== "保護者" ? position : "",
        ptaRole: category === "保護者" ? ptaRole : "",
        children: category === "保護者" ? children.map(c => ({
          name: c.name.trim(),
          school: c.school,
          grade: c.grade,
          class_: c.class_,
          club: c.club,
        })) : [],
        role: category === "先生" ? "先生" : category === "地域" ? "地域" : ptaRole === "一般会員" ? "一般" : ptaRole,
        createdAt: new Date().toISOString(),
      };
      await setDoc(doc(db, "users", uid), profileData);
      onComplete(profileData);
    } catch (e) {
      if (e.code === "auth/email-already-in-use") setErr("このメールアドレスは既に登録されています");
      else setErr("登録に失敗しました: " + e.message);
    }
    setBusy(false);
  };

  const catBadge = (label) => (
    <span onClick={()=>setCategory(label)} style={{
      display:"inline-block", padding:"8px 18px", borderRadius:20, fontSize:14, fontWeight:600, cursor:"pointer",
      marginRight:8, marginBottom:6, border:`2px solid ${category===label ? PRIMARY : BORDER}`,
      background: category===label ? "#e8f0fe" : "#fff", color: category===label ? PRIMARY_DARK : TEXT2,
      transition:"all 0.15s",
    }}>{label}</span>
  );

  return (
    <div style={{ paddingTop:40, paddingBottom:40 }}>
      <div style={{ textAlign:"center", marginBottom:24 }}>
        <div style={{ fontSize:36, marginBottom:6 }}>🏫</div>
        <div style={{ fontSize:22, fontWeight:800, color:TEXT }}>八木中ネット</div>
        <div style={{ fontSize:12, color:TEXT2, marginTop:2 }}>新規ユーザー登録</div>
      </div>

      {/* ステッププログレス */}
      <div style={{ display:"flex", justifyContent:"center", gap:8, marginBottom:24 }}>
        {[1,2,3].map(s => (
          <div key={s} style={{ display:"flex", alignItems:"center", gap:6 }}>
            <div style={{ width:28, height:28, borderRadius:14, background: step>=s ? PRIMARY : BORDER, color: step>=s ? "#fff" : TEXT2, display:"flex", alignItems:"center", justifyContent:"center", fontSize:13, fontWeight:700 }}>{s}</div>
            {s < 3 && <div style={{ width:30, height:2, background: step>s ? PRIMARY : BORDER }} />}
          </div>
        ))}
      </div>

      {err && <div style={{ background:"#fef2f2", color:"#dc2626", padding:"10px 14px", borderRadius:10, fontSize:13, marginBottom:16 }}>{err}</div>}

      {/* Step1: 基本情報 */}
      {step === 1 && (
        <div style={{ background:CARD_BG, borderRadius:RADIUS, padding:"24px 20px", border:`1px solid ${BORDER}` }}>
          <div style={{ fontSize:16, fontWeight:700, color:TEXT, marginBottom:16 }}>Step 1：あなたについて</div>

          <div style={{ marginBottom:14 }}>
            <label style={labelSt}>区分</label>
            <div>{catBadge("保護者")}{catBadge("先生")}{catBadge("地域")}</div>
          </div>

          <div style={{ marginBottom:14 }}>
            <label style={labelSt}>氏名</label>
            <input value={name} onChange={e=>setName(e.target.value)} placeholder="伊藤 宏明" style={inputSt} />
          </div>

          {!user && (
            <>
              <div style={{ marginBottom:14 }}>
                <label style={labelSt}>メールアドレス</label>
                <input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="example@mail.com" style={inputSt} />
              </div>
              <div style={{ marginBottom:14 }}>
                <label style={labelSt}>パスワード（8文字以上）</label>
                <input type="password" value={pw} onChange={e=>setPw(e.target.value)} placeholder="8文字以上" style={inputSt} />
              </div>
            </>
          )}

          {category === "保護者" && (
            <>
              <div style={{ marginBottom:14 }}>
                <label style={labelSt}>地区</label>
                <select value={district} onChange={e=>setDistrict(e.target.value)} style={inputSt}>{MASTER.districts.map(d=><option key={d}>{d}</option>)}</select>
              </div>
              <div style={{ marginBottom:14 }}>
                <label style={labelSt}>PTA役職</label>
                <select value={ptaRole} onChange={e=>setPtaRole(e.target.value)} style={inputSt}>{MASTER.ptaRoles.map(r=><option key={r}>{r}</option>)}</select>
              </div>
            </>
          )}

          {category !== "保護者" && (
            <div style={{ marginBottom:14 }}>
              <label style={labelSt}>立場・役職</label>
              <input value={position} onChange={e=>setPosition(e.target.value)} placeholder={category==="先生" ? "教頭、校長、担任 など" : "民生委員、町内会長 など"} style={inputSt} />
            </div>
          )}

          <button onClick={handleStep1} style={btnSt}>次へ</button>
        </div>
      )}

      {/* Step2: 子ども情報 */}
      {step === 2 && (
        <div style={{ background:CARD_BG, borderRadius:RADIUS, padding:"24px 20px", border:`1px solid ${BORDER}` }}>
          <div style={{ fontSize:16, fontWeight:700, color:TEXT, marginBottom:16 }}>Step 2：お子さまの情報</div>

          {children.map((child, i) => (
            <div key={i} style={{ background:"#f8fafc", borderRadius:12, padding:"16px 14px", marginBottom:12, border:`1px solid ${BORDER}`, position:"relative" }}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
                <span style={{ fontSize:12, fontWeight:700, color:PRIMARY, background:"#e8f0fe", padding:"3px 12px", borderRadius:8 }}>{i+1}人目</span>
                {children.length > 1 && (
                  <span onClick={()=>removeChild(i)} style={{ fontSize:11, color:"#dc2626", cursor:"pointer", fontWeight:600 }}>削除</span>
                )}
              </div>

              <div style={{ marginBottom:10 }}>
                <label style={labelSt}>お子さま氏名</label>
                <input value={child.name} onChange={e=>updateChild(i,"name",e.target.value)} placeholder="伊藤 大" style={inputSt} />
              </div>

              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:10 }}>
                <div>
                  <label style={labelSt}>学校名</label>
                  <select value={child.school} onChange={e=>updateChild(i,"school",e.target.value)} style={{...inputSt, fontSize:13}}>
                    {MASTER.schools.map(s=><option key={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelSt}>学年</label>
                  <select value={child.grade} onChange={e=>updateChild(i,"grade",e.target.value)} style={{...inputSt, fontSize:13}}>
                    {(MASTER.grades[child.school]||["1年"]).map(g=><option key={g}>{g}</option>)}
                  </select>
                </div>
              </div>

              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                <div>
                  <label style={labelSt}>クラス</label>
                  <select value={child.class_} onChange={e=>updateChild(i,"class_",e.target.value)} style={{...inputSt, fontSize:13}}>
                    {MASTER.classes.map(c=><option key={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelSt}>部活（任意）</label>
                  <select value={child.club} onChange={e=>updateChild(i,"club",e.target.value)} style={{...inputSt, fontSize:13}}>
                    {MASTER.clubs.map(c=><option key={c}>{c}</option>)}
                  </select>
                </div>
              </div>
            </div>
          ))}

          <button onClick={addChild} style={{ width:"100%", padding:"12px", borderRadius:10, border:`2px dashed ${BORDER}`, background:"transparent", color:TEXT2, fontSize:14, fontWeight:600, cursor:"pointer", marginBottom:16 }}>＋ 兄弟を追加</button>

          <div style={{ display:"flex", gap:10 }}>
            <button onClick={()=>setStep(1)} style={{...btnSt, background:"#fff", color:TEXT2, border:`1.5px solid ${BORDER}`, flex:1}}>戻る</button>
            <button onClick={handleStep2} style={{...btnSt, flex:2}}>次へ</button>
          </div>
        </div>
      )}

      {/* Step3: 確認 */}
      {step === 3 && (
        <div style={{ background:CARD_BG, borderRadius:RADIUS, padding:"24px 20px", border:`1px solid ${BORDER}` }}>
          <div style={{ fontSize:16, fontWeight:700, color:TEXT, marginBottom:16 }}>Step 3：登録内容の確認</div>

          <div style={{ background:"#f8fafc", borderRadius:12, padding:"16px", marginBottom:16, border:`1px solid ${BORDER}` }}>
            <ConfirmRow label="区分" value={category} />
            <ConfirmRow label="氏名" value={name} />
            <ConfirmRow label="メール" value={user?.email || email} />
            {category === "保護者" && <ConfirmRow label="地区" value={district} />}
            {category === "保護者" && <ConfirmRow label="PTA役職" value={ptaRole} />}
            {category !== "保護者" && <ConfirmRow label="立場" value={position} />}
          </div>

          {category === "保護者" && children.length > 0 && (
            <div style={{ background:"#f8fafc", borderRadius:12, padding:"16px", marginBottom:16, border:`1px solid ${BORDER}` }}>
              <div style={{ fontSize:13, fontWeight:700, color:TEXT, marginBottom:8 }}>お子さま情報</div>
              {children.map((c,i) => (
                <div key={i} style={{ marginBottom:i<children.length-1?10:0 }}>
                  <div style={{ fontSize:13, fontWeight:600, color:PRIMARY }}>{i+1}人目：{c.name}</div>
                  <div style={{ fontSize:12, color:TEXT2 }}>{c.school} {c.grade} {c.class_}{c.club !== "なし" ? ` / ${c.club}` : ""}</div>
                </div>
              ))}
            </div>
          )}

          <div style={{ display:"flex", gap:10 }}>
            <button onClick={()=>setStep(category==="保護者"?2:1)} style={{...btnSt, background:"#fff", color:TEXT2, border:`1.5px solid ${BORDER}`, flex:1}}>戻る</button>
            <button onClick={handleSubmit} disabled={busy} style={{...btnSt, flex:2, opacity:busy?0.6:1}}>{busy ? "登録中..." : "登録する"}</button>
          </div>
        </div>
      )}

      {!user && step === 1 && (
        <div style={{ textAlign:"center", marginTop:20, fontSize:14, color:TEXT2 }}>
          既にアカウントをお持ちの方は
          <span onClick={onSwitch} style={{ color:PRIMARY, fontWeight:700, cursor:"pointer", marginLeft:4 }}>ログイン</span>
        </div>
      )}
    </div>
  );
}

// ======== プロフィール編集画面（マイページ・管理者編集 共通） ========
function ProfileEditScreen({ uid, initialProfile, onSave, onCancel, isAdmin = false, viewerRole = "" }) {
  const [category, setCategory] = useState(initialProfile?.category || "保護者");
  const [name, setName] = useState(initialProfile?.name || "");
  const [district, setDistrict] = useState(initialProfile?.district || MASTER.districts[0]);
  const [position, setPosition] = useState(initialProfile?.position || "");
  const [ptaRole, setPtaRole] = useState(initialProfile?.ptaRole || "一般会員");
  const [children, setChildren] = useState(initialProfile?.children?.length ? initialProfile.children : [{ name:"", school:MASTER.schools[0], grade:"1年", class_:"1組", club:"なし" }]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // 管理者でなければ自分のロールは変更できない
  const canEditRole = isAdmin;

  const addChild = () => setChildren(p => [...p, { name:"", school:MASTER.schools[0], grade:"1年", class_:"1組", club:"なし" }]);
  const removeChild = (i) => setChildren(p => p.filter((_,idx) => idx !== i));
  const updateChild = (i, field, val) => {
    const c = [...children];
    c[i] = { ...c[i], [field]: val };
    if (field === "school") {
      const grades = MASTER.grades[val] || ["1年"];
      c[i].grade = grades[0];
    }
    setChildren(c);
  };

  const handleSubmit = async () => {
    setErr("");
    if (!name.trim()) { setErr("氏名を入力してください"); return; }
    if (category === "保護者") {
      const hasEmpty = children.some(c => !c.name.trim());
      if (hasEmpty) { setErr("お子さまの氏名を入力してください"); return; }
    }
    setBusy(true);
    try {
      // 差分更新（updateDocで指定したフィールドのみ更新、他のフィールドは保持）
      const updateData = {
        category,
        name: name.trim(),
        district: category === "保護者" ? district : "",
        position: category !== "保護者" ? position : "",
        ptaRole: category === "保護者" ? ptaRole : "",
        children: category === "保護者" ? children.map(c => ({
          name: c.name.trim(),
          school: c.school,
          grade: c.grade,
          class_: c.class_,
          club: c.club,
        })) : [],
        role: category === "先生" ? "先生" : category === "地域" ? "地域" : (ptaRole === "一般会員" ? "一般" : ptaRole),
        updatedAt: new Date().toISOString(),
      };
      // emailは更新しない（認証情報なので）
      const { updateDoc, doc } = await import("firebase/firestore");
      await updateDoc(doc(db, "users", uid), updateData);
      onSave(updateData);
    } catch (e) {
      setErr("保存に失敗しました: " + e.message);
    }
    setBusy(false);
  };

  const catBadge = (label) => (
    <span onClick={()=>setCategory(label)} style={{
      display:"inline-block", padding:"8px 18px", borderRadius:20, fontSize:14, fontWeight:600, cursor:"pointer",
      marginRight:8, marginBottom:6, border:`2px solid ${category===label ? PRIMARY : BORDER}`,
      background: category===label ? "#e8f0fe" : "#fff", color: category===label ? PRIMARY_DARK : TEXT2,
    }}>{label}</span>
  );

  return (
    <div style={{ paddingTop:24, paddingBottom:40 }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:20 }}>
        <div>
          <div style={{ fontSize:20, fontWeight:800, color:TEXT }}>{isAdmin ? "👥 メンバー編集" : "👤 マイページ"}</div>
          <div style={{ fontSize:12, color:TEXT2, marginTop:2 }}>登録情報を編集できます</div>
        </div>
        <button onClick={onCancel} style={{ padding:"8px 14px", borderRadius:10, border:`1.5px solid ${BORDER}`, background:"#fff", color:TEXT2, fontSize:12, fontWeight:600, cursor:"pointer" }}>← 戻る</button>
      </div>

      {err && <div style={{ background:"#fef2f2", color:"#dc2626", padding:"10px 14px", borderRadius:10, fontSize:13, marginBottom:16 }}>{err}</div>}

      <div style={{ background:CARD_BG, borderRadius:RADIUS, padding:"24px 20px", border:`1px solid ${BORDER}`, marginBottom:14 }}>
        <div style={{ fontSize:14, fontWeight:700, color:TEXT, marginBottom:14 }}>基本情報</div>

        <div style={{ marginBottom:14 }}>
          <label style={labelSt}>区分</label>
          <div>{catBadge("保護者")}{catBadge("先生")}{catBadge("地域")}</div>
        </div>

        <div style={{ marginBottom:14 }}>
          <label style={labelSt}>氏名</label>
          <input value={name} onChange={e=>setName(e.target.value)} style={inputSt} />
        </div>

        {category === "保護者" && (
          <>
            <div style={{ marginBottom:14 }}>
              <label style={labelSt}>地区</label>
              <select value={district} onChange={e=>setDistrict(e.target.value)} style={inputSt}>{MASTER.districts.map(d=><option key={d}>{d}</option>)}</select>
            </div>
            <div style={{ marginBottom:14 }}>
              <label style={labelSt}>PTA役職</label>
              {canEditRole ? (
                <select value={ptaRole} onChange={e=>setPtaRole(e.target.value)} style={inputSt}>{MASTER.ptaRoles.map(r=><option key={r}>{r}</option>)}</select>
              ) : (
                <input value={ptaRole} disabled style={{ ...inputSt, background:"#f1f5f9", color:TEXT2 }} />
              )}
              {!canEditRole && <div style={{ fontSize:11, color:TEXT2, marginTop:4 }}>※ PTA役職の変更は管理者にお問い合わせください</div>}
            </div>
          </>
        )}

        {category !== "保護者" && (
          <div style={{ marginBottom:14 }}>
            <label style={labelSt}>立場・役職</label>
            <input value={position} onChange={e=>setPosition(e.target.value)} placeholder={category==="先生" ? "教頭、校長、担任 など" : "民生委員、町内会長 など"} style={inputSt} />
          </div>
        )}
      </div>

      {category === "保護者" && (
        <div style={{ background:CARD_BG, borderRadius:RADIUS, padding:"24px 20px", border:`1px solid ${BORDER}`, marginBottom:14 }}>
          <div style={{ fontSize:14, fontWeight:700, color:TEXT, marginBottom:14 }}>お子さまの情報</div>
          {children.map((child, i) => (
            <div key={i} style={{ background:"#f8fafc", borderRadius:12, padding:"16px 14px", marginBottom:12, border:`1px solid ${BORDER}`, position:"relative" }}>
              {children.length > 1 && (
                <button onClick={()=>removeChild(i)} style={{ position:"absolute", top:8, right:8, background:"none", border:"none", color:"#dc2626", fontSize:18, cursor:"pointer" }}>×</button>
              )}
              <div style={{ fontSize:13, fontWeight:700, color:PRIMARY, marginBottom:10 }}>{i+1}人目</div>
              <div style={{ marginBottom:10 }}>
                <label style={labelSt}>氏名</label>
                <input value={child.name} onChange={e=>updateChild(i,"name",e.target.value)} style={inputSt} />
              </div>
              <div style={{ marginBottom:10 }}>
                <label style={labelSt}>学校</label>
                <select value={child.school} onChange={e=>updateChild(i,"school",e.target.value)} style={inputSt}>{MASTER.schools.map(s=><option key={s}>{s}</option>)}</select>
              </div>
              <div style={{ display:"flex", gap:8, marginBottom:10 }}>
                <div style={{ flex:1 }}>
                  <label style={labelSt}>学年</label>
                  <select value={child.grade} onChange={e=>updateChild(i,"grade",e.target.value)} style={inputSt}>{(MASTER.grades[child.school] || ["1年"]).map(g=><option key={g}>{g}</option>)}</select>
                </div>
                <div style={{ flex:1 }}>
                  <label style={labelSt}>組</label>
                  <select value={child.class_} onChange={e=>updateChild(i,"class_",e.target.value)} style={inputSt}>{MASTER.classes.map(c=><option key={c}>{c}</option>)}</select>
                </div>
              </div>
              <div>
                <label style={labelSt}>部活</label>
                <select value={child.club} onChange={e=>updateChild(i,"club",e.target.value)} style={inputSt}>{MASTER.clubs.map(c=><option key={c}>{c}</option>)}</select>
              </div>
            </div>
          ))}
          <button onClick={addChild} style={{ width:"100%", padding:12, borderRadius:12, border:`1.5px dashed ${PRIMARY}`, background:"#f8fafc", color:PRIMARY, fontWeight:700, fontSize:13, cursor:"pointer" }}>＋ お子さまを追加</button>
        </div>
      )}

      <button onClick={handleSubmit} disabled={busy} style={{ ...btnSt, opacity:busy?0.6:1 }}>{busy ? "保存中..." : "保存する"}</button>
    </div>
  );
}

function ConfirmRow({ label, value }) {
  return (
    <div style={{ display:"flex", justifyContent:"space-between", padding:"6px 0", borderBottom:`0.5px solid ${BORDER}` }}>
      <span style={{ fontSize:13, color:TEXT2 }}>{label}</span>
      <span style={{ fontSize:13, fontWeight:600, color:TEXT }}>{value}</span>
    </div>
  );
}

// ======== ホーム画面（ランチャー） ========
function HomeScreen({ profile, onLogout, onOpenApp, onOpenProfile }) {
  const isChiiki = profile?.category === "地域";
  const apps = [
    ...(!isChiiki ? [{ id:"groupware", name:"グループウェア", icon:"💬", desc:"お知らせ・チャット・アンケート", color:"#1e3a5f", available:true }] : []),
    { id:"calendar", name:"カレンダー", icon:"📅", desc:"学校行事・PTA・地域の予定", color:"#0284c7", available:true },
    { id:"mimamori", name:"見守りナビ", icon:"👀", desc:"見守りスポット・カレンダー", color:"#059669", available:true },
    { id:"eventnavi", name:"イベントナビ", icon:"🎪", desc:"イベント管理・参加受付", color:"#d97706", available:true },
  ];

  const initial = (profile?.name || "?").charAt(0);

  // ホーム画面追加機能（PWAインストールプロンプト）
  const [installPrompt, setInstallPrompt] = useState(null);
  const [showIosGuide, setShowIosGuide] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  useEffect(() => {
    // 既にホーム画面から起動している場合は非表示
    setIsStandalone(window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true);
    const handler = (e) => { e.preventDefault(); setInstallPrompt(e); };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);
  const handleInstall = async () => {
    const isIos = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    if (installPrompt) {
      installPrompt.prompt();
      const { outcome } = await installPrompt.userChoice;
      if (outcome === "accepted") setInstallPrompt(null);
    } else if (isIos) {
      setShowIosGuide(true);
    } else {
      setShowIosGuide(true); // Android Chrome等でもガイド表示（既にインストール済み or プロンプト未対応の場合）
    }
  };

  return (
    <div style={{ paddingTop:24, paddingBottom:40 }}>
      {/* ヘッダー */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:24 }}>
        <div>
          <div style={{ fontSize:22, fontWeight:800, color:TEXT }}>🏫 八木中ネット</div>
          <div style={{ fontSize:12, color:TEXT2, marginTop:2 }}>仙台市立八木山中学校PTA</div>
        </div>
        <div onClick={onLogout} style={{
          width:40, height:40, borderRadius:20, background:PRIMARY, color:"#fff",
          display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, fontWeight:700, cursor:"pointer",
        }}>{initial}</div>
      </div>

      {/* ユーザー情報カード */}
      <div style={{ background:CARD_BG, borderRadius:RADIUS, padding:"20px", border:`1px solid ${BORDER}`, marginBottom:20, position:"relative" }}>
        {onOpenProfile && (
          <button onClick={onOpenProfile} style={{ position:"absolute", top:14, right:14, padding:"6px 12px", borderRadius:8, border:`1.5px solid ${BORDER}`, background:"#fff", color:PRIMARY, fontSize:11, fontWeight:700, cursor:"pointer", display:"flex", alignItems:"center", gap:4 }}>✎ マイページ</button>
        )}
        <div style={{ display:"flex", alignItems:"center", gap:14 }}>
          <div style={{ width:52, height:52, borderRadius:26, background:"#e8f0fe", color:PRIMARY, display:"flex", alignItems:"center", justifyContent:"center", fontSize:24, fontWeight:700 }}>{initial}</div>
          <div>
            <div style={{ fontSize:17, fontWeight:700, color:TEXT }}>{profile?.name}</div>
            <div style={{ fontSize:12, color:TEXT2 }}>
              {profile?.category === "保護者" ? `${profile.ptaRole || "一般会員"} ・ ${profile.district}` : `${profile?.category} ・ ${profile?.position || ""}`}
            </div>
            {profile?.children?.length > 0 && (
              <div style={{ fontSize:11, color:TEXT2, marginTop:2 }}>
                {profile.children.map(c => `${c.name}（${c.school} ${c.grade}）`).join("、")}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ホーム画面追加ボタン（スマホ用・目立つ位置） */}
      {!isStandalone && (
        <button onClick={handleInstall} style={{ width:"100%", padding:"14px 16px", borderRadius:14, border:"none", background:"linear-gradient(135deg,#0284c7,#0369a1)", color:"white", fontSize:14, fontWeight:800, cursor:"pointer", marginBottom:16, fontFamily:"inherit", boxShadow:"0 4px 16px rgba(2,132,199,0.4)", display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
          <span style={{ fontSize:20 }}>📲</span>
          <span>スマホのホーム画面に追加する</span>
        </button>
      )}

      {/* アプリランチャー */}
      <div style={{ fontSize:15, fontWeight:700, color:TEXT, marginBottom:12 }}>アプリ</div>
      {apps.map(app => (
        <div key={app.id} onClick={()=>{
          if (app.available) {
            if (app.url) window.open(app.url, "_blank");
            else if (onOpenApp) onOpenApp(app.id);
          }
        }} style={{
          display:"flex", alignItems:"center", gap:14, padding:"16px 18px", borderRadius:RADIUS, background:app.color,
          border:"none", marginBottom:8, cursor: app.available ? "pointer" : "default",
          opacity: app.available ? 1 : 0.5, transition:"transform 0.1s",
          boxShadow:`0 4px 14px ${app.color}55`,
        }}>
          <div style={{ width:48, height:48, borderRadius:14, background:"rgba(255,255,255,0.25)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:26 }}>{app.icon}</div>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:15, fontWeight:800, color:"white" }}>{app.name}</div>
            <div style={{ fontSize:12, color:"rgba(255,255,255,0.8)" }}>{app.desc}</div>
          </div>
          {app.available ? (
            <span style={{ color:"rgba(255,255,255,0.7)", fontSize:22 }}>›</span>
          ) : (
            <span style={{ fontSize:10, color:"rgba(255,255,255,0.7)", background:"rgba(255,255,255,0.15)", padding:"4px 10px", borderRadius:8 }}>準備中</span>
          )}
        </div>
      ))}

      {/* ログアウト */}
      <button onClick={onLogout} style={{ width:"100%", padding:"14px", borderRadius:12, border:`1.5px solid ${BORDER}`, background:"#fff", color:"#dc2626", fontSize:14, fontWeight:600, cursor:"pointer", marginTop:12, fontFamily:"inherit" }}>ログアウト</button>

      {/* スマホ向け手順ガイドモーダル（iPhone・Android両方） */}
      {showIosGuide && (
        <div onClick={()=>setShowIosGuide(false)} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:9999, padding:20 }}>
          <div onClick={e=>e.stopPropagation()} style={{ background:"white", borderRadius:18, padding:"22px 18px", maxWidth:400, width:"100%", maxHeight:"90vh", overflowY:"auto", boxShadow:"0 8px 32px rgba(0,0,0,0.3)" }}>
            <div style={{ fontSize:18, fontWeight:800, color:"#0f172a", marginBottom:6, textAlign:"center" }}>📲 ホーム画面に追加する方法</div>
            <div style={{ fontSize:11, color:"#94a3b8", textAlign:"center", marginBottom:16 }}>お使いのスマートフォンで以下の手順をお試しください</div>

            {/* iPhone Safari */}
            <div style={{ background:"#f0f9ff", borderRadius:12, padding:"12px 14px", marginBottom:10, border:"1px solid #bae6fd" }}>
              <div style={{ fontSize:13, fontWeight:800, color:"#0284c7", marginBottom:8 }}>📱 iPhone (Safari) の場合</div>
              <ol style={{ paddingLeft:18, fontSize:12, color:"#475569", lineHeight:1.8, margin:0 }}>
                <li>画面右下の <b>「...」ボタン</b> をタップ</li>
                <li>メニューを下にスクロール → <b>「ホーム画面に追加」</b></li>
                <li>右上の <b>「追加」</b> をタップ</li>
              </ol>
            </div>

            {/* iPhone Chrome */}
            <div style={{ background:"#fef3c7", borderRadius:12, padding:"12px 14px", marginBottom:10, border:"1px solid #fcd34d" }}>
              <div style={{ fontSize:13, fontWeight:800, color:"#b45309", marginBottom:8 }}>📱 iPhone (Chrome) の場合</div>
              <ol style={{ paddingLeft:18, fontSize:12, color:"#475569", lineHeight:1.8, margin:0 }}>
                <li>画面右下の <b>「...」ボタン</b> をタップ</li>
                <li>メニュー内の <b>「ホーム画面に追加」</b> をタップ<br/><span style={{ fontSize:10, color:"#94a3b8" }}>※ 表示されない場合：右下の<b>共有ボタン</b>をタップしてSafariで開き直してください</span></li>
                <li>右上の <b>「追加」</b> をタップ</li>
              </ol>
            </div>

            {/* Android */}
            <div style={{ background:"#f0fdf4", borderRadius:12, padding:"12px 14px", marginBottom:14, border:"1px solid #bbf7d0" }}>
              <div style={{ fontSize:13, fontWeight:800, color:"#059669", marginBottom:8 }}>🤖 Android (Chrome) の場合</div>
              <ol style={{ paddingLeft:18, fontSize:12, color:"#475569", lineHeight:1.8, margin:0 }}>
                <li>画面右上の <b>メニュー（︙）</b> をタップ</li>
                <li><b>「ホーム画面に追加」</b> または <b>「アプリをインストール」</b> を選択</li>
                <li><b>「追加」</b> または <b>「インストール」</b> をタップ</li>
              </ol>
            </div>

            <div style={{ background:"#fef3c7", borderRadius:10, padding:"10px 14px", marginBottom:14, fontSize:11, color:"#92400e", lineHeight:1.6 }}>
              ✨ <b>ホーム画面に追加すると</b>、アプリのようにアイコンから直接起動できて便利です！
            </div>

            <button onClick={()=>setShowIosGuide(false)} style={{ width:"100%", padding:"12px", borderRadius:10, border:"none", background:"linear-gradient(135deg,#0284c7,#0369a1)", color:"white", fontWeight:700, fontSize:14, cursor:"pointer" }}>閉じる</button>
          </div>
        </div>
      )}
    </div>
  );
}
