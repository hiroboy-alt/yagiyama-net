import { initializeApp } from "firebase/app";
import { getAuth, setPersistence, browserLocalPersistence } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyBUMYSL31nao-X60sgj1SaDT3uVdoklGo8",
  authDomain: "yagiyama-net.firebaseapp.com",
  projectId: "yagiyama-net",
  storageBucket: "yagiyama-net.firebasestorage.app",
  messagingSenderId: "521005930868",
  appId: "1:521005930868:web:ec8d8afb837114ad833421"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
// パスワードリセットなどFirebaseが自動送信するメールを日本語にする
auth.languageCode = "ja";
// 認証状態を localStorage に永続化（ブラウザを閉じてもログイン維持。明示的ログアウトのみで切断）
setPersistence(auth, browserLocalPersistence).catch(e => console.error("Auth persistence設定エラー:", e));
export const db = getFirestore(app);
export const storage = getStorage(app);
export default app;

// イベントナビのFirestore（イベントデータ用）
const eventnaviConfig = {
  apiKey: "AIzaSyDdk3OWqTuBiS7s55IMRgawMHmWHNjYvjo",
  authDomain: "eventnavi-c4b4e.firebaseapp.com",
  projectId: "eventnavi-c4b4e",
  storageBucket: "eventnavi-c4b4e.firebasestorage.app",
  messagingSenderId: "640639639010",
  appId: "1:640639639010:web:ed6cfa5cd451aa07ffedbb",
};
const eventnaviApp = initializeApp(eventnaviConfig, "eventnavi");
export const eventnaviDb = getFirestore(eventnaviApp);

// 見守りナビのFirestore（登録・特別日データ用）
const mimamoriConfig = {
  apiKey: "AIzaSyD1cLdOir9tuhRdUlv5GqR0N0FY3KiWUs4",
  authDomain: "mimamori-navi-306da.firebaseapp.com",
  projectId: "mimamori-navi-306da",
  storageBucket: "mimamori-navi-306da.firebasestorage.app",
  messagingSenderId: "934421674856",
  appId: "1:934421674856:web:9752a528c3d2b98ecf74dd",
};
const mimamoriApp = initializeApp(mimamoriConfig, "mimamori");
export const mimamoriDb = getFirestore(mimamoriApp);
