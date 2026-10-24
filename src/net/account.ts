// Conta do jogador (Firebase): login por e-mail e senha, perfil, estatísticas
// e campeonato solo salvo na nuvem. Sem Firebase configurado, o jogo funciona
// como antes (sem conta, tudo no navegador).
import { initializeApp, type FirebaseApp } from "firebase/app";
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type Auth,
  type User,
} from "firebase/auth";
import { collection, doc, getDoc, getDocs, getFirestore, serverTimestamp, setDoc, type Firestore } from "firebase/firestore";
import { FIREBASE_CONFIG } from "./config";

export interface PlayerStats {
  races: number;
  wins: number;
  podiums: number;
  poles: number;
  points: number;
  dnfs: number;
  titles: number;
  champs: number;
  best: number | null;
}

export interface Profile {
  id: string;
  name: string;
  team_name: string;
  stats: Partial<PlayerStats>;
  /** campeonatos salvos (id -> save) */
  champs: Record<string, unknown> | null;
  /** pintura do carro e emblema */
  livery?: unknown;
  /** melhor volta em cada pista (índice da pista -> tempo e piloto) */
  laps?: Record<string, { time: number; driver: string }>;
  /** amigos (ids das contas) */
  friends?: string[];
}

export const EMPTY_STATS: PlayerStats = { races: 0, wins: 0, podiums: 0, poles: 0, points: 0, dnfs: 0, titles: 0, champs: 0, best: null };

let fb: { app: FirebaseApp; auth: Auth; db: Firestore } | null = null;

export function accountsEnabled(): boolean {
  return !!FIREBASE_CONFIG.apiKey && !!FIREBASE_CONFIG.projectId;
}

function F() {
  if (!fb) {
    const app = initializeApp(FIREBASE_CONFIG);
    fb = { app, auth: getAuth(app), db: getFirestore(app) };
  }
  return fb;
}

class Account {
  user: User | null = null;
  profile: Profile | null = null;

  /** recupera a sessão salva no navegador */
  async restore(): Promise<boolean> {
    if (!accountsEnabled()) return false;
    const { auth } = F();
    this.user = await new Promise<User | null>((resolve) => {
      const off = onAuthStateChanged(auth, (u) => {
        off();
        resolve(u);
      });
    });
    if (this.user) await this.loadProfile();
    return !!this.user;
  }

  async signIn(email: string, password: string): Promise<string | null> {
    try {
      const cred = await signInWithEmailAndPassword(F().auth, email, password);
      this.user = cred.user;
      await this.loadProfile();
      return null;
    } catch (e) {
      return translate(e);
    }
  }

  async signUp(email: string, password: string, name: string, teamName = ""): Promise<string | null> {
    try {
      const cred = await createUserWithEmailAndPassword(F().auth, email, password);
      this.user = cred.user;
      await this.loadProfile(name, teamName);
      return null;
    } catch (e) {
      return translate(e);
    }
  }

  /** entra com a conta Google (abre uma janelinha do Google) */
  async signInGoogle(): Promise<string | null> {
    try {
      const cred = await signInWithPopup(F().auth, new GoogleAuthProvider());
      this.user = cred.user;
      await this.loadProfile(cred.user.displayName?.split(" ")[0] ?? undefined);
      return null;
    } catch (e) {
      return translate(e);
    }
  }

  async resetPassword(email: string): Promise<string | null> {
    try {
      await sendPasswordResetEmail(F().auth, email);
      return null;
    } catch (e) {
      return translate(e);
    }
  }

  async signOut() {
    if (accountsEnabled()) await signOut(F().auth);
    this.user = null;
    this.profile = null;
  }

  private ref() {
    return doc(F().db, "profiles", this.user!.uid);
  }

