/**
 * VOSEO — DETECTOR MORFOLÓGICO PARA EL TEXTO DE ESTE REPO.
 *
 * LA REGLA. El ecosistema escribe en ES o EN neutro internacional, sin regionalismos y SIN VOSEO
 * (`unrlvl-context/protocols/DELIVERY_AND_VERIFICATION_RULE.md` §2-BIS). El motivo es operativo: el
 * imperativo voseante y el pretérito son homógrafos, y en una lista de instrucciones —una interfaz o
 * un prompt— quien lee no sabe si le piden algo o le informan de algo ya hecho.
 *
 * ORIGEN. Es el mismo detector de `Orchestrator/src/idioma/voseo.ts` (Orchestrator #82, 2026-10-20),
 * escrito en JavaScript sin dependencias para que corra con `node` como el resto de los tests del repo.
 * Si se amplía una lista aquí, se amplía también allí: las dos copias vigilan la misma regla.
 *
 * POR QUÉ MORFOLÓGICO Y NO UNA LISTA. Una lista cerrada de formas sólo cubre las que alguien ya vio,
 * y las listas anteriores usaban `\b`, que en JavaScript sólo conoce letras ASCII: una forma que
 * termina en vocal acentuada nunca casaba [medido 2026-10-20: `/\b(revisá)\b/i.test('revisá esto')`
 * da `false`]. Este detector caza la CLASE: toda palabra terminada en -á, -é, -í, -ás, -és o -ís (la
 * marca morfológica del voseo verbal), menos una lista blanca de palabras que no son voseo y menos los
 * futuros. Una lista blanca se completa sola con el uso; una lista de prohibidas, nunca.
 *
 * LO QUE NO CAZA, declarado (`ICR_CONTRACT.md` V-12: un patrón léxico por definición está incompleto):
 *   · el imperativo voseante con pronombre pegado (no lleva tilde): sólo lo caza para los radicales
 *     de `RADICALES_CON_PRONOMBRE`;
 *   · algunas formas de verbos cuyo radical termina en -ar, -er o -ir, que se confunden con un
 *     futuro. Las más comunes se cubren con `RADICALES_AMBIGUOS`.
 */

/**
 * Palabras con la terminación del voseo que no son voseo. Se añaden aquí cuando una palabra legítima
 * dispara el test, con la condición de que no sea homógrafa de una orden voseante.
 */
export const PALABRAS_PERMITIDAS = new Set([
  // adverbios, pronombres e interrogativos
  'qué', 'más', 'así', 'sí', 'aquí', 'ahí', 'allí', 'allá', 'después', 'además', 'demás', 'detrás',
  'atrás', 'jamás', 'quizás', 'quizá', 'través', 'revés', 'porqué', 'mí', 'sé', 'dé', 'té', 'ojalá',
  // formas de tuteo o de tercera persona que coinciden en terminación
  'está', 'estás', 'esté', 'estés',
  // pretérito de primera persona de verbos en -er, que no es homógrafo del imperativo voseante (-é)
  'entendí',
  // sustantivos, gentilicios y topónimos
  'país', 'inglés', 'francés', 'portugués', 'japonés', 'interés', 'estrés', 'café', 'bebé', 'mamá',
  'papá', 'sofá', 'maní', 'açaí', 'asaí', 'caché', 'cachés', 'relé', 'arnés', 'capitoné', 'panamá',
  'canadá',
  // abreviaturas de días de la semana
  'mié',
  // nombres propios usados en ejemplos y pruebas
  'tomás',
]);

/**
 * Radicales de verbos en -ar/-er cuyo imperativo voseante se confunde con un futuro (mir-á frente a
 * un futuro de «mir»). No son formas voseantes: son raíces, y el detector les pega la terminación.
 */
