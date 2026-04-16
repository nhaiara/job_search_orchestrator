import { GoogleGenAI } from "@google/genai";

const getAI = (apiKey?: string) => {
  return new GoogleGenAI({ apiKey: apiKey || process.env.GEMINI_API_KEY || '' });
};

async function withRetry<T>(
  fn: () => Promise<T>, 
  modelName: string, 
  hasCustomKey: boolean,
  maxRetries = 5, 
  initialDelay = 5000
): Promise<T> {
  let lastError: any;
  const keyStatus = hasCustomKey ? 'Custom API Key' : 'Default Shared Key';
  console.log(`[Gemini Call] Using model "${modelName}" with ${keyStatus}`);
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      const errorStr = JSON.stringify(error).toLowerCase();
      const message = (error.message || '').toLowerCase();
      const status = error.status || (error.error?.code);
      
      const isRateLimit = 
        message.includes('429') || 
        message.includes('resource_exhausted') ||
        message.includes('quota') ||
        status === 429 || 
        errorStr.includes('429') ||
        errorStr.includes('resource_exhausted') ||
        errorStr.includes('quota exceeded');

      if (isRateLimit && i < maxRetries - 1) {
        const delay = initialDelay * Math.pow(2, i);
        console.warn(`[Gemini Quota] Hit limit for model "${modelName}" using ${keyStatus}. Retrying in ${delay}ms... (Attempt ${i + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      if (isRateLimit) {
        console.error(`[Gemini Quota Critical] Quota exhausted for model "${modelName}" using ${keyStatus} after ${maxRetries} attempts.`);
      }
      
      throw error;
    }
  }
  throw lastError;
}

export async function analyzeJobMatch(jobDescription: string, cvContent: string, apiKey?: string, modelName?: string) {
  const ai = getAI(apiKey);
  const model = modelName || "gemini-2.5-flash";
  const prompt = `
    Atue como Analista de Aquisição de Talentos Sênior. Você deve cruzar a JOB DESCRIPTION com o MASTER PROFILE da candidata (Nhaiara Moura) e retornar o nível de Match.
    
    CV MASTER (V17):
    ${cvContent}
    
    JOB DESCRIPTION:
    ${jobDescription}

    REGRAS DE ANÁLISE:
    Regra 1: Vetos (Hard Filters) - 0% Match (Classifique como "Discard")
    Veto aplicável se:
    - Exigir idioma Alemão fluente ou JD escrita em Alemão.
    - Indústria fora de Software (ex: QA laboratório, civil, mecânica).
    - Exigir escrita de código para produção (Hands-on SWE), desenvolvimento de APIs para produção, ou experiência em criação de ERPs (SAP/Oracle/Workday).

    Regra 2: Princípio da Evidência Explícita (Anti-Alucinação)
    Se a JD pede um requisito (ferramenta, responsabilidade) que NÃO ESTÁ listado no Master Profile, a nota para esse requisito é ZERO. Nunca presuma experiência por contexto.

    Regra 3: Cálculo de Pontuação Parcial (Máximo 100)
    A - Domínio & Skill (Até 50 pts): Exige Platform, SRE, Quality, AI/MLOps, Fintech ou SaaS? Stack alinha com perfil?
    B - Escopo & Impacto (Até 30 pts): É posição de liderança (EM/Director) ou IC estratégico (Staff/Lead Quality/SRE)?
    C - Logística & Fit (Até 20 pts): Berlim ou 100% Remoto = 20 pts. Híbrido/Presencial fora de Berlim = 0 a 5 pts.

    Regra 4: Classificação por Tiers (Defina com base na soma das notas)
    - Diamond: 80 a 100
    - Gold: 50 a 79
    - Silver: 30 a 49
    - Discard: 0 a 29 (ou se Veto ativado)

    AÇÃO EXTRA PARA DIAMOND:
    Se o tier for "Diamond", elabore de 2 a 4 perguntas curtas e diretas para a candidata responder, com o objetivo de capturar nuances específicas exigidas na JD para enriquecer a Cover Letter e os bullets do CV.

    Retorne APENAS um JSON válido seguindo este esquema exato:
    {
      "tier": "Diamond|Gold|Silver|Discard",
      "scores": {
        "domain": 0,
        "scope": 0,
        "logistics": 0
      },
      "totalScore": 0,
      "reason": "Motivo focado na evidência explícita",
      "goldenPillar": "Nome do pilar mais aderente",
      "company": "Nome da empresa",
      "role": "Título do cargo",
      "location": "Localização",
      "diamondQuestions": ["Pergunta 1?", "Pergunta 2?"] // Retorne array vazio [] se não for Diamond
    }
  `;

  const response = await withRetry(() => ai.models.generateContent({
    model,
    contents: prompt,
    config: { responseMimeType: "application/json" }
  }), model, !!apiKey);

  const text = response.text || "{}";
  return JSON.parse(text);
}

export async function generateDiamond(jobDescription: string, cvContent: string, userAnswers: string, clTemplate?: string, apiKey?: string, modelName?: string) {
  const ai = getAI(apiKey);
  const model = modelName || "gemini-2.5-flash";
  const prompt = `
    Atue como meu Estrategista de Carreira Executiva. Aplicação NÍVEL DIAMOND.
    ⚠️ NUNCA alucine fatos. Use APENAS o Master Profile V17.
    
    CV MASTER (V17):
    ${cvContent}
    
    JOB DESCRIPTION:
    ${jobDescription}

    RESPOSTAS DA CANDIDATA ÀS PERGUNTAS DE ALINHAMENTO:
    ${userAnswers}
    
    ${clTemplate ? `MODELO DE COVER LETTER BASE (Use como guia de tom e estrutura, mas adapte totalmente aos fatos e respostas):\n${clTemplate}` : ''}
    
    Tarefa:
    Gere os textos exatos para substituir no template Diamond.
    1. CUSTOM_HEADLINE: Título focado na JD.
    2. SUMMARY: Executive Summary focado na dor da vaga e nas respostas dadas (máx 4 linhas).
    3. SKILLS (1 a 4): 4 Core Competencies da JD cruzadas com meu perfil (Nome e Descrição).
    4. EXP_TAXFIX, EXP_MIMI, EXP_TECHLEAD, EXP_SDET: Reescreva os bullets de experiência destas empresas focando APENAS em fatos reais úteis para esta vaga, utilizando os insights das respostas.
    5. Cover Letter: Crie os 3 parágrafos (Hook Chaos-to-order, Storytelling com métricas, Closing focado em AI).
    
    Retorne APENAS um JSON com estas chaves exatas:
    {
      "CUSTOM_HEADLINE": "...",
      "SUMMARY": "...",
      "SKILL_NAME1": "...", "SKILL_DESCRIPTION1": "...",
      "SKILL_NAME2": "...", "SKILL_DESCRIPTION2": "...",
      "SKILL_NAME3": "...", "SKILL_DESCRIPTION3": "...",
      "SKILL_NAME4": "...", "SKILL_DESCRIPTION4": "...",
      "EXP_TAXFIX": "...",
      "EXP_MIMI": "...",
      "EXP_TECHLEAD": "...",
      "EXP_SDET": "...",
      "DIAMOND_HOOK": "...",
      "DIAMOND_STORY": "...",
      "DIAMOND_CLOSING": "..."
    }
  `;

  const response = await withRetry(() => ai.models.generateContent({
    model,
    contents: prompt,
    config: { responseMimeType: "application/json" }
  }), model, !!apiKey);

  const text = response.text || "{}";
  return JSON.parse(text);
}

export async function generateGold(jobDescription: string, cvContent: string, clTemplate?: string, apiKey?: string, modelName?: string) {
  const ai = getAI(apiKey);
  const model = modelName || "gemini-2.5-flash";
  const prompt = `
    Atue como meu Estrategista de Carreira Executiva. Aplicação NÍVEL GOLD (ATS).
    ⚠️ NUNCA alucine fatos. Use APENAS o Master Profile V17.
    
    CV MASTER (V17):
    ${cvContent}
    
    JOB DESCRIPTION:
    ${jobDescription}
    
    ${clTemplate ? `MODELO DE COVER LETTER BASE (Use como guia de tom e estrutura, mas mapeie o GOLD_REASON dentro deste contexto):\n${clTemplate}` : ''}
    
    Tarefa:
    1. Crie TUNED_HEADLINE focada na JD.
    2. Crie TUNED_SUMMARY (3 linhas) com densidade máxima de keywords REAIS.
    3. Escolha 3 pilares exatos do perfil (HEADLINER_PILLAR 1, 2, 3) e descreva o match (PILLAR_DESCRIPTION 1, 2, 3).
    4. Crie o GOLD_REASON: Um parágrafo direto mapeando 1 fato do CV para 1 requisito chave da JD para a Cover Letter.
    
    Retorne APENAS um JSON com estas chaves exatas:
    {
      "TUNED_HEADLINE": "...",
      "TUNED_SUMMARY": "...",
      "HEADLINER_PILLAR1": "...", "PILLAR_DESCRIPTION1": "...",
      "HEADLINER_PILLAR2": "...", "PILLAR_DESCRIPTION2": "...",
      "HEADLINER_PILLAR3": "...", "PILLAR_DESCRIPTION3": "...",
      "GOLD_REASON": "..."
    }
  `;

  const response = await withRetry(() => ai.models.generateContent({
    model,
    contents: prompt,
    config: { responseMimeType: "application/json" }
  }), model, !!apiKey);

  const text = response.text || "{}";
  return JSON.parse(text);
}

export async function generateSilver(jobDescription: string, cvContent: string, apiKey?: string, modelName?: string) {
  const ai = getAI(apiKey);
  const model = modelName || "gemini-2.5-flash";
  const prompt = `
    Atue como meu Estrategista de Carreira. Aplicação NÍVEL SILVER.
    ⚠️ NUNCA alucine fatos. Use APENAS o Master Profile V17.
    
    CV MASTER (V17):
    ${cvContent}
    
    JOB DESCRIPTION:
    ${jobDescription}
    
    Tarefa:
    Escreva uma 'Application Note' (SHORT_COVER_LETTER_PLACE_HOLDER) estilo e-mail/LinkedIn (máx 150 palavras).
    Destaque a disponibilidade para iniciar em maio e faça conexão com o pilar técnico mais alinhado entre o CV e a JD.
    
    Retorne APENAS um JSON com esta chave exata:
    {
      "SHORT_COVER_LETTER_PLACE_HOLDER": "..."
    }
  `;

  const response = await withRetry(() => ai.models.generateContent({
    model,
    contents: prompt,
    config: { responseMimeType: "application/json" }
  }), model, !!apiKey);

  const text = response.text || "{}";
  return JSON.parse(text);
}

export const analyzeJob = analyzeJobMatch;