  private async loadProfile(name?: string, teamName?: string) {
    if (!this.user) return;
    const snap = await getDoc(this.ref());
    if (snap.exists()) {
      const d = snap.data();
      let champs: Record<string, unknown> | null = null;
      try {
        champs = d.champs ? JSON.parse(d.champs) : null;
        // save antigo (um campeonato só) vira o primeiro da lista
        if (!champs && d.champ) {
          const old = JSON.parse(d.champ) as { champ?: { id?: string; name?: string } };
          if (old?.champ) {
            old.champ.id ??= "antigo";
            old.champ.name ??= "Meu campeonato";
            champs = { [old.champ.id]: old };
          }
        }
      } catch {
        champs = null;
      }
      this.profile = { id: this.user.uid, name: d.name ?? "Engenheiro", team_name: d.team_name ?? "", stats: d.stats ?? {}, champs, laps: d.laps ?? {}, livery: d.livery ?? null, friends: Array.isArray(d.friends) ? d.friends : [] };
      void this.publish(); // aparece pros amigos (e no ranking) assim que entra
      return;
    }
    const fresh: Profile = {
      id: this.user.uid,
      name: name || this.user.email?.split("@")[0] || "Engenheiro",
      team_name: teamName ?? "",
      stats: {},
      champs: null,
    };
    this.profile = fresh;
    await setDoc(this.ref(), { name: fresh.name, team_name: fresh.team_name, stats: {}, champs: null, updated_at: serverTimestamp() });
    void this.publish();
  }

  private async save(patch: Partial<Profile>) {
    if (!this.user || !this.profile) return;
    Object.assign(this.profile, patch);
    // campeonato vai como texto (o Firestore não aceita listas dentro de listas)
    const data: Record<string, unknown> = { ...patch, updated_at: serverTimestamp() };
    if ("champs" in patch) data.champs = patch.champs ? JSON.stringify(patch.champs) : null;
    delete data.id;
    await setDoc(this.ref(), data, { merge: true }).catch((e) => console.warn("não salvou o perfil", e));
  }

  setNames(name: string, teamName: string) {
    if (this.profile && (this.profile.name !== name || this.profile.team_name !== teamName)) {
      void this.save({ name, team_name: teamName }).then(() => this.publish());
    }
  }

  /** pintura do carro e emblema na conta */
  saveLivery(livery: unknown) {
    void this.save({ livery });
    void this.publish();
  }

  /** campeonatos salvos na nuvem (junto do perfil) */
  saveChamps(champs: Record<string, unknown>) {
    void this.save({ champs });
  }

  /** soma o resultado de uma corrida nas estatísticas */
  recordRace(r: { finish: number | null; pole: boolean; points: number; title?: boolean; champDone?: boolean; lap?: { track: number; time: number; driver: string } }) {
    if (!this.profile) return;
    const s = { ...EMPTY_STATS, ...this.profile.stats };
    // recorde de volta por pista (pro ranking entre amigos)
    if (r.lap && r.lap.time > 0) {
      const laps = (this.profile.laps ??= {});
      const k = String(r.lap.track);
      if (!laps[k] || r.lap.time < laps[k].time) laps[k] = { time: Math.round(r.lap.time * 1000) / 1000, driver: r.lap.driver };
    }
    s.races++;
    if (r.finish === null) s.dnfs++;
    else {
      if (r.finish === 1) s.wins++;
      if (r.finish <= 3) s.podiums++;
      s.best = s.best === null ? r.finish : Math.min(s.best, r.finish);
    }
    if (r.pole) s.poles++;
    s.points += r.points;
    if (r.champDone) s.champs++;
    if (r.title) s.titles++;
    void this.save({ stats: s, laps: this.profile.laps ?? {} });
    void this.publish();
  }

  /** resumo público pro ranking entre amigos (coleção "leaderboard") */
  private async publish() {
    if (!this.user || !this.profile) return;
    const p = this.profile;
    await setDoc(
      doc(F().db, "leaderboard", this.user.uid),
      { name: p.name, team_name: p.team_name, stats: { ...EMPTY_STATS, ...p.stats }, laps: p.laps ?? {}, livery: p.livery ?? null, updated_at: serverTimestamp() },
      { merge: true },
    ).catch((e) => console.warn("ranking: não publicou", e));
  }

