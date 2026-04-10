import { useState, useEffect, useRef } from 'react';
import { collection, query, onSnapshot, orderBy, limit, addDoc, doc, updateDoc, getDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../hooks/useAuth';
import { motion } from 'motion/react';
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
  RefreshCw
} from 'lucide-react';
import { 
  generateLevel1Questions, 
  generateLevel1Final, 
  generateLevel2, 
  generateLevel3,
  analyzeJob
} from '../lib/gemini';
const CV_LEVEL_3_ID = '1eCyJTG_IItfwzk3EBzRGCvTX1sT7g49UaD-x8gGC0rE';
const CV_LEVEL_1_2_ID = '11Icr9xJSx-Dr8piplsltIai9oOeu2qdh-qIqAaiRQS4';
const OUTPUT_FOLDER_ID = '1VLI8Lhz6CVhkPRKhwI64ArfzoIwkLork';
const PROCESSED_FOLDER_ID = '1kjYwJliWojpWm0TfbGDeTp3-9foVES8_';
import { Link } from 'react-router-dom';
import { AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { extractFileId } from '../lib/driveUtils';

export default function Dashboard() {
  const { user } = useAuth();
  const [stats, setStats] = useState({
    total: 0,
    ready: 0,
    sent: 0,
    manual: 0
  });
  const [recentApps, setRecentApps] = useState<any[]>([]);
  const [selectedApp, setSelectedApp] = useState<any>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [pendingSync, setPendingSync] = useState(false);
  const [genStep, setGenStep] = useState<'idle' | 'questions' | 'finalizing'>('idle');
  const [genStatus, setGenStatus] = useState<string>('');
  const [googleTokens, setGoogleTokens] = useState<any>(() => {
    const saved = localStorage.getItem('google_drive_tokens');
    return saved ? JSON.parse(saved) : null;
  });
  const [questions, setQuestions] = useState<string[]>([]);
  const [answers, setAnswers] = useState<{[key: string]: string}>({});
  const [notification, setNotification] = useState<{ message: string, type: 'success' | 'error' } | null>(null);
  const genStatusRef = useRef<HTMLDivElement>(null);
  const questionsRef = useRef<HTMLDivElement>(null);

  const [topMatch, setTopMatch] = useState<any>(null);

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
        setGenStatus('IA analisando vaga e gerando perguntas...');
        const result = await generateLevel1Questions(selectedApp.jobDescription, masterProfile, cvContent);
        setQuestions(result.questions);
        setGenStep('questions');
        // Scroll to questions after a short delay to allow rendering
        setTimeout(() => {
          questionsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 100);
      } else if (isLevel1 && genStep === 'questions') {
        setGenStep('finalizing');
        setGenStatus('IA gerando documentos finais...');
        // Scroll to status
        setTimeout(() => {
          genStatusRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 100);
        const answersStr = Object.entries(answers).map(([q, a]) => `Q: ${q}\nA: ${a}`).join('\n\n');
        const result = await generateLevel1Final(selectedApp.jobDescription, masterProfile, cvContent, answersStr);
        
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

  useEffect(() => {
    if (!user) return;

    const q = query(
      collection(db, `users/${user.uid}/applications`),
      orderBy('updatedAt', 'desc'),
      limit(5)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const apps = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setRecentApps(apps);
    });

    // Stats and Top Match listener
    const qAll = query(collection(db, `users/${user.uid}/applications`));
    const unsubscribeAll = onSnapshot(qAll, (snapshot) => {
      const all = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setStats({
        total: all.length,
        ready: all.filter((a: any) => a.status === '✅ Pronto').length,
        sent: all.filter((a: any) => a.status === 'Enviada').length,
        manual: all.filter((a: any) => a.status === '💎 Manual').length,
      });

      // Find top match among non-completed
      const pending = all.filter((a: any) => !['✅ Pronto', 'Enviada', '🗑️ Descartada', 'Rejeitada'].includes(a.status));
      const sorted = pending.sort((a: any, b: any) => {
        const scores: any = { 'Altíssima': 4, 'Alta': 3, 'Média': 2, 'Baixa': 1, 'Incompatível': 0 };
        return (scores[b.matchScore] || 0) - (scores[a.matchScore] || 0);
      });
      setTopMatch(sorted[0]);
    });

    return () => {
      unsubscribe();
      unsubscribeAll();
    };
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
      if (data.error) throw new Error(data.error);
      
      const files = data.files || [];
      for (const file of files) {
        const exists = recentApps.some(app => app.driveFileId === file.id);
        if (exists) continue;

        const analysis = await analyzeJob(file.content, masterProfile, customRules);
        await addDoc(collection(db, `users/${user.uid}/applications`), {
          company: analysis.company || 'Unknown',
          role: analysis.role || file.name,
          location: analysis.location || 'Remote',
          link: '',
          jobDescription: file.content,
          matchScore: analysis.matchScore,
          matchReasoning: analysis.matchReasoning,
          gapAnalysis: analysis.gapAnalysis,
          pilarAbreAlas: analysis.pilarAbreAlas,
          keyStack: analysis.keyStack,
          openingStrategy: analysis.openingStrategy,
          suggestedStatus: analysis.suggestedStatus,
          driveFileId: file.id,
          driveFolderLink: '',
          status: analysis.suggestedStatus || '🤖 Auto',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          uid: user.uid
        });
      }
      setNotification({ message: 'Drive sincronizado com sucesso!', type: 'success' });
    } catch (error: any) {
      console.error('Error syncing drive:', error);
      setNotification({ message: `Erro ao sincronizar: ${error.message}`, type: 'error' });
    } finally {
      setSyncing(false);
    }
  };

  const statCards = [
    { name: 'Total de Vagas', value: stats.total, icon: TrendingUp, color: 'blue' },
    { name: 'Prontas p/ Aplicar', value: stats.ready, icon: CheckCircle2, color: 'green' },
    { name: 'Enviadas', value: stats.sent, icon: Clock, color: 'indigo' },
    { name: 'Nível 1 (💎)', value: stats.manual, icon: AlertCircle, color: 'amber' },
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
            onClick={() => handleSyncDrive()}
            disabled={syncing}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all border shadow-sm disabled:opacity-50 ${
              googleTokens 
                ? 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50' 
                : 'bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-100'
            }`}
          >
            <Zap size={18} className={syncing ? "animate-pulse text-amber-500" : (googleTokens ? "text-slate-400" : "text-indigo-500")} />
            {syncing ? 'Sincronizando...' : (googleTokens ? 'Sincronizar Drive' : 'Conectar e Sincronizar')}
          </button>
          <Link 
            to="/applications" 
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors shadow-lg shadow-blue-200"
          >
            <Plus size={18} />
            Nova Vaga
          </Link>
        </div>
      </header>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {statCards.map((stat, i) => (
          <motion.div
            key={stat.name}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm"
          >
            <div className={`w-12 h-12 rounded-xl bg-${stat.color}-50 flex items-center justify-center mb-4`}>
              <stat.icon className={`text-${stat.color}-600`} size={24} />
            </div>
            <p className="text-sm font-medium text-slate-500">{stat.name}</p>
            <p className="text-2xl font-bold text-slate-900 mt-1">{stat.value}</p>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Recent Applications */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-slate-50 flex justify-between items-center">
            <h3 className="font-bold text-slate-900">Aplicações Recentes</h3>
            <Link to="/applications" className="text-sm text-blue-600 font-medium flex items-center gap-1 hover:underline">
              Ver todas <ArrowRight size={14} />
            </Link>
          </div>
          <div className="divide-y divide-slate-50">
            {recentApps.length > 0 ? (
              recentApps.map((app) => (
                <div 
                  key={app.id} 
                  onClick={() => {
                    setSelectedApp(app);
                    setIsDetailOpen(true);
                  }}
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
                    <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                      app.status.includes('💎') ? 'bg-amber-50 text-amber-700 border border-amber-100' :
                      app.status.includes('✅') ? 'bg-green-50 text-green-700 border border-green-100' :
                      'bg-blue-50 text-blue-700 border border-blue-100'
                    }`}>
                      {app.status}
                    </span>
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

        {/* Quick Tips / AI Insight */}
        <div className="bg-gradient-to-br from-blue-600 to-indigo-700 rounded-2xl p-8 text-white shadow-xl shadow-blue-200">
          <h3 className="text-xl font-bold mb-4">AI Insight</h3>
          {topMatch ? (
            <>
              <p className="text-blue-100 text-sm leading-relaxed mb-6">
                "Nhaiara, notei que você tem {stats.manual} vagas de nível 💎 pendentes. O match técnico com a <b>{topMatch.company}</b> é <b>{topMatch.matchScore}</b>. Recomendo focar nela hoje para garantir o 'time to market'."
              </p>
              <div className="space-y-4">
                <div className="bg-white/10 rounded-xl p-4 backdrop-blur-sm">
                  <p className="text-xs text-blue-200 uppercase font-bold tracking-wider mb-1">Próximo Passo</p>
                  <p className="text-sm font-medium">Revisar Cover Letter para {topMatch.company}</p>
                </div>
                <Link 
                  to="/applications"
                  className="block w-full py-3 bg-white text-blue-700 rounded-xl font-bold text-sm shadow-lg hover:bg-blue-50 transition-colors text-center"
                >
                  Ver Detalhes da Vaga
                </Link>
              </div>
            </>
          ) : (
            <p className="text-blue-100 text-sm leading-relaxed">
              "Nhaiara, adicione novas vagas ou sincronize seu Drive para que eu possa analisar os melhores matches para você."
            </p>
          )}
        </div>
      </div>

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
                  <h4 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Raciocínio do Match</h4>
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
