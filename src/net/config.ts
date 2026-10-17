// Firebase das contas dos jogadores (login por e-mail e senha + Firestore).
// Essa configuração é pública de propósito: quem protege os dados são as
// regras do Firestore (ver firestore.rules).
// apiKey vazia = sem contas: dá pra jogar sem conta.
export const FIREBASE_CONFIG = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  appId: "",
};
