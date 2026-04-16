import { GoogleGenAI } from "@google/genai";
import { useState, useEffect } from 'react';
import { doc, getDoc, setDoc, serverTimestamp, collection, query, getDocs, deleteDoc, updateDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { useAuth } from '../hooks/useAuth';
import { motion } from 'motion/react';
import { Save, UserCircle, FileText, Code, Zap, Plus, AlertCircle, RefreshCw, Sparkles, X } from 'lucide-react';
import { AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { extractFileId } from '../lib/driveUtils';
import { analyzeJobMatch } from '../lib/gemini';

const DEFAULT_RULES = `1. Altíssima: Fintech + AI/Data + Berlin ou remoto + Senioridade (Manager/Team Lead) + ≥80% de match entre os requisitos/responsabilidades e meu perfil master. Status sugerido: "💎 Manual".
2. Alta: AI Platform + hibrida + ≥70% de match entre os requisitos/responsabilidades e meu perfil master. Status sugerido: "🤖 Auto".
3. Média: Vagas de EM puro ou fora de Berlim + entre 50% e 70% de match entre os requisitos/responsabilidades e meu perfil master. Status sugerido: "🤖 Auto".
4. Baixa: Gaps técnicos profundos (C++, Embedded) ou + <50% de match entre os requisitos/responsabilidades e meu perfil master. Status sugerido: "🤖 Auto".
5. Incompatível: Se a vaga exigir Alemão (Must-have). Status sugerido: "🗑️ Descarte".`;

export default function AppSettings() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState({
    masterProfile: '',
    masterProfileFileId: '',
    customRules: DEFAULT_RULES,
    driveFolderId: '',
    outputFolderId: '',
    processedFolderId: '',
    cvDiamondFileId: '',
    cvGoldFileId: '',
    cvSilverFileId: '',
    clDiamondFileId: '',
    clGoldFileId: '',
    geminiApiKey: '',
    geminiModel: 'gemini-2.5-flash'
  });
  const [syncingProfile, setSyncingProfile] = useState(false);
  const [googleTokens, setGoogleTokens] = useState<any>(() => {
    const saved = localStorage.getItem('google_drive_tokens');
    return saved ? JSON.parse(saved) : null;
  });

  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [cleaning, setCleaning] = useState(false);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'GOOGLE_AUTH_SUCCESS') {
        const tokens = event.data.tokens;
        setGoogleTokens(tokens);
        localStorage.setItem('google_drive_tokens', JSON.stringify(tokens));
        setNotification({ message: 'Google Drive conectado com sucesso!', type: 'success' });
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  useEffect(() => {
    if (!user) return;

    const fetchProfile = async () => {
      const path = `users/${user.uid}`;
      try {
        const docRef = doc(db, path);
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
          const data = docSnap.data();
          setProfile(prev => ({ 
            ...prev, 
            ...data,
            customRules: data.customRules || DEFAULT_RULES
          }));
        }
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, path);
      } finally {
        setLoading(false);
      }
    };

    fetchProfile();
  }, [user]);

  const [testingKey, setTestingKey] = useState(false);

  const [isCustomModel, setIsCustomModel] = useState(false);

  useEffect(() => {
    if (profile.geminiModel && !['gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-2.0-flash-exp', 'gemini-3-flash'].includes(profile.geminiModel)) {
      setIsCustomModel(true);
    }
  }, [profile.geminiModel]);

  const handleTestKey = async () => {
    if (!profile.geminiApiKey) {
      setNotification({ message: 'Insira uma chave primeiro.', type: 'error' });
      return;
    }
    setTestingKey(true);
    const modelName = profile.geminiModel || "gemini-2.5-flash";
    console.log(`[Gemini Test] Testing key with model: ${modelName} (Custom API Key)`);
    try {
      const ai = new GoogleGenAI({ apiKey: profile.geminiApiKey });
      const model = ai.models.generateContent({
        model: modelName,
        contents: "Respond with 'OK' if you can hear me.",
      });
      const response = await model;
      if (response.text?.includes('OK')) {
        console.log(`[Gemini Test Success] Key validated successfully for model: ${modelName}`);
        setNotification({ message: 'Chave validada com sucesso!', type: 'success' });
      } else {
        throw new Error('Resposta inesperada da IA.');
      }
    } catch (error: any) {
      console.error('Error testing Gemini key:', error);
      setNotification({ message: `Erro na chave: ${error.message}`, type: 'error' });
    } finally {
      setTestingKey(false);
    }
  };

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    try {
      // Clean up IDs before saving
      const cleanedProfile = {
        ...profile,
        masterProfileFileId: extractFileId(profile.masterProfileFileId),
        cvDiamondFileId: extractFileId(profile.cvDiamondFileId),
        cvGoldFileId: extractFileId(profile.cvGoldFileId),
        cvSilverFileId: extractFileId(profile.cvSilverFileId),
        clDiamondFileId: extractFileId(profile.clDiamondFileId),
        clGoldFileId: extractFileId(profile.clGoldFileId),
        driveFolderId: extractFileId(profile.driveFolderId),
        outputFolderId: extractFileId(profile.outputFolderId),
        processedFolderId: extractFileId(profile.processedFolderId)
      };

      const path = `users/${user.uid}`;
      try {
        await setDoc(doc(db, path), {
          ...cleanedProfile,
          uid: user.uid,
          name: user.displayName,
          email: user.email,
          updatedAt: serverTimestamp()
        }, { merge: true });
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, path);
      }
      
      setProfile(cleanedProfile);
      setNotification({ message: 'Configurações salvas com sucesso!', type: 'success' });
    } catch (error) {
      console.error('Error saving profile:', error);
      setNotification({ message: 'Erro ao salvar configurações.', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleConnectGoogle = async () => {
    try {
      const response = await fetch('/api/auth/google/url');
      const { url } = await response.json();
      window.open(url, 'google_auth', 'width=600,height=700');
    } catch (error) {
      setNotification({ message: 'Erro ao conectar com Google Drive.', type: 'error' });
    }
  };

  const handleSyncProfile = async () => {
    if (!profile.masterProfileFileId) {
      setNotification({ message: 'Insira o Link ou ID do arquivo primeiro.', type: 'error' });
      return;
    }

    if (!googleTokens) {
      handleConnectGoogle();
      return;
    }

    setSyncingProfile(true);
    try {
      const fileId = extractFileId(profile.masterProfileFileId);
      const response = await fetch('/api/get-drive-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          fileId,
          accessToken: googleTokens?.access_token
        })
      });

      const data = await response.json();
      if (data.error) throw new Error(data.error);

      setProfile(prev => ({ ...prev, masterProfile: data.content, masterProfileFileId: fileId }));
      setNotification({ message: 'Perfil Master sincronizado com o Drive!', type: 'success' });
    } catch (error: any) {
      console.error('Error syncing profile from drive:', error);
      setNotification({ message: `Erro ao sincronizar: ${error.message}`, type: 'error' });
    } finally {
      setSyncingProfile(false);
    }
  };

  const handleCleanupDuplicates = async () => {
    if (!user) return;
    setCleaning(true);
    setNotification({ message: 'Analisando duplicadas no banco de dados...', type: 'success' });
    try {
      const q = query(collection(db, `users/${user.uid}/applications`));
      const snapshot = await getDocs(q);
      const allApps = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));
      
      const seenIds = new Set();
      const seenContents = new Set();
      const toDelete = [];

      // Sort by updatedAt desc to keep the most recent/updated ones
      allApps.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

      for (const app of allApps) {
        const content = app.jobDescription?.trim();
        const driveId = app.driveFileId;
        
        let isDuplicate = false;
        if (driveId && seenIds.has(driveId)) isDuplicate = true;
        if (content && seenContents.has(content)) isDuplicate = true;

        if (isDuplicate) {
          toDelete.push(app.id);
        } else {
          if (driveId) seenIds.add(driveId);
          if (content) seenContents.add(content);
        }
      }

      if (toDelete.length > 0) {
        for (const id of toDelete) {
          const path = `users/${user.uid}/applications/${id}`;
          try {
            await deleteDoc(doc(db, path));
          } catch (error) {
            handleFirestoreError(error, OperationType.DELETE, path);
          }
        }
        setNotification({ message: `${toDelete.length} duplicadas removidas com sucesso!`, type: 'success' });
      } else {
        setNotification({ message: 'Nenhuma duplicada encontrada.', type: 'success' });
      }
    } catch (error: any) {
      console.error('Error cleaning duplicates:', error);
      setNotification({ message: `Erro ao limpar: ${error.message}`, type: 'error' });
    } finally {
      setCleaning(false);
    }
  };

  const handleReanalyzeAll = async () => {
    if (!user) return;
    setCleaning(true);
    setNotification({ message: 'Iniciando reanálise em lote...', type: 'success' });
    try {
      const userPath = `users/${user.uid}`;
      let userData;
      try {
        const userDoc = await getDoc(doc(db, userPath));
        userData = userDoc.data();
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, userPath);
      }
      
      const masterProfile = userData?.masterProfile || '';
      const customRules = userData?.customRules || '';
      const geminiApiKey = userData?.geminiApiKey || '';

      const appsPath = `users/${user.uid}/applications`;
      let snapshot;
      try {
        const q = query(collection(db, appsPath));
        snapshot = await getDocs(q);
      } catch (error) {
        handleFirestoreError(error, OperationType.LIST, appsPath);
      }
      
      const allApps = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));

      // Filter eligible apps: 
      // 1. NOT in final states (Pronto, Enviada, Entrevista, feedback, Rejeitada)
      // 2. If Discarded, only allow if it was an automatic discard (Incompatible) and NOT manual (no discardReason)
      const eligibleApps = allApps.filter(app => {
        const isFinalState = ['✅ Aplicar', '📩 Triagem', '🤝 Sucesso', '❌ Rejeitada'].includes(app.status);
        if (isFinalState) return false;
        
        if (app.status === '🗑️ Descarte') {
          // Allow re-analysis only if it was an automatic discard without a manual reason
          return app.matchScore === 'Discard' && !app.discardReason;
        }
        
        return true;
      });

      if (eligibleApps.length === 0) {
        setNotification({ message: 'Nenhuma vaga elegível para reanálise encontrada.', type: 'success' });
        return;
      }

      let count = 0;
      const geminiModel = userData?.geminiModel || 'gemini-2.5-flash';
      for (const app of eligibleApps) {
        try {
          const analysis = await analyzeJobMatch(app.jobDescription, masterProfile, geminiApiKey, geminiModel);
          const status = analysis.tier === 'Diamond' ? '⏳ Input IA' : 
                         analysis.tier === 'Discard' ? '🗑️ Descarte' : 
                         '⚙️ Gerar Docs';

          await updateDoc(doc(db, `users/${user.uid}/applications`, app.id), {
            company: analysis.company || app.company,
            role: analysis.role || app.role,
            location: analysis.location || app.location,
            matchScore: analysis.tier,
            totalScore: analysis.totalScore,
            matchReasoning: analysis.reason,
            goldenPillar: analysis.goldenPillar,
            diamondQuestions: analysis.diamondQuestions || [],
            status: status,
            updatedAt: new Date().toISOString()
          });
          count++;
          setNotification({ message: `Processando: ${count}/${eligibleApps.length}`, type: 'success' });
          
          // Delay to respect rate limits
          // Default: 6s (10 RPM) for shared key
          // Custom Key: 1s (60 RPM) - safe even for basic paid tiers
          const delay = geminiApiKey ? 1000 : 6000;
          if (count < eligibleApps.length) {
            await new Promise(r => setTimeout(r, delay));
          }
        } catch (e) {
          console.error(`Error reanalyzing app ${app.id}:`, e);
        }
      }

      setNotification({ message: `Reanálise concluída! ${count} vagas atualizadas com base no novo perfil/regras.`, type: 'success' });
    } catch (error: any) {
      console.error('Error in batch reanalysis:', error);
      setNotification({ message: `Erro na reanálise: ${error.message}`, type: 'error' });
    } finally {
      setCleaning(false);
    }
  };

  const handleMigrateStatuses = async () => {
    if (!user) return;
    setCleaning(true);
    setNotification({ message: 'Iniciando migração de status...', type: 'success' });
    try {
      const appsPath = `users/${user.uid}/applications`;
      const q = query(collection(db, appsPath));
      const snapshot = await getDocs(q);
      const allApps = snapshot.docs.map(doc => ({ id: doc.id, status: doc.data().status }));

      const statusMap: Record<string, string> = {
        '📥 Nova: Pendente IA': '📥 Nova',
        '⏳ Input IA: Aguarda Respostas': '⏳ Input IA',
        '⏳ Pendente Input (Diamond)': '⏳ Input IA',
        '⚙️ Gerar Docs: Match Pronto': '⚙️ Gerar Docs',
        '⚙️ Pendente Geração de Docs': '⚙️ Gerar Docs',
        '✅ Aplicar: Arquivos Criados': '✅ Aplicar',
        '✅ Pendente Envio': '✅ Aplicar',
        '📩 Triagem: CV Enviado': '📩 Triagem',
        '📩 Em Triagem': '📩 Triagem',
        '🕰️ Feedback: Pós-Entrevista': '🕰️ Feedback',
        '🗣️ Entrevistas: Papos Ativos': '🗣️ Entrevistas',
        '🏆 Proposta: Em Negociação': '🏆 Proposta',
        '🤝 Sucesso: Oferta Aceita': '🤝 Sucesso',
        '❌ Rejeitada: Não Passamos': '❌ Rejeitada',
        '🗑️ Descarte: Veto / Fechada': '🗑️ Descarte',
        '🗑️ Descartada': '🗑️ Descarte'
      };

      let count = 0;
      for (const app of allApps) {
        const newStatus = statusMap[app.status];
        if (newStatus && newStatus !== app.status) {
          await updateDoc(doc(db, appsPath, app.id), {
            status: newStatus,
            updatedAt: new Date().toISOString()
          });
          count++;
        }
      }

      setNotification({ message: `${count} status migrados com sucesso!`, type: 'success' });
    } catch (error: any) {
      console.error('Error migrating statuses:', error);
      setNotification({ message: `Erro na migração: ${error.message}`, type: 'error' });
    } finally {
      setCleaning(false);
    }
  };

  if (loading) return <div>Carregando...</div>;

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <header className="flex justify-between items-end">
        <div>
          <h2 className="text-3xl font-bold text-slate-900">Configurações</h2>
          <p className="text-slate-500 mt-1">Gerencie sua identidade profissional e modelos de automação.</p>
        </div>
        <div className="flex items-center gap-4">
          {!googleTokens && (
            <button
              onClick={handleConnectGoogle}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors"
            >
              <RefreshCw size={16} />
              Conectar Google Drive
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors shadow-lg shadow-blue-200 disabled:opacity-50"
          >
            <Save size={18} />
            {saving ? 'Salvando...' : 'Salvar Alterações'}
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-8">
        {/* Master Profile Section */}
        <section className="bg-white p-8 rounded-2xl border border-slate-100 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center text-blue-600">
                <UserCircle size={20} />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900">Source of Truth: Perfil Master</h3>
                <p className="text-xs text-slate-500">O conteúdo será puxado do Google Drive para análise.</p>
              </div>
            </div>
            <button
              onClick={handleSyncProfile}
              disabled={syncingProfile}
              className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-bold hover:bg-slate-800 transition-colors disabled:opacity-50"
            >
              <Zap size={14} className={syncingProfile ? 'animate-pulse' : ''} />
              {syncingProfile ? 'Sincronizando...' : 'Sincronizar Agora'}
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase">Link ou ID do Arquivo (Google Drive)</label>
              <input
                type="text"
                value={profile.masterProfileFileId}
                onChange={(e) => setProfile({ ...profile, masterProfileFileId: e.target.value })}
                placeholder="https://docs.google.com/document/d/..."
                className="w-full mt-1 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none font-mono"
              />
            </div>

            {profile.masterProfile && (
              <div className="mt-6">
                <label className="text-xs font-bold text-slate-500 uppercase mb-2 block">Preview do Conteúdo Sincronizado</label>
                <div className="w-full h-48 p-4 bg-slate-50 border border-slate-100 rounded-xl text-[10px] font-mono text-slate-400 overflow-y-auto whitespace-pre-wrap">
                  {profile.masterProfile}
                </div>
              </div>
            )}
          </div>
          
          <p className="mt-4 text-xs text-slate-400 italic">
            Dica: Mantenha seu Perfil Master atualizado no Google Drive e clique em "Sincronizar Agora" para que a IA use a versão mais recente.
          </p>
        </section>

        {/* Templates Section */}
        <section className="bg-white p-8 rounded-2xl border border-slate-100 shadow-sm">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600">
              <FileText size={20} />
            </div>
            <h3 className="text-lg font-bold text-slate-900">Modelos de Currículo (Google Drive)</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase">Modelo CV DIAMOND</label>
              <input
                type="text"
                value={profile.cvDiamondFileId}
                onChange={(e) => setProfile({ ...profile, cvDiamondFileId: e.target.value })}
                placeholder="Link ou ID do Google Doc"
                className="w-full mt-1 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none font-mono"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase">Modelo CV GOLD</label>
              <input
                type="text"
                value={profile.cvGoldFileId}
                onChange={(e) => setProfile({ ...profile, cvGoldFileId: e.target.value })}
                placeholder="Link ou ID do Google Doc"
                className="w-full mt-1 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none font-mono"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase">Modelo CV SILVER</label>
              <input
                type="text"
                value={profile.cvSilverFileId}
                onChange={(e) => setProfile({ ...profile, cvSilverFileId: e.target.value })}
                placeholder="Link ou ID do Google Doc"
                className="w-full mt-1 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none font-mono"
              />
            </div>
          </div>

          <div className="flex items-center gap-3 mt-10 mb-6">
            <div className="w-10 h-10 rounded-lg bg-violet-50 flex items-center justify-center text-violet-600">
              <FileText size={20} />
            </div>
            <h3 className="text-lg font-bold text-slate-900">Modelos de Cover Letter (Google Drive)</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase">Modelo CL DIAMOND</label>
              <input
                type="text"
                value={profile.clDiamondFileId}
                onChange={(e) => setProfile({ ...profile, clDiamondFileId: e.target.value })}
                placeholder="Link ou ID do Google Doc"
                className="w-full mt-1 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-violet-500 outline-none font-mono"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase">Modelo CL GOLD</label>
              <input
                type="text"
                value={profile.clGoldFileId}
                onChange={(e) => setProfile({ ...profile, clGoldFileId: e.target.value })}
                placeholder="Link ou ID do Google Doc"
                className="w-full mt-1 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-violet-500 outline-none font-mono"
              />
            </div>
          </div>
        </section>

        {/* Custom Rules & Automation Section */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <section className="bg-white p-8 rounded-2xl border border-slate-100 shadow-sm">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center text-amber-600">
                <Zap size={20} />
              </div>
              <h3 className="text-lg font-bold text-slate-900">Regras de Classificação (IA)</h3>
            </div>
            <textarea
              value={profile.customRules}
              onChange={(e) => setProfile({ ...profile, customRules: e.target.value })}
              placeholder="Ex: Descartar se exigir Alemão fluente. Marcar como 💎 se for Fintech em Berlim..."
              className="w-full h-48 p-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-mono focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-all outline-none"
            />
            <div className="mt-4">
              <button
                onClick={handleReanalyzeAll}
                disabled={cleaning}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-indigo-50 border border-indigo-100 text-indigo-700 rounded-xl text-sm font-bold hover:bg-indigo-100 transition-all disabled:opacity-50"
              >
                <Sparkles size={16} className={cleaning ? "animate-pulse" : ""} />
                {cleaning ? 'Reanalisando...' : 'Refazer Análise de Match (Lote)'}
              </button>
              <p className="mt-2 text-[10px] text-slate-400 text-center">
                A reanálise em lote aplicará seu Perfil Master e Regras atuais a todas as vagas que ainda não foram aplicadas ou descartadas.
              </p>
            </div>
          </section>

          <section className="bg-white p-8 rounded-2xl border border-slate-100 shadow-sm">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-lg bg-green-50 flex items-center justify-center text-green-600">
                <Plus size={20} />
              </div>
              <h3 className="text-lg font-bold text-slate-900">Google Drive Automation</h3>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase">Folder ID (Monitoramento)</label>
                <input
                  type="text"
                  value={profile.driveFolderId}
                  onChange={(e) => setProfile({ ...profile, driveFolderId: e.target.value })}
                  placeholder="ID da pasta para monitorar .md"
                  className="w-full mt-1 px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-green-500 outline-none"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase">Folder ID (Output)</label>
                <input
                  type="text"
                  value={profile.outputFolderId}
                  onChange={(e) => setProfile({ ...profile, outputFolderId: e.target.value })}
                  placeholder="ID da pasta para salvar aplicações"
                  className="w-full mt-1 px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-green-500 outline-none"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase">Folder ID (Processadas)</label>
                <input
                  type="text"
                  value={profile.processedFolderId}
                  onChange={(e) => setProfile({ ...profile, processedFolderId: e.target.value })}
                  placeholder="ID da pasta para mover arquivos lidos"
                  className="w-full mt-1 px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-green-500 outline-none"
                />
              </div>
              <p className="text-xs text-slate-500">
                O sistema irá monitorar a pasta de monitoramento por arquivos .md e movê-los para a pasta de processadas após a importação.
              </p>
            </div>
          </section>

          <section className="bg-white p-8 rounded-2xl border border-slate-100 shadow-sm">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-lg bg-red-50 flex items-center justify-center text-red-600">
                <Code size={20} />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-bold text-slate-900">API Gemini</h3>
                  {profile.geminiApiKey && (
                    <div className="flex items-center justify-center w-5 h-5 rounded-full bg-emerald-500 text-white shadow-sm" title="Chave Configurada">
                      <Zap size={12} fill="currentColor" />
                    </div>
                  )}
                </div>
                <p className="text-xs text-slate-500">Use sua própria chave para evitar limites de cota.</p>
              </div>
            </div>
            <div className="space-y-6">
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Modelo</label>
                  {!isCustomModel ? (
                    <select
                      value={profile.geminiModel}
                      onChange={(e) => {
                        if (e.target.value === 'custom') {
                          setIsCustomModel(true);
                        } else {
                          setProfile({ ...profile, geminiModel: e.target.value });
                        }
                      }}
                      className="w-full mt-1.5 px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-red-500 outline-none transition-all"
                    >
                      <option value="gemini-1.5-flash">Gemini 1.5 Flash</option>
                      <option value="gemini-1.5-pro">Gemini 1.5 Pro</option>
                      <option value="gemini-2.0-flash-exp">Gemini 2.0 Flash (Experimental)</option>
                      <option value="gemini-2.5-flash">Gemini 2.5 Flash (Recomendado)</option>
                      <option value="custom">Outro (Digitar nome...)</option>
                    </select>
                  ) : (
                    <div className="relative mt-1.5">
                      <input
                        type="text"
                        value={profile.geminiModel}
                        onChange={(e) => setProfile({ ...profile, geminiModel: e.target.value })}
                        placeholder="Ex: gemini-2.5-flash"
                        className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-red-500 outline-none pr-20"
                      />
                      <button
                        onClick={() => {
                          setIsCustomModel(false);
                          setProfile({ ...profile, geminiModel: 'gemini-2.5-flash' });
                        }}
                        className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-1 text-[10px] font-bold text-slate-400 hover:text-slate-600 uppercase"
                      >
                        Trocar
                      </button>
                    </div>
                  )}
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">API Key</label>
                  <div className="flex gap-2 mt-1.5">
                    <input
                      type="password"
                      value={profile.geminiApiKey}
                      onChange={(e) => setProfile({ ...profile, geminiApiKey: e.target.value })}
                      placeholder="Insira sua chave do Google AI Studio"
                      className="flex-1 px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-red-500 outline-none transition-all"
                    />
                    <button
                      onClick={handleTestKey}
                      disabled={testingKey || !profile.geminiApiKey}
                      className="px-6 py-2.5 bg-slate-900 text-white rounded-xl text-xs font-bold hover:bg-slate-800 transition-all disabled:opacity-50 shadow-sm"
                    >
                      {testingKey ? 'Testando...' : 'Testar'}
                    </button>
                  </div>
                </div>
              </div>
              
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                <p className="text-[10px] text-slate-500 leading-relaxed">
                  Ao usar sua própria chave com <b>Billing Ativado</b>, você obtém limites maiores. 
                  Obtenha sua chave gratuitamente em <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="text-blue-600 font-bold hover:underline">Google AI Studio</a>.
                </p>
              </div>
            </div>
          </section>

          <section className="bg-white p-8 rounded-2xl border border-slate-100 shadow-sm border-dashed border-slate-200">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-lg bg-slate-50 flex items-center justify-center text-slate-600 border border-slate-100">
                <RefreshCw size={20} />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900">Manutenção de Dados</h3>
                <p className="text-xs text-slate-500">Ferramentas para manter seu pipeline limpo.</p>
              </div>
            </div>
            <div className="space-y-4">
              <button
                onClick={handleCleanupDuplicates}
                disabled={cleaning}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-white border border-slate-200 text-slate-700 rounded-xl text-sm font-bold hover:bg-slate-50 transition-all disabled:opacity-50"
              >
                <RefreshCw size={16} className={cleaning ? "animate-spin" : ""} />
                {cleaning ? 'Limpando...' : 'Remover Vagas Duplicadas'}
              </button>
              <button
                onClick={handleMigrateStatuses}
                disabled={cleaning}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-50 border border-blue-100 text-blue-700 rounded-xl text-sm font-bold hover:bg-blue-100 transition-all disabled:opacity-50"
              >
                <Zap size={16} className={cleaning ? "animate-pulse" : ""} />
                {cleaning ? 'Migrando...' : 'Migrar Status Existentes'}
              </button>
              <p className="text-[10px] text-slate-400 text-center">
                Isso removerá vagas com o mesmo ID do Drive ou conteúdo idêntico, mantendo a versão mais recente.
              </p>
            </div>
          </section>
        </div>
      </div>

      {/* Notification Toast */}
      <AnimatePresence>
        {notification && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className={cn(
              "fixed bottom-8 right-8 z-[100] px-6 py-3 rounded-xl shadow-2xl font-bold text-sm flex items-center gap-3",
              notification.type === 'success' ? "bg-emerald-600 text-white" : "bg-red-600 text-white"
            )}
          >
            {notification.type === 'success' ? <Zap size={18} /> : <AlertCircle size={18} />}
            <span className="flex-1">{notification.message}</span>
            <button 
              onClick={() => setNotification(null)}
              className="p-1 hover:bg-white/20 rounded-lg transition-colors"
            >
              <X size={14} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
