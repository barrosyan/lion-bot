import express from "express";
import fs from "fs/promises";
import path from "path";
import db from "../db.js";
import { askGemini } from "../services/geminiService.js";

const router = express.Router();

const LION_CONTEXT = `
A Lion Engenharia, fundada em 2021 por um visionário engenheiro eletricista, emergiu como uma força líder no setor de energia solar no Rio Grande do Norte. Com mais de 30 colaboradores e uma vasta gama de projetos, oferecemos desde a instalação até a manutenção de usinas solares, garantindo uma transição suave para energia renovável.

Informações da Empresa:
- CNPJ: 17.038.598/0001-00
- NOME FANTASIA: JORGE EDUARDO DE SOUZA LEAO JUNIOR LIMITADA
- Endereço: Avenida Senador João Câmara, 173, Centro, Parnamirim, RN – 59140160
- Contato: (84) 99938-7075 | comercial@lionengenharia.solar

Foco em qualidade, satisfação do cliente, tecnologia de ponta, e serviços como:
- Setor de Condomínios (Sustentabilidade e Valorização Comunitária)
- Setor Empresarial (Eficiência e Responsabilidade Corporativa)
- Setor Zona Rural (Potencializando a Agricultura)
- Setor Residencial (Conforto e Economia para o Lar)
- Projeto e Homologação (Projetos certificados)
- Monitoramento de Usina (Em tempo real)
- Instalação de Usina Solar (Implementação eficiente)
- Expansão de Painéis Solares (Aumentar capacidade)
A empresa tem mais de 100 projetos mensais e mais de 1.000 clientes satisfeitos.
`;

const WELCOME_MESSAGE = `
Olá!
Sou o assistente virtual da Lion Engenharia e estou aqui para ajudar com seu projeto de energia solar.
Por favor, **digite o CPF ou CNPJ do titular do contrato.**
`;

const MENU_PRINCIPAL_TEXT = (protocolId) => `
O Protocolo **${protocolId}** já está ativo. Para começar, por favor, digite o número da opção que melhor descreve sua necessidade:
[1] Consultar o Andamento do Meu Projeto (Engenharia/Cronograma)
[2] Suporte Técnico (Usina Parada, Alerta, Geração Baixa)
[3] Dúvidas sobre Contrato, Faturas da COSERN e Financeiro (Administrativo)
[4] Ajuda com o Aplicativo de Monitoramento (Suporte/TI)
[5] Outras Dúvidas ou Assuntos Não Listados (Geral/Triagem)

Se precisar de ajuda humana, digite **HUMANO**.
`;
const WATERMARK = "\n\nAtendimento Lion Engenharia 🌿";

const UPLOADS_DIR = path.join(process.cwd(), 'uploads'); 
const LOG_FILE_PATH = path.join(process.cwd(), 'lion_atendimento_log.csv');

function cleanCpfCnpj(cpfCnpj) {
    return (cpfCnpj || '').replace(/\D/g, '');
}
function parseData(row) {
    if (!row) return { history: [] };
    try { return row.data ? JSON.parse(row.data) : { history: [] }; } catch { return { history: [] }; }
}
function stringifyData(obj) { return JSON.stringify(obj || { history: [] }); }

