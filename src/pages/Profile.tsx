import { useState, useEffect } from 'react';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../hooks/useAuth';
import { motion } from 'motion/react';
import { Save, UserCircle, FileText, Code, Zap, Plus, AlertCircle, RefreshCw } from 'lucide-react';
import { AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { extractFileId } from '../lib/driveUtils';

const DEFAULT_RULES = `1. Altíssima: Fintech + AI/Data + Berlin ou remoto + Senioridade (Manager/Team Lead) + ≥80% de match entre os requisitos/responsabilidades e meu perfil master. Status sugerido: "💎 Manual".
2. Alta: AI Platform + hibrida + ≥70% de match entre os requisitos/responsabilidades e meu perfil master. Status sugerido: "🤖 Auto".
3. Média: Vagas de EM puro ou fora de Berlim + entre 50% e 70% de match entre os requisitos/responsabilidades e meu perfil master. Status sugerido: "🤖 Auto".
4. Baixa: Gaps técnicos profundos (C++, Embedded) ou + <50% de match entre os requisitos/responsabilidades e meu perfil master. Status sugerido: "🤖 Auto".
5. Incompatível: Se a vaga exigir Alemão (Must-have). Status sugerido: "🗑️ Descartada".`;

export default function Profile() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState({
    masterProfile: '',
    masterProfileFileId: '',
    customRules: DEFAULT_RULES,
    driveFolderId: '',
    cvLevel1FileId: '',
    cvLevel23FileId: ''
  });
  const [syncingProfile, setSyncingProfile] = useState(false);
  const [googleTokens, setGoogleTokens] = useState<any>(() => {
    const saved = localStorage.getItem('google_drive_tokens');
    return saved ? JSON.parse(saved) : null;
  });

  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

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
      const docRef = doc(db, 'users', user.uid);
      const docSnap = await getDoc(docRef);
      
      if (docSnap.exists()) {
        const data = docSnap.data();
        setProfile(prev => ({ 
          ...prev, 
          ...data,
          customRules: data.customRules || DEFAULT_RULES
        }));
      }
      setLoading(false);
    };

    fetchProfile();
  }, [user]);

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    try {
      // Clean up IDs before saving
      const cleanedProfile = {
        ...profile,
        masterProfileFileId: extractFileId(profile.masterProfileFileId),
        cvLevel1FileId: extractFileId(profile.cvLevel1FileId),
        cvLevel23FileId: extractFileId(profile.cvLevel23FileId),
        driveFolderId: extractFileId(profile.driveFolderId)
      };

      await setDoc(doc(db, 'users', user.uid), {
        ...cleanedProfile,
        uid: user.uid,
        name: user.displayName,
        email: user.email,
        updatedAt: serverTimestamp()
      }, { merge: true });
      
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase">Modelo CV Nível 1</label>
              <input
                type="text"
                value={profile.cvLevel1FileId}
                onChange={(e) => setProfile({ ...profile, cvLevel1FileId: e.target.value })}
                placeholder="Link ou ID do Google Doc"
                className="w-full mt-1 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none font-mono"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase">Modelo CV Nível 2 e 3</label>
              <input
                type="text"
                value={profile.cvLevel23FileId}
                onChange={(e) => setProfile({ ...profile, cvLevel23FileId: e.target.value })}
                placeholder="Link ou ID do Google Doc"
                className="w-full mt-1 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none font-mono"
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
                <label className="text-xs font-bold text-slate-500 uppercase">Folder ID</label>
                <input
                  type="text"
                  value={profile.driveFolderId}
                  onChange={(e) => setProfile({ ...profile, driveFolderId: e.target.value })}
                  placeholder="ID da pasta no Google Drive"
                  className="w-full mt-1 px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-green-500 outline-none"
                />
              </div>
              <p className="text-xs text-slate-500">
                O sistema irá monitorar esta pasta por arquivos .md e importá-los automaticamente.
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
            {notification.message}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
