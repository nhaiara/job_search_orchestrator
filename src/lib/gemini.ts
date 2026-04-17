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

export interface TagDefinition {
  name: string;
  instruction: string;
}

export interface GenerationRules {
  tags: TagDefinition[];
  globalRules: string;
  silverPrompt: string;
  goldPrompt: string;
  diamondPrompt: string;
}

const DEFAULT_GLOBAL_RULES = `Language: English (US/UK professional).
Tone: Professional, authoritative, and data-driven.
Terminology: Use modern IT industry standards (e.g., SDLC, Scalability, Stakeholder Management, Agile).
Style: Georgia size 12, Titles in Navy Blue (#002B49).
Date Format: European standard (e.g., 16 April 2026 or 16/04/2026).
Job Title Sanitization: Extract only the core role name from {{JOB_TITLE}}. Explicitly remove suffixes like "(all genders)", "(m/f/d)", or any gender-neutral/specific tagging.`;

const DEFAULT_TAGS = [
  { name: 'DATE', instruction: 'Gere a data atual no formato padrão europeu (ex: 16 April 2026).' },
  { name: 'JOB_TITLE', instruction: 'Extraia o nome principal do cargo da JD, removendo sufixos de gênero (all genders, m/f/d).' },
  { name: 'COMPANY_NAME', instruction: 'Extraia o nome da empresa contratante.' },
  { name: 'HIRING_MANAGER', instruction: 'Extraia o nome do recrutador ou Hiring Manager, se disponível. Caso contrário use "Hiring Team".' }
];

