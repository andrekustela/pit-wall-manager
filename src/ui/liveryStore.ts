// Onde fica a pintura do jogador: na conta (se tiver) e no navegador.
import { account } from "../net/account";
import { cleanLivery, type Livery } from "../sim/livery";
import { storeGet, storeSet } from "./common";

export function getLivery(): Livery | null {
  const fromAccount = cleanLivery(account.profile?.livery);
  if (fromAccount) return fromAccount;
  try {
    return cleanLivery(JSON.parse(storeGet("pwm.livery") || "null"));
  } catch {
    return null;
  }
}

/** salva (null = volta pras cores originais da equipe) */
export function setLivery(l: Livery | null) {
  storeSet("pwm.livery", l ? JSON.stringify(l) : "");
  if (account.profile) {
    account.profile.livery = l;
    account.saveLivery(l);
  }
}