  /** código de amigo: começo do id da conta (6 letras/números) */
  friendCode(): string {
    return (this.user?.uid ?? "").slice(0, 6).toUpperCase();
  }

  /** adiciona um amigo pelo código; devolve o amigo ou uma mensagem de erro */
  async addFriend(code: string): Promise<RankRow | string> {
    const c = code.trim().toUpperCase();
    if (!this.profile || !this.user) return "Entre na sua conta pra adicionar amigos.";
    if (c.length !== 6) return "O código tem 6 letras/números.";
    if (c === this.friendCode()) return "Esse é o seu próprio código.";
    const rows = await this.ranking();
    if (rows === null) return "O ranking ainda não foi liberado no Firebase.";
    const f = rows.find((r) => r.id.slice(0, 6).toUpperCase() === c);
    if (!f) return "Não achei ninguém com esse código. Peça pro seu amigo entrar no jogo uma vez com a conta dele.";
    const list = this.profile.friends ?? [];
    if (list.includes(f.id)) return `${f.name} já está na sua lista.`;
    await this.save({ friends: [...list, f.id] });
    return f;
  }

  async removeFriend(id: string) {
    if (!this.profile) return;
    await this.save({ friends: (this.profile.friends ?? []).filter((x) => x !== id) });
  }

  /** ranking de todo mundo que joga (null = sem permissão: falta liberar a regra no Firebase) */
  async ranking(): Promise<RankRow[] | null> {
    if (!accountsEnabled() || !this.user) return [];
    try {
      const snap = await getDocs(collection(F().db, "leaderboard"));
      return snap.docs.map((d) => {
        const x = d.data();
        return { id: d.id, name: x.name ?? "?", team_name: x.team_name ?? "", stats: { ...EMPTY_STATS, ...(x.stats ?? {}) }, laps: x.laps ?? {}, livery: x.livery ?? null, updated: x.updated_at?.toMillis?.() ?? 0 };
      });
    } catch (e) {
      if ((e as { code?: string }).code === "permission-denied") return null;
      throw e;
    }
  }
}

export interface RankRow {
  id: string;
  name: string;
  team_name: string;
  stats: PlayerStats;
  laps: Record<string, { time: number; driver: string }>;
  livery?: unknown;
  /** última vez que entrou ou correu (ms) */
  updated?: number;
}

export const account = new Account();

function translate(e: unknown): string {
  const code = (e as { code?: string })?.code ?? "";
  if (/invalid-credential|wrong-password|user-not-found|invalid-login/.test(code)) return "E-mail ou senha errados.";
  if (/email-already-in-use/.test(code)) return "Esse e-mail já tem conta. É só entrar.";
  if (/weak-password/.test(code)) return "A senha precisa ter pelo menos 6 caracteres.";
  if (/invalid-email/.test(code)) return "Esse e-mail não parece válido.";
  if (/too-many-requests/.test(code)) return "Muitas tentativas. Espere um pouco e tente de novo.";
  if (/network/.test(code)) return "Sem conexão com o servidor de contas.";
  if (/operation-not-allowed/.test(code)) return "Esse tipo de login ainda não foi ligado no Firebase.";
  if (/popup-closed-by-user|cancelled-popup-request/.test(code)) return "Janela do Google fechada antes de terminar.";
  if (/popup-blocked/.test(code)) return "O navegador bloqueou a janela do Google. Libere pop-ups pra este site.";
  if (/unauthorized-domain/.test(code)) return "Este endereço ainda não está liberado no Firebase (Domínios autorizados).";
  return (e as Error)?.message ?? "Deu algum erro. Tente de novo.";
}