function buildRulesPrompt(rules?: GenerationRules) {
  const global = rules?.globalRules || DEFAULT_GLOBAL_RULES;
  const tags = rules?.tags || DEFAULT_TAGS;
  
  return `
    REGRAS GLOBAIS DE GERAÇÃO:
    ${global}

    INSTRUÇÕES PARA TAGS ESPECÍFICAS:
    ${tags.map(t => `- ${t.name}: ${t.instruction}`).join('\n')}
  `;
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
    Regra 0: Sanitização do Título (MANDATÓRIO)
    Extraia apenas o nome principal do cargo em {{JOB_TITLE}}. Remova explicitamente sufixos como "(all genders)", "(m/f/d)", "(f/m/d)", ou qualquer tag de gênero/neutra. Retorne no campo "role".

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
      "hiringManager": "Nome do Hiring Manager ou Recrutador (se mencionado, senão 'Hiring Team')",
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

export async function generateDiamond(jobDescription: string, cvContent: string, userAnswers: string, clTemplate?: string, apiKey?: string, modelName?: string, rules?: GenerationRules) {
  const ai = getAI(apiKey);
  const model = modelName || "gemini-2.5-flash";
  const rulesPrompt = buildRulesPrompt(rules);
  const tierPrompt = rules?.diamondPrompt || `
    Gere os textos exatos para substituir no template Diamond.
    1. CUSTOM_HEADLINE: Foco em alta senioridade e inovação.
    2. SUMMARY: Visão estratégica e foco em mentoria (máx 4 linhas).
    3. SKILLS (1 a 4): Resolução de problemas em larga escala (Nome e Descrição).
    4. EXPERIÊNCIAS (Reflita os insights das respostas da candidata):
       - EXP_TAXFIX: Foco em Fintech/Compliance.
       - EXP_MIMI: Foco em Product-driven/HealthTech.
       - EXP_TECHLEAD: Foco em Team Health e Tech Debt.
       - EXP_SDET: Foco em Automação e CI/CD Excellence.
    5. Cover Letter: Hook "Chaos-to-order", Storytelling personalizado com métricas e fechamento estratégico.
  `;

  const prompt = `
    Atue como meu Estrategista de Carreira Executiva. Aplicação NÍVEL DIAMOND (Storytelling de Alto Impacto).
    ⚠️ NUNCA alucine fatos. Use APENAS o Master Profile.
    
    ${rulesPrompt}

    CV MASTER:
    ${cvContent}
    
    JOB DESCRIPTION:
    ${jobDescription}

    RESPOSTAS DA CANDIDATA ÀS PERGUNTAS DE ALINHAMENTO (USE PARA CUSTOMIZAR TODO O CONTEÚDO):
    ${userAnswers}
    
    ${clTemplate ? `MODELO DE COVER LETTER BASE (Use como guia de estrutura):\n${clTemplate}` : ''}
    
    TAREFA ESPECÍFICA DIAMOND:
    ${tierPrompt}
    
    Retorne APENAS um JSON com TODAS as chaves necessárias (Tags globais definidas acima + chaves específicas do prompt Diamond).
  `;

  const response = await withRetry(() => ai.models.generateContent({
    model,
    contents: prompt,
    config: { responseMimeType: "application/json" }
  }), model, !!apiKey);

  const text = response.text || "{}";
  return JSON.parse(text);
}

export async function generateGold(jobDescription: string, cvContent: string, companyName: string, clTemplate?: string, apiKey?: string, modelName?: string, rules?: GenerationRules) {
  const ai = getAI(apiKey);
  const model = modelName || "gemini-2.5-flash";
  const rulesPrompt = buildRulesPrompt(rules);
  const tierPrompt = rules?.goldPrompt || `
    1. TUNED_HEADLINE: Título de uma linha (Role + Value Prop).
    2. TUNED_SUMMARY: Resumo de 4 linhas focado em liderança e impacto no negócio.
    3. Escolha 3 competências centrais (HEADLINER_PILLAR 1, 2, 3) e forneça descrições de impacto (PILLAR_DESCRIPTION 1, 2, 3).
    4. GOLD_REASON: Você DEVE completar a seguinte estrutura de frase obrigatória: "I am particularly drawn to ${companyName} because of [MOTIVO_AQUI]. "
  `;

  const prompt = `
    Atue como meu Estrategista de Carreira Executiva. Aplicação NÍVEL GOLD (Strategic Alignment).
    ⚠️ NUNCA alucine fatos. Use APENAS o Master Profile.
    
    ${rulesPrompt}

    CV MASTER:
    ${cvContent}
    
    JOB DESCRIPTION:
    ${jobDescription}
    
    ${clTemplate ? `MODELO DE COVER LETTER BASE:\n${clTemplate}` : ''}
    
    TAREFA ESPECÍFICA GOLD:
    ${tierPrompt}
    
    Retorne APENAS um JSON com TODAS as chaves necessárias (Tags globais definidas acima + chaves específicas do prompt Gold).
  `;

  const response = await withRetry(() => ai.models.generateContent({
    model,
    contents: prompt,
    config: { responseMimeType: "application/json" }
  }), model, !!apiKey);

  const text = response.text || "{}";
  return JSON.parse(text);
}

export async function generateSilver(jobDescription: string, cvContent: string, apiKey?: string, modelName?: string, rules?: GenerationRules) {
  const ai = getAI(apiKey);
  const model = modelName || "gemini-2.5-flash";
  const rulesPrompt = buildRulesPrompt(rules);
  const tierPrompt = rules?.silverPrompt || `
    Escreva uma "Application Note" (SHORT_COVER_LETTER_PLACE_HOLDER) direcionada ao time de recrutamento. Deve funcionar como um e-mail curto e impactante.
    MÁXIMO de 2 parágrafos:
    - Parágrafo 1: Saudação profissional e declaração direta de contribuição/proposta de valor para o cargo.
    - Parágrafo 2: Breve resumo de como seu perfil específico resolve um ponto de dor chave mencionado na JD.
  `;

  const prompt = `
    Atue como meu Estrategista de Carreira. Aplicação NÍVEL SILVER (Application Note).
    ⚠️ NUNCA alucine fatos. Use APENAS o Master Profile.

    ${rulesPrompt}
    
    CV MASTER:
    ${cvContent}
    
    JOB DESCRIPTION:
    ${jobDescription}
    
    TAREFA ESPECÍFICA SILVER:
    ${tierPrompt}
    
    Retorne APENAS um JSON with TODAS as chaves necessárias (Tags globais definidas acima + chaves específicas do prompt Silver).
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
