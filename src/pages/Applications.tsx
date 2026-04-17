import React, { useState, useEffect, useRef } from 'react';
import { collection, query, onSnapshot, orderBy, addDoc, updateDoc, doc, deleteDoc, serverTimestamp, getDoc } from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { useAuth } from '../hooks/useAuth';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { extractFileId } from '../lib/driveUtils';
import { 
  analyzeJobMatch,
  generateDiamond,
  generateGold,
  generateSilver
} from '../lib/gemini';
import { 
  Search, 
  Filter, 
  Plus, 
  MoreVertical, 
  ExternalLink, 
  Trash2, 
  Zap,
  CheckCircle2,
  Clock,
  XCircle,
  FileText,
  ChevronRight,
  RefreshCw,
  X,
  AlertCircle,
  Cpu,
  Sparkles,
  Send,
  Loader2,
  TrendingUp
} from 'lucide-react';

const CV_LEVEL_3_ID = '1eCyJTG_IItfwzk3EBzRGCvTX1sT7g49UaD-x8gGC0rE';
const CV_LEVEL_1_2_ID = '11Icr9xJSx-Dr8piplsltIai9oOeu2qdh-qIqAaiRQS4';
const OUTPUT_FOLDER_ID = '1VLI8Lhz6CVhkPRKhwI64ArfzoIwkLork';
const PROCESSED_FOLDER_ID = '1kjYwJliWojpWm0TfbGDeTp3-9foVES8_';

