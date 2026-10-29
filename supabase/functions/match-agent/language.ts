/**
 * The language to answer in: the language of the user's message, not the app's. Place names are
 * Spanish whatever the user writes ("from Universidad de La Sabana"), so capitalized names and the
 * connectors inside them are skipped before counting function words. A message with no clear signal
 * ("Cota → La Sabana 7am") keeps the app's language. Pure TypeScript, unit-tested.
 */
export type Language = 'es' | 'en';

const ES = new Set([
  'de', 'del', 'la', 'las', 'el', 'los', 'al', 'en', 'y', 'que', 'para', 'por', 'desde', 'hasta', 'con', 'sin', 'un', 'una', 'mi', 'es', 'son', 'hay',
  'mañana', 'hoy', 'pasado', 'tarde', 'noche', 'hora', 'horas', 'voy', 'vamos', 'necesito', 'quiero', 'busco', 'llegar', 'salgo', 'salir', 'ir', 'tengo', 'puedes', 'podrías',
  'cupo', 'cupos', 'viaje', 'viajes', 'carro', 'sale', 'cuesta', 'quedan', 'como', 'cómo', 'dónde', 'donde', 'cuándo', 'cuanto', 'cuánto', 'más', 'antes', 'después', 'tu', 'tus', 'te',
  'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo', 'gracias', 'hola', 'porque', 'pero', 'también', 'solo', 'ese', 'este', 'esta',
]);
const EN = new Set([
  'the', 'to', 'from', 'at', 'on', 'in', 'and', 'i', "i'm", 'im', 'an', 'for', 'my', 'is', 'are', 'of', 'with', 'by', 'around', 'next', 'this', 'that', 'there', 'can', 'you', 'your', 'it', 'please',
  'need', 'want', 'looking', 'ride', 'get', 'go', 'going', 'leave', 'leaving', 'tomorrow', 'today', 'morning', 'afternoon', 'evening', 'tonight', 'am', 'pm', 'before', 'after',
  'seat', 'seats', 'trip', 'trips', 'car', 'departs', 'leaves', 'costs', 'left', 'only', 'but', 'also', 'thanks', 'hi', 'hello', 'how', 'where', 'when', 'what', 'which', 'any',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'than', 'about',
]);
const CONNECTORS = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y']);

const isCapitalized = (word: string) => /^\p{Lu}/u.test(word);

export function detectLanguage(text: string, fallback: Language): Language {
  const sentences = text.split(/[.!?¿¡\n]+/);
  let es = /[ñ¿¡]/.test(text) ? 2 : 0;
  let en = 0;
  for (const sentence of sentences) {
    const words = sentence.match(/[\p{L}']+/gu) ?? [];
    // A capitalized word is a name unless it starts the sentence; "I" is always English.
    const name = words.map((word, index) => word !== 'I' && index > 0 && isCapitalized(word));
    for (let index = 1; index < words.length - 1; index += 1) {
      if (CONNECTORS.has(words[index].toLowerCase()) && name[index - 1] && isCapitalized(words[index + 1])) name[index] = true;
    }
    words.forEach((word, index) => {
      if (name[index]) return;
      const lower = word.toLowerCase();
      if (ES.has(lower)) es += 1;
      if (EN.has(lower)) en += 1;
    });
  }
  if (es === en) return fallback;
  return es > en ? 'es' : 'en';
}
