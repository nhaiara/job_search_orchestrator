import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertCircle, RefreshCw, X } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends React.Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center p-4 bg-slate-900/10 backdrop-blur-sm fixed inset-0 z-[9999]">
          <div className="max-w-md w-full bg-white rounded-2xl shadow-2xl p-8 text-center border border-slate-100 relative">
            <button 
              onClick={() => this.setState({ hasError: false, error: null })}
              className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-all"
            >
              <X size={20} />
            </button>
            <div className="w-16 h-16 bg-red-50 text-red-600 rounded-full flex items-center justify-center mx-auto mb-6">
              <AlertCircle size={32} />
            </div>
            <h2 className="text-2xl font-bold text-slate-900 mb-2">Ops! Algo deu errado</h2>
            <p className="text-slate-600 mb-8">
              Ocorreu um erro inesperado na interface. Você pode tentar fechar este aviso ou recarregar a página.
            </p>
            {this.state.error && (
              <div className="mb-8 p-4 bg-slate-50 rounded-lg text-left overflow-auto max-h-32 border border-slate-100">
                <code className="text-xs text-red-500 font-mono">{this.state.error.message}</code>
              </div>
            )}
            <div className="flex gap-3">
              <button
                onClick={() => this.setState({ hasError: false, error: null })}
                className="flex-1 px-6 py-3 border border-slate-200 text-slate-600 font-bold rounded-xl hover:bg-slate-50 transition-colors"
              >
                Fechar
              </button>
              <button
                onClick={() => window.location.reload()}
                className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition-colors shadow-lg shadow-blue-200"
              >
                <RefreshCw size={18} />
                Recarregar
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
