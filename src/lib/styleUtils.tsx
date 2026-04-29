import React from 'react';
import { 
  PlusCircle, 
  Brain, 
  FileText, 
  CheckCircle2, 
  Send, 
  Clock, 
  Users, 
  Trophy, 
  Handshake, 
  AlertTriangle, 
  XCircle, 
  Trash2,
  Gem,
  Star,
  Award
} from 'lucide-react';

export const getStatusStyle = (status: string) => {
  switch(status) {
    case '📥 Nova': return { bg: 'bg-slate-100', text: 'text-slate-700', border: 'border-slate-200', icon: <PlusCircle size={12} /> };
    case '⏳ Input IA': return { bg: 'bg-blue-100', text: 'text-blue-700', border: 'border-blue-200', icon: <Brain size={12} /> };
    case '⚙️ Gerar Docs': return { bg: 'bg-indigo-50', text: 'text-indigo-700', border: 'border-indigo-200', icon: <FileText size={12} /> };
    case '✅ Aplicar': return { bg: 'bg-indigo-100', text: 'text-indigo-700', border: 'border-indigo-200', icon: <CheckCircle2 size={12} /> };
    case '📩 Triagem': return { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', icon: <Send size={12} /> };
    case '🕰️ Feedback': return { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', icon: <Clock size={12} /> };
    case '🗣️ Entrevistas': return { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200', icon: <Users size={12} /> };
    case '🏆 Proposta': return { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', icon: <Trophy size={12} /> };
    case '🤝 Sucesso': return { bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200', icon: <Handshake size={12} /> };
    case '⚠️ Mismatch': return { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200', icon: <AlertTriangle size={12} /> };
    case '❌ Rejeitada': return { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', icon: <XCircle size={12} /> };
    case '🗑️ Descarte': return { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', icon: <Trash2 size={12} /> };
    default: return { bg: 'bg-slate-50', text: 'text-slate-600', border: 'border-slate-200', icon: null };
  }
};

export const getTierStyle = (tier: string) => {
  switch(tier) {
    case 'Diamond': return { bg: 'bg-cyan-50', text: 'text-cyan-700', border: 'border-cyan-200', icon: <Gem size={10} /> };
    case 'Gold': return { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', icon: <Star size={10} /> };
    case 'Silver': return { bg: 'bg-slate-50', text: 'text-slate-700', border: 'border-slate-200', icon: <Award size={10} /> };
    case 'Discard': return { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', icon: <XCircle size={10} /> };
    default: return { bg: 'bg-slate-50', text: 'text-slate-600', border: 'border-slate-200', icon: null };
  }
};
