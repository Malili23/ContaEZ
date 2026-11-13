import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import '@fontsource-variable/dm-sans';
import '@fontsource-variable/manrope';
import './styles.css';
import './readability.css';

class ErrorBoundary extends React.Component<{children:React.ReactNode},{error:string}> {
  state={error:''};
  static getDerivedStateFromError(error:unknown){return {error:error instanceof Error?error.message:String(error)}}
  render(){if(this.state.error)return <section className="error-boundary"><h1>No se pudo mostrar este proyecto</h1><p>Los originales no se han modificado. Conserva tus respaldos y vuelve a abrir ContaEZ. Si el problema continúa, comparte una descripción del error con el creador.</p><p>{this.state.error}</p><button className="button primary" onClick={()=>location.reload()}>Volver a abrir</button></section>;return this.props.children;}
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><ErrorBoundary><App /></ErrorBoundary></React.StrictMode>);