function dbGet(query, params = []) {
    return new Promise((resolve, reject) => db.get(query, params, (err, row) => err ? reject(err) : resolve(row)));
}
function dbAll(query, params = []) {
    return new Promise((resolve, reject) => db.all(query, params, (err, rows) => err ? reject(err) : resolve(rows)));
}
function dbRun(query, params = []) {
    return new Promise((resolve, reject) => db.run(query, params, function(err) { err ? reject(err) : resolve(this); }));
}
async function generateProtocolId() {
    
    let row = await dbGet("SELECT last_number FROM protocol_sequence WHERE id = 1");
    let nextNumber = (row ? row.last_number : 0) + 1;

    await dbRun("UPDATE protocol_sequence SET last_number = ? WHERE id = 1", [nextNumber]);

    const date = new Date();
    const d = String(date.getDate()).padStart(2, '0');
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const y = date.getFullYear();
    const n = String(nextNumber).padStart(5, '0');
    
    return `LION-${d}${m}${y}-${n}`;
}
async function logToDb(phone, protocolId, eventType, description, sla) {
    const timestamp = Date.now();

    try {
        await dbRun(
            `INSERT INTO protocol_logs (
                phone, 
                protocol_id, 
                event_type, 
                description, 
                sla, 
                timestamp
            ) VALUES (?, ?, ?, ?, ?, ?)`,
            [
                phone,
                protocolId,
                eventType,
                description,
                sla,
                timestamp
            ]
        );
        console.log(`[DB LOG SUCESSO] Evento "${eventType}" registrado no banco de dados.`);

    } catch (error) {
        console.error(`[DB LOG ERRO] Falha ao registrar log no DB:`, error);
    }
}
async function saveMediaFile(conversationId, mediaMeta) { 
    if (!mediaMeta || !mediaMeta.path) {
        console.warn(`[MEDIA] Mídia Meta inválida ou sem path para a conversa ${conversationId}.`);
        return;
    }

    try {
        await fs.mkdir(UPLOADS_DIR, { recursive: true });

        const uniqueFilename = `${Date.now()}-${path.basename(mediaMeta.filename || 'file.dat')}`;
        const targetPath = path.join(UPLOADS_DIR, uniqueFilename);

        await fs.rename(mediaMeta.path, targetPath);
        
        const relativePath = path.join('uploads', uniqueFilename);

        await dbRun(
            `INSERT INTO media_files (
                conversation_id, 
                filename, 
                filepath, 
                mimetype, 
                uploaded_at
            ) VALUES (?, ?, ?, ?, ?)`,
            [
                conversationId, 
                mediaMeta.filename || uniqueFilename, 
                relativePath, 
                mediaMeta.contentType, 
                Date.now()
            ]
        );

        console.log(`[MEDIA SUCESSO] Mídia salva em: ${relativePath} e registrada no DB.`);

    } catch (error) {
        console.error(`[MEDIA ERRO] Falha ao salvar ou mover arquivo para a conversa ${conversationId}.`, error);
    }
}
async function saveConversationState(phone, newData, nextState, flow, historyEntries, newSummary) { 
    console.log(`[PERSISTÊNCIA] Tentando salvar estado para ${phone}. Novo Estado: ${nextState}`);
    const updatedHistory = (newData.history || []).concat(historyEntries);
    newData.history = updatedHistory.slice(-5); 
    
    try {
        await dbRun(
            "UPDATE conversations SET flow=?, state=?, data=?, long_term_summary=?, last_message_at=? WHERE phone=?",
            [flow, nextState, stringifyData(newData), newSummary || "", Date.now(), phone]
        );
        console.log(`[PERSISTÊNCIA SUCESSO] Estado salvo: ${nextState}.`);
    } catch (error) {
        console.error(`[PERSISTÊNCIA ERRO] Falha ao salvar estado para ${phone}. (Verifique se o DB está funcionando):`, error);
    }
}
async function summarizeConversation(conversation, askGemini) { 
    const MIN_HISTORY_LENGTH = 10;
    const currentHistory = conversation.data.history || [];

    if (currentHistory.length < MIN_HISTORY_LENGTH) {
        return { 
            newSummary: conversation.long_term_summary, 
            clearHistory: false
        };
    }

    const recentHistoryText = currentHistory.map(h => `${h.type} (${new Date(h.timestamp).toLocaleTimeString('pt-BR')}): ${h.text}`).join('\n');
    
    const systemPrompt = `
        Você é um assistente de IA focado em manter o contexto de conversas de atendimento ao cliente para a Lion Engenharia.
        Sua tarefa é ler o histórico recente (apenas as últimas interações) e o resumo de longo prazo existente.
        Condense e ATUALIZE essas informações, focando nos principais tópicos, problemas, acordos e solicitações do cliente.
        
        Regras:
        1. **Mantenha o tom objetivo** e focado em fatos (Protocolo, Problema Principal, Tentativas de Solução).
        2. O resultado deve ser um **texto conciso**, com no máximo 500 caracteres, para ser usado como memória futura.
        3. **NÃO responda ao cliente.** Apenas gere o texto de resumo.
    `;

    const userPrompt = `
        --- Resumo de Longo Prazo Existente (Não Modificar Se Vazio):
        ${conversation.long_term_summary || 'N/A'}
        
        --- Histórico Recente para Condensar (Máximo 5 Interações):
        ${recentHistoryText}
        
        Gere o NOVO resumo ATUALIZADO (máximo 500 caracteres):
    `;

    console.log(`[GEMINI SUMMARY] Solicitando novo resumo para ${currentHistory.length} interações...`);
    
    try {
        const geminiResponse = await askGemini(systemPrompt + userPrompt);
        const newSummaryText = geminiResponse.trim();
        
        if (newSummaryText.length > 5) {
            console.log(`[GEMINI SUMMARY] Sucesso. Histórico será limpo.`);
            return { 
                newSummary: newSummaryText, 
                clearHistory: true 
            };
        }

    } catch (error) {
        console.error("[GEMINI SUMMARY ERRO] Falha ao chamar Gemini para sumarização:", error);
    }
    
    return { 
        newSummary: conversation.long_term_summary, 
        clearHistory: false
    }; 
}
async function findClientAndProjects(cleanId) {
    const client = await dbGet("SELECT id, nome FROM clientes WHERE documento = ?", [cleanId]);
    if (!client) return null;
    const projects = await dbAll(
        "SELECT id, tipo, nome, percentual_conclusao, data, status_detalhado FROM projetos WHERE id_cliente = ?", 
        [client.id]
    );
    return { client, projects: projects || [] };
}
function formatProjectList(projects) {
    if (!projects || projects.length === 0) {
        return "Nenhum projeto foi encontrado para o seu cadastro.";
    }
    let list = "Projetos encontrados (selecione o número):\n";
    projects.forEach((p, index) => {
        list += `[${index + 1}] ${p.nome} (Status: ${p.percentual_conclusao}% concluído)\n`;
    });
    return list + "\nPor favor, digite o número do projeto para consultar o status.";
}
function formatProjectStatus(project) {
    return `
✅ *Detalhes do Projeto:*
*Nome/Etapa:* ${project.nome}
*Status que consta é:* ${project.status_detalhado || `${project.percentual_conclusao}% concluído`} 

Gostaria de confirmar: este status está correto ou você recebeu alguma informação mais recente?
`;
}
async function logUnidentifiedCall(protocolId, phone, description) {
    try {
        await dbRun(
            `INSERT INTO unidentified_calls (
                protocol_id, 
                phone, 
                issue_description, 
                created_at
            ) VALUES (?, ?, ?, ?)`,
            [
                protocolId,
                phone,
                description,
                Date.now()
            ]
        );
        console.log(`[DB CALL SUCESSO] Chamado não identificado (${protocolId}) registrado.`);

    } catch (error) {
        console.error(`[DB CALL ERRO] Falha ao registrar chamado não identificado:`, error);
    }
}
async function createEscalationTicket(protocolId, clientRef, phone, type, description, sla) {
    try {
        await dbRun(
            `INSERT INTO escalation_tickets (
                protocol_id, 
                client_ref, 
                phone, 
                type, 
                description, 
                sla, 
                created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                protocolId,
                clientRef,
                phone,
                type,
                description,
                sla,
                Date.now()
            ]
        );
        console.log(`[ESCALATION SUCESSO] Ticket de escalonamento (${protocolId}) registrado.`);

    } catch (error) {
        console.error(`[ESCALATION ERRO] Falha ao registrar ticket de escalonamento:`, error);
    }
}

router.post("/webhook", async (req, res) => {
    const { from, body, media } = req.body;
    const currentTime = Date.now();
    const oneHour = 60 * 60 * 1000;

    console.log(`\n--- REQUISIÇÃO RECEBIDA ---`);

    try {
        let row = await dbGet("SELECT * FROM conversations WHERE phone = ?", [from]);
        
        let conversation = null;
        let isNewConversation = !row;
        let replyText = "";
        let historyEntry = [];
        let nextState = "awaiting_identity";
        let newData = { flow: "welcome", protocolId: null };
        let currentFlow = "welcome";

        if (isNewConversation) {
            await dbRun(
                "INSERT INTO conversations (phone, flow, state, data, long_term_summary, last_message_at) VALUES (?, ?, ?, ?, ?, ?)",
                [from, "welcome", "awaiting_identity", stringifyData({ protocolId: null }), "", currentTime]
            );
            return res.json({ reply: WELCOME_MESSAGE });
        }

        conversation = {
            id: row.id,
            phone: row.phone,
            flow: row.flow,
            state: row.state,
            data: parseData(row),
            long_term_summary: row.long_term_summary,
            last_message_at: row.last_message_at
        };
        currentFlow = conversation.flow;
        nextState = conversation.state;
        newData = conversation.data;
        if (!newData.protocolId) { newData.protocolId = row.protocolId || null; }

        if (row.last_message_at && (currentTime - row.last_message_at > oneHour)) {
            await dbRun(
                "UPDATE conversations SET flow=?, state=?, data=?, last_message_at=? WHERE phone=?",
                ["welcome", "awaiting_identity", stringifyData({ protocolId: null }), currentTime, from]
            );
            return res.json({ reply: WELCOME_MESSAGE });
        }
        
        const { newSummary, clearHistory } = await summarizeConversation(conversation, askGemini);
        if (clearHistory) {
            conversation.long_term_summary = newSummary;
            conversation.data.history = [];
        }

        historyEntry.push({ type: "Cliente", text: body, timestamp: currentTime });
        
        const mediaMeta = media ? {
            filename: media.filename || `media-${Date.now()}`,
            path: media.path || media.url || `uploads/${Date.now()}-${media.filename}`,
            contentType: media.contentType || media.mimetype || "application/octet-stream"
        } : null;

        if (conversation.state === "awaiting_identity") {
            const cleanId = cleanCpfCnpj(body);
            
            if (cleanId.length < 11 || cleanId.length > 14) {
                replyText = "Número de Documento Inválido, por favor, tente novamente.";
            } else {
                const searchResult = await findClientAndProjects(cleanId);
                
                if (searchResult && searchResult.client) {
                    newData.cleanId = cleanId;
                    newData.clientName = searchResult.client.nome;
                    newData.projects = searchResult.projects;
                    newData.protocolId = await generateProtocolId(); 
                    
                    nextState = "awaiting_option"; 
                    replyText = `Obrigado! Cadastro localizado. O seu Protocolo de Atendimento é **${newData.protocolId}**.\n\n` + MENU_PRINCIPAL_TEXT(newData.protocolId);
                    
                    await logToDb(
                        from, 
                        newData.protocolId, 
                        'ID_FALHA_CHAMADO_ABERTO', 
                        'Cliente não identificado. Aguardando descrição do problema.', 
                        '2 dias úteis'
                    );
        
                    nextState = "awaiting_unidentified_description";
                    
                    replyText = `Ainda não conseguimos localizar seu cadastro. Para garantir o seu atendimento com o Protocolo **${newData.protocolId}**, por favor, **descreva sua solicitação em poucas palavras**.`;
                }
            }
        }
        
        else if (conversation.state === "awaiting_unidentified_description") {
            const issueDescription = body.trim().substring(0, 255);
            
            await logUnidentifiedCall(
                newData.protocolId,
                from,
                issueDescription
            );
    
            nextState = "awaiting_option"; 
            replyText = `Obrigado! Lembramos que sua solicitação foi registrada no Protocolo **${newData.protocolId}**. A equipe administrativa irá analisar o chamado e entrará em contato em até **2 dias úteis**.\n\n` + MENU_PRINCIPAL_TEXT(newData.protocolId);
        }


        else if (conversation.state === "awaiting_project_selection") {
            const projects = newData.projects;
            const projectIndex = parseInt(body.trim(), 10);
            
            if (isNaN(projectIndex) || projectIndex < 1 || projectIndex > projects.length) {
                if (body.trim().toLowerCase() === 'humano') {
                    nextState = "awaiting_human_confirmation";
                    replyText = "Apenas para economizar seu tempo, eu consigo te dar o Status do seu projeto e o Protocolo de Atendimento agora mesmo. Posso verificar isso antes de transferir?";
                } else {
                    replyText = `Opção inválida. Digite apenas o número do projeto (1 a ${projects.length}).\n\n` + formatProjectList(projects);
                }
            } else {
                const selectedProject = projects[projectIndex - 1]; 
                newData.selectedProject = selectedProject; 
                
                nextState = "awaiting_project_confirmation"; 
                replyText = formatProjectStatus(selectedProject) + "\n\n**Digite 'SIM' se o status estiver correto, ou 'NAO' se houver contradição.**";
            }
        }
        
        // 3. --- VALIDAÇÃO DO STATUS DO PROJETO (awaiting_project_confirmation) - FLUXO 1.1 ---
        else if (conversation.state === "awaiting_project_confirmation") {
            const project = newData.selectedProject;
            const clientReply = body.trim().toUpperCase();

            if (clientReply === "SIM") {
                nextState = "awaiting_option"; 
                replyText = `Que ótimo que o status está correto! Sua instalação está PRÉ-AGENDADA para ser concluída na **SEMANA [X]** (prazo contratual máximo). Faremos todos os esforços para antecipar este prazo.\n\n` + MENU_PRINCIPAL_TEXT(newData.protocolId);
            } else if (clientReply === "NAO" || clientReply === "NÃO") {
                
                await createEscalationTicket(
                    newData.protocolId,
                    newData.clientName,
                    from,
                    'PROJETO_CONTRADICAO',
                    `Contradição de status no Projeto ${project.nome}. Cliente enviou: ${body}`,
                    '4 a 8 horas úteis'
                );
                
                await logToDb(from, newData.protocolId, 'PROJETO_CONTRADICAO', `Contradição de status. SLA Crítico.`, '4 a 8 horas úteis');

                nextState = "awaiting_option"; 
                replyText = `Obrigado por nos alertar! Estou gerando um alerta de **prioridade máxima** para o atendente de Cronogramas, que entrará em contato em até **4 a 8 horas úteis**.\n\n` + MENU_PRINCIPAL_TEXT(newData.protocolId);
            
            } else {
                nextState = "awaiting_project_confirmation"; 
                replyText = "Resposta inválida. Por favor, digite **'SIM'** ou **'NAO'**.";
            }
        }

        // 4. --- ESCOLHA DE OPÇÃO (Menu Principal Nível 1) ---
        else if (conversation.state === "awaiting_option") {
            switch (body.trim().toUpperCase()) {
                case "1": 
                    const currentProjects = newData.projects || [];
                    if (currentProjects.length > 0) {
                        nextState = "awaiting_project_selection";
                        replyText = formatProjectList(currentProjects);
                    } else {
                        nextState = "awaiting_option";
                        replyText = `Não encontramos projetos ativos vinculados ao seu CPF/CNPJ. ${MENU_PRINCIPAL_TEXT(newData.protocolId)}`;
                    }
                    break;

                case "2": 
                    nextState = "awaiting_technical_description";
                    replyText = "Para agilizar o diagnóstico e acionar o técnico correto, por favor, **descreva em poucas palavras o que está acontecendo.**";
                    break;
                
                case "3": 
                    nextState = "awaiting_administrative_submenu";
                    replyText = `Assuntos administrativos. Sobre o que gostaria de falar?\n[3-1] Dúvidas sobre Contrato\n[3-2] Dúvidas sobre Faturas COSERN e Compensação\n[3-3] Financeiro e Notas Fiscais\n[3-9] Voltar ao menu anterior`;
                    break;
                
                case "4": 
                    nextState = "awaiting_app_submenu";
                    replyText = `Dúvidas sobre o aplicativo de monitoramento?\n[4-1] Como acessar o aplicativo pela primeira vez?\n[4-2] Como entender os gráficos de geração?\n[4-3] Esqueci minha senha\n[4-9] Voltar ao menu anterior`;
                    break;

                case "5": 
                    // Resposta Livre via Gemini (Tratamento Default/Geral)
                    nextState = "awaiting_option"; 
                    const longTermContext = conversation.long_term_summary ? `Contexto de conversas anteriores: ${conversation.long_term_summary}` : '';
                    const aiPrompt = `... [PROMPT GEMINI CONTEXTO INSTITUCIONAL/GERAL] ...`;
                    let aiReply = await askGemini(aiPrompt);
                    replyText = aiReply.trim() + WATERMARK;
                    break;
                
                case "HUMANO": 
                    nextState = "awaiting_human_confirmation";
                    replyText = "Apenas para economizar seu tempo, eu consigo te dar o Status do seu projeto e o Protocolo de Atendimento agora mesmo. Posso verificar isso antes de transferir?";
                    break;

                default: 
                    nextState = "awaiting_option";
                    replyText = "Opção inválida. Por favor, digite apenas o número da opção desejada." + MENU_PRINCIPAL_TEXT(newData.protocolId);
                    break;
            }
        } 
        
        // 5. --- FLUXO DE SUPORTE TÉCNICO (FLUXO 2) - TRIAGEM DETALHADA ---
        else if (conversation.state === "awaiting_technical_description") {
            const description = body.trim().toLowerCase();

            if (description.includes("infiltração") || description.includes("vazamento") || description.includes("goteira")) {
                newData.issueType = "RISCO_ESTRUTURAL_URGENTE";
                nextState = "awaiting_structural_files"; 
                replyText = "Devido ao **risco estrutural**, esta é uma ocorrência de **prioridade máxima**. Por favor, envie uma **foto/vídeo** para o registro da equipe técnica.";
            }
            else if (description.includes("desligou") || description.includes("parou") || description.includes("alerta") || description.includes("vermelha")) {
                newData.issueType = "PONTO_Z_CRITICO";
                nextState = "awaiting_breaker_status"; 
                replyText = "Entendido. Para analisar o problema, por favor, **confirme se o disjuntor da usina está LIGADO.**";
            }
            else if (description.includes("geração baixa") || description.includes("produzindo pouco")) {
                newData.issueType = "GERACAO_BAIXA";
                nextState = "awaiting_generation_files"; 
                replyText = "Certo. Para analisar a geração, precisamos das suas **últimas contas de energia e do Relatório de Geração Distribuída (COSERN/Distribuidora)**. Por favor, envie em seguida.";
            }
            else {
                // Tenta usar o Gemini para esclarecer a dúvida, mantendo o estado
                nextState = "awaiting_technical_description"; 
                const aiPrompt = `... [PROMPT GEMINI TRIAGEM TÉCNICA] ...`;
                let aiReply = await askGemini(aiPrompt);
                replyText = aiReply.trim() + "\n\nSe sua dúvida não foi resolvida, por favor, seja mais específico na descrição ou digite **HUMANO** para ser transferido." + WATERMARK;
            }
        }

        // 6. --- FLUXOS DE SUBMENU (FLUXO 3 e 4) - Respostas Automáticas/Registro ---
        else if (conversation.state === "awaiting_administrative_submenu" || conversation.state === "awaiting_app_submenu") {
            const flowNumber = conversation.state === "awaiting_administrative_submenu" ? '3' : '4';
            const option = body.trim();
            const protocol = newData.protocolId;
            
            if (option === `${flowNumber}-9`) {
                nextState = "awaiting_option";
                replyText = MENU_PRINCIPAL_TEXT(protocol);
            } else if (option.startsWith(flowNumber + '-')) {
                await logToDb(from, protocol, `SUBMENU_${option}`, `Solicitação administrativa/app.`, '2 dias úteis');

                nextState = "awaiting_option";
                let tempReply = "Sua solicitação foi registrada! Nossa equipe irá analisar e retornar o contato em **até 2 dias úteis**.\n\n";
                // Lógica de resposta rápida (vídeos, etc.)
                if (option === '4-1' || option === '4-2') { tempReply = `Ótima pergunta! Preparamos um vídeo curto que explica isso: [Link do Vídeo YouTube]. `} 
                
                replyText = tempReply + MENU_PRINCIPAL_TEXT(protocol);
            } else {
                nextState = conversation.state; 
                replyText = "Opção inválida. Por favor, escolha a opção desejada no submenu ou digite **HUMANO**."
            }
        }
        
        // 7. --- PROTOCOLO DE ESCALONAMENTO HUMANO (awaiting_human_confirmation) ---
        else if (conversation.state === "awaiting_human_confirmation") {
            const clientReply = body.trim().toUpperCase();

            if (clientReply === "SIM") {
                if (newData.projects && newData.projects.length > 0) {
                    nextState = "awaiting_project_selection";
                    replyText = formatProjectList(newData.projects);
                } else {
                    nextState = "awaiting_option";
                    replyText = MENU_PRINCIPAL_TEXT(newData.protocolId);
                }
            } else if (clientReply === "NAO" || clientReply === "NÃO") {
                await logToDb(from, newData.protocolId, 'ESCALONAMENTO_HUMANO', 'Cliente irredutível após Protocolo de Insistência.', 'Imediato');
                
                nextState = "awaiting_option"; 
                replyText = `Entendido. Estou transferindo seu atendimento. O atendente irá cumprimentá-lo com a seguinte saudação: "Olá, sou o [NOME], do suporte da Lion Engenharia. Vi aqui pelo Protocolo **${newData.protocolId}** que você está com [PROBLEMA]. Vou cuidar disso agora mesmo."\n\n` + MENU_PRINCIPAL_TEXT(newData.protocolId);

            } else {
                nextState = "awaiting_human_confirmation";
                replyText = "Resposta inválida. Por favor, digite 'SIM' ou 'NÃO'.";
            }
        }
        
        // 8. --- FLUXO 2: TRATAMENTO DE PONTO Z CRÍTICO (awaiting_breaker_status) ---
        else if (conversation.state === "awaiting_breaker_status") {
            const clientReply = body.trim().toUpperCase();

            if (clientReply === "SIM" || clientReply === "LIGADO") {
                await logToDb(from, newData.protocolId, 'TECNICO_PONTO_Z_CRITICO', 'Sistema Parado (Disjuntor LIGADO).', '4 a 8 horas úteis');
                nextState = "awaiting_option";
                replyText = `Obrigado por confirmar. Esta é uma ocorrência de **prioridade máxima**. Sua solicitação foi encaminhada para a equipe técnica e entraremos em contato em até **4 a 8 horas úteis**.\n\n` + MENU_PRINCIPAL_TEXT(newData.protocolId);
            } else if (clientReply === "NAO" || clientReply === "NÃO" || clientReply === "DESLIGADO") {
                await logToDb(from, newData.protocolId, 'TECNICO_PONTO_Z_DESLIGADO', 'Sistema Parado (Disjuntor DESLIGADO).', '4 a 8 horas úteis');
                nextState = "awaiting_option";
                replyText = `Entendido. Sua solicitação de suporte técnico foi registrada. Nossa equipe entrará em contato em até **4 a 8 horas úteis** para auxiliar na rechecagem do sistema.\n\n` + MENU_PRINCIPAL_TEXT(newData.protocolId);
            } else {
                nextState = "awaiting_breaker_status";
                replyText = "Resposta inválida. Por favor, confirme se o disjuntor está **LIGADO** ou **DESLIGADO**."
            }
        }
        
        // 9. --- FLUXO 2: TRATAMENTO DE RECEBIMENTO DE ARQUIVOS (MÍDIA/TEXTO) ---
        
        // Risco Estrutural (awaiting_structural_files)
        else if (conversation.state === "awaiting_structural_files" && (media || body)) {
            if (media) await saveMediaFile(conversation.id, mediaMeta); 
            await logToDb(from, newData.protocolId, 'TECNICO_RISCO_ESTRUTURAL', `Infiltração ou Vazamento. Arquivos recebidos.`, '4 a 8 horas úteis');
            nextState = "awaiting_option";
            replyText = "Recebemos seus arquivos. Este chamado já foi encaminhado com **prioridade máxima**. Aguarde o nosso contato, que será feito em até **4 a 8 horas úteis**." + MENU_PRINCIPAL_TEXT(newData.protocolId);
        }
        
        // Geração Baixa (awaiting_generation_files)
        else if (conversation.state === "awaiting_generation_files" && (media || body)) {
            if (media) await saveMediaFile(conversation.id, mediaMeta); 
            await logToDb(from, newData.protocolId, 'TECNICO_GERACAO_BAIXA', `Arquivos de conta/relatório recebidos.`, '4 a 8 horas úteis');
            nextState = "awaiting_option";
            replyText = "Documentos recebidos! Nossa equipe técnica irá analisar e retornará o contato em até **4 a 8 horas úteis**." + MENU_PRINCIPAL_TEXT(newData.protocolId);
        }

        // --- TRATAMENTO DEFAULT/GENÉRICO ---
        else {
            const aiPrompt = `... [PROMPT GEMINI DEFAULT] ...`;
            let aiReply = await askGemini(aiPrompt);
            replyText = aiReply.trim() + WATERMARK;
        }


        // --- SALVAMENTO E RESPOSTA FINAL ---
        if (replyText) {
            historyEntry.push({ type: "Assistente", text: replyText, timestamp: Date.now() });
            await saveConversationState(from, newData, nextState, currentFlow, historyEntry, conversation.long_term_summary);
            return res.json({ reply: replyText });
        } else {
            const errorReply = "Desculpe, ocorreu um erro de processamento. Por favor, tente voltar ao menu principal digitando 99." + WATERMARK;
            return res.status(500).json({ reply: errorReply });
        }

    } catch (err) {
        console.error(`[FATAL ERROR] Erro no webhook para ${from}:`, err);
        return res.status(500).json({ error: err.message });
    }
});

export default router;