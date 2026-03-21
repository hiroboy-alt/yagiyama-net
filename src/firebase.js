import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

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
export const db = getFirestore(app);
export default app;
