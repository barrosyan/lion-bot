// Fluxo para lista de compensação (rateio)

export function start() {
  return {
    accounts: [],      // array com objetos {account_number, invoice_file?}
    titularidade_confirmed: null,
    contract_data: null,
    attachments: [],
    created_at: new Date().toISOString()
  };
}

export async function onText(conversation, text) {
  const data = conversation.data || start();

  // se não recebeu lista de contas, interpreta o texto como lista ou instrução
  if (!data.accounts || data.accounts.length === 0) {
    // tentativa simples: separe por vírgula números/identificadores
    const parts = text.split(/,|\n/).map(p => p.trim()).filter(Boolean);
    if (parts.length > 0) {
      const accounts = parts.map(p => ({ identifier: p }));
      return {
        reply: `Recebi as contas: ${parts.join(", ")}. As contas estão na titularidade da unidade geradora? (responda 'sim' ou 'não')`,
        nextState: "awaiting_titularity",
        save: { accounts }
      };
    }

    return {
      reply: "Por favor, envie a lista de contas (pode separar por vírgula ou pular linhas).",
      nextState: "awaiting_accounts"
    };
  }

  if (data.titularidade_confirmed === null) {
    return {
      reply: "As contas estão na titularidade da unidade geradora? Responda 'sim' ou 'não'.",
      nextState: "awaiting_titularity"
    };
  }

  if (data.titularidade_confirmed === false) {
    return {
      reply: "Nesse caso, oriento realizar a transferência/alteração de titularidade. Quando concluir, envie 'pronto' e encaminharemos os passos para inclusão na lista de compensação.",
      nextState: "awaiting_transfer"
    };
  }

  if (!data.contract_data) {
    return {
      reply: "Por favor, envie os dados do contrato e/ou documentos necessários (PDFs).",
      nextState: "awaiting_contract"
    };
  }

  // caso tudo ok, confirmar envio para Groner
  return {
    reply: "Obrigado — vou consolidar as informações e abrir a solicitação de rateio. Deseja prosseguir? (responda 'sim')",
    nextState: "awaiting_confirmation"
  };
}

export async function onMedia(conversation, mediaMeta) {
  const data = conversation.data || start();
  data.attachments.push(mediaMeta);
  return {
    reply: `Arquivo recebido (${data.attachments.length}). Envie mais ou responda 'pronto' quando terminar.`,
    nextState: "awaiting_contract",
    save: { attachments: data.attachments }
  };
}

export function buildGronerPayload(conversation) {
  const data = conversation.data || start();
  return {
    tipo: "lista_compensacao",
    accounts: data.accounts,
    titularidade_confirmed: data.titularidade_confirmed,
    contract_data: data.contract_data,
    anexos: data.attachments || [],
    contato_telefone: conversation.phone,
    origem: "whatsapp_postvenda"
  };
}