export default function Applications() {
  const { user } = useAuth();
  const [apps, setApps] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedApp, setSelectedApp] = useState<any>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [appToDelete, setAppToDelete] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [scraping, setScraping] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genStep, setGenStep] = useState<'idle' | 'questions' | 'finalizing'>('idle');
  const [genStatus, setGenStatus] = useState<string>('');
  const [pendingSync, setPendingSync] = useState(false);
  const genStatusRef = useRef<HTMLDivElement>(null);
  const questionsRef = useRef<HTMLDivElement>(null);
  const [googleTokens, setGoogleTokens] = useState<any>(() => {
    const saved = localStorage.getItem('google_drive_tokens');
    return saved ? JSON.parse(saved) : null;
  });
  const [questions, setQuestions] = useState<string[]>([]);
  const [answers, setAnswers] = useState<{[key: string]: string}>({});
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('All');
  const [isDiscardModalOpen, setIsDiscardModalOpen] = useState(false);
  const [discardingAppId, setDiscardingAppId] = useState<string | null>(null);
  const [discardReason, setDiscardReason] = useState('');
  const [newApp, setNewApp] = useState({
    company: '',
    role: '',
    location: '',
    link: '',
    jobDescription: ''
  });

  useEffect(() => {
    if (selectedApp) {
      setQuestions(selectedApp.diamondQuestions || []);
      setAnswers(selectedApp.diamondAnswers || {});
    } else {
      setQuestions([]);
      setAnswers({});
    }
  }, [selectedApp]);

  const saveAnswers = async (newAnswers: {[key: string]: string}) => {
    if (!user || !selectedApp) return;
    setAnswers(newAnswers);
    await updateDoc(doc(db, `users/${user.uid}/applications`, selectedApp.id), {
      diamondAnswers: newAnswers,
      updatedAt: new Date().toISOString()
    });
  };

  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  useEffect(() => {
    if (!user) return;

    const q = query(
      collection(db, `users/${user.uid}/applications`),
      orderBy('updatedAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const allApps = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));
      setApps(allApps);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `users/${user.uid}/applications`);
    });

    return unsubscribe;
  }, [user]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'GOOGLE_AUTH_SUCCESS') {
        const tokens = event.data.tokens;
        setGoogleTokens(tokens);
        localStorage.setItem('google_drive_tokens', JSON.stringify(tokens));
        setNotification({ message: 'Google Drive conectado com sucesso!', type: 'success' });
        
        if (pendingSync) {
          setPendingSync(false);
          // Small delay to ensure state is updated
          setTimeout(() => handleSyncDrive(tokens), 500);
        }
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [pendingSync, apps, user]); // Added dependencies to ensure handleSyncDrive has latest context

  const handleConnectGoogle = async () => {
    try {
      const response = await fetch('/api/auth/google/url');
      const { url } = await response.json();
      window.open(url, 'google_auth', 'width=600,height=700');
    } catch (error) {
      setNotification({ message: 'Erro ao conectar com Google Drive.', type: 'error' });
    }
  };

  const handleSyncDrive = async (overrideTokens?: any) => {
    if (!user) return;
    
    const tokens = overrideTokens || googleTokens;
    if (!tokens) {
      setPendingSync(true);
      handleConnectGoogle();
      return;
    }

    setSyncing(true);
    try {
      const path = `users/${user.uid}`;
      let userData;
      try {
        const userDoc = await getDoc(doc(db, path));
        userData = userDoc.data();
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, path);
      }
      
      const folderId = userData?.driveFolderId;
      const outputFolderId = userData?.outputFolderId || OUTPUT_FOLDER_ID;
      const processedFolderId = userData?.processedFolderId || PROCESSED_FOLDER_ID;
      const masterProfile = userData?.masterProfile || '';
      const customRules = userData?.customRules || '';
      const geminiApiKey = userData?.geminiApiKey || '';

      if (!folderId) {
        setNotification({ message: 'Configure o Folder ID no seu Perfil primeiro.', type: 'error' });
        setSyncing(false);
        return;
      }

      const response = await fetch('/api/sync-drive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          folderId,
          accessToken: tokens?.access_token,
          refreshToken: tokens?.refresh_token
        })
      });
      
      if (response.status === 401 || response.status === 403) {
        setGoogleTokens(null);
        localStorage.removeItem('google_drive_tokens');
        throw new Error('Sessão do Google Drive expirada. Por favor, conecte novamente.');
      }

      const data = await response.json();
      if (data.error) {
        if (data.error.toLowerCase().includes('authentication') || data.error.toLowerCase().includes('credentials')) {
          setGoogleTokens(null);
          localStorage.removeItem('google_drive_tokens');
          throw new Error('Sessão do Google Drive expirada. Por favor, conecte novamente.');
        }
        throw new Error(data.error);
      }
      
      const files = data.files || [];
      let processedCount = 0;

      // Track seen in this batch to prevent duplicates if Drive returns same file twice or identical content
      const seenIdsInBatch = new Set();
      const seenContentsInBatch = new Set();

      for (const file of files) {
        const fileContentTrimmed = file.content?.trim();
        
        // Check if already exists by Drive ID
        const existsById = apps.some(app => app.driveFileId === file.id) || seenIdsInBatch.has(file.id);
        
        // Check if already exists by exact content match
        const existsByContent = apps.some(app => 
          app.jobDescription && app.jobDescription.trim() === fileContentTrimmed
        ) || (fileContentTrimmed && seenContentsInBatch.has(fileContentTrimmed));

        if (existsById || existsByContent) {
          // It's a duplicate (ID or content). 
          // Move it to processed folder so it doesn't clutter the input, but don't add to DB.
          try {
            await fetch('/api/move-file', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                fileId: file.id,
                currentParents: file.parents,
                targetFolderId: processedFolderId,
                rootFolderId: folderId,
                accessToken: tokens?.access_token,
                refreshToken: tokens?.refresh_token
              })
            });
          } catch (e) {
            console.error('Error moving duplicate file:', e);
          }
          continue;
        }

        try {
          // Analyze (Frontend)
          const geminiModel = userData?.geminiModel || 'gemini-2.5-flash';
          const analysis = await analyzeJobMatch(file.content, masterProfile, geminiApiKey, geminiModel);
          const status = analysis.tier === 'Diamond' ? '⏳ Input IA' : 
                         analysis.tier === 'Discard' ? '🗑️ Descarte' : 
                         '⚙️ Gerar Docs';

          // Save
          await addDoc(collection(db, `users/${user.uid}/applications`), {
            company: analysis.company || 'Unknown',
            role: analysis.role || file.name,
            location: analysis.location || 'Unknown',
            jobDescription: file.content,
            driveFileId: file.id,
            driveFolderLink: '',
            matchScore: analysis.tier,
            totalScore: analysis.totalScore,
            matchReasoning: analysis.reason,
            goldenPillar: analysis.goldenPillar,
            diamondQuestions: analysis.diamondQuestions || [],
            uid: user.uid,
            status: status,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          });

          // Update batch tracking
          seenIdsInBatch.add(file.id);
          if (fileContentTrimmed) seenContentsInBatch.add(fileContentTrimmed);

          // Move file in Drive only after successful save
          await fetch('/api/move-file', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fileId: file.id,
              currentParents: file.parents,
              targetFolderId: processedFolderId,
              rootFolderId: folderId,
              accessToken: tokens?.access_token,
              refreshToken: tokens?.refresh_token
            })
          });

          processedCount++;
          // Small delay to respect rate limits (Gemini Free Tier is ~15 RPM)
          // Using 6s (10 RPM) to be safe and allow for other concurrent requests
          await new Promise(resolve => setTimeout(resolve, 6000));
        } catch (fileError: any) {
          console.error(`Error processing file ${file.name}:`, fileError);
          const errorStr = JSON.stringify(fileError).toLowerCase();
          const errorMsg = (fileError.message || '').toLowerCase();
          
          if (errorMsg.includes('429') || errorMsg.includes('resource_exhausted') || errorMsg.includes('quota') ||
              errorStr.includes('429') || errorStr.includes('resource_exhausted') || errorStr.includes('quota')) {
            setNotification({ 
              message: 'Limite de cota do Gemini atingido. Algumas vagas serão processadas na próxima sincronização.', 
              type: 'error' 
            });
            break; // Stop processing further files to avoid more errors
          }
        }
      }
      setNotification({ 
        message: processedCount > 0 ? `Sincronização concluída! ${processedCount} novas vagas adicionadas.` : 'Sincronização concluída! Nenhuma nova vaga encontrada.', 
        type: 'success' 
      });
    } catch (error: any) {
      console.error('Error syncing drive:', error);
      const msg = error.message || '';
      if (msg.includes('authentication') || msg.includes('credentials') || msg.includes('401') || msg.includes('403')) {
        setGoogleTokens(null);
        localStorage.removeItem('google_drive_tokens');
        setNotification({ message: 'Sessão do Google Drive expirada. Por favor, conecte novamente.', type: 'error' });
      } else {
        setNotification({ message: `Erro ao sincronizar: ${error.message}`, type: 'error' });
      }
    } finally {
      setSyncing(false);
    }
  };

  const handleGenerateApplication = async (appOverride?: any) => {
    const app = appOverride || selectedApp;
    if (!user || !app) return;
    
    // If we're performing single generation (not batch override), we set global states
    if (!appOverride) {
      setGenerating(true);
      setGenStatus('Iniciando geração...');
      setGenStep('finalizing');
    }

    try {
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      const userData = userDoc.data();
      const name = userData?.name || user.displayName || 'Nhaiara Moura';
      
      const cvDiamondId = extractFileId(userData?.cvDiamondFileId);
      const cvGoldId = extractFileId(userData?.cvGoldFileId);
      const cvSilverId = extractFileId(userData?.cvSilverFileId);
      const outputFolderId = extractFileId(userData?.outputFolderId || OUTPUT_FOLDER_ID);
      const processedFolderId = extractFileId(userData?.processedFolderId || PROCESSED_FOLDER_ID);
      
      const clDiamondId = extractFileId(userData?.clDiamondFileId);
      const clGoldId = extractFileId(userData?.clGoldFileId);
      
      const isDiamond = app.matchScore === 'Diamond';
      const isGold = app.matchScore === 'Gold';

      // Common Tags
      const commonTags = {
        DATE: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
        JOB_TITLE: app.role || 'Engineering Manager',
        COMPANY_NAME: app.company || 'Empresa',
        HIRING_MANAGER: app.hiringManager || 'Hiring Team'
      };

      let cvTemplateId = cvSilverId;
      let clTemplateId = null;
      let tags = { ...commonTags };

      const geminiApiKey = userData?.geminiApiKey || '';
      const geminiModel = userData?.geminiModel || 'gemini-2.5-flash';
      const masterProfile = userData?.masterProfile || '';

      if (isDiamond) {
        if (!appOverride) setGenStatus('IA gerando dados Diamond...');
        cvTemplateId = cvDiamondId;
        clTemplateId = clDiamondId;
        
        const currentAnswers = app.diamondAnswers || {};
        const answersStr = Object.entries(currentAnswers).map(([q, a]) => `Q: ${q}\nA: ${a}`).join('\n\n');
        
        const result = await generateDiamond(app.jobDescription, masterProfile, answersStr, '', geminiApiKey, geminiModel, userData?.generationRules);
        tags = { ...tags, ...result };
      } else if (isGold) {
        if (!appOverride) setGenStatus('IA gerando dados Gold...');
        cvTemplateId = cvGoldId;
        clTemplateId = clGoldId;
        
        const result = await generateGold(app.jobDescription, masterProfile, app.company || 'Empresa', '', geminiApiKey, geminiModel, userData?.generationRules);
        tags = { ...tags, ...result };
      } else {
        if (!appOverride) setGenStatus('IA gerando dados Silver...');
        cvTemplateId = cvSilverId;
        const result = await generateSilver(app.jobDescription, masterProfile, geminiApiKey, geminiModel, userData?.generationRules);
        tags = { ...tags, ...result };
      }

      if (!appOverride) setGenStatus('Criando pasta e documentos no Google Drive...');
      const genResponse = await fetch('/api/generate-application', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          company: app.company,
          role: app.role,
          cvTemplateId,
          clTemplateId,
          tags,
          outputFolderId,
          processedFolderId,
          originalFileId: app.driveFileId,
          accessToken: googleTokens?.access_token,
          refreshToken: googleTokens?.refresh_token
        })
      });
      
      const genData = await genResponse.json();
      if (genData.error) throw new Error(genData.error);

      if (!appOverride) setGenStatus('Atualizando banco de dados...');
      await updateDoc(doc(db, `users/${user.uid}/applications`, app.id), {
        driveFolderLink: genData.folderLink,
        status: '✅ Aplicar',
        updatedAt: new Date().toISOString()
      });

      if (!appOverride) {
        setNotification({ message: `Aplicação ${app.matchScore} gerada com sucesso!`, type: 'success' });
        setGenStep('idle');
        setIsDetailOpen(false);
      }
      return true;
    } catch (error: any) {
      console.error('Error generating application:', error);
      if (!appOverride) setNotification({ message: `Erro: ${error.message}`, type: 'error' });
      return false;
    } finally {
      if (!appOverride) {
        setGenerating(false);
        setGenStatus('');
      }
    }
  };

  const handleBatchGenerate = async () => {
    if (!user) return;
    
    // Find top 5 Gold/Silver apps that need generation
    const candidates = apps
      .filter(app => (app.matchScore === 'Gold' || app.matchScore === 'Silver') && app.status === '⚙️ Gerar Docs')
      .sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0))
      .slice(0, 5);

    if (candidates.length === 0) {
      setNotification({ message: 'Nenhuma vaga Gold ou Silver pendente de documentos encontrada.', type: 'error' });
      return;
    }

    setGenerating(true);
    setNotification(null);
    let successCount = 0;

    for (let i = 0; i < candidates.length; i++) {
      const app = candidates[i];
      setGenStatus(`Processando ${i + 1}/${candidates.length}: ${app.company}...`);
      const success = await handleGenerateApplication(app);
      if (success) successCount++;
    }

    setGenerating(false);
    setGenStatus('');
    setNotification({ 
      message: `${successCount} de ${candidates.length} aplicações processadas com sucesso!`, 
      type: successCount === candidates.length ? 'success' : 'error' 
    });
  };
  const handleScrapeLink = async () => {
    if (!newApp.link) {
      setNotification({ message: 'Insira um link primeiro.', type: 'error' });
      return;
    }

    setScraping(true);
    try {
      const response = await fetch('/api/scrape-job', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: newApp.link })
      });
      
      const data = await response.json();
      if (data.error) throw new Error(data.error);

      setNewApp(prev => ({
        ...prev,
        jobDescription: data.content || prev.jobDescription,
        role: data.title?.split('|')[0]?.split('-')[0]?.trim() || prev.role
      }));
      
      setNotification({ message: 'Conteúdo capturado com sucesso!', type: 'success' });
    } catch (error: any) {
      console.error('Error scraping:', error);
      setNotification({ message: `Erro ao capturar: ${error.message}`, type: 'error' });
    } finally {
      setScraping(false);
    }
  };

  const handleAddApplication = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setAnalyzing(true);

    try {
      // 1. Get Master Profile and Rules
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      const userData = userDoc.data();
      const masterProfile = userData?.masterProfile || '';
      const customRules = userData?.customRules || '';

      const geminiApiKey = userData?.geminiApiKey || '';
      const geminiModel = userData?.geminiModel || 'gemini-2.5-flash';

      // 2. Analyze with AI (Frontend)
      const analysis = await analyzeJobMatch(newApp.jobDescription, masterProfile, geminiApiKey, geminiModel);
      const status = analysis.tier === 'Diamond' ? '⏳ Input IA' : 
                     analysis.tier === 'Discard' ? '🗑️ Descarte' : 
                     '⚙️ Gerar Docs';

      // 3. Save to Firestore
      await addDoc(collection(db, `users/${user.uid}/applications`), {
        ...newApp,
        company: analysis.company || newApp.company,
        role: analysis.role || newApp.role,
        location: analysis.location || newApp.location,
        hiringManager: analysis.hiringManager || 'Hiring Team',
        matchScore: analysis.tier,
        totalScore: analysis.totalScore,
        matchReasoning: analysis.reason,
        goldenPillar: analysis.goldenPillar,
        diamondQuestions: analysis.diamondQuestions || [],
        uid: user.uid,
        driveFolderLink: '',
        status: status,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      setIsModalOpen(false);
      setNewApp({ company: '', role: '', location: '', link: '', jobDescription: '' });
      setNotification({ message: 'Vaga adicionada com sucesso!', type: 'success' });
    } catch (error) {
      console.error('Error adding application:', error);
      setNotification({ message: 'Erro ao analisar vaga. Verifique se o Gemini API Key está configurado.', type: 'error' });
    } finally {
      setAnalyzing(false);
    }
  };

  const updateStatus = async (id: string, status: string) => {
    if (!user) return;
    
    if (status === '🗑️ Descarte') {
      setDiscardingAppId(id);
      setIsDiscardModalOpen(true);
      setDiscardReason('');
      return;
    }

    await updateDoc(doc(db, `users/${user.uid}/applications`, id), {
      status,
      updatedAt: new Date().toISOString()
    });

    if (selectedApp?.id === id) {
      setSelectedApp({ ...selectedApp, status });
    }
  };

  const handleConfirmDiscard = async () => {
    if (!user || !discardingAppId) return;
    
    try {
      await updateDoc(doc(db, `users/${user.uid}/applications`, discardingAppId), {
        status: '🗑️ Descarte',
        discardReason: discardReason,
        updatedAt: new Date().toISOString()
      });
      
      if (selectedApp?.id === discardingAppId) {
        setSelectedApp({ ...selectedApp, status: '🗑️ Descarte', discardReason });
      }
      
      setIsDiscardModalOpen(false);
      setDiscardingAppId(null);
      setDiscardReason('');
      setNotification({ message: 'Vaga descartada com o motivo registrado.', type: 'success' });
    } catch (error) {
      console.error('Error discarding app:', error);
      setNotification({ message: 'Erro ao descartar vaga.', type: 'error' });
    }
  };

  const deleteApp = async (id: string) => {
    if (!user) return;
    try {
      await deleteDoc(doc(db, `users/${user.uid}/applications`, id));
      setAppToDelete(null);
      setNotification({ message: 'Vaga excluída com sucesso.', type: 'success' });
    } catch (error) {
      console.error('Error deleting app:', error);
      setNotification({ message: 'Erro ao excluir vaga.', type: 'error' });
    }
  };

  const handleReanalyzeApp = async (app: any) => {
    if (!user) return;

    // Protection check: Don't reanalyze final states or manual discards
    const isFinalState = ['✅ Aplicar', '📩 Triagem', '🗣️ Entrevistas', '🕰️ Feedback', '❌ Rejeitada'].includes(app.status);
    const isManualDiscard = app.status === '🗑️ Descarte' && app.discardReason;

    if (isFinalState || isManualDiscard) {
      setNotification({ 
        message: 'Esta vaga está em um estado final ou foi descartada manualmente e não pode ser reanalisada.', 
        type: 'error' 
      });
      return;
    }

    setSyncing(true);
    setNotification({ message: 'Refazendo análise...', type: 'success' });
    try {
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      const userData = userDoc.data();
      const masterProfile = userData?.masterProfile || '';
      const customRules = userData?.customRules || '';
      const geminiApiKey = userData?.geminiApiKey || '';
      const geminiModel = userData?.geminiModel || 'gemini-2.5-flash';

      const analysis = await analyzeJobMatch(app.jobDescription, masterProfile, geminiApiKey, geminiModel);
      const status = analysis.tier === 'Diamond' ? '⏳ Input IA' : 
                     analysis.tier === 'Discard' ? '🗑️ Descarte' : 
                     '⚙️ Gerar Docs';
      
      const updatedData = {
        company: analysis.company || app.company,
        role: analysis.role || app.role,
        location: analysis.location || app.location,
        hiringManager: analysis.hiringManager || 'Hiring Team',
        matchScore: analysis.tier,
        totalScore: analysis.totalScore,
        matchReasoning: analysis.reason,
        goldenPillar: analysis.goldenPillar,
        diamondQuestions: analysis.diamondQuestions || [],
        status: status,
        updatedAt: new Date().toISOString()
      };
      
      await updateDoc(doc(db, `users/${user.uid}/applications`, app.id), updatedData);

      if (selectedApp?.id === app.id) {
        setSelectedApp({ ...selectedApp, ...updatedData });
      }

      setNotification({ message: 'Análise atualizada com sucesso!', type: 'success' });
    } catch (error: any) {
      console.error('Error reanalyzing app:', error);
      setNotification({ message: `Erro na análise: ${error.message}`, type: 'error' });
    } finally {
      setSyncing(false);
    }
  };

  const filteredApps = apps.filter(app => {
    const matchesSearch = 
      app.company?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      app.role?.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesFilter = filterStatus === 'All' || app.status === filterStatus;
    
    return matchesSearch && matchesFilter;
  });

  return (
    <div className="space-y-8">
      <header className="flex justify-between items-end">
        <div>
          <h2 className="text-3xl font-bold text-slate-900">Aplicações</h2>
          <p className="text-slate-500 mt-1">Gerencie seu pipeline de vagas e acompanhe o progresso.</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={handleBatchGenerate}
            disabled={generating}
            className="flex items-center gap-2 px-6 py-2 bg-amber-500 text-white rounded-lg font-medium hover:bg-amber-600 transition-colors shadow-lg shadow-amber-200 disabled:opacity-50"
          >
            {generating ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
            Processar Top 5 (Gold/Silver)
          </button>
          <button
            onClick={() => handleSyncDrive()}
            disabled={syncing}
            className={`flex items-center gap-2 px-6 py-2 rounded-lg font-medium transition-all shadow-sm disabled:opacity-50 ${
              googleTokens 
                ? 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50' 
                : 'bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-100'
            }`}
          >
            <Zap size={18} className={syncing ? "animate-pulse text-amber-500" : (googleTokens ? "text-slate-400" : "text-indigo-500")} />
            {syncing ? 'Sincronizando...' : (googleTokens ? 'Sincronizar Drive' : 'Conectar e Sincronizar')}
          </button>
          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors shadow-lg shadow-blue-200"
          >
            <Plus size={18} />
            Adicionar Vaga
          </button>
        </div>
      </header>

      {/* Filters & Search */}
      <div className="flex flex-col md:flex-row gap-4 items-center bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
        <div className="flex-1 relative w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input 
            type="text" 
            placeholder="Buscar por empresa ou cargo..." 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
          />
        </div>
        <div className="flex items-center gap-2 w-full md:w-auto">
          <Filter size={18} className="text-slate-400" />
          <select 
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="flex-1 md:flex-none px-4 py-2 border border-slate-200 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors outline-none bg-white"
          >
            <option value="All">Todos os Status</option>
            <option value="📥 Nova">📥 Nova</option>
            <option value="⏳ Input IA">⏳ Input IA</option>
            <option value="⚙️ Gerar Docs">⚙️ Gerar Docs</option>
            <option value="✅ Aplicar">✅ Aplicar</option>
            <option value="📩 Triagem">📩 Triagem</option>
            <option value="🕰️ Feedback">🕰️ Feedback</option>
            <option value="🗣️ Entrevistas">🗣️ Entrevistas</option>
            <option value="🏆 Proposta">🏆 Proposta</option>
            <option value="🤝 Sucesso">🤝 Sucesso</option>
            <option value="❌ Rejeitada">❌ Rejeitada</option>
            <option value="🗑️ Descarte">🗑️ Descarte</option>
          </select>
        </div>
      </div>

      {/* Applications List */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/50 border-b border-slate-100">
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Identidade & Match</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Operação</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-slate-400">Carregando aplicações...</td>
                </tr>
              ) : filteredApps.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-slate-400">Nenhuma vaga encontrada.</td>
                </tr>
              ) : (
                filteredApps.map((app) => (
                  <tr 
                    key={app.id} 
                    className="hover:bg-slate-50/50 transition-colors group cursor-pointer"
                    onClick={() => {
                      setSelectedApp(app);
                      setIsDetailOpen(true);
                    }}
                  >
                    <td className="px-6 py-4">
                      <div className="space-y-2">
                        <div className="flex items-start justify-between gap-4">
                          <div className="space-y-1">
                            <div className="font-bold text-slate-900 text-sm leading-tight">{app.role}</div>
                            <div className="text-[10px] text-slate-500 font-medium">
                              {app.company} • {app.location}
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            <span className={cn(
                              "text-[10px] font-bold px-2 py-0.5 rounded",
                              app.matchScore === 'Diamond' ? 'bg-amber-100 text-amber-800' :
                              app.matchScore === 'Gold' ? 'bg-blue-100 text-blue-800' :
                              app.matchScore === 'Silver' ? 'bg-slate-100 text-slate-800' :
                              'bg-red-100 text-red-800'
                            )}>
                              {app.matchScore} ({app.totalScore}%)
                            </span>
                            <div className="text-[9px] text-slate-400 font-medium">
                              {app.goldenPillar || '-'}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          {app.link && (
                            <a 
                              href={app.link} 
                              target="_blank" 
                              rel="noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 text-blue-600 rounded text-[10px] font-bold hover:bg-blue-100 transition-colors"
                            >
                              <ExternalLink size={10} /> Apply
                            </a>
                          )}
                          <div className="flex items-center gap-2 text-[9px] text-slate-400">
                            <span>ID: {app.id.slice(0, 5)}</span>
                            <span>•</span>
                            <span>{new Date(app.createdAt).toLocaleDateString()}</span>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4" onClick={(e) => e.stopPropagation()}>
                      <div className="flex flex-col gap-2">
                        <select 
                          value={app.status}
                          onChange={(e) => updateStatus(app.id, e.target.value)}
                          className={cn(
                            "text-[10px] font-bold px-2 py-1 rounded-full border outline-none cursor-pointer appearance-none text-center min-w-[90px]",
                            app.status === '⏳ Input IA' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                            app.status === '⚙️ Gerar Docs' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                            app.status === '✅ Aplicar' ? 'bg-green-50 text-green-700 border-green-200' :
                            app.status === '📩 Triagem' ? 'bg-indigo-50 text-indigo-700 border-indigo-200' :
                            app.status === '🗑️ Descarte' ? 'bg-red-50 text-red-700 border-red-200' :
                            'bg-slate-50 text-slate-600 border-slate-200'
                          )}
                        >
                          <option value="📥 Nova">📥 Nova</option>
                          <option value="⏳ Input IA">⏳ Input IA</option>
                          <option value="⚙️ Gerar Docs">⚙️ Gerar Docs</option>
                          <option value="✅ Aplicar">✅ Aplicar</option>
                          <option value="📩 Triagem">📩 Triagem</option>
                          <option value="🕰️ Feedback">🕰️ Feedback</option>
                          <option value="🗣️ Entrevistas">🗣️ Entrevistas</option>
                          <option value="🏆 Proposta">🏆 Proposta</option>
                          <option value="🤝 Sucesso">🤝 Sucesso</option>
                          <option value="❌ Rejeitada">❌ Rejeitada</option>
                          <option value="🗑️ Descarte">🗑️ Descarte</option>
                        </select>
                        {app.driveFolderLink && (
                          <a 
                            href={app.driveFolderLink} 
                            target="_blank" 
                            rel="noreferrer"
                            className="text-[10px] text-amber-600 hover:underline flex items-center gap-1"
                          >
                            <FileText size={10} /> Pasta Drive
                          </a>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button 
                          onClick={() => handleReanalyzeApp(app)}
                          disabled={syncing || ['✅ Pronto', 'Enviada', 'Entrevista', 'Aguardando feedback', 'Rejeitada'].includes(app.status) || (app.status === '🗑️ Descartada' && app.discardReason)}
                          title={
                            ['✅ Pronto', 'Enviada', 'Entrevista', 'Aguardando feedback', 'Rejeitada'].includes(app.status) 
                              ? "Vaga em estado final não permite reanálise" 
                              : (app.status === '🗑️ Descartada' && app.discardReason)
                                ? "Vaga descartada manualmente não permite reanálise"
                                : "Refazer análise de match"
                          }
                          className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors disabled:opacity-20"
                        >
                          <Sparkles size={16} className={syncing ? "animate-pulse" : ""} />
                        </button>
                        <button 
                          onClick={() => setAppToDelete(app.id)}
                          className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden"
            >
              <div className="p-6 border-b border-slate-100 flex justify-between items-center">
                <h3 className="text-xl font-bold text-slate-900">Nova Aplicação</h3>
                <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                  <XCircle size={24} />
                </button>
              </div>
              <form onSubmit={handleAddApplication} className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">Empresa</label>
                    <input 
                      required
                      value={newApp.company}
                      onChange={(e) => setNewApp({ ...newApp, company: e.target.value })}
                      className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">Cargo</label>
                    <input 
                      required
                      value={newApp.role}
                      onChange={(e) => setNewApp({ ...newApp, role: e.target.value })}
                      className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">Localização</label>
                    <input 
                      value={newApp.location}
                      onChange={(e) => setNewApp({ ...newApp, location: e.target.value })}
                      className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">Link da Vaga</label>
                    <div className="flex gap-2">
                      <input 
                        value={newApp.link}
                        onChange={(e) => setNewApp({ ...newApp, link: e.target.value })}
                        placeholder="https://..."
                        className="flex-1 px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                      />
                      <button
                        type="button"
                        onClick={handleScrapeLink}
                        disabled={scraping || !newApp.link}
                        className="px-3 py-2 bg-indigo-50 text-indigo-600 rounded-lg border border-indigo-100 hover:bg-indigo-100 transition-colors disabled:opacity-50"
                        title="Capturar conteúdo do link"
                      >
                        {scraping ? <Loader2 size={18} className="animate-spin" /> : <RefreshCw size={18} />}
                      </button>
                    </div>
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase">Job Description (JD)</label>
                  <textarea 
                    required
                    value={newApp.jobDescription}
                    onChange={(e) => setNewApp({ ...newApp, jobDescription: e.target.value })}
                    className="w-full h-48 px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none"
                    placeholder="Cole aqui o texto completo da vaga para análise da IA..."
                  />
                </div>
                <div className="pt-4 flex gap-3">
                  <button 
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="flex-1 px-6 py-3 border border-slate-200 text-slate-600 font-bold rounded-xl hover:bg-slate-50 transition-colors"
                  >
                    Cancelar
                  </button>
                  <button 
                    type="submit"
                    disabled={analyzing}
                    className="flex-2 px-6 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition-colors shadow-lg shadow-blue-200 disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {analyzing ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Analisando com Gemini...
                      </>
                    ) : (
                      <>
                        <Zap size={18} />
                        Analisar e Salvar
                      </>
                    )}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

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
            {notification.type === 'success' ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
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

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {appToDelete && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white w-full max-w-md rounded-2xl shadow-2xl p-8 text-center"
            >
              <div className="w-16 h-16 bg-red-50 text-red-600 rounded-full flex items-center justify-center mx-auto mb-6">
                <Trash2 size={32} />
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-2">Excluir Vaga?</h3>
              <p className="text-slate-500 mb-8">Esta ação não pode ser desfeita. Tem certeza que deseja remover esta aplicação?</p>
              <div className="flex gap-3">
                <button
                  onClick={() => setAppToDelete(null)}
                  className="flex-1 px-6 py-3 border border-slate-200 text-slate-600 font-bold rounded-xl hover:bg-slate-50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => deleteApp(appToDelete)}
                  className="flex-1 px-6 py-3 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 transition-colors shadow-lg shadow-red-200"
                >
                  Confirmar Exclusão
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Discard Reason Modal */}
      <AnimatePresence>
        {isDiscardModalOpen && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white w-full max-w-md rounded-2xl shadow-2xl p-8"
            >
              <div className="flex items-center gap-3 mb-6 text-red-600">
                <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center">
                  <Trash2 size={24} />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-slate-900">Motivo do Descarte</h3>
                  <p className="text-sm text-slate-500">Por que esta vaga não serve?</p>
                </div>
              </div>

              <div className="space-y-4">
                <textarea 
                  autoFocus
                  value={discardReason}
                  onChange={(e) => setDiscardReason(e.target.value)}
                  placeholder="Ex: Salário abaixo do esperado, tecnologias não compatíveis, modelo presencial..."
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-red-500 outline-none min-h-[120px] resize-none"
                />
                
                <div className="flex gap-3 pt-2">
                  <button 
                    onClick={() => {
                      setIsDiscardModalOpen(false);
                      setDiscardingAppId(null);
                    }}
                    className="flex-1 py-3 bg-white border border-slate-200 text-slate-600 font-bold rounded-xl hover:bg-slate-50 transition-all"
                  >
                    Cancelar
                  </button>
                  <button 
                    onClick={handleConfirmDiscard}
                    className="flex-1 py-3 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 transition-all shadow-lg shadow-red-200"
                  >
                    Confirmar Descarte
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Detail Modal */}
      <AnimatePresence>
        {isDetailOpen && selectedApp && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white w-full max-w-4xl max-h-[90vh] rounded-2xl shadow-2xl overflow-hidden flex flex-col"
            >
              <div className="p-6 border-b border-slate-100 flex justify-between items-start">
                <div>
                  <div className="flex items-center gap-3 mb-1">
                    <h3 className="text-2xl font-bold text-slate-900">{selectedApp.role}</h3>
                    <span className={cn(
                      "text-xs font-bold px-2 py-1 rounded-full border",
                      selectedApp.matchScore === 'Altíssima' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' :
                      selectedApp.matchScore === 'Alta' ? 'bg-blue-50 text-blue-700 border-blue-100' :
                      'bg-slate-50 text-slate-700 border-slate-100'
                    )}>
                      {selectedApp.matchScore} Match
                    </span>
                  </div>
                  <p className="text-slate-500 font-medium">{selectedApp.company} • {selectedApp.location}</p>
                </div>
                <button onClick={() => setIsDetailOpen(false)} className="text-slate-400 hover:text-slate-600 p-2 transition-colors">
                  <X size={24} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-8 space-y-8">
                {/* Intelligence Section */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="bg-emerald-50/50 p-5 rounded-xl border border-emerald-100">
                    <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider mb-2">Pilar Golden</p>
                    <p className="text-sm font-semibold text-emerald-900">{selectedApp.goldenPillar || 'Não analisado'}</p>
                  </div>
                  <div className="bg-blue-50/50 p-5 rounded-xl border border-blue-100">
                    <p className="text-[10px] font-bold text-blue-600 uppercase tracking-wider mb-2">Tier de Match</p>
                    <p className="text-sm font-semibold text-blue-900">{selectedApp.matchScore} ({selectedApp.totalScore}%)</p>
                  </div>
                </div>

                {/* Strategy Section */}
                <div className="space-y-4">
                  <h4 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Critérios de Match</h4>
                  <div className="bg-slate-50 p-6 rounded-xl border border-slate-100 text-sm text-slate-700 leading-relaxed">
                    {selectedApp.matchReasoning || 'Sem detalhes adicionais.'}
                  </div>
                </div>

                <div className="space-y-4">
                  <h4 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Estratégia de Abertura</h4>
                  <div className="bg-indigo-50/30 p-6 rounded-xl border border-indigo-100 text-sm text-indigo-900 leading-relaxed italic">
                    "{selectedApp.openingStrategy || 'Sem estratégia definida.'}"
                  </div>
                </div>

                {/* Job Description */}
                <div className="space-y-4">
                  <h4 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Descrição da Vaga</h4>
                  <div className="bg-white p-6 rounded-xl border border-slate-200 text-sm text-slate-600 whitespace-pre-wrap font-mono max-h-96 overflow-y-auto">
                    {selectedApp.jobDescription}
                  </div>
                </div>

                {/* Diamond Questions Section */}
                {selectedApp.matchScore === 'Diamond' && questions.length > 0 && (
                  <div className="space-y-6 bg-amber-50/50 p-6 rounded-2xl border border-amber-100">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center text-amber-600">
                        <Sparkles size={20} />
                      </div>
                      <div>
                        <h4 className="font-bold text-amber-900">Perguntas Diamond</h4>
                        <p className="text-xs text-amber-700">Responda para capturar nuances específicas para os documentos</p>
                      </div>
                    </div>
                    <div className="space-y-4">
                      {questions.map((q, i) => (
                        <div key={i} className="space-y-1.5">
                          <label className="text-xs font-bold text-amber-800">{q}</label>
                          <textarea 
                            value={answers[q] || ''}
                            onChange={(e) => saveAnswers({ ...answers, [q]: e.target.value })}
                            className="w-full px-4 py-2 bg-white border border-amber-200 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 outline-none min-h-[80px]"
                            placeholder="Sua resposta com dados e métricas..."
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Discard Reason Section */}
                {selectedApp.status === '🗑️ Descarte' && (
                  <div className="space-y-4">
                    <h4 className="text-sm font-bold text-red-600 uppercase tracking-wider">Motivo do Descarte</h4>
                    <div className="bg-red-50 p-6 rounded-xl border border-red-100">
                      <textarea 
                        value={selectedApp.discardReason || ''}
                        onChange={async (e) => {
                          const newReason = e.target.value;
                          setSelectedApp({ ...selectedApp, discardReason: newReason });
                          if (!user) return;
                          await updateDoc(doc(db, `users/${user.uid}/applications`, selectedApp.id), {
                            discardReason: newReason,
                            updatedAt: new Date().toISOString()
                          });
                        }}
                        placeholder="Por que você descartou essa vaga? (ex: Salário baixo, stack diferente, localização...)"
                        className="w-full bg-transparent text-sm text-red-900 outline-none placeholder:text-red-300 min-h-[100px] resize-none"
                      />
                    </div>
                  </div>
                )}

                {/* Automation Section */}
                {generating && (
                  <div ref={genStatusRef} className="bg-blue-50 p-4 rounded-xl border border-blue-100 flex items-center gap-3 animate-pulse">
                    <Loader2 className="animate-spin text-blue-600" size={20} />
                    <span className="text-sm font-medium text-blue-700">{genStatus}</span>
                  </div>
                )}

                {/* Operations Section */}
                <div className="pt-6 border-t border-slate-100 grid grid-cols-2 gap-8">
                  <div className="space-y-3">
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Operação</h4>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-slate-500">Status Atual:</span>
                        <select 
                          value={selectedApp.status}
                          onChange={(e) => updateStatus(selectedApp.id, e.target.value)}
                          className={cn(
                            "text-[10px] font-bold px-2 py-1 rounded-full border outline-none cursor-pointer appearance-none text-center min-w-[120px]",
                            selectedApp.status === '⏳ Input IA' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                            selectedApp.status === '⚙️ Gerar Docs' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                            selectedApp.status === '✅ Aplicar' ? 'bg-green-50 text-green-700 border-green-200' :
                            selectedApp.status === '📩 Triagem' ? 'bg-indigo-50 text-indigo-700 border-indigo-200' :
                            selectedApp.status === '🗑️ Descarte' ? 'bg-red-50 text-red-700 border-red-200' :
                            'bg-slate-50 text-slate-600 border-slate-200'
                          )}
                        >
                          <option value="📥 Nova">📥 Nova</option>
                          <option value="⏳ Input IA">⏳ Input IA</option>
                          <option value="⚙️ Gerar Docs">⚙️ Gerar Docs</option>
                          <option value="✅ Aplicar">✅ Aplicar</option>
                          <option value="📩 Triagem">📩 Triagem</option>
                          <option value="🕰️ Feedback">🕰️ Feedback</option>
                          <option value="🗣️ Entrevistas">🗣️ Entrevistas</option>
                          <option value="🏆 Proposta">🏆 Proposta</option>
                          <option value="🤝 Sucesso">🤝 Sucesso</option>
                          <option value="❌ Rejeitada">❌ Rejeitada</option>
                          <option value="🗑️ Descarte">🗑️ Descarte</option>
                        </select>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-slate-500">Link Pasta Drive:</span>
                        <input 
                          type="text"
                          placeholder="Cole o link aqui..."
                          defaultValue={selectedApp.driveFolderLink}
                          onBlur={async (e) => {
                            if (!user) return;
                            await updateDoc(doc(db, `users/${user.uid}/applications`, selectedApp.id), {
                              driveFolderLink: e.target.value,
                              updatedAt: new Date().toISOString()
                            });
                          }}
                          className="text-xs text-blue-600 bg-slate-50 border border-slate-200 rounded px-2 py-1 outline-none focus:ring-1 focus:ring-blue-500 w-1/2"
                        />
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-slate-500">Link da Vaga:</span>
                        <input 
                          type="text"
                          placeholder="Link para aplicar..."
                          defaultValue={selectedApp.link}
                          onBlur={async (e) => {
                            if (!user) return;
                            await updateDoc(doc(db, `users/${user.uid}/applications`, selectedApp.id), {
                              link: e.target.value,
                              updatedAt: new Date().toISOString()
                            });
                          }}
                          className="text-xs text-blue-600 bg-slate-50 border border-slate-200 rounded px-2 py-1 outline-none focus:ring-1 focus:ring-blue-500 w-1/2"
                        />
                      </div>
                    </div>
                  </div>
                  <div className="space-y-3 text-right">
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Identidade</h4>
                    <div className="text-[10px] text-slate-500 space-y-1">
                      <p>ID: {selectedApp.id}</p>
                      <p>Importado em: {new Date(selectedApp.createdAt).toLocaleString()}</p>
                      {selectedApp.driveFileId && <p>Drive File ID: {selectedApp.driveFileId}</p>}
                      {selectedApp.link && (
                        <p>
                          <span className="font-bold">Link Vaga:</span>{' '}
                          <a href={selectedApp.link} target="_blank" rel="noreferrer" className="text-blue-500 hover:underline">
                            {selectedApp.link}
                          </a>
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-6 border-t border-slate-100 bg-slate-50 flex justify-between items-center">
                <div className="flex gap-3">
                  <button 
                    onClick={() => {
                      setAppToDelete(selectedApp.id);
                      setIsDetailOpen(false);
                    }}
                    className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    title="Excluir Vaga"
                  >
                    <Trash2 size={20} />
                  </button>
                  <button 
                    onClick={() => handleReanalyzeApp(selectedApp)}
                    disabled={syncing}
                    className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors disabled:opacity-20"
                    title="Revisar Match"
                  >
                    <Sparkles size={20} className={syncing ? "animate-spin" : ""} />
                  </button>
                </div>

                <div className="flex gap-3">
                  {selectedApp.status === '🗑️ Descarte' ? (
                    <button 
                      onClick={() => setIsDetailOpen(false)}
                      className="px-8 py-2 bg-slate-900 text-white font-bold rounded-lg hover:bg-slate-800 transition-all shadow-lg shadow-slate-200"
                    >
                      Salvar e Fechar
                    </button>
                  ) : (
                    <>
                      {selectedApp.status === '✅ Aplicar' ? (
                        <button 
                          onClick={() => {
                            updateStatus(selectedApp.id, '🚀 Aplicada');
                            setIsDetailOpen(false);
                          }}
                          className="px-8 py-2 bg-indigo-600 text-white font-bold rounded-lg hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200 flex items-center gap-2"
                        >
                          <Send size={18} />
                          Marcar como Aplicada
                        </button>
                      ) : genStep === 'idle' && (
                        <button 
                          onClick={() => handleGenerateApplication()}
                          disabled={generating}
                          className={cn(
                            "px-8 py-2 text-white font-bold rounded-lg transition-all shadow-lg flex items-center gap-2",
                            selectedApp.matchScore === 'Diamond' ? 'bg-amber-600 hover:bg-amber-700 shadow-amber-200' :
                            selectedApp.matchScore === 'Gold' ? 'bg-blue-600 hover:bg-blue-700 shadow-blue-200' :
                            'bg-slate-600 hover:bg-slate-700 shadow-slate-200'
                          )}
                        >
                          {generating ? (
                            <Loader2 className="animate-spin" size={18} />
                          ) : (
                            <FileText size={18} />
                          )}
                          Gerar Docs
                        </button>
                      )}

                      {selectedApp.link && (
                        <a 
                          href={selectedApp.link}
                          target="_blank"
                          rel="noreferrer"
                          className="px-6 py-2 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 transition-colors shadow-lg shadow-blue-200 flex items-center gap-2"
                        >
                          <ExternalLink size={16} /> Apply Now
                        </a>
                      )}
                    </>
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
