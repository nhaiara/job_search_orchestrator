import { useState, useEffect, useRef } from 'react';
import { collection, query, onSnapshot, orderBy, limit, addDoc, doc, updateDoc, getDoc, getDocs } from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { useAuth } from '../hooks/useAuth';
import { motion } from 'motion/react';
import { getStatusStyle, getTierStyle } from '../lib/styleUtils';
import { 
  TrendingUp, 
  CheckCircle2, 
  Clock, 
  AlertCircle,
  ArrowRight,
  Plus,
  XCircle,
  ExternalLink,
  FileText,
  Cpu,
  Sparkles,
  Send,
  Loader2,
  Zap,
  RefreshCw,
  Trash2,
  X,
  Gem,
  Award,
  Trophy,
  Handshake,
  AlertTriangle,
  Users,
  PlusCircle,
  Brain,
  Star,
  ChevronDown,
  PlayCircle
} from 'lucide-react';
import { 
  analyzeJobMatch,
  generateDiamond,
  generateGold,
  generateSilver,
  updateMasterProfileWithLearnings,
  generateJobMatchQuestions,
  generateInterviewPreparation
} from '../lib/gemini';
const CV_LEVEL_3_ID = '1eCyJTG_IItfwzk3EBzRGCvTX1sT7g49UaD-x8gGC0rE';
const CV_LEVEL_1_2_ID = '11Icr9xJSx-Dr8piplsltIai9oOeu2qdh-qIqAaiRQS4';
const OUTPUT_FOLDER_ID = '1VLI8Lhz6CVhkPRKhwI64ArfzoIwkLork';
const PROCESSED_FOLDER_ID = '1kjYwJliWojpWm0TfbGDeTp3-9foVES8_';
import { Link, useNavigate } from 'react-router-dom';
import { AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { extractFileId } from '../lib/driveUtils';

import Markdown from 'react-markdown';

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [stats, setStats] = useState({
    pendingAction: 0,
    feedback: 0,
    interviews: 0,
    activeDiamonds: 0,
    closed: 0
  });
  const [recentApps, setRecentApps] = useState<any[]>([]);
  const [selectedApp, setSelectedApp] = useState<any>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isDescExpanded, setIsDescExpanded] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [pendingSync, setPendingSync] = useState(false);
  const [genStep, setGenStep] = useState<'idle' | 'questions' | 'finalizing'>('idle');
  const [genStatus, setGenStatus] = useState<string>('');
  const [appToDelete, setAppToDelete] = useState<string | null>(null);
  const [googleTokens, setGoogleTokens] = useState<any>(() => {
    const saved = localStorage.getItem('google_drive_tokens');
    return saved ? JSON.parse(saved) : null;
  });
  const [questions, setQuestions] = useState<string[]>([]);
  const [answers, setAnswers] = useState<{[key: string]: string}>({});

  const saveAnswers = async (newAnswers: any) => {
    setAnswers(newAnswers);
    if (!user || !selectedApp) return;
    await updateDoc(doc(db, `users/${user.uid}/applications`, selectedApp.id), {
      diamondAnswers: newAnswers,
      updatedAt: new Date().toISOString()
    });
  };
  const [notification, setNotification] = useState<{ message: string, type: 'success' | 'error' } | null>(null);
  const genStatusRef = useRef<HTMLDivElement>(null);
  const questionsRef = useRef<HTMLDivElement>(null);

  const [topMatch, setTopMatch] = useState<any>(null);

  const updateStatus = async (id: string, status: string) => {
    if (!user) return;
    
    // Find the app to check its current tier
    const appToUpdate = recentApps.find(a => a.id === id) || (topMatch?.id === id ? topMatch : null);
    let extraData = {};

    // Se o usuário está tirando do descarte para o processamento, precisamos dar um "tier" para a vaga
    if (appToUpdate?.matchScore === 'Discard' || !appToUpdate?.matchScore) {
      if (status === '⏳ Input IA') {
        extraData = { matchScore: 'Diamond' };
      } else if (status === '⚙️ Gerar Docs') {
        extraData = { matchScore: 'Gold' };
      }
    }

    await updateDoc(doc(db, `users/${user.uid}/applications`, id), {
      status,
      ...extraData,
      updatedAt: new Date().toISOString()
    });
    if (selectedApp?.id === id) {
      setSelectedApp({ ...selectedApp, status, ...extraData });
    }
  };

  const [generatingQuestions, setGeneratingQuestions] = useState(false);
  const [generatingTips, setGeneratingTips] = useState(false);

  const handleGenerateInterviewTips = async () => {
    if (!user || !selectedApp) return;
    setGeneratingTips(true);
    try {
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      const userData = userDoc.data();
      const masterProfile = userData?.masterProfile || '';
      const geminiApiKey = userData?.geminiApiKey || '';
      const geminiModel = userData?.geminiModel || 'gemini-3.1-pro-preview';

      const tips = await generateInterviewPreparation(
        selectedApp.jobDescription, 
        masterProfile, 
        selectedApp.interviewNotes || '', 
        geminiApiKey,
        geminiModel
      );
      
      await updateDoc(doc(db, `users/${user.uid}/applications`, selectedApp.id), {
        interviewSuggestions: tips,
        updatedAt: new Date().toISOString()
      });

      setSelectedApp({ ...selectedApp, interviewSuggestions: tips });
      setNotification({ message: 'Preparação para entrevista gerada!', type: 'success' });
    } catch (error) {
      console.error('Error generating tips:', error);
      setNotification({ message: 'Erro ao gerar guia de entrevista.', type: 'error' });
    } finally {
      setGeneratingTips(false);
    }
  };

  const handleGenerateQuestions = async () => {
    if (!user || !selectedApp) return;
    setGeneratingQuestions(true);
    try {
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      const userData = userDoc.data();
      const masterProfile = userData?.masterProfile || '';
      const geminiApiKey = userData?.geminiApiKey || '';
      const geminiModel = userData?.geminiModel || 'gemini-2.5-flash';

      const questionsResult = await generateJobMatchQuestions(selectedApp.jobDescription, masterProfile, geminiApiKey, geminiModel);
      
      await updateDoc(doc(db, `users/${user.uid}/applications`, selectedApp.id), {
        diamondQuestions: questionsResult,
        updatedAt: new Date().toISOString()
      });

      setSelectedApp({ ...selectedApp, diamondQuestions: questionsResult });
      setQuestions(questionsResult);
      setNotification({ message: 'Perguntas geradas com sucesso!', type: 'success' });
    } catch (error) {
      console.error('Error generating questions:', error);
      setNotification({ message: 'Erro ao gerar perguntas.', type: 'error' });
    } finally {
      setGeneratingQuestions(false);
    }
  };

  const deleteApp = async (id: string) => {
    if (!user) return;
    try {
      await updateDoc(doc(db, `users/${user.uid}/applications`, id), {
        status: '🗑️ Descarte',
        updatedAt: new Date().toISOString()
      });
      setAppToDelete(null);
      setNotification({ message: 'Vaga movida para descarte.', type: 'success' });
    } catch (error) {
      console.error('Error deleting app:', error);
      setNotification({ message: 'Erro ao descartar vaga.', type: 'error' });
    }
  };

  const handleReanalyzeApp = async (app: any) => {
    if (!user) return;
    setSyncing(true);
    try {
      const userDoc = await getDoc(doc(db, `users/${user.uid}`));
      const userData = userDoc.data();
      const masterProfile = userData?.masterProfile || '';
      const geminiApiKey = userData?.geminiApiKey || '';
      const geminiModel = userData?.geminiModel || 'gemini-2.5-flash';

      const analysis = await analyzeJobMatch(app.jobDescription, masterProfile, geminiApiKey, geminiModel);
      const status = analysis.tier === 'Diamond' ? '⏳ Input IA' : 
                     analysis.tier === 'Discard' ? '⚠️ Mismatch' : 
                     '⚙️ Gerar Docs';
      
      const updatedData = {
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
      };
      
      await updateDoc(doc(db, `users/${user.uid}/applications`, app.id), updatedData);
      if (selectedApp?.id === app.id) {
        setSelectedApp({ ...selectedApp, ...updatedData });
      }
      setNotification({ message: 'Análise atualizada!', type: 'success' });
    } catch (error: any) {
      console.error('Error reanalyzing app:', error);
      setNotification({ message: `Erro: ${error.message}`, type: 'error' });
    } finally {
      setSyncing(false);
    }
  };

  const handleGenerateApplication = async (appOverride?: any) => {
    const app = appOverride || selectedApp;
    if (!app || !user) return;
    
    // If single, set global states
    if (!appOverride) {
      setGenerating(true);
      setGenStatus('Iniciando processo...');
      setNotification(null);
    }

    try {
      const path = `users/${user.uid}`;
      let userData;
      try {
        const userDoc = await getDoc(doc(db, path));
        userData = userDoc.data();
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, path);
      }
      
      const masterProfile = userData?.masterProfile || '';
      const name = userData?.name || 'Nhaiara Moura';

      const match = app.matchScore;
      const isDiamond = match === 'Diamond';
      const isGold = match === 'Gold';

      // Use template IDs from profile or fallback to constants
      const cvDiamondId = extractFileId(userData?.cvDiamondFileId || CV_LEVEL_1_2_ID);
      const cvGoldId = extractFileId(userData?.cvGoldFileId || CV_LEVEL_1_2_ID);
      const cvSilverId = extractFileId(userData?.cvSilverFileId || CV_LEVEL_3_ID);
      const outputFolderId = extractFileId(userData?.outputFolderId || OUTPUT_FOLDER_ID);
      const processedFolderId = extractFileId(userData?.processedFolderId || PROCESSED_FOLDER_ID);
      
      const clDiamondId = extractFileId(userData?.clDiamondFileId);
      const clGoldId = extractFileId(userData?.clGoldFileId);
      
      const geminiApiKey = userData?.geminiApiKey || '';
      const geminiModel = userData?.geminiModel || 'gemini-2.5-flash';

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

      if (isDiamond && genStep === 'idle') {
        if (!appOverride) setGenStatus('IA analisando vaga e gerando perguntas...');
        // Questions are already in the app document from the sync phase
        if (app.diamondQuestions && app.diamondQuestions.length > 0) {
          if (!appOverride) setQuestions(app.diamondQuestions);
          if (!appOverride) setGenStep('questions');
        } else {
          // Fallback if questions weren't generated during sync
          const analysis = await analyzeJobMatch(app.jobDescription, masterProfile, geminiApiKey, geminiModel);
          if (!appOverride) setQuestions(analysis.diamondQuestions || []);
          if (!appOverride) setGenStep('questions');
        }
        
        // Scroll to questions after a short delay to allow rendering
        if (!appOverride) {
          setTimeout(() => {
            questionsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }, 100);
        }
        return; // Wait for answers
      } else if (isDiamond && genStep === 'questions') {
        if (!appOverride) setGenStep('finalizing');
        if (!appOverride) setGenStatus('IA gerando documentos finais Diamond...');
        cvTemplateId = cvDiamondId;
        clTemplateId = clDiamondId;
        
        const answersStr = Object.entries(answers).map(([q, a]) => `Q: ${q}\nA: ${a}`).join('\n\n');
        const result = await generateDiamond(app.jobDescription, masterProfile, answersStr, '', geminiApiKey, geminiModel, userData?.generationRules);
        tags = { ...tags, ...result };

        // Save learning to Master Profile
        if (!appOverride) setGenStatus('IA atualizando Perfil Master com novos aprendizados...');
        const updatedProfile = await updateMasterProfileWithLearnings(masterProfile, answersStr, geminiApiKey, geminiModel);
        if (updatedProfile && updatedProfile !== masterProfile) {
          await updateDoc(doc(db, 'users', user.uid), {
            masterProfile: updatedProfile,
            updatedAt: new Date().toISOString()
          });

          // Sync back to Google Doc if available
          if (userData?.masterProfileFileId && googleTokens?.access_token) {
            try {
              if (!appOverride) setGenStatus('Sincronizando Perfil Master com Google Drive...');
              await fetch('/api/update-doc-content', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  fileId: userData.masterProfileFileId,
                  content: updatedProfile,
                  accessToken: googleTokens.access_token,
                  refreshToken: googleTokens.refresh_token
                })
              });
            } catch (syncError) {
              console.error('Failed to sync master profile to Drive:', syncError);
            }
          }
        }
      } else if (isGold) {
        if (!appOverride) setGenStep('finalizing');
        if (!appOverride) setGenStatus('IA gerando documentos Gold...');
        cvTemplateId = cvGoldId;
        clTemplateId = clGoldId;
        
        const result = await generateGold(app.jobDescription, masterProfile, app.company || 'Empresa', '', geminiApiKey, geminiModel, userData?.generationRules);
        tags = { ...tags, ...result };
      } else {
        if (!appOverride) setGenStep('finalizing');
        if (!appOverride) setGenStatus('IA gerando aplicação Silver...');
        cvTemplateId = cvSilverId;
        const result = await generateSilver(app.jobDescription, masterProfile, geminiApiKey, geminiModel, userData?.generationRules);
        tags = { ...tags, ...result };
      }

      setGenStatus('Criando pasta e documentos no Google Drive...');
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
      const msg = error.message || '';
      if (!appOverride) {
        if (msg.includes('authentication') || msg.includes('credentials') || msg.includes('401') || msg.includes('403')) {
          setGoogleTokens(null);
          localStorage.removeItem('google_drive_tokens');
          setNotification({ message: 'Sessão do Google Drive expirada. Por favor, conecte novamente.', type: 'error' });
        } else {
          setNotification({ message: `Erro: ${error.message}`, type: 'error' });
        }
      }
      return false;
    } finally {
      setGenerating(false);
      setGenStatus('');
    }
  };

  useEffect(() => {
    if ((generating || generatingTips) && genStatusRef.current) {
      genStatusRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [generating, generatingTips]);

  const openDetail = (app: any) => {
    setSelectedApp(app);
    setIsDetailOpen(true);
    setIsDescExpanded(false);
  };

  const handleBatchGenerate = async () => {
    if (!user) return;
    
    // Get all apps and find top 5 Gold/Silver that need docs
    const q = query(collection(db, `users/${user.uid}/applications`));
    const snapshot = await getDocs(q);
    const allSnapshot = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));

    const candidates = allSnapshot
      .filter(app => (app.matchScore === 'Gold' || app.matchScore === 'Silver') && app.status === '⚙️ Gerar Docs')
      .sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0))
      .slice(0, 5);

    if (candidates.length === 0) {
      setNotification({ message: 'Nenhuma vaga Gold ou Silver pendente de documentos encontrada.', type: 'error' });
      return;
    }

    setGenerating(true);
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

  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  useEffect(() => {
    if (!user) return;

    // Single listener for all applications to save quota
    const qAll = query(collection(db, `users/${user.uid}/applications`));
    
    const unsubscribe = onSnapshot(qAll, (snapshot) => {
      const all = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));
      
      // Derive stats
      const pendingActionStatuses = ['📥 Nova', '⏳ Input IA', '⚙️ Gerar Docs', '✅ Aplicar'];
      const feedbackStatuses = ['📩 Triagem', '🕰️ Feedback'];
      const closedStatuses = ['🗑️ Descarte', '❌ Rejeitada', '⚠️ Mismatch'];

      setStats({
        pendingAction: all.filter((a: any) => pendingActionStatuses.includes(a.status)).length,
        feedback: all.filter((a: any) => feedbackStatuses.includes(a.status)).length,
        interviews: all.filter((a: any) => a.status === '🗣️ Entrevistas').length,
        activeDiamonds: all.filter((a: any) => 
          a.matchScore === 'Diamond' && 
          !['❌ Rejeitada', '🗑️ Descarte', '🤝 Sucesso', '⚠️ Mismatch'].includes(a.status)
        ).length,
        closed: all.filter((a: any) => closedStatuses.includes(a.status)).length,
      });

      // Derive high priority apps (sorted by totalScore desc, limit 5)
      const sortedByScoreDesc = [...all].sort((a, b) => 
        (b.totalScore || 0) - (a.totalScore || 0)
      );
      setRecentApps(sortedByScoreDesc.slice(0, 5));

      // Derive top match among non-completed
      const pending = all.filter((a: any) => !['✅ Aplicar', '📩 Triagem', '🗑️ Descarte', '❌ Rejeitada', '🤝 Sucesso'].includes(a.status));
      const sortedByScore = [...pending].sort((a: any, b: any) => {
        const scores: any = { 'Diamond': 4, 'Gold': 3, 'Silver': 2, 'Discard': 0 };
        return (scores[b.matchScore] || 0) - (scores[a.matchScore] || 0);
      });
      setTopMatch(sortedByScore[0]);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `users/${user.uid}/applications`);
    });

    return () => unsubscribe();
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
          setTimeout(() => handleSyncDrive(tokens), 500);
        }
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [pendingSync, user]);

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
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      const userData = userDoc.data();
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

      // Get all existing apps to prevent duplicates properly
      const allAppsQuery = query(collection(db, `users/${user.uid}/applications`));
      const allAppsSnapshot = await getDocs(allAppsQuery);
      const allApps = allAppsSnapshot.docs.map(doc => doc.data());
      const existingFileIds = new Set(allApps.map(app => app.driveFileId).filter(Boolean));
      const existingContents = new Set(allApps.map(app => app.jobDescription?.trim()).filter(Boolean));

      for (const file of files) {
        const fileContentTrimmed = file.content?.trim();
        const existsById = existingFileIds.has(file.id);
        const existsByContent = existingContents.has(fileContentTrimmed);

        if (existsById || existsByContent) {
          // Duplicate (ID or content), move file but don't add to DB
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
          const analysis = await analyzeJobMatch(file.content, masterProfile, geminiApiKey, userData?.geminiModel || 'gemini-2.5-flash');
          const status = analysis.tier === 'Diamond' ? '⏳ Input IA' : 
                         analysis.tier === 'Discard' ? '⚠️ Mismatch' : 
                         '⚙️ Gerar Docs';

          await addDoc(collection(db, `users/${user.uid}/applications`), {
            company: analysis.company || 'Unknown',
            role: analysis.role || file.name,
            location: analysis.location || 'Remote',
            link: '',
            jobDescription: file.content,
            matchScore: analysis.tier,
            totalScore: analysis.totalScore,
            matchReasoning: analysis.reason,
            goldenPillar: analysis.goldenPillar,
            diamondQuestions: analysis.diamondQuestions || [],
            driveFileId: file.id,
            driveFolderLink: '',
            status: status,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            uid: user.uid
          });

          // Update local sets to prevent duplicates in the same batch
          existingFileIds.add(file.id);
          if (fileContentTrimmed) existingContents.add(fileContentTrimmed);

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
        message: processedCount > 0 ? `Drive sincronizado! ${processedCount} novas vagas adicionadas.` : 'Drive sincronizado! Nenhuma nova vaga encontrada.', 
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

  const statCards = [
    { name: 'Ação Pendente', value: stats.pendingAction, icon: PlayCircle, color: 'blue', filter: 'Pending' },
    { name: 'Em Triagem/Feedback', value: stats.feedback, icon: Clock, color: 'amber', filter: 'Feedback' },
    { name: 'Em Entrevista', value: stats.interviews, icon: Users, color: 'purple', filter: '🗣️ Entrevistas' },
    { name: 'Diamonds Ativas', value: stats.activeDiamonds, icon: Gem, color: 'cyan', filter: 'Diamond' },
    { name: 'Fechadas / Mismatch', value: stats.closed, icon: XCircle, color: 'red', filter: 'Closed' },
  ];

  return (
    <div className="space-y-8">
      <header className="flex justify-between items-end">
        <div>
          <h2 className="text-3xl font-bold text-slate-900">Dashboard</h2>
          <p className="text-slate-500 mt-1">Bem-vinda de volta ao seu centro de comando de carreira.</p>
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
        </div>
      </header>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-6">
        {statCards.map((stat, i) => (
          <motion.div
            key={stat.name}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            onClick={() => {
              if (stat.filter === 'Diamond') {
                navigate(`/applications?tier=Diamond&hideFinal=true`);
              } else if (stat.filter === 'Pending') {
                navigate(`/applications?status=📥 Nova,⏳ Input IA,⚙️ Gerar Docs,✅ Aplicar`);
              } else if (stat.filter === 'Feedback') {
                navigate(`/applications?status=📩 Triagem,🕰️ Feedback`);
              } else if (stat.filter === 'Closed') {
                navigate(`/applications?status=🗑️ Descarte,❌ Rejeitada,⚠️ Mismatch`);
              } else {
                navigate(`/applications?status=${encodeURIComponent(stat.filter)}`);
              }
            }}
            className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm cursor-pointer hover:shadow-md hover:border-blue-100 transition-all group"
          >
            <div className={`w-12 h-12 rounded-xl bg-${stat.color}-50 flex items-center justify-center mb-4 transition-transform group-hover:scale-110`}>
              <stat.icon className={`text-${stat.color}-600`} size={24} />
            </div>
            <p className="text-sm font-medium text-slate-500">{stat.name}</p>
            <p className="text-2xl font-bold text-slate-900 mt-1">{stat.value}</p>
          </motion.div>
        ))}
      </div>

      {/* AI Insight Banner */}
      {topMatch && (
        <motion.div 
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-gradient-to-r from-blue-600 to-indigo-700 rounded-2xl p-6 text-white shadow-xl shadow-blue-100 flex flex-col md:flex-row items-center justify-between gap-6 relative group"
        >
          <button 
            onClick={() => setTopMatch(null)}
            className="absolute top-4 right-4 p-1.5 bg-white/10 hover:bg-white/20 rounded-lg transition-all opacity-0 group-hover:opacity-100"
            title="Fechar Insight"
          >
            <X size={14} />
          </button>
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center backdrop-blur-sm">
              <Sparkles size={24} className="text-blue-100" />
            </div>
            <div>
              <h3 className="font-bold text-lg">AI Insight</h3>
              <p className="text-blue-100 text-sm">
                Nhaiara, notei que você tem {stats.activeDiamonds} vagas de nível 💎 pendentes. O match técnico com a <b>{topMatch.company}</b> é <b>{topMatch.matchScore}</b>.
              </p>
            </div>
          </div>
          <button 
            onClick={() => openDetail(topMatch)}
            className="px-6 py-2 bg-white text-blue-700 rounded-xl font-bold text-sm shadow-lg hover:bg-blue-50 transition-colors whitespace-nowrap"
          >
            Ver Detalhes da Vaga
          </button>
        </motion.div>
      )}

      <div className="grid grid-cols-1 gap-8">
        {/* High Priority Applications */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-slate-50 flex justify-between items-center">
            <h3 className="font-bold text-slate-900">Aplicações de Alta Prioridade</h3>
            <Link to="/applications" className="text-sm text-blue-600 font-medium flex items-center gap-1 hover:underline">
              Ver todas <ArrowRight size={14} />
            </Link>
          </div>
          <div className="divide-y divide-slate-50">
            {recentApps.length > 0 ? (
              recentApps.map((app) => (
                <div 
                  key={app.id} 
                  onClick={() => openDetail(app)}
                  className="p-6 flex items-center justify-between hover:bg-slate-50 transition-colors cursor-pointer group"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center font-bold text-slate-400">
                      {app.company[0]}
                    </div>
                    <div>
                      <h4 className="font-semibold text-slate-900">{app.role}</h4>
                      <p className="text-sm text-slate-500">{app.company} • {app.location}</p>
                      {app.link && (
                        <a 
                          href={app.link} 
                          target="_blank" 
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 text-blue-600 rounded text-[10px] font-bold hover:bg-blue-100 transition-colors mt-1"
                        >
                          <ExternalLink size={10} /> Apply
                        </a>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity pr-4" onClick={(e) => e.stopPropagation()}>
                      {app.status === '✅ Aplicar' && (
                        <button 
                          onClick={() => updateStatus(app.id, '📩 Triagem')}
                          className="p-2 text-indigo-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                          title="Marcar como Aplicada"
                        >
                          <Send size={16} />
                        </button>
                      )}
                      <button 
                        onClick={() => setAppToDelete(app.id)}
                        className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        title="Descartar Vaga"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                    <div className={cn(
                      "px-3 py-1 rounded-full text-[10px] font-bold border flex items-center gap-1.5",
                      getStatusStyle(app.status).bg,
                      getStatusStyle(app.status).text,
                      getStatusStyle(app.status).border
                    )}>
                      {getStatusStyle(app.status).icon}
                      {app.status}
                    </div>
                    <span className="text-xs text-slate-400">
                      {new Date(app.updatedAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <div className="p-12 text-center text-slate-500">
                Nenhuma aplicação encontrada. Comece adicionando uma nova vaga!
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {appToDelete && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl"
            >
              <h3 className="text-lg font-bold text-slate-900 mb-2">Descartar Vaga?</h3>
              <p className="text-slate-500 text-sm mb-6">
                Esta ação moverá a vaga para o status de Descarte. Você poderá recuperá-la ou excluí-la permanentemente depois.
              </p>
              <div className="flex gap-3">
                <button 
                  onClick={() => setAppToDelete(null)}
                  className="flex-1 px-4 py-2 bg-slate-100 text-slate-600 font-bold rounded-lg hover:bg-slate-200 transition-colors"
                >
                  Cancelar
                </button>
                <button 
                  onClick={() => deleteApp(appToDelete)}
                  className="flex-1 px-4 py-2 bg-red-600 text-white font-bold rounded-lg hover:bg-red-700 transition-colors"
                >
                  Descartar
                </button>
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
                      selectedApp.matchScore === 'Diamond' ? 'bg-amber-50 text-amber-700 border-amber-100' :
                      selectedApp.matchScore === 'Gold' ? 'bg-blue-50 text-blue-700 border-blue-100' :
                      selectedApp.matchScore === 'Silver' ? 'bg-slate-50 text-slate-700 border-slate-100' :
                      'bg-red-50 text-red-700 border-red-100'
                    )}>
                      {selectedApp.matchScore} Match ({selectedApp.totalScore}%)
                    </span>
                  </div>
                  <p className="text-slate-500 font-medium">{selectedApp.company} • {selectedApp.location}</p>
                </div>
                <button onClick={() => setIsDetailOpen(false)} className="text-slate-400 hover:text-slate-600 p-2 transition-colors">
                  <XCircle size={24} />
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
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Descrição da Vaga</h4>
                    <button 
                      onClick={() => setIsDescExpanded(!isDescExpanded)}
                      className="text-xs text-blue-600 font-bold hover:underline flex items-center gap-1"
                    >
                      {isDescExpanded ? 'Ver menos' : 'Ver mais'}
                      <ArrowRight size={12} className={cn("transition-transform", isDescExpanded ? "-rotate-90" : "rotate-90")} />
                    </button>
                  </div>
                  <div className={cn(
                    "bg-white p-6 rounded-xl border border-slate-200 text-sm text-slate-600 whitespace-pre-wrap font-mono transition-all duration-300 overflow-hidden relative",
                    isDescExpanded ? "max-h-none pb-12" : "max-h-32"
                  )}>
                    {selectedApp.jobDescription}
                    {!isDescExpanded && (
                      <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-white to-transparent pointer-events-none" />
                    )}
                  </div>
                </div>

                {/* Diamond Questions Section */}
                {selectedApp.matchScore === 'Diamond' && genStep !== 'questions' && (
                  <div className="space-y-6 bg-amber-50/50 p-6 rounded-2xl border border-amber-100">
                    <div className="flex items-center justify-between gap-3 mb-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center text-amber-600">
                          <Sparkles size={20} />
                        </div>
                        <div>
                          <h4 className="font-bold text-amber-900">Perguntas Diamond</h4>
                          <p className="text-xs text-amber-700">Responda para capturar nuances específicas</p>
                        </div>
                      </div>
                      {questions.length === 0 && (
                        <button 
                          onClick={handleGenerateQuestions}
                          disabled={generatingQuestions}
                          className="px-4 py-2 bg-amber-600 text-white text-xs font-bold rounded-lg hover:bg-amber-700 transition-colors flex items-center gap-2 disabled:opacity-50"
                        >
                          {generatingQuestions ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                          Gerar Perguntas
                        </button>
                      )}
                    </div>
                    {questions.length > 0 ? (
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
                    ) : (
                      <div className="text-center py-4">
                        <p className="text-sm text-amber-800 italic">Nenhuma pergunta gerada para este match técnico.</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Interview Preparation Section */}
                {selectedApp.status === '🗣️ Entrevistas' && (
                  <div className="space-y-6">
                    <div className="bg-indigo-50/50 p-6 rounded-2xl border border-indigo-100 space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600">
                            <Clock size={20} />
                          </div>
                          <div>
                            <h4 className="font-bold text-indigo-900">Preparação para Entrevista</h4>
                            <p className="text-xs text-indigo-700">Anote detalhes do convite ou do e-mail</p>
                          </div>
                        </div>
                        <button 
                          onClick={handleGenerateInterviewTips}
                          disabled={generatingTips || !selectedApp.interviewNotes}
                          className="px-4 py-2 bg-indigo-600 text-white text-xs font-bold rounded-lg hover:bg-indigo-700 transition-colors flex items-center gap-2 disabled:opacity-50"
                        >
                          {generatingTips ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                          Gerar Guia de Preparação
                        </button>
                      </div>

                      <textarea 
                        value={selectedApp.interviewNotes || ''}
                        onChange={async (e) => {
                          const notes = e.target.value;
                          setSelectedApp({ ...selectedApp, interviewNotes: notes });
                          if (!user) return;
                          await updateDoc(doc(db, `users/${user.uid}/applications`, selectedApp.id), {
                            interviewNotes: notes,
                            updatedAt: new Date().toISOString()
                          });
                        }}
                        className="w-full px-4 py-3 bg-white border border-indigo-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none min-h-[120px]"
                        placeholder="Cole aqui o e-mail de convite, nomes dos entrevistadores, ou tópicos que você quer revisar..."
                      />
                    </div>

                    {selectedApp.interviewSuggestions && (
                      <div className="bg-emerald-50/50 p-6 rounded-2xl border border-emerald-100 space-y-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600">
                            <Sparkles size={20} />
                          </div>
                          <h4 className="font-bold text-emerald-900">Guia de Preparação (IA)</h4>
                        </div>
                        <div className="prose prose-sm max-w-none prose-emerald bg-white p-6 rounded-xl border border-emerald-100">
                          <Markdown>{selectedApp.interviewSuggestions}</Markdown>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Discard / Rejection / Mismatch Reason Section */}
                {['🗑️ Descarte', '❌ Rejeitada', '⚠️ Mismatch'].includes(selectedApp.status) && (
                  <div className="space-y-4">
                    <h4 className="text-sm font-bold text-red-600 uppercase tracking-wider">Anotações (Motivo)</h4>
                    <div className="bg-red-50 p-6 rounded-xl border border-red-100 text-sm text-red-900">
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
                        placeholder="Anote aqui o motivo da rejeição, descarte ou observações sobre o mismatch..."
                        className="w-full bg-transparent outline-none min-h-[100px] resize-none"
                      />
                    </div>
                  </div>
                )}

                {/* Diamond Questions Section */}
                {selectedApp.matchScore === 'Diamond' && genStep !== 'questions' && (
                  <div className="space-y-6 bg-amber-50/50 p-6 rounded-2xl border border-amber-100">
                    <div className="flex items-center justify-between gap-3 mb-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center text-amber-600">
                          <Sparkles size={20} />
                        </div>
                        <div>
                          <h4 className="font-bold text-amber-900">Perguntas Diamond</h4>
                          <p className="text-xs text-amber-700">Responda para capturar nuances específicas</p>
                        </div>
                      </div>
                      {questions.length === 0 && (
                        <button 
                          onClick={handleGenerateQuestions}
                          disabled={generatingQuestions}
                          className="px-4 py-2 bg-amber-600 text-white text-xs font-bold rounded-lg hover:bg-amber-700 transition-colors flex items-center gap-2 disabled:opacity-50"
                        >
                          {generatingQuestions ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                          Gerar Perguntas
                        </button>
                      )}
                    </div>
                    {questions.length > 0 ? (
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
                    ) : (
                      <div className="text-center py-4">
                        <p className="text-sm text-amber-800 italic">Nenhuma pergunta gerada para este match técnico.</p>
                      </div>
                    )}
                  </div>
                )}

                {genStep === 'questions' && (
                  <div ref={questionsRef} className="space-y-6 bg-amber-50/50 p-6 rounded-2xl border border-amber-100 animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center text-amber-600">
                        <Sparkles size={20} />
                      </div>
                      <div>
                        <h4 className="font-bold text-amber-900">Perguntas Diamond</h4>
                        <p className="text-xs text-amber-700">Responda para capturar nuances específicas</p>
                      </div>
                    </div>
                    <div className="space-y-4">
                      {questions.map((q, i) => (
                        <div key={i} className="space-y-1.5">
                          <label className="text-xs font-bold text-amber-800">{q}</label>
                          <textarea 
                            value={answers[q] || ''}
                            onChange={(e) => setAnswers({ ...answers, [q]: e.target.value })}
                            className="w-full px-4 py-2 bg-white border border-amber-200 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 outline-none min-h-[80px]"
                            placeholder="Sua resposta com dados e métricas..."
                          />
                        </div>
                      ))}
                      <button 
                        onClick={handleGenerateApplication}
                        disabled={generating}
                        className="w-full py-3 bg-amber-600 text-white font-bold rounded-xl hover:bg-amber-700 transition-all shadow-lg shadow-amber-200 flex items-center justify-center gap-2"
                      >
                        {generating ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />}
                        Finalizar e Gerar PDFs
                      </button>
                    </div>
                  </div>
                )}

                {/* Operations Section */}
                <div className="pt-6 border-t border-slate-100 grid grid-cols-2 gap-8">
                  <div className="space-y-3">
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Operação</h4>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-slate-500">Status Atual:</span>
                        <div className="relative">
                          <select 
                            value={selectedApp.status}
                            onChange={(e) => updateStatus(selectedApp.id, e.target.value)}
                            className={cn(
                              "text-[10px] font-bold px-3 py-1.5 rounded-full border outline-none cursor-pointer appearance-none text-center min-w-[140px] transition-colors pr-8",
                              getStatusStyle(selectedApp.status).bg,
                              getStatusStyle(selectedApp.status).text,
                              getStatusStyle(selectedApp.status).border
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
                            <option value="⚠️ Mismatch">⚠️ Mismatch</option>
                            <option value="❌ Rejeitada">❌ Rejeitada</option>
                            <option value="🗑️ Descarte">🗑️ Descarte</option>
                          </select>
                          <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none opacity-50">
                            <ChevronDown size={10} className={getStatusStyle(selectedApp.status).text} />
                          </div>
                          <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                            {getStatusStyle(selectedApp.status).icon}
                          </div>
                        </div>
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

                {/* Automation Section */}
                <div id="gen-progress-dashboard" className="pt-4 pb-8">
                  {(generating || generatingTips) && (
                    <div ref={genStatusRef} className="bg-blue-50 p-4 rounded-xl border border-blue-100 flex items-center gap-3 animate-pulse">
                      <Loader2 className="animate-spin text-blue-600" size={20} />
                      <span className="text-sm font-medium text-blue-700">
                        {generating ? genStatus : 'Gerando guia de preparação para entrevista...'}
                      </span>
                    </div>
                  )}
                  {syncing && (
                    <div className="bg-amber-50 p-4 rounded-xl border border-amber-100 flex items-center gap-3 animate-pulse mt-2">
                      <Loader2 className="animate-spin text-amber-600" size={20} />
                      <span className="text-sm font-medium text-amber-700">Sincronizando/Analisando com Gemini...</span>
                    </div>
                  )}
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
                            updateStatus(selectedApp.id, '📩 Triagem');
                            setIsDetailOpen(false);
                          }}
                          className="px-8 py-2 bg-indigo-600 text-white font-bold rounded-lg hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200 flex items-center gap-2"
                        >
                          <Send size={18} />
                          Marcar como Aplicada
                        </button>
                      ) : genStep === 'idle' && ['📥 Nova', '⏳ Input IA', '⚙️ Gerar Docs'].includes(selectedApp.status) && (
                        <button 
                          onClick={handleGenerateApplication}
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

                      {selectedApp.link && selectedApp.status === '✅ Aplicar' && (
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
    </div>
  );
}
