import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// Importação dos arquivos JSON
import pt from './pt.json';
import en from './en.json';
import es from './es.json';
import fr from './fr.json';
import de from './de.json';
import zh from './zh.json';
import ja from './ja.json';
import ru from './ru.json';
import hi from './hi.json';
import ar from './ar.json';
import it from './it.json';
import ko from './ko.json';
import bn from './bn.json';
import tr from './tr.json';
import vi from './vi.json';
import pl from './pl.json';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      pt: { translation: pt },
      en: { translation: en },
      es: { translation: es },
      fr: { translation: fr },
      de: { translation: de },
      zh: { translation: zh },
      ja: { translation: ja },
      ru: { translation: ru },
      hi: { translation: hi },
      ar: { translation: ar },
      it: { translation: it },
      ko: { translation: ko },
      bn: { translation: bn },
      tr: { translation: tr },
      vi: { translation: vi },
      pl: { translation: pl }
    },
    // Sincroniza com as chaves simplificadas (en, pt, es...)
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false 
    },
    // Ajuda o i18n a entender que 'pt-BR' ou 'pt-PT' devem usar o arquivo 'pt'
    load: 'languageOnly',
    interpolation: { escapeValue: false }
  });

export default i18n;