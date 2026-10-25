// Ponte mínima com a página: só avisa que o jogo está rodando no programa de PC
// (o menu esconde o botão "Baixar pro PC" e o de instalar pelo navegador).
const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("pwmDesktop", { app: "pc" });
