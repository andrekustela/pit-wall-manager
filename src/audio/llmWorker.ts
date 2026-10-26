// IA do rádio (texto) rodando fora do fio do jogo: carregar o modelo e gerar a resposta não
// travam a corrida. O WebLLM faz a ponte com a página.
import { WebWorkerMLCEngineHandler } from "@mlc-ai/web-llm";

const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (msg: MessageEvent) => handler.onmessage(msg);
