import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

const DEFAULT_RULES = `1. Altíssima: Fintech + AI/Data + Berlin ou remoto + Senioridade (Manager/Team Lead) + ≥80% de match entre os requisitos/responsabilidades e meu perfil master. Status sugerido: "💎 Manual".
2. Alta: AI Platform + hibrida + ≥70% de match entre os requisitos/responsabilidades e meu perfil master. Status sugerido: "🤖 Auto".
3. Média: Vagas de EM puro ou fora de Berlim + entre 50% e 70% de match entre os requisitos/responsabilidades e meu perfil master. Status sugerido: "🤖 Auto".
4. Baixa: Gaps técnicos profundos (C++, Embedded) ou + <50% de match entre os requisitos/responsabilidades e meu perfil master. Status sugerido: "🤖 Auto".
5. Incompatível: Se a vaga exigir Alemão (Must-have). Status sugerido: "🗑️ Descartada".`;

export async function analyzeJob(jobDescription: string, masterProfile: string, customRules: string) {
  const prompt = `
    Contexto: Sou a Nhaiara Moura, EM sênior com foco em AI Orchestration, Chaos-to-Order leadership, Fintech e Platform.
    
    Sua Missão: Atue como meu Analista de Estratégia de Carreira. Você deve processar as novas vagas e classificar qual é meu nivel de match com a vaga anunciada, para que baseado no padrão de match, eu decida qual o esforço manual e customização de aplicação vou usar.
    
    PERFIL MASTER 7.0:
    ${masterProfile}
    
    REGRAS DE CLASSIFICAÇÃO:
    ${customRules || DEFAULT_RULES}

    JOB DESCRIPTION:
    ${jobDescription}

    Sua missão é realizar um Match Analysis rigoroso.
    Identifique o Gap Principal (Ponto Fraco) e o Pilar Abre-Alas (Ponto Forte) do Perfil Master que deve ser o "Headliner" da aplicação.
    
    Retorne APENAS um JSON no seguinte formato:
    {
      "matchScore": "Altíssima" | "Alta" | "Média" | "Baixa" | "Incompatível",
      "gapAnalysis": "Análise do Gap Principal (Ponto Fraco)",
      "openingStrategy": "Estratégia de abertura para a Cover Letter",
      "keyStack": "Lista das tecnologias principais exigidas (Stack Chave)",
      "suggestedStatus": "💎 Manual" | "🤖 Auto" | "🗑️ Descartada",
      "pilarAbreAlas": "Qual dos meus 3 Pilares de Força deve ser o Headliner",
      "company": "Nome da empresa",
      "role": "Título do cargo",
      "location": "Localização",
      "link": "URL real para aplicação. Procure no texto por links próximos a palavras-chave como 'Apply', 'Application', 'Candidatar-se', 'Link' ou em botões descritos no texto. Priorize links de plataformas de recrutamento (Lever, Greenhouse, Workday, etc). Se não encontrar, deixe vazio.",
      "matchReasoning": "Breve explicação da classificação baseada nas Regras de Ouro"
    }
  `;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
  });

  const text = response.text;
  if (!text) throw new Error("No response from Gemini");

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  return jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(text);
}

export async function generateLevel1Questions(jobDescription: string, masterProfile: string, cvContent: string) {
  const prompt = `
    Atue como um Especialista em Recrutamento de Elite (Headhunter) focado em Engineering Management em Berlim. 
    Tenho uma vaga de Altíssimo Match e quero que você me ajude a criar a aplicação perfeita.
    
    Contexto: Use meu 'Perfil Master' e meu CV como base para customização.
    
    PERFIL MASTER:
    ${masterProfile}
    
    CV ATUAL:
    ${cvContent}
    
    JOB DESCRIPTION:
    ${jobDescription}
    
    Tarefa:
    1. Analise a JD e identifique as 3 competências 'críticas' que eles buscam e que estão escondidas nas entrelinhas.
    2. Faça-me 3 a 5 perguntas específicas sobre minha experiência (especialmente Taxfix e Mimi) para que eu possa te dar 'munição' real e dados quantitativos que batam com essa JD.
    
    Retorne APENAS um JSON no seguinte formato:
    {
      "criticalCompetencies": ["comp1", "comp2", "comp3"],
      "questions": ["pergunta 1", "pergunta 2", "pergunta 3", ...]
    }
  `;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
  });

  const text = response.text;
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  return jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(text);
}

