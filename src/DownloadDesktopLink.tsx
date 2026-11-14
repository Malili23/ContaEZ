import { Download } from 'lucide-react';
import { isDesktop } from './platform';

export default function DownloadDesktopLink() {
  if (isDesktop()) return null;
  return <a className="contaez-download-desktop" href="https://contaez-mexico.pages.dev/#descargas" target="_blank" rel="noopener noreferrer">
    <Download size={16} aria-hidden="true" /> Descargar app <span className="contaez-download-platforms">Windows o Mac</span>
  </a>;
}
