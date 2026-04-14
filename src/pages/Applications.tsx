import React, { useState, useEffect, useRef } from 'react';
import { collection, query, onSnapshot, orderBy, addDoc, updateDoc, doc, deleteDoc, serverTimestamp, getDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../hooks/useAuth';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { extractFileId } from '../lib/driveUtils';
import { analyzeJob, generateLevel1Questions, generateLevel1Final, generateLevel2, generateLevel3 } from '../lib/gemini';
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
  Loader2
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
  const [newApp, setNewApp] = useState({
    company: '',
    role: '',
    location: '',
    link: '',
    jobDescription: ''
  });

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
      setApps(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      setLoading(false);
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
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      const userData = userDoc.data();
      const folderId = userData?.driveFolderId;
      const masterProfile = userData?.masterProfile || '';
      const customRules = userData?.customRules || '';

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
          processedFolderId: PROCESSED_FOLDER_ID
        })
      });
      
      const data = await response.json();
      if (data.error) {
        throw new Error(data.error);
      }
      
      const files = data.files || [];

      for (const file of files) {
        // Check if already exists (by name or some metadata)
        const exists = apps.some(app => app.driveFileId === file.id);
        if (exists) continue;

        // Analyze (Frontend)
        const analysis = await analyzeJob(file.content, masterProfile, customRules);

        // Save
        await addDoc(collection(db, `users/${user.uid}/applications`), {
          company: analysis.company || 'Unknown',
          role: analysis.role || file.name,
          location: analysis.location || 'Unknown',
          jobDescription: file.content,
          driveFileId: file.id,
          driveFolderLink: '', // To be filled manually or by future automation
          ...analysis,
          uid: user.uid,
          status: analysis.suggestedStatus || '🤖 Auto',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
      }
      setNotification({ message: 'Sincronização concluída!', type: 'success' });
    } catch (error: any) {
      console.error('Error syncing drive:', error);
      setNotification({ message: `Erro ao sincronizar: ${error.message}`, type: 'error' });
    } finally {
      setSyncing(false);
    }
  };

  const handleGenerateApplication = async () => {
    if (!selectedApp || !user) return;
    setGenerating(true);
    setGenStatus('Iniciando processo...');
    setNotification(null);

    try {
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      const userData = userDoc.data();
      const masterProfile = userData?.masterProfile || '';
      const name = userData?.name || 'Nhaiara Moura';

      const match = selectedApp.matchScore;
      const isLevel1 = match === 'Altíssima';
      const isLevel2 = match === 'Alta' || match === 'Média';
      // Level 3 is Baixa or Incompatível (though incompatível might not be processed)

      // Fetch CV content
      setGenStatus('Buscando currículo base no Drive...');
      
      // Use template IDs from profile or fallback to constants
      const cvLevel1Id = extractFileId(userData?.cvLevel1FileId || CV_LEVEL_1_2_ID);
      const cvLevel23Id = extractFileId(userData?.cvLevel23FileId || CV_LEVEL_3_ID);
      
      const cvId = (isLevel1 || isLevel2) ? cvLevel1Id : cvLevel23Id;
      const cvResponse = await fetch('/api/get-drive-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          fileId: cvId,
          accessToken: googleTokens?.access_token
        })
      });
      const cvData = await cvResponse.json();
      const cvContent = cvData.content;

      if (isLevel1 && genStep === 'idle') {
        // Step 1: Generate Questions
        setGenStatus('IA analisando vaga e gerando perguntas...');
        const result = await generateLevel1Questions(selectedApp.jobDescription, masterProfile, cvContent);
        setQuestions(result.questions);
        setGenStep('questions');
        // Scroll to questions after a short delay to allow rendering
        setTimeout(() => {
          questionsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 100);
      } else if (isLevel1 && genStep === 'questions') {
        // Step 2: Finalize Level 1
        setGenStep('finalizing');
        setGenStatus('IA gerando documentos finais...');
        // Scroll to status
        setTimeout(() => {
          genStatusRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 100);
        const answersStr = Object.entries(answers).map(([q, a]) => `Q: ${q}\nA: ${a}`).join('\n\n');
        const result = await generateLevel1Final(selectedApp.jobDescription, masterProfile, cvContent, answersStr);
        
        // Generate PDF and Upload to Drive
        setGenStatus('Criando pasta e PDFs no Google Drive...');
        const genResponse = await fetch('/api/generate-application', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            company: selectedApp.company,
            role: selectedApp.role,
            cvContent: result.tunedCV,
            clContent: result.coverLetter,
            outputFolderId: OUTPUT_FOLDER_ID,
            processedFolderId: PROCESSED_FOLDER_ID,
            originalFileId: selectedApp.driveFileId,
            accessToken: googleTokens?.access_token
          })
        });
        const genData = await genResponse.json();
        
        if (genData.error) {
          throw new Error(genData.error);
        }

        if (!genData.folderLink) {
          throw new Error('Drive folder link was not generated.');
        }
        
        setGenStatus('Atualizando banco de dados...');
        await updateDoc(doc(db, `users/${user.uid}/applications`, selectedApp.id), {
          driveFolderLink: genData.folderLink,
          status: '✅ Pronto',
          updatedAt: new Date().toISOString()
        });

        setNotification({ message: 'Aplicação Nível 1 gerada com sucesso!', type: 'success' });
        setGenStep('idle');
        setIsDetailOpen(false);
      } else if (isLevel2) {
        setGenStep('finalizing');
        setGenStatus('IA gerando documentos personalizados...');
        // Scroll to status
        setTimeout(() => {
          genStatusRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 100);
        const result = await generateLevel2(selectedApp.jobDescription, masterProfile, cvContent);
        
        setGenStatus('Criando pasta e PDFs no Google Drive...');
        const genResponse = await fetch('/api/generate-application', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            company: selectedApp.company,
            role: selectedApp.role,
            cvContent: result.tunedCV,
            clContent: result.coverLetter,
            outputFolderId: OUTPUT_FOLDER_ID,
            processedFolderId: PROCESSED_FOLDER_ID,
            originalFileId: selectedApp.driveFileId,
            accessToken: googleTokens?.access_token
          })
        });
        const genData = await genResponse.json();
        
        if (genData.error) {
          throw new Error(genData.error);
        }

        if (!genData.folderLink) {
          throw new Error('Drive folder link was not generated.');
        }
        
        setGenStatus('Atualizando banco de dados...');
        await updateDoc(doc(db, `users/${user.uid}/applications`, selectedApp.id), {
          driveFolderLink: genData.folderLink,
          status: '✅ Pronto',
          updatedAt: new Date().toISOString()
        });

        setNotification({ message: 'Aplicação Nível 2 gerada com sucesso!', type: 'success' });
        setGenStep('idle');
        setIsDetailOpen(false);
      } else {
        // Level 3
        setGenStep('finalizing');
        setGenStatus('IA gerando Cover Letter rápida...');
        // Scroll to status
        setTimeout(() => {
          genStatusRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 100);
        const result = await generateLevel3(selectedApp.jobDescription, cvContent);
        
        setGenStatus('Criando pasta e PDFs no Google Drive...');
        const genResponse = await fetch('/api/generate-application', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            company: selectedApp.company,
            role: selectedApp.role,
            cvContent: result.tunedCV,
            clContent: result.coverLetter,
            outputFolderId: OUTPUT_FOLDER_ID,
            processedFolderId: PROCESSED_FOLDER_ID,
            originalFileId: selectedApp.driveFileId,
            accessToken: googleTokens?.access_token
          })
        });
        const genData = await genResponse.json();
        
        if (genData.error) {
          throw new Error(genData.error);
        }

        if (!genData.folderLink) {
          throw new Error('Drive folder link was not generated.');
        }
        
        setGenStatus('Atualizando banco de dados...');
        await updateDoc(doc(db, `users/${user.uid}/applications`, selectedApp.id), {
          driveFolderLink: genData.folderLink,
          status: '✅ Pronto',
          updatedAt: new Date().toISOString()
        });

        setNotification({ message: 'Aplicação Nível 3 gerada com sucesso!', type: 'success' });
        setGenStep('idle');
        setIsDetailOpen(false);
      }
    } catch (error: any) {
      console.error('Error generating application:', error);
      setNotification({ message: `Erro: ${error.message}`, type: 'error' });
    } finally {
      setGenerating(false);
      setGenStatus('');
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

      // 2. Analyze with AI (Frontend)
      const analysis = await analyzeJob(newApp.jobDescription, masterProfile, customRules);

      // 3. Save to Firestore
      await addDoc(collection(db, `users/${user.uid}/applications`), {
        ...newApp,
        ...analysis,
        uid: user.uid,
        driveFolderLink: '',
        status: analysis.suggestedStatus || '🤖 Auto',
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
    await updateDoc(doc(db, `users/${user.uid}/applications`, id), {
      status,
      updatedAt: new Date().toISOString()
    });
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
            <option value="💎 Manual">💎 Manual</option>
            <option value="🤖 Auto">🤖 Auto</option>
            <option value="✅ Pronto">✅ Pronto</option>
            <option value="Enviada">Enviada</option>
            <option value="Entrevista">Entrevista</option>
            <option value="Aguardando feedback">Aguardando feedback</option>
            <option value="Rejeitada">Rejeitada</option>
            <option value="🗑️ Descartada">🗑️ Descartada</option>
          </select>
        </div>
      </div>

      {/* Applications List */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/50 border-b border-slate-100">
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Identidade</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Inteligência</th>
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
                      <div className="space-y-1">
                        <div className="font-bold text-slate-900 text-sm leading-tight">{app.role}</div>
                        <div className="text-[10px] text-slate-500 font-medium">
                          {app.company} • {app.location}
                        </div>
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
                        <div className="flex flex-wrap gap-x-2 gap-y-1 text-[9px] text-slate-400 mt-1">
                          <span>ID: {app.id.slice(0, 5)}</span>
                          <span>•</span>
                          <span>{new Date(app.createdAt).toLocaleDateString()}</span>
                          {app.driveFileId && (
                            <>
                              <span>•</span>
                              <span className="text-slate-400">FileID: {app.driveFileId.slice(0, 8)}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2">
                          <span className={cn(
                            "text-[10px] font-bold px-2 py-0.5 rounded",
                            app.matchScore === 'Altíssima' ? 'bg-emerald-100 text-emerald-800' :
                            app.matchScore === 'Alta' ? 'bg-blue-100 text-blue-800' :
                            app.matchScore === 'Média' ? 'bg-slate-100 text-slate-800' :
                            'bg-red-100 text-red-800'
                          )}>
                            {app.matchScore}
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-600 line-clamp-1">
                          <span className="font-bold text-slate-400">Gap:</span> {app.gapAnalysis || '-'}
                        </div>
                        <div className="text-[10px] text-slate-600 line-clamp-1">
                          <span className="font-bold text-slate-400">Pilar:</span> {app.pilarAbreAlas || '-'}
                        </div>
                        <div className="text-[10px] text-slate-600 line-clamp-1">
                          <span className="font-bold text-slate-400">Stack:</span> {app.keyStack || '-'}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4" onClick={(e) => e.stopPropagation()}>
                      <div className="flex flex-col gap-2">
                        <select 
                          value={app.status}
                          onChange={(e) => updateStatus(app.id, e.target.value)}
                          className={cn(
                            "text-[10px] font-bold px-2 py-1 rounded-full border outline-none cursor-pointer appearance-none text-center min-w-[100px]",
                            app.status.includes('💎') ? 'bg-amber-50 text-amber-700 border-amber-200' :
                            app.status.includes('🤖') ? 'bg-blue-50 text-blue-700 border-blue-200' :
                            app.status.includes('✅') ? 'bg-green-50 text-green-700 border-green-200' :
                            app.status === 'Enviada' ? 'bg-indigo-50 text-indigo-700 border-indigo-200' :
                            app.status === '🗑️ Descartada' ? 'bg-red-50 text-red-700 border-red-200' :
                            'bg-slate-50 text-slate-600 border-slate-200'
                          )}
                        >
                          <option value="💎 Manual">💎 Manual</option>
                          <option value="🤖 Auto">🤖 Auto</option>
                          <option value="✅ Pronto">✅ Pronto</option>
                          <option value="Enviada">Enviada</option>
                          <option value="Entrevista">Entrevista</option>
                          <option value="Aguardando feedback">Aguardando feedback</option>
                          <option value="Rejeitada">Rejeitada</option>
                          <option value="🗑️ Descartada">🗑️ Descartada</option>
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
                    <input 
                      value={newApp.link}
                      onChange={(e) => setNewApp({ ...newApp, link: e.target.value })}
                      className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                    />
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
            {notification.message}
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
                <button onClick={() => setIsDetailOpen(false)} className="text-slate-400 hover:text-slate-600 p-2">
                  <XCircle size={24} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-8 space-y-8">
                {/* Intelligence Section */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="bg-emerald-50/50 p-5 rounded-xl border border-emerald-100">
                    <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider mb-2">Pilar Abre-Alas (Forte)</p>
                    <p className="text-sm font-semibold text-emerald-900">{selectedApp.pilarAbreAlas || 'Não analisado'}</p>
                  </div>
                  <div className="bg-red-50/50 p-5 rounded-xl border border-red-100">
                    <p className="text-[10px] font-bold text-red-600 uppercase tracking-wider mb-2">Gap Principal (Fraco)</p>
                    <p className="text-sm font-semibold text-red-900">{selectedApp.gapAnalysis || 'Não analisado'}</p>
                  </div>
                  <div className="bg-blue-50/50 p-5 rounded-xl border border-blue-100">
                    <p className="text-[10px] font-bold text-blue-600 uppercase tracking-wider mb-2">Stack Chave</p>
                    <p className="text-sm font-semibold text-blue-900">{selectedApp.keyStack || 'Não analisado'}</p>
                  </div>
                </div>

                {/* Strategy Section */}
                <div className="space-y-4">
                  <h4 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Resiocínio do Match</h4>
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

                {/* Automation Section */}
                {generating && (
                  <div ref={genStatusRef} className="bg-blue-50 p-4 rounded-xl border border-blue-100 flex items-center gap-3 animate-pulse">
                    <Loader2 className="animate-spin text-blue-600" size={20} />
                    <span className="text-sm font-medium text-blue-700">{genStatus}</span>
                  </div>
                )}

                {genStep === 'questions' && (
                  <div ref={questionsRef} className="space-y-6 bg-amber-50/50 p-6 rounded-2xl border border-amber-100 animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center text-amber-600">
                        <Sparkles size={20} />
                      </div>
                      <div>
                        <h4 className="font-bold text-amber-900">Munição para Nível 1</h4>
                        <p className="text-xs text-amber-700">Responda para uma personalização extrema</p>
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
                        <span className="font-bold text-slate-900">{selectedApp.status}</span>
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

              <div className="p-6 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
                <button 
                  onClick={() => {
                    setIsDetailOpen(false);
                    setGenStep('idle');
                    setAnswers({});
                  }}
                  className="px-6 py-2 bg-white border border-slate-200 text-slate-600 font-bold rounded-lg hover:bg-slate-50 transition-colors"
                >
                  Fechar
                </button>
                
                {genStep === 'idle' && (
                  <button 
                    onClick={handleGenerateApplication}
                    disabled={generating}
                    className={cn(
                      "px-6 py-2 text-white font-bold rounded-lg transition-all shadow-lg flex items-center gap-2",
                      selectedApp.matchScore === 'Altíssima' ? 'bg-amber-600 hover:bg-amber-700 shadow-amber-200' :
                      selectedApp.matchScore === 'Alta' || selectedApp.matchScore === 'Média' ? 'bg-blue-600 hover:bg-blue-700 shadow-blue-200' :
                      'bg-slate-600 hover:bg-slate-700 shadow-slate-200'
                    )}
                  >
                    {generating ? (
                      <Loader2 className="animate-spin" size={18} />
                    ) : (
                      <Cpu size={18} />
                    )}
                    {selectedApp.matchScore === 'Altíssima' ? '💎 Iniciar Nível 1' : 
                     selectedApp.matchScore === 'Alta' || selectedApp.matchScore === 'Média' ? '⚡ Gerar Nível 2' : 
                     '♻️ Gerar Nível 3'}
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
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
