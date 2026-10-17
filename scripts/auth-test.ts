// Testa as contas no Firebase: cria conta, grava/lê o perfil, entra de novo e apaga tudo no fim.
import { initializeApp } from "firebase/app";
import { createUserWithEmailAndPassword, deleteUser, getAuth, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { deleteDoc, doc, getDoc, getFirestore, setDoc } from "firebase/firestore";
import { FIREBASE_CONFIG } from "../src/net/config";

const app = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);
const db = getFirestore(app);
const email = `teste-pwm-${Date.now()}@exemplo.com`;
const pass = "senha-teste-123";
try {
  const cred = await createUserWithEmailAndPassword(auth, email, pass);
  console.log("ok: conta criada", cred.user.uid);
  const ref = doc(db, "profiles", cred.user.uid);
  await setDoc(ref, { name: "Teste", team_name: "Equipe Teste", stats: { races: 1 }, champ: null });
  console.log("ok: perfil gravado");
  const snap = await getDoc(ref);
  console.log("ok: perfil lido", JSON.stringify(snap.data()));
  // outro perfil não pode ser lido (regra)
  try {
    await getDoc(doc(db, "profiles", "outro-usuario"));
    console.log("ATENÇÃO: conseguiu ler perfil de outro (regra aberta demais)");
  } catch {
    console.log("ok: perfil de outro bloqueado pela regra");
  }
  await signOut(auth);
  const again = await signInWithEmailAndPassword(auth, email, pass);
  console.log("ok: entrou de novo");
  await deleteDoc(ref);
  await deleteUser(again.user);
  console.log("ok: conta de teste apagada");
} catch (e) {
  console.log("ERRO:", (e as { code?: string }).code, (e as Error).message);
}
process.exit(0);