export async function generateLevel1Final(jobDescription: string, masterProfile: string, cvContent: string, answers: string) {
  const prompt = `
    Atue como um Especialista em Recrutamento de Elite (Headhunter) focado em Engineering Management em Berlim.
    
    Contexto: Use meu 'Perfil Master', meu CV e minhas respostas abaixo como base para customização total.
    
    PERFIL MASTER:
    ${masterProfile}
    
    CV ATUAL:
    ${cvContent}
    
    JOB DESCRIPTION:
    ${jobDescription}
    
    MINHAS RESPOSTAS ÀS SUAS PERGUNTAS:
    ${answers}
    
    Tarefa:
    1. Reescrever minhas experiências profissionais do CV focando no que eu fiz em cada empresa que seja diretamente conectado com a vaga em análise, deixando o CV limpo, sem muito para ler além daquilo que realmente importa para o hiring manager da vaga, conectando as respostas que eu forneci que possam ser úteis para minha aplicação.
    2. Criar uma Cover Letter 'Storytelling' que conecte algum pilar ou habilidade minha com algum requisito da vaga, mostrando que eu prestei atenção na vaga anunciada.
    
    Retorne APENAS um JSON no seguinte formato:
    {
      "tunedCV": "Conteúdo do CV em Markdown",
      "coverLetter": "Conteúdo da Cover Letter em Markdown"
    }
  `;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
  });

  const text = response.text;
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  return jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(text);
}

export async function generateLevel2(jobDescription: string, masterProfile: string, cvContent: string) {
  const prompt = `
    Atue como meu Coach de Carreira. Quero aplicar para uma vaga de Alta Prioridade de forma eficiente.
    
    Contexto: Use meu 'Perfil Master' e meu CV como base para customização do resumo profissional.
    
    PERFIL MASTER:
    ${masterProfile}
    
    CV ATUAL:
    ${cvContent}
    
    JOB DESCRIPTION:
    ${jobDescription}
    
    Tarefa:
    1. Gere uma versão 'Tuned' do meu resumo profissional (Professional Summary) que use as palavras-chave desta JD, mas mantenha a estrutura base do meu CV.
    2. Identifique qual dos meus Pilares de Força deve ser o protagonista nesta aplicação (Headliner).
    3. Escreva uma Cover Letter direta, profissional e elegante (máximo 3 parágrafos com frases curtas e simples de ler) focada em como resolvi problemas similares aos citados na descrição da vaga.
    
    Retorne APENAS um JSON no seguinte formato:
    {
      "tunedSummary": "Resumo profissional tunado",
      "headliner": "Pilar protagonista",
      "tunedCV": "Conteúdo do CV completo com o resumo atualizado em Markdown",
      "coverLetter": "Conteúdo da Cover Letter em Markdown"
    }
  `;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
  });

  const text = response.text;
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  return jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(text);
}

export async function generateLevel3(jobDescription: string, cvContent: string) {
  const prompt = `
    Atue como meu Assistente de Aplicação. Vou fazer uma aplicação rápida para esta vaga.
    
    Contexto: Use meu CV padrão.
    
    CV PADRÃO:
    ${cvContent}
    
    JOB DESCRIPTION:
    ${jobDescription}
    
    Tarefa:
    1. Escreva uma 'Short Cover Letter' (estilo corpo de e-mail ou nota de aplicação do LinkedIn) de no máximo 150 palavras.
    2. Adicione uma seção “apresentação” no currículo com essa informação, antes do resumo profissional.
    3. Destaque o pilar mais forte do meu perfil.
    4. Não altere detalhes do meu CV original além da nova seção.
    
    Retorne APENAS um JSON no seguinte formato:
    {
      "shortCoverLetter": "Cover Letter curta",
      "tunedCV": "Conteúdo do CV com a seção de apresentação adicionada em Markdown",
      "coverLetter": "Conteúdo da Cover Letter (mesmo que shortCoverLetter) em Markdown"
    }
  `;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
  });

  const text = response.text;
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  return jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(text);
}
