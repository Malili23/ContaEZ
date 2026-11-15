import { ArrowLeft, Download } from 'lucide-react';
import { isDesktop } from './platform';
import './web-navigation.css';

export default function WebNavigation() {
  if (isDesktop()) return null;
  return <nav className="web-navigation" aria-label="Sitio de ContaEZ">
    <a className="web-navigation-home" href="/" aria-label="Volver a la portada">
      <ArrowLeft size={16} aria-hidden="true" /> <span>Volver a la portada</span>
    </a>
    <a className="contaez-download-desktop" href="https://contaez-mexico.pages.dev/#descargas" target="_blank" rel="noopener noreferrer">
      <Download size={16} aria-hidden="true" /> Descargar app <span className="contaez-download-platforms">Windows o Mac</span>
    </a>
  </nav>;
}
