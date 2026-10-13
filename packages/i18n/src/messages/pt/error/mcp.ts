import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/mcp";

export const messages = {
  "error.mcp.redirectByName": "Este endereço não pode ser acessado pelo nome.",
  "error.mcp.redirectGetOnly": "Este endereço responde somente a GET.",
  "error.mcp.redirectNotSignIn": "Este endereço não faz parte de um processo de entrada.",
  "error.mcp.redirectRefused": "A entrada foi recusada. Volte ao OpenBot e tente novamente.",
  "error.mcp.redirectNoSignIn": "Nenhum processo de entrada está aguardando isso. Ele pode ter terminado.",
  "error.mcp.redirectSignedIn": "O OpenBot está conectado. Você pode fechar esta janela.",
  "error.mcp.signInFileUnreadable": "O arquivo de autenticação MCP não pode ser lido.",
  "error.mcp.signInFileTooLarge": "O arquivo de autenticação MCP é muito grande.",
  "error.mcp.unsupported": "Este servidor não oferece suporte a servidores MCP.",
  "error.mcp.signInOnHost": "A autenticação em um servidor MCP só funciona no OpenBot do computador anfitrião.",
  "error.mcp.signInAppUnsupported":
    "Este servidor não é compatível com apps de autenticação. Atualize o OpenBot no host.",
  "error.mcp.redirectRelayed": "O OpenBot enviou a autenticação para o servidor. Você pode fechar esta janela.",
  "error.mcp.relayEnded": "Esta autenticação terminou. Inicie-a novamente.",
  "error.mcp.relayNoState":
    "A página de autenticação do servidor não protege o endereço de retorno, então o OpenBot não a abre neste computador.",
  "error.mcp.relayAddressInvalid":
    "Este não é o endereço do fim desta autenticação. Copie o endereço completo do navegador.",
} as const satisfies PartialTranslation<typeof source>;