const RADICALES_AMBIGUOS = [
  'mir', 'esper', 'declar', 'gener', 'consider', 'oper', 'prepar', 'separ', 'compar',
  'aclar', 'admir', 'retir', 'tir', 'gir', 'super', 'recuper', 'toler', 'moder', 'aceler', 'liber',
  'exager', 'numer', 'enumer', 'alter', 'quer',
];
const FORMAS_DE_RADICAL_AMBIGUO = new Set(
  RADICALES_AMBIGUOS.flatMap((r) => [`${r}á`, `${r}ás`, `${r}é`, `${r}és`]),
);

/**
 * Imperativo voseante con pronombre pegado. No lleva tilde, así que no tiene marca morfológica: en
 * neutro la misma orden sí la lleva (la forma de tú acentúa la sílaba del radical). Se arma con
 * radical + vocal temática + pronombre, sólo para radicales de verbos que se usan al dar
 * instrucciones; un radical genérico daría falsos positivos con sustantivos comunes.
 */
const RADICALES_CON_PRONOMBRE = [
  ['aprob', 'a'], ['rechaz', 'a'], ['fij', 'a'], ['remat', 'a'], ['oper', 'a'], ['avis', 'a'],
  ['dej', 'a'], ['mir', 'a'], ['revis', 'a'], ['us', 'a'], ['carg', 'a'], ['guard', 'a'],
  ['cop', 'ia'], ['peg', 'a'], ['toc', 'a'], ['sum', 'a'], ['pregunt', 'a'], ['solicit', 'a'],
  ['llev', 'a'], ['qued', 'a'], ['acord', 'a'], ['cont', 'a'], ['prob', 'a'], ['pon', 'e'],
  ['hac', 'e'], ['dec', 'i'], ['ped', 'i'], ['sub', 'i'], ['abr', 'i'], ['eleg', 'i'],
];
const PRONOMBRES = ['lo', 'la', 'los', 'las', 'le', 'les', 'me', 'te', 'nos'];
const FORMAS_CON_PRONOMBRE = new Set(
  RADICALES_CON_PRONOMBRE.flatMap(([r, v]) => PRONOMBRES.map((pr) => r + v + pr)),
);

/** Futuro: infinitivo + -á / -ás / -é, o raíz irregular (podr-, querr-, sabr-, har-, dir-…). */
function esFuturo(p) {
  const m = p.match(/^(.*)(á|ás|é)$/u);
  if (m && /(ar|er|ir)$/u.test(m[1]) && m[1].length >= 4) return true;
  if (/(dr|rr|br)(á|ás|é)$/u.test(p)) return true;
  return /^(ser|ir|dar|ver|har|dir)(á|ás|é)$/u.test(p);
}

// Las dos formas se escriben por partes para que este archivo pase su propio barrido.
const PRONOMBRE_VOSEANTE = 'v' + 'os';
/** Léxico regional con equivalente neutro (V-12). */
const REGIONALISMOS = new Set(['ac' + 'á']);

/**
 * Devuelve las formas voseantes o regionales encontradas en el texto, en el orden en que aparecen.
 * Una lista vacía quiere decir que el texto está limpio.
 */
export function formasVoseantes(texto) {
  // `\n` escrito dentro de una cadena pegaría la «n» a la palabra siguiente.
  const limpio = texto.replace(/\\[nrt]/g, ' ');
  const hallazgos = [];
  for (const m of limpio.matchAll(/\p{L}+/gu)) {
    const palabra = m[0];
    const p = palabra.toLowerCase();
    if (p === PRONOMBRE_VOSEANTE || REGIONALISMOS.has(p) || FORMAS_DE_RADICAL_AMBIGUO.has(p) || FORMAS_CON_PRONOMBRE.has(p)) {
      hallazgos.push(palabra);
      continue;
    }
    // Dos letras no hacen una forma verbal: son clases de una expresión regular (`[EÉ]`) o siglas.
    if (p.length < 3 || !/\p{L}(á|é|í|ás|és|ís)$/u.test(p)) continue;
    if (PALABRAS_PERMITIDAS.has(p) || esFuturo(p)) continue;
    hallazgos.push(palabra);
  }
  return hallazgos;
}
