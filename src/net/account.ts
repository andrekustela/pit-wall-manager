// Conta do jogador (Supabase): login por e-mail e senha, perfil, estatísticas
// e campeonato solo salvo na nuvem. Sem Supabase configurado, o jogo funciona
// como antes (convidado, tudo no navegador).
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";

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
  champ: unknown | null;
}

export const EMPTY_STATS: PlayerStats = { races: 0, wins: 0, podiums: 0, poles: 0, points: 0, dnfs: 0, titles: 0, champs: 0, best: null };

let client: SupabaseClient | null = null;

export function accountsEnabled(): boolean {
  return !!SUPABASE_URL && !!SUPABASE_ANON_KEY;
}

function sb(): SupabaseClient {
  if (!client) client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
  return client;
}

class Account {
  user: User | null = null;
  profile: Profile | null = null;

  /** recupera a sessão salva no navegador */
  async restore(): Promise<boolean> {
    if (!accountsEnabled()) return false;
    const { data } = await sb().auth.getSession();
    this.user = data.session?.user ?? null;
    if (this.user) await this.loadProfile();
    return !!this.user;
  }

  async signIn(email: string, password: string): Promise<string | null> {
    const { data, error } = await sb().auth.signInWithPassword({ email, password });
    if (error) return translate(error.message);
    this.user = data.user;
    await this.loadProfile();
    return null;
  }

  /** cria a conta; devolve erro, ou "confirm" se o Supabase pedir confirmação por e-mail */
  async signUp(email: string, password: string, name: string, teamName = ""): Promise<string | null> {
    const { data, error } = await sb().auth.signUp({ email, password, options: { data: { name, team_name: teamName } } });
    if (error) return translate(error.message);
    if (!data.session) return "confirm";
    this.user = data.user;
    await this.loadProfile(name, teamName);
    return null;
  }

  async resetPassword(email: string): Promise<string | null> {
    const { error } = await sb().auth.resetPasswordForEmail(email, { redirectTo: location.origin });
    return error ? translate(error.message) : null;
  }

  async signOut() {
    if (accountsEnabled()) await sb().auth.signOut();
    this.user = null;
    this.profile = null;
  }

  private async loadProfile(name?: string, teamName?: string) {
    if (!this.user) return;
    const { data } = await sb().from("profiles").select("*").eq("id", this.user.id).maybeSingle();
    if (data) {
      this.profile = data as Profile;
      return;
    }
    const fresh: Profile = {
      id: this.user.id,
      name: name || (this.user.user_metadata?.name as string) || this.user.email?.split("@")[0] || "Engenheiro",
      team_name: teamName ?? ((this.user.user_metadata?.team_name as string) || ""),
      stats: {},
      champ: null,
    };
    await sb().from("profiles").insert(fresh);
    this.profile = fresh;
  }

  private async save(patch: Partial<Profile>) {
    if (!this.user || !this.profile) return;
    Object.assign(this.profile, patch);
    await sb()
      .from("profiles")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", this.user.id);
  }

  setNames(name: string, teamName: string) {
    if (this.profile && (this.profile.name !== name || this.profile.team_name !== teamName)) void this.save({ name, team_name: teamName });
  }

  saveChamp(champ: unknown | null) {
    void this.save({ champ });
  }

  /** soma o resultado de uma corrida nas estatísticas */
  recordRace(r: { finish: number | null; pole: boolean; points: number; title?: boolean; champDone?: boolean }) {
    if (!this.profile) return;
    const s = { ...EMPTY_STATS, ...this.profile.stats };
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
    void this.save({ stats: s });
  }
}

export const account = new Account();

function translate(msg: string): string {
  if (/invalid login/i.test(msg)) return "E-mail ou senha errados.";
  if (/already registered|already been registered/i.test(msg)) return "Esse e-mail já tem conta. É só entrar.";
  if (/password should be at least/i.test(msg)) return "A senha precisa ter pelo menos 6 caracteres.";
  if (/email not confirmed/i.test(msg)) return "Falta confirmar o e-mail (veja sua caixa de entrada).";
  if (/invalid email|unable to validate email/i.test(msg)) return "Esse e-mail não parece válido.";
  if (/rate limit|too many/i.test(msg)) return "Muitas tentativas. Espere um pouco e tente de novo.";
  return msg;
}
