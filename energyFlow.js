// Fluxo para problemas de geração / conta de energia

export function start() {
  return {
    issue_type: null,    // 'conta_nao_recebida' | 'geracao_baixa' | 'outro'
    description: null,
    attachments: [],     // fotos / pdfs
    meter_reading: null,
    invoice_date: null,
    created_at: new Date().toISOString()
  };
}

export async function onText(conversation, text) {
  const data = conversation.data || start();

  if (!data.issue_type) {
    // primeira mensagem: interpretar - o caller pode mapear por palavras-chave
    const lower = text.toLowerCase();
    let inferred = "outro";
    if (lower.includes("conta") || lower.includes("não recebeu") || lower.includes("nao recebeu")) inferred = "conta_nao_recebida";
    if (lower.includes("geração") || lower.includes("geracao") || lower.includes("gerando pouco")) inferred = "geracao_baixa";

    return {
      reply: `Entendi. Está relatando: *${inferred}*. Conte mais detalhes (ex.: desde quando percebeu a queda, valor da conta, etc.).`,
      nextState: "awaiting_details",
      save: { issue_type: inferred, description: text }
    };
  }

  // se tiver issue_type e descrição, solicitar anexos
  if (!data.attachments || data.attachments.length === 0) {
    return {
      reply: "Por favor, envie a foto ou PDF da conta (ou do inversor/leitura) para registrarmos no histórico.",
      nextState: "awaiting_attachments"
    };
  }

  // se já tinha anexos, perguntar se deseja que criemos análise
  return {
    reply: "Recebido. Deseja que eu abra uma solicitação para análise técnica/financeira? Responda 'sim' para abrir.",
    nextState: "awaiting_confirmation"
  };
}

export async function onMedia(conversation, mediaMeta) {
  const data = conversation.data || start();
  data.attachments.push(mediaMeta);

  return {
    reply: `Arquivo recebido (${data.attachments.length}). Envie mais arquivos ou responda 'pronto' para finalizar.`,
    nextState: "awaiting_attachments",
    save: { attachments: data.attachments }
  };
}

export function buildGronerPayload(conversation) {
  const data = conversation.data || start();
  return {
    tipo: "problema_geracao_conta",
    issue_type: data.issue_type,
    descricao: data.description,
    anexos: data.attachments,
    contato_telefone: conversation.phone,
    origem: "whatsapp_postvenda"
  };
}
