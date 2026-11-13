import { isDesktop, openExternal } from '../platform';
export interface ChatGPTStatus { connected: boolean; email?: string; model?: string; models?: { slug: string; display_name: string }[]; }
async function invokeNative<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isDesktop()) throw new Error('La conexión segura con tu plan de ChatGPT está disponible en la aplicación de escritorio. Puedes copiar tu consulta y abrir ChatGPT desde esta vista web.');
  const { invoke } = await import('@tauri-apps/api/core'); return invoke<T>(command, args);
}
export async function getChatGPTStatus(): Promise<ChatGPTStatus> {
  if (!isDesktop()) return { connected: false };
  return invokeNative<ChatGPTStatus>('chatgpt_status');
}
export async function connectChatGPT(newAccount = false): Promise<ChatGPTStatus> { return invokeNative<ChatGPTStatus>('chatgpt_connect', { newAccount }); }
export async function disconnectChatGPT(): Promise<void> { return invokeNative<void>('chatgpt_disconnect'); }
export async function askChatGPT(text: string, context: string): Promise<string> {
  if (!text.trim()) throw new Error('Escribe una pregunta.');
  if (context.length > 160000) throw new Error('Selecciona menos información para compartir con ChatGPT.');
  return invokeNative<string>('chatgpt_ask', { text, context });
}
export async function manageChatGPTUsage(): Promise<void> { return openExternal('https://chatgpt.com/settings/usage'); }
