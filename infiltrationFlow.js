// ESM module
// fluxo de infiltração: coleta descrição, fotos, endereço (opcional) e prefere horário.
// conversation: { id, phone, flow, state, data } where data is parsed JSON or null

export function start() {
  return {
    description: null,
    photos: [],        // array of { filename, path, contentType }
    address: null,
    preferred_date: null,
    preferred_time: null,
    created_at: new Date().toISOString()
  };
}

export async function onText(conversation, text) {
  const data = conversation.data || start();

  // state handling based on conversation.state is in caller; here we return actions
  if (!data.description) {
    // treat incoming as description
    return {
      reply: "Entendi. Pode me descrever com mais detalhes o local da infiltração? (ex.: teto da sala, parede norte, área externa)",
      nextState: "awaiting_description",
      save: { description: text }
    };
  }

  if (!data.address) {
    return {
      reply: "Obrigado. Por favor, informe o endereço ou confirme se é o mesmo do cadastro.",
      nextState: "awaiting_address",
      save: { address: text }
    };
  }

  if (!data.preferred_date) {
    return {
      reply: "Alguma data preferida para a visita técnica? Responda no formato DD/MM/AAAA ou diga 'sem preferência'.",
      nextState: "awaiting_date",
      save: { preferred_date: text }
    };
  }

  if (!data.preferred_time) {
    return {
      reply: "Algum horário preferido? (manhã / tarde / horário específico HH:MM) ou 'sem preferência'.",
      nextState: "awaiting_time",
      save: { preferred_time: text }
    };
  }

  // se já tiver tudo
  return {
    reply: "Recebemos suas informações. Agora, por favor, envie fotos do local (2–4 fotos).",
    nextState: "awaiting_photos"
  };
}

export async function onMedia(conversation, mediaMeta) {
  // mediaMeta: { filename, path, contentType }
  const data = conversation.data || start();
  data.photos.push(mediaMeta);

  // após 2 fotos sugerimos confirmar; se quiser mais, o cliente pode enviar
  const count = data.photos.length;
  const replies = [];
  if (count < 2) {
    replies.push(`Foto recebida (${count}). Envie mais 1–3 fotos para melhor avaliação.`);
    return {
      reply: replies.join("\n"),
      nextState: "awaiting_photos",
      save: { photos: data.photos }
    };
  }

  replies.push(`Recebemos ${count} fotos. Deseja que eu agende a visita técnica agora? Responda 'sim' para agendar ou 'alterar' para modificar dados.`);
  return {
    reply: replies.join("\n"),
    nextState: "awaiting_confirmation",
    save: { photos: data.photos }
  };
}

export function buildGronerPayload(conversation) {0
  const data = conversation.data || start();
  // Exemplo genérico; ajuste campos conforme mapping do cliente/tenant Groner
  return {
    tipo: "infiltracao",
    descricao: data.description || "",
    endereco: data.address || "",
    preferred_date: data.preferred_date || null,
    preferred_time: data.preferred_time || null,
    anexos: data.photos || [],
    origem: "whatsapp_postvenda",
    contato_telefone: conversation.phone
  };
}
