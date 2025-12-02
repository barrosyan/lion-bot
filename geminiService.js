// src/services/geminiService.js
import fetch from "node-fetch";

/**
 * askGemini(prompt)
 * Retorna uma resposta gerada pelo modelo gemini-2.0-flash (texto curto e natural).
 * Requer a variável de ambiente GEMINI_API_KEY.
 */
export async function askGemini(prompt) {
    try {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            console.error("❌ GEMINI_API_KEY não configurada. Verifique seu arquivo .env.");
            throw new Error("GEMINI_API_KEY não configurada");
        }

        console.log(`[GEMINI DEBUG] Enviando prompt (Tamanho: ${prompt.length} chars) para Gemini...`);
        // console.log(`[GEMINI DEBUG] Prompt Completo: \n--- START PROMPT ---\n${prompt}\n--- END PROMPT ---`); // CUIDADO: Habilite apenas para depuração, pode ser muito log.

        const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";
        const body = {
            contents: [
                {
                    role: "user",
                    parts: [{ text: prompt }]
                }
            ],
            generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 256,
            }
        };

        const res = await fetch(`${url}?key=${apiKey}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });
        
        console.log(`[GEMINI DEBUG] Status da API: ${res.status}`);

        const json = await res.json();
        
        // Log para ver a resposta completa em caso de erro ou resposta vazia
        if (!res.ok || !json?.candidates?.[0]?.content?.parts?.[0]?.text) {
            console.error("[GEMINI DEBUG] RESPOSTA COMPLETA DA API (VERIFIQUE ERROS):", JSON.stringify(json, null, 2));
        }

        const text =
            json?.candidates?.[0]?.content?.parts?.[0]?.text ||
            json?.candidates?.[0]?.output_text ||
            "Desculpe, não consegui entender.";

        return text.trim();
    } catch (err) {
        console.error("❌ Erro Gemini:", err.message);
        return "Houve um erro ao consultar a IA. Pode repetir, por favor?";
    }
}