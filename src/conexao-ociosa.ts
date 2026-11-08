import { inspect } from 'node:util';
// redigir.js, não logger.js: o logger calcula as pastas ao ser carregado, e este arquivo carrega no começo do
// comando muxor, antes de ele apontar para ~/.muxor/dados (o init chegou a ler um catálogo vazio por isso).
import { redact } from './redigir.js';

// Conexões HTTP que o servidor fecha por ficarem paradas (ex.: o MCP do Funifier PM enquanto você digita outra coisa).
// No Node 26 o fetch usa HTTP/2 e, quando a sessão ociosa expira, emite um 'error' sem ninguém ouvindo: o processo
// inteiro caía ("socket idle timeout", UND_ERR_INFO). A conexão já está morta e quem usa reconecta na próxima chamada
// (McpConexao), então esse erro é só registrado. Qualquer outro erro não tratado continua derrubando o processo.
export function ehConexaoOciosa(e: unknown) {
  const x = e as { code?: string; message?: string } | null;
  return x?.code === 'UND_ERR_INFO' || /socket idle timeout/i.test(x?.message ?? '');
}

export function tolerarConexaoOciosa(registrar: (e: Error) => void) {
  process.on('uncaughtException', (e) => {
    if (ehConexaoOciosa(e)) return registrar(e);
    console.error(redact(inspect(e)));
    process.exit(1);
  });
}
