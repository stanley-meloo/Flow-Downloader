import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { exists } from '@tauri-apps/plugin-fs';
import { readText } from '@tauri-apps/plugin-clipboard-manager';

/**
 * Lê a área de transferência e cola no input.
 */
export async function handlePaste(setUrl, showToast) {
  try {
    const clipboardText = await readText();
    
    if (clipboardText && clipboardText.trim().length > 0) {
      setUrl(clipboardText);
      
      if (clipboardText.startsWith('http')) {
        showToast("clipboard_success", "success");
      } else {
        showToast("error_invalid", "info");
      }
    } else {
      showToast("clipboard_empty", "error");
    }
  } catch (err) {
    console.error("Erro ao ler clipboard:", err);
    showToast("clipboard_error", "error");
  }
}

/**
 * Abre o local do arquivo, verificando se ele existe
 */
export async function openMediaLocation(directory, title, format, showToast) {
  try {
    // 1. Limpeza do título
    const safeTitle = title
      .replace(/[\\/:*?"<>|]/g, "") 
      .replace(/ /g, "_");         
    
    // 2. Monta o caminho
    const cleanDir = directory.endsWith('/') || directory.endsWith('\\') 
      ? directory.slice(0, -1) 
      : directory;
      
    // Nome do arquivo com extensão
    const fileName = `${safeTitle}.${format || 'mp4'}`;
    // Caminho completo final
    const fullPath = `${cleanDir}/${fileName}`;

    // 3. Verifica existência
    const fileExists = await exists(fullPath);

    if (fileExists) {
      await revealItemInDir(fullPath);
    } else {
      console.warn("Arquivo não encontrado:", fullPath);
      // Se não achar o arquivo, tenta abrir pelo menos a pasta
      if (await exists(cleanDir)) {
          await revealItemInDir(cleanDir);
          showToast("open_error", "info");
      } else {
          showToast("open_error", "error");
      }
    }

  } catch (err) {
    console.error("Erro ao tentar abrir arquivo:", err);
    showToast("open_error", "error");
  }
}