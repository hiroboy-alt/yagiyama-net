import { useState, useEffect } from "react";
import { auth, db } from "./firebase";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "firebase/auth";
import {
  doc, setDoc, getDoc, collection, getDocs,
} from "firebase/firestore";
import GroupwareApp from "./Groupware.jsx";

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

  if (loading) return (
    <div style={{ minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", background:BG }}>
      <div style={{ textAlign:"center" }}>
        <div style={{ fontSize:36, marginBottom:8 }}>🏫</div>
        <div style={{ fontSize:15, color:TEXT2 }}>読み込み中...</div>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight:"100vh", background:BG, fontFamily:"'Hiragino Sans','Hiragino Kaku Gothic ProN','Noto Sans JP',sans-serif" }}>
      <div style={{ maxWidth:MAX_W, margin:"0 auto", padding:"0 16px" }}>
        {screen === "login" && <LoginScreen onSwitch={()=>setScreen("register")} onLogin={()=>{}} />}
        {screen === "register" && <RegisterScreen user={user} onComplete={(p)=>{setProfile(p);setScreen("home");}} onSwitch={()=>setScreen("login")} />}
        {screen === "home" && <HomeScreen profile={profile} onLogout={async()=>{await signOut(auth);setProfile(null);setScreen("login");}} onOpenApp={(appId)=>setScreen(appId)} />}
        {screen === "groupware" && <GroupwareApp firebaseUser={{...profile, uid:user?.uid}} onBackToHome={()=>setScreen("home")} />}
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
      </div>

      <div style={{ textAlign:"center", marginTop:20, fontSize:14, color:TEXT2 }}>
        アカウントをお持ちでない方は
        <span onClick={onSwitch} style={{ color:PRIMARY, fontWeight:700, cursor:"pointer", marginLeft:4 }}>新規登録</span>
      </div>
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

function ConfirmRow({ label, value }) {
  return (
    <div style={{ display:"flex", justifyContent:"space-between", padding:"6px 0", borderBottom:`0.5px solid ${BORDER}` }}>
      <span style={{ fontSize:13, color:TEXT2 }}>{label}</span>
      <span style={{ fontSize:13, fontWeight:600, color:TEXT }}>{value}</span>
    </div>
  );
}

// ======== ホーム画面（ランチャー） ========
function HomeScreen({ profile, onLogout, onOpenApp }) {
  const apps = [
    { id:"groupware", name:"グループウェア", icon:"💬", desc:"お知らせ・チャット・アンケート", color:"#1a73e8", available:true },
    { id:"mimamori", name:"見守りナビ", icon:"👀", desc:"見守りスポット・カレンダー", color:"#0d9488", available:true, url:"https://mimamori-navi.vercel.app" },
    { id:"eventnavi", name:"イベントナビ", icon:"🎪", desc:"イベント管理・参加受付", color:"#d97706", available:true, url:"https://eventnavi.vercel.app" },
  ];

  const initial = (profile?.name || "?").charAt(0);

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
      <div style={{ background:CARD_BG, borderRadius:RADIUS, padding:"20px", border:`1px solid ${BORDER}`, marginBottom:20 }}>
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

      {/* アプリランチャー */}
      <div style={{ fontSize:15, fontWeight:700, color:TEXT, marginBottom:12 }}>アプリ</div>
      {apps.map(app => (
        <div key={app.id} onClick={()=>{
          if (app.available) {
            if (app.url) window.open(app.url, "_blank");
            else if (onOpenApp) onOpenApp(app.id);
          }
        }} style={{
          display:"flex", alignItems:"center", gap:14, padding:"16px 18px", borderRadius:RADIUS, background:CARD_BG,
          border:`1px solid ${BORDER}`, marginBottom:8, cursor: app.available ? "pointer" : "default",
          opacity: app.available ? 1 : 0.5, transition:"transform 0.1s",
        }}>
          <div style={{ width:48, height:48, borderRadius:14, background:`${app.color}15`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:26 }}>{app.icon}</div>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:15, fontWeight:700, color:TEXT }}>{app.name}</div>
            <div style={{ fontSize:12, color:TEXT2 }}>{app.desc}</div>
          </div>
          {app.available ? (
            <span style={{ color:app.color, fontSize:22 }}>›</span>
          ) : (
            <span style={{ fontSize:10, color:TEXT2, background:"#f1f5f9", padding:"4px 10px", borderRadius:8 }}>準備中</span>
          )}
        </div>
      ))}

      {/* ログアウト */}
      <button onClick={onLogout} style={{ width:"100%", padding:"14px", borderRadius:12, border:`1.5px solid ${BORDER}`, background:"#fff", color:"#dc2626", fontSize:14, fontWeight:600, cursor:"pointer", marginTop:20, fontFamily:"inherit" }}>ログアウト</button>
    </div>
  );
}
