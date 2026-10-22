/**
 * ImageLab — POST /api/compose
 *
 * BRIEF 7 (2026-08-22) — EL COMPOSITOR DETERMINÍSTICO. "La escena se genera, la tipografía se
 * compone."
 *
 * POR QUÉ EXISTE. Medido en producción el 2026-08-22: el modelo de imagen corrompe sistemáticamente
 * la tipografía española que dibuja dentro de la imagen ("EXACTEMENTE", "CUANDA", "APAPSRIENTA",
 * "FRACIÓN") e insertó "LEY 284" en una pieza. Ese texto vive en el plano VISUAL, y el Watcher juzga
 * el COPY: ninguna regla —HR-LEGAL-01 incluida— alcanza a los píxeles. Dos piezas aprobadas
 * quedaron bloqueadas por eso el mismo día.
 *
 * LA DECISIÓN (Sam). La generación deja de producir texto (cláusula del eje en `api/execute.ts`,
 * bloque C) y el texto se compone aquí, por código, sobre la imagen limpia. Un generador estocástico
 * no vuelve a tocar una letra.
 *
 * MOTOR ELEGIDO Y POR QUÉ. `satori` (HTML/CSS → SVG) + `@resvg/resvg-js` (SVG → PNG). Es el mismo
 * par que hay debajo de `@vercel/og`, el generador de OG-images del stack donde ImageLab ya vive
 * (Vercel, runtime Node); se usan directos y no vía `@vercel/og` porque éste está pensado para el
 * runtime Edge y aquí el handler es Node (`VercelRequest/VercelResponse`, igual que `/api/execute`).
 * satori vectoriza el texto a `<path>`, así que el PNG no depende de las fuentes del sistema.
 *
 * DETERMINISMO. El bloque PURO de abajo (COMPOSITOR:BEGIN/END) resuelve tokens → estilo → escena
 * sin red, sin DB y sin reloj: misma entrada ⇒ misma escena, carácter por carácter. Lo verifica
 * `tests/compositor_test.mjs` extrayendo el bloque de ESTA fuente. Lo impuro queda afuera y es
 * transporte: leer tokens de Supabase, bajar el archivo de fuente y rasterizar.
 *
 * LAS TRES REGLAS DURAS DEL BRIEF, y dónde se cumplen:
 *   (a) el texto del overlay sale del COPY YA JUZGADO. Este endpoint NO escribe ni reescribe texto:
 *       recibe `headline` / `subheadline` y los compone VERBATIM. Quien los deriva de la pieza es
 *       `content-run-stage` (bloque puro COMPOSITOR-TEXTO). Aquí no hay ninguna rama que genere,
 *       recorte, traduzca o complete texto: si no entra, no sale.
 *   (b) tipografía, paleta y posición son DATO POR MARCA. Salen de tres tablas que ya existen o se
 *       siembran: `brand_typography` (familia + import), `brand_palette` (hex por rol) y
 *       `imagelab_overlay_tokens` (qué rol juega cada ranura + la posición). CERO fuentes y CERO
 *       colores cableados en el motor: si el dato falta, esto FALLA con el nombre de lo que falta,
 *       no inventa un Helvetica blanco.
 *   (c) determinista y testeable sin red (arriba).
 *
 * CONTRATO
 *   POST /api/compose
 *   { brand_id, canal?, image_url? | image_data_url?, headline, subheadline?, piece_id?,
 *     products?: [{ image_url, name? }],    ← capa de producto (2026-09-27), PNG real con alfa
 *     carousel?: { index, total, role, background?, eyebrow?, keyword?, figure?, steps?, cta? },
 *                                           ← F3 (2026-10-02), lámina de carrusel; ver el bloque F3
 *     emphasis?: [subcadena literal del titular, …] }   ← 1.4.0 (2026-10-13), hasta 3 tramos
 *   → 200 { status:'ok', image_data_url, compositor_version, tokens_source, width, height,
 *           fonts:[…], markers:[…], text:{ headline, subheadline, emphasis? },
 *           meta:{ carousel_applied, warnings:[…], carousel?:{ …, fit } } }
 *                                           ← `fit` (1.3.3): qué redujo el ajuste vertical, si actuó
 *   → 4xx/5xx { error, error_label, status:'error' }  ← `error_label` es lo que lee execLab.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { GoogleAuth } from 'google-auth-library';
import sharp from 'sharp';

declare const process: { env: Record<string, string | undefined> };

// ── COMPOSITOR:BEGIN ── (BRIEF 7, 2026-08-22) bloque PURO: tokens → estilo → escena.
// Sin fetch, sin DB, sin estado, sin reloj. Lo ejecuta `tests/compositor_test.mjs` extrayéndolo por
// estos sentinelas: lo que se testea es la fuente que se deploya, no una copia.

// La versión viaja al eco de la pieza (`builder_meta.image.compositor_version`). Sube cuando cambia
// lo que el compositor DIBUJA — no cuando cambia un token de marca (eso es dato) ni un comentario.
//   1.3.0 (F3, 2026-10-02) — láminas de carrusel según la maqueta v4 (campo `carousel`). Aditivo:
//         una marca sin `tokens.carousel` compone exactamente como en 1.2.0.
//   1.3.1 (2026-10-03) — espacio entre palabras parejo: las fuentes llegan a satori sin kerning
//         (`neutralizeKerning`), porque satori mide sin él y dibuja con él. Cambia el dibujo de TODO
//         texto —titular, bajada, etiquetas, logotipo de texto— en lámina y en overlay.
//   1.3.2 (2026-10-03) — la flecha del CTA del cierre señala abajo, al texto del post: a la derecha
//         prometía una lámina más que no existe. La del aviso de deslizar en la portada no cambia.
//   1.3.3 (2026-10-03) — ajuste vertical de la lámina de carrusel (`fitCarouselContent`): si el bloque
//         central no cabe entre la cabecera y el pie, se reduce por escalones (cifra → titular →
//         cuerpo y pasos → pasos omitidos, nunca el crítico) y el pie no se tapa ni sale del lienzo.
//         Una lámina que ya cabía sale idéntica.
//   1.3.4 (2026-10-03) — efecto de texto en las láminas con foto (`tokens.carousel.text_effect`): una
//         sombra por glifo, del color de una FUNCIÓN de la paleta, que da contraste local al texto sin
//         tocar el velo ni la imagen. Sólo con `background:'image'`; ni la superficie, ni el logotipo,
//         ni la barra de progreso. Sin el token, la escena sale idéntica a la de 1.3.3.
//   1.4.0 (2026-10-13) — ÉNFASIS POR PALABRA en el titular (Sam, 2026-10-13: «que en los textos de las
//         imágenes se resalten las palabras clave con negritas, mayúsculas, tamaños y colores de la
//         marca»). La petición trae `emphasis: [subcadenas LITERALES del titular]`; la marca declara
//         cómo se ven en `typography.headline.emphasis` (overlay) y `carousel.typography.headline.emphasis`
//         (lámina): rol tipográfico, peso, itálica, transformación, escala de tamaño y tracking, más
//         `palette.headline_emphasis` (overlay; la lámina usa la función `keyword`). Sin `emphasis` en la
//         petición, o sin el token en la marca, la escena sale idéntica a la de 1.3.4.
//   1.5.0 (2026-10-13) — EL TEXTO RESPETA A LA PLATAFORMA (Sam, 2026-10-13: «que la proporción y cantidad
//         de texto vs la imagen no sobrepase los requerimientos de cada plataforma»). Dos tokens de DATO por
//         canal: `layout.max_text_area_pct` (el bloque de texto no ocupa más de ese % de la imagen; si no
//         cabe, baja de escalón, luego se quita la bajada y, si aun así no cabe, se compone al mínimo y se
//         marca) y `layout.safe_zone_pct` (bordes que la interfaz de la plataforma tapa: el texto se compone
//         dentro). El límite rige el post y la portada del carrusel; las láminas interiores son tarjetas de
//         texto por diseño. Sin los tokens, la escena sale idéntica a la de 1.4.0.
//   1.6.0 (2026-10-15) — EL TEXTO NO TAPA UNA CARA, Y SE LEE SOBRE FONDO CLARO (Sam, 2026-10-15, pieza c3762333:
//         «el texto está casi encima de la cara cuando hay mucho espacio disponible»; «las letras blancas quedan
//         sobre fondo claro… un sutil tratamiento visual de sombra… No oscurezcas el fondo»). Dos tokens de DATO:
//         `layout.avoid_faces` { enabled, anchors?, margin_pct? } — las caras de la escena se detectan (Gemini, la
//         misma vía de Vertex que el inspector) y el bloque se compone en la primera ancla candidata cuya caja no
//         toca ninguna (por defecto: la declarada y luego las otras dos de su misma columna); si ninguna queda
//         libre, la de menor solape, y se dice. Si la detección falla, se compone en el ancla declarada y se dice.
//         `layout.text_effect` { kind:'shadow', color: <rol de brand_palette>, alpha, blur_pct, offset_pct } — la
//         sombra por glifo de 1.3.4, ahora también en el overlay. Sin los tokens, la escena sale idéntica a 1.5.0.
//   1.6.1 (2026-10-15) — medido en producción con c3762333: la caja de «cabeza entera» que pedía 1.6.0 tomaba pelo
//         y cuello, y no dejaba ninguna ancla libre (82,5 % / 32,65 % de solape). Ahora se pide el ROSTRO (cejas a
//         mentón, oreja a oreja); el margen de `avoid_faces.margin_pct` sigue dando aire. Si ninguna ancla queda
//         libre ni con los escalones, se elige el MENOR solape entre todas las combinaciones (ancla × escalón), y a
//         igual solape, el menor ajuste. `meta.faces.boxes` devuelve las cajas medidas (antes el informe pisaba la
//         lista con el número de caras).
//   1.6.2 (2026-10-15) — LA SOMBRA SE DECIDE MIDIENDO (Sam, 2026-10-15, pieza c51e180a: «el texto claro queda sobre
//         fondo claro… crear esa regla»). `layout.text_effect.when` { 'always' (por defecto, 1.6.0) | 'low_contrast' }
//         y `min_contrast` (razón WCAG, 1..21, obligatoria con 'low_contrast'). Con 'low_contrast' el compositor mide
//         la luminancia del fondo DEBAJO del bloque de texto ya ubicado —sobre la escena compuesta SIN texto: foto,
//         velo y franja, porque el velo de la marca ya cambia el contraste— (el 10 % del área que menos contrasta con el
//         color del texto) y aplica la sombra sólo si ese contraste queda por debajo de `min_contrast` Y la sombra
//         contrasta con el texto más que el fondo. Texto claro sobre fondo oscuro sale sin sombra; texto claro sobre
//         fondo claro, con ella. `meta.text_effect` dice qué midió y qué decidió. Sin `when`, idéntico a 1.6.1.
//         `layout.text_effect.color` admite además un hex literal, para que la regla viva en la capa GLOBAL sin
//         nombrar un rol de paleta que una marca nueva quizá no tenga.
//   1.6.3 (2026-10-15) — EL TEXTO ESQUIVA LOS LETREROS Y EL ÉNFASIS SE LEE (Sam, 2026-10-15: «los textos en imagen sí
//         deben esquivar el letrero si hace falta o puedes probar haciendo un blur sutil de dicho letrero»; «el accent
//         color azul del embedded text no contrasta… con el cielo de la imagen»). Dos tokens de DATO:
//         `layout.avoid_scene_text` { enabled, margin_pct?, blur_pct? } — la MISMA llamada de detección de caras pide
//         también el texto legible de la escena (letreros, pantallas, carteles). Las caras siguen decidiendo el tamaño;
//         entre las anclas que tapan lo mismo de caras se elige la que menos tapa un letrero. Si aun así lo tapa y la
//         marca declara `blur_pct`, ese letrero se desenfoca sutilmente bajo el texto (no se oscurece nada).
//         `layout.emphasis_contrast` { min_contrast, fallbacks: [roles de brand_palette] } — se mide el color del
//         énfasis contra lo que tiene detrás (foto + velo, la mediana del área); si no llega al umbral, se usa el rol de
//         la lista que más contrasta, si contrasta más. `meta.faces.signs` y `meta.emphasis_contrast` lo dicen.
//         Sin los tokens, idéntico a 1.6.2.
//   1.6.4 (2026-10-17) — EL ÉNFASIS SE SEPARA DEL TITULAR (Sam, 2026-10-17, pieza 5b842958: «las palabras claves en un
//         accent color que contrastara con el resto del texto»). 1.6.3 elegía la alternativa sólo por contraste con el
//         fondo; sobre fondo oscuro gana siempre el tono más claro de la lista, que puede ser casi el color del titular.
//         Token de DATO opcional `layout.emphasis_contrast.min_contrast_vs_text`: con él, sólo compiten las
//         alternativas que contrastan al menos eso con el color del titular. Sin el token, idéntico a 1.6.3.
//   1.7.0 (2026-10-19) — CORTES DE LÍNEA DEL TITULAR (Sam, 2026-10-19). Un salto de línea escrito en el
//         titular se respeta (antes se leía como un espacio). Y con tramos de énfasis, el titular se corta
//         por una regla: el tramo con énfasis abre línea si le preceden 3 palabras o más en la suya, y lo
//         que le sigue va a la línea siguiente si son 3 palabras o más hasta el fin de la frase. Sin saltos
//         escritos ni énfasis, idéntico a 1.6.4. Ver `headlineLineRanges`.
//   1.8.0 (2026-10-19) — EL COLOR DEL RESALTADO LO ELIGE UNA PERSONA (Sam, 2026-10-19: «no he visto … cambiar de
//         color de accent»). Campo opcional `emphasis_role`: un rol de `brand_palette` de la marca. Si existe y el
//         titular lleva énfasis, el tramo resaltado sale en ese color y la corrección automática por contraste
//         (`layout.emphasis_contrast`) NO lo cambia: lo eligió una persona mirando la imagen. Un rol que la marca no
//         tiene no rompe: se compone con el de siempre y se dice. Sin el campo, idéntico a 1.7.0.
//         Sam, 2026-10-19: «el color del resaltado debe ser dentro de los accent colors definidos para cada marca…
//         no son de libre elección». El rol pedido tiene que ser uno de los que la marca declara para resaltar
//         (`palette.headline_emphasis` y `layout.emphasis_contrast.fallbacks`); cualquier otro se ignora y se dice
//         (`OVERLAY_EMPHASIS_ROLE_NOT_ALLOWED`). La lista es dato de cada marca: cero roles en el código.
//   1.9.0 (2026-10-20) — LA SOMBRA Y LA FRANJA LAS ELIGE UNA PERSONA (Sam, 2026-10-20: «quitar o poner la sombra de
//         las letras… en determinado espacio o palabras» y «cambiar el accent color de la franja»). Tres campos
//         opcionales, todos dato de la marca en lo que pueden valer:
//         · `text_shadow` 'on' | 'off': la sombra de TODO el texto. 'off' la quita; 'on' la pone siempre (sin medir
//           contraste) con la sombra que la marca declara en `layout.text_effect`. Una marca que quiere ofrecerla sin
//           ponerla por defecto la declara con `when: 'on_request'`. Sin sombra declarada, 'on' no inventa una: se
//           compone sin ella y se dice (`OVERLAY_SHADOW_NOT_DECLARED`).
//         · `shadow_spans`: subcadenas literales del titular que van AL REVÉS del resto (sin sombra si el texto la
//           lleva; con ella si no). Mismos límites que `emphasis`.
//         · `rule_role`: el color del filete bajo el titular. Sólo uno de los accent con los que la marca resalta
//           (`emphasisAllowedRoles`) o el suyo de siempre (`layout.rule.palette`); cualquier otro se ignora y se dice.
//         Sin los tres campos, idéntico a 1.8.0.
//   1.10.0 (2026-10-20) — LA BARRA LATERAL TAMBIÉN (Sam, 2026-10-20: «sí, también la barra lateral con los accent»).
//         Campo opcional `identity_role`: el color de la franja de identidad (el sello a sangre del borde). Sólo su
//         color de siempre (`identity.palette`) o los accent con los que la marca resalta; cualquier otro se ignora y
//         se dice. Sin el campo, idéntico a 1.9.0.
//   1.11.0 (2026-10-22) — EL TEXTO DE LA LÁMINA NO TAPA CARAS NI PRODUCTOS (Sam, 2026-10-22, pieza 3c58d5a1: «todo el
//         texto está sobre la cara o los productos, se suponía que eso ya estaba corregido»). 1.6.x sólo protegía el
//         overlay; la lámina de carrusel componía su bloque en el centro fijo de la maqueta v4 sin mirar la foto, y la
//         detección no pedía productos. Tres tokens de DATO, con la forma de `layout.avoid_faces`:
//         · `carousel.avoid_faces` { enabled, margin_pct?, placements?, column_pct?, fallback?, inset_min_pct?, band? } —
//           en las láminas con foto (portada, cuerpo y cierre) se detectan caras con la MISMA llamada de 1.6.x y el bloque
//           se compone en la primera colocación libre de la maqueta: fila (centro, abajo, arriba) y, si la marca la
//           declara, columna (izquierda, derecha). Si ninguna libra, el último recurso es dato (`fallback`): 'inset'
//           compone la lámina sobre la superficie de la marca con la foto reducida debajo del texto; 'band' pone una
//           banda de superficie bajo el texto. Nunca se oscurece la foto entera.
//         · `carousel.avoid_products` y `layout.avoid_products` { enabled, margin_pct? } — la misma llamada pide también
//           los productos, envases y objetos protagonistas, y cuentan como una cara (lámina y overlay).
//         Sin los tokens, la lámina y el overlay salen idénticos a 1.10.0. Si la detección falla, se compone como en
//         1.10.0 y se dice. `meta.carousel.avoid` dice qué se detectó, qué se eligió y por qué.
//   1.11.1 (2026-10-22) — EL 'INSET' NO SE VUELVE PATRÓN (Sam, 2026-10-22: «me gusta el recurso de las láminas 4 y 5
//         mientras aporte variedad y no un patrón»). Medido en 3c58d5a1 tras 1.11.0: tres láminas con 'inset', las tres
//         con el texto arriba. Token de DATO `carousel.avoid_faces.inset_alternate` (booleano): las láminas pares llevan
//         el texto abajo y la foto arriba; las impares, como en 1.11.0. Determinista por número de lámina. Sin el token,
//         idéntico a 1.11.0. `meta.carousel.avoid.inset_text` dice de qué lado quedó el texto.
//   1.12.0 (2026-10-22) — LA UBICACIÓN DEL TEXTO LA PIDE UNA PERSONA (Sam, 2026-10-22, mirando piezas en
//         Arreglos: «quiero poder solicitar … que se cambie la ubicación del texto arriba, abajo o recomponer para que
//         no tape el objetivo o el producto»). Campo opcional de la petición `text_place`: 'top' | 'bottom' | 'auto'.
//         · 'top' / 'bottom' fuerzan la FILA. En el overlay, el ancla de esa fila en la columna que declara la marca;
//           con `avoid_faces`/`avoid_products`, se sigue esquivando, pero sólo por columna dentro de esa fila. En la
//           lámina, la colocación 'top'/'bottom' de la maqueta, y con la política, sus columnas declaradas. Si la fila
//           pedida tapa algo, se compone igual —la pidió una persona— y se dice (`OVERLAY_TEXT_PLACE_COVERS`,
//           `CAROUSEL_TEXT_PLACE_COVERS`). Sin último recurso ('inset'/'band'): moverían el texto de donde se pidió.
//         · 'auto' es la elección de siempre (la que no tapa cara ni producto); sin la política, el ancla declarada.
//         La zona segura del canal (`safe_zone_pct`) se respeta siempre: la caja del texto sale de ella. Un velo en
//         degradado que oscurece el borde contrario al texto pedido sigue al texto. Sin el campo, idéntico a 1.11.1.
//   1.13.0 (2026-10-22) — EL TEXTO NO TAPA EL CUERPO DE LA PERSONA, Y NINGUNA PALABRA QUEDA SOLA EN SU LÍNEA (Sam,
//         2026-10-22: «recomponer para que no tape el objetivo o el producto», y de una marca de
//         autor: «también le veo muchos problemas»). Medido ese día en b95fd1c9, d9e97f57 y 733c033a recompuestas con 1.12.0: la cara queda libre, pero
//         el bloque cae sobre el torso, las piernas o el brazo de la figura de pie, porque sólo se esquivaban cajas de cara
//         y de producto. Y en d9e97f57 «…It told» / «her» / «she was right.»: una palabra sola justo antes del énfasis.
//         · `layout.avoid_people` y `carousel.avoid_people` { enabled, margin_pct?, min_width_pct?, fallback?, band? }
//           (overlay; la lámina usa su propio último recurso) — la MISMA llamada de detección pide también la figura
//           humana completa (cabeza a pies, lo visible), y cuenta como una cara. Se prueban las anclas (overlay) o las
//           colocaciones (lámina) de siempre; si ninguna libra la figura y la marca declara `min_width_pct`, el bloque
//           se ESTRECHA al lado libre de la figura (nunca por debajo de ese ancho); si ni así, el último recurso
//           declarado: en el overlay, 'band' (una banda bajo el texto, del color y alfa que la marca declare); en la
//           lámina, su 'inset'/'band' de 1.11.0. Nunca se oscurece la foto entera. `text_place` sigue mandando sobre la
//           fila: si la fila pedida tapa, se compone igual y se dice, sin último recurso.
//         · LA PALABRA SOLA. El corte de líneas del overlay (titular y bajada) y del titular de la lámina nunca deja una
//           sola palabra en la última línea de un tramo cuando lo que sigue empieza un énfasis, ni en la última línea del
//           bloque: si la línea anterior tiene 3 palabras o más y cabe, una baja a acompañarla. Regla general, medida con
//           las métricas de la fuente; sin métricas, no se toca. Cambia el corte, nunca el tamaño ni la posición.
//         Sin `avoid_people`, la elección es la de 1.12.0; sin palabra sola, la escena es la de 1.12.0.
export const COMPOSITOR_VERSION = '1.13.0';

// Las nueve anclas. Enumeración CERRADA con fail-loud: un ancla que no está no cae a un default
// silencioso — el token está mal escrito y hay que verlo. (La regla multimarca admite enumerar con
// fail-loud; lo que prohíbe es que la enumeración distinga marcas, y ésta es geometría.)
const ANCHORS: Record<string, { y: 'flex-start' | 'center' | 'flex-end'; x: 'flex-start' | 'center' | 'flex-end'; align: 'left' | 'center' | 'right' }> = {
  top_left:      { y: 'flex-start', x: 'flex-start', align: 'left' },
  top_center:    { y: 'flex-start', x: 'center',     align: 'center' },
  top_right:     { y: 'flex-start', x: 'flex-end',   align: 'right' },
  middle_left:   { y: 'center',     x: 'flex-start', align: 'left' },
  center:        { y: 'center',     x: 'center',     align: 'center' },
  middle_right:  { y: 'center',     x: 'flex-end',   align: 'right' },
  bottom_left:   { y: 'flex-end',   x: 'flex-start', align: 'left' },
  bottom_center: { y: 'flex-end',   x: 'center',     align: 'center' },
  bottom_right:  { y: 'flex-end',   x: 'flex-end',   align: 'right' },
};

const SCRIM_MODES = new Set(['none', 'solid', 'gradient_bottom', 'gradient_top']);

// ── BRIEF 8 · D · LA FRANJA DE IDENTIDAD ───────────────────────────────────────────────────────
// El sello de la marca en la imagen. Es MECÁNICA DEL EJE: los cuatro modos son geometría —de qué
// borde nace la franja—, y nada más. El color, el grosor y la PRESENCIA son instancia: viven en la
// fila de la marca (`tokens.identity`), como todo lo demás de este compositor.
//
// REGLA DURA, y es de diseño, no de código: la franja es A SANGRE COMPLETA del borde elegido y
// DELGADA. Jamás un marco cerrado — un rectángulo alrededor de la imagen se lee como un anuncio
// publicitario, y esta franja existe para lo contrario: firmar sin gritar. Por eso no hay ningún
// modo de marco ni combinación de bordes: la enumeración lo hace imposible, no lo desaconseja.
//
// Y se dibuja SIEMPRE que la marca la declare, con titular o sin él: es el sello de la marca, no un
// adorno del texto. De ahí sale la capacidad de SELLAR retroactivamente una escena limpia cuyo
// título todavía no existe.
const IDENTITY_MODES = new Set(['none', 'edge_left', 'edge_right', 'edge_bottom']);
const SLOTS = ['headline', 'subheadline'] as const;
type Slot = (typeof SLOTS)[number];

export interface OverlayText { headline: string; subheadline?: string | null; emphasis?: string[] | null }

// ── 1.4.0 · ÉNFASIS POR PALABRA ────────────────────────────────────────────────────────────────
// EJE: que un titular pueda llevar tramos con otro peso, tamaño, transformación y color, y cómo se
// arman en la escena. INSTANCIA: QUÉ tramos (los marca quien escribe el copy y llegan en `emphasis`)
// y CÓMO se ven (tokens de la marca). El motor no elige palabras ni estilos: sigue el dato.
//
// Los tramos son subcadenas LITERALES del titular. El texto visible es el mismo carácter por carácter
// con énfasis o sin él (regla (a)): el énfasis sólo agrupa y estiliza, nunca escribe.
export const EMPHASIS_MAX_TERMS = 3;
export const EMPHASIS_MAX_CHARS = 60;
// Escala de tamaño admitida para el tramo enfatizado, respecto del titular. Fuera de rango es un
// token mal escrito y se dice (fail-loud), no se recorta en silencio.
const EMPHASIS_SCALE_MIN = 0.5;
const EMPHASIS_SCALE_MAX = 2.5;

/** Valida el campo `emphasis` de la petición. Ausente ⇒ []. Error del LLAMADOR ⇒ 400 con etiqueta. */
/** 1.8.0 — el rol de paleta pedido para el resaltado. Ausente = null. Un rol mal escrito es 400 antes de leer dato. */
export function parseEmphasisRoleRequest(raw: unknown): string | null {
  if (raw == null || raw === '') return null;
  if (typeof raw !== 'string' || !/^[a-z0-9_]{1,40}$/.test(raw))
    throw new CompositorError('COMPOSITOR_EMPHASIS_ROLE_INVALID', 'emphasis_role debe ser el nombre de un rol de brand_palette (minúsculas, números y guion bajo)', 400);
  return raw;
}

/**
 * 1.8.0 — aplica el rol elegido al resaltado del titular. PURA. Sin rol, o sin resaltado en el titular, el estilo
 * sale igual. Con rol que la paleta no tiene, igual y con un marcador. Con rol válido, el color cambia y la
 * corrección automática por contraste se apaga para esta composición. Un rol fuera de los que la marca declara
 * para resaltar (`emphasisAllowedRoles`) no se aplica: sale igual y con un marcador.
 */
export function applyEmphasisRole<S extends { slots: Record<string, any>; layout: Record<string, any>; markers: string[] }>(
  style: S, role: string | null, palette: Array<{ role?: unknown; hex?: unknown }>, allowed: readonly string[],
): { style: S; applied: string | null } {
  if (!role || !style.slots?.headline?.emphasis) return { style, applied: null };
  if (!allowed.includes(role)) {
    return { style: { ...style, markers: [...style.markers, `OVERLAY_EMPHASIS_ROLE_NOT_ALLOWED: '${role}' no está entre los colores de resaltado de la marca [${allowed.join(', ')}]; el resaltado sale con el color de siempre`] }, applied: null };
  }
  const hit = (palette ?? []).find((p) => String(p?.role ?? '') === role && typeof p?.hex === 'string');
  if (!hit) {
    return { style: { ...style, markers: [...style.markers, `OVERLAY_EMPHASIS_ROLE_UNKNOWN: la marca no declara brand_palette.role='${role}'; el resaltado sale con el color de siempre`] }, applied: null };
  }
  const recolored = withEmphasisColor(style, hexToRgba(String(hit.hex), 1));
  return { style: { ...recolored, layout: { ...recolored.layout, emphasisContrast: undefined } }, applied: role };
}

/**
 * 1.8.0 — los roles con los que la marca resalta: el de siempre (`palette.headline_emphasis`) y las alternativas
 * (`layout.emphasis_contrast.fallbacks`). PURA. Es la lista de la que una persona elige y la única que la corrección
 * automática usa: lo que no está aquí no resalta.
 */
export function emphasisAllowedRoles(tokens: Record<string, any> | null | undefined): string[] {
  const out: string[] = [];
  const add = (r: unknown) => { if (typeof r === 'string' && r && !out.includes(r)) out.push(r); };
  add(tokens?.palette?.headline_emphasis);
  const fb = tokens?.layout?.emphasis_contrast?.fallbacks;
  if (Array.isArray(fb)) fb.forEach(add);
  return out;
}

// ── 1.9.0 · LA SOMBRA Y LA FRANJA ELEGIDAS POR UNA PERSONA ─────────────────────────────────────────

/** 1.9.0 — `text_shadow`: 'on' | 'off'. Ausente = null (lo que la marca declara). Otro valor es 400. */
export function parseTextShadowRequest(raw: unknown): 'on' | 'off' | null {
  if (raw == null || raw === '') return null;
  if (raw === 'on' || raw === 'off') return raw;
  throw new CompositorError('COMPOSITOR_TEXT_SHADOW_INVALID', "text_shadow debe ser 'on' u 'off' (o no venir)", 400);
}

/** 1.9.0 — `shadow_spans`: subcadenas del titular con la sombra al revés. Mismos límites que `emphasis`. */
export function parseShadowSpansRequest(raw: unknown): string[] {
  try { return parseEmphasisRequest(raw); } catch (e) {
    throw new CompositorError('COMPOSITOR_SHADOW_SPANS_INVALID', e instanceof Error ? e.message.replace(/^emphasis/, 'shadow_spans') : String(e), 400);
  }
}

/** 1.9.0 — `rule_role`: un rol de `brand_palette` para el filete. Ausente = null. Mal escrito es 400. */
export function parseRuleRoleRequest(raw: unknown): string | null {
  if (raw == null || raw === '') return null;
  if (typeof raw !== 'string' || !/^[a-z0-9_]{1,40}$/.test(raw))
    throw new CompositorError('COMPOSITOR_RULE_ROLE_INVALID', 'rule_role debe ser el nombre de un rol de brand_palette (minúsculas, números y guion bajo)', 400);
  return raw;
}

/**
 * 1.9.0 — los colores posibles del filete: el suyo de siempre (`layout.rule.palette`) y los accent con los que la marca
 * resalta (`emphasisAllowedRoles`). PURA. Dato de la marca: cero roles en el código.
 */
export function ruleAllowedRoles(tokens: Record<string, any> | null | undefined): string[] {
  const out: string[] = [];
  const own = tokens?.layout?.rule?.palette;
  if (typeof own === 'string' && own) out.push(own);
  for (const r of emphasisAllowedRoles(tokens)) if (!out.includes(r)) out.push(r);
  return out;
}

/** 1.9.0 — el color elegido para el filete. PURA. Sin filete, fuera de la lista o sin hex: sale igual y se dice. */
export function applyRuleRole<S extends { rule: null | { color: string }; markers: string[] }>(
  style: S, role: string | null, palette: Array<{ role?: unknown; hex?: unknown }>, allowed: readonly string[],
): { style: S; applied: string | null } {
  if (!role) return { style, applied: null };
  const mark = (m: string) => ({ style: { ...style, markers: [...style.markers, m] }, applied: null });
  if (!style.rule) return mark(`OVERLAY_RULE_NOT_DECLARED: se pidió el filete en '${role}' y la composición no lleva filete`);
  if (!allowed.includes(role)) return mark(`OVERLAY_RULE_ROLE_NOT_ALLOWED: '${role}' no está entre los colores de la marca para el filete [${allowed.join(', ')}]; sale con el de siempre`);
  const hit = (palette ?? []).find((p) => String(p?.role ?? '') === role && typeof p?.hex === 'string');
  if (!hit) return mark(`OVERLAY_RULE_ROLE_UNKNOWN: la marca no declara brand_palette.role='${role}'; el filete sale con el de siempre`);
  return { style: { ...style, rule: { ...style.rule, color: hexToRgba(String(hit.hex), 1) } }, applied: role };
}

/** 1.10.0 — `identity_role`: un rol de `brand_palette` para la franja de identidad. Ausente = null. Mal escrito es 400. */
export function parseIdentityRoleRequest(raw: unknown): string | null {
  if (raw == null || raw === '') return null;
  if (typeof raw !== 'string' || !/^[a-z0-9_]{1,40}$/.test(raw))
    throw new CompositorError('COMPOSITOR_IDENTITY_ROLE_INVALID', 'identity_role debe ser el nombre de un rol de brand_palette (minúsculas, números y guion bajo)', 400);
  return raw;
}

/** 1.10.0 — los colores posibles de la franja de identidad: el suyo (`identity.palette`) y los accent de resaltado. PURA. */
export function identityAllowedRoles(tokens: Record<string, any> | null | undefined): string[] {
  const out: string[] = [];
  const own = tokens?.identity?.palette;
  if (typeof own === 'string' && own) out.push(own);
  for (const r of emphasisAllowedRoles(tokens)) if (!out.includes(r)) out.push(r);
  return out;
}

/** 1.10.0 — el color elegido para la franja de identidad. PURA. Sin franja, fuera de la lista o sin hex: sale igual y se dice. */
export function applyIdentityRole<S extends { identity: null | { color: string }; markers: string[] }>(
  style: S, role: string | null, palette: Array<{ role?: unknown; hex?: unknown }>, allowed: readonly string[],
): { style: S; applied: string | null } {
  if (!role) return { style, applied: null };
  const mark = (m: string) => ({ style: { ...style, markers: [...style.markers, m] }, applied: null });
  if (!style.identity) return mark(`OVERLAY_IDENTITY_NOT_DECLARED: se pidió la franja de identidad en '${role}' y la composición no la lleva`);
  if (!allowed.includes(role)) return mark(`OVERLAY_IDENTITY_ROLE_NOT_ALLOWED: '${role}' no está entre los colores de la marca para la franja [${allowed.join(', ')}]; sale con el de siempre`);
  const hit = (palette ?? []).find((p) => String(p?.role ?? '') === role && typeof p?.hex === 'string');
  if (!hit) return mark(`OVERLAY_IDENTITY_ROLE_UNKNOWN: la marca no declara brand_palette.role='${role}'; la franja sale con el de siempre`);
  return { style: { ...style, identity: { ...style.identity, color: hexToRgba(String(hit.hex), 1) } }, applied: role };
}

/**
 * 1.9.0 — la sombra pedida por una persona. PURA. 'off' quita la de la marca; 'on' pone la declarada siempre (sin
 * medir contraste: la eligió alguien mirando la imagen). Los tramos marcan en el titular dónde va al revés. Sin sombra
 * declarada no se inventa ninguna: lo pedido que la necesita no se aplica y se dice.
 */
export function applyTextShadowRequest<S extends {
  textEffect?: Record<string, any>; textEffectDeclared?: { color: string; blurPct: number; offsetPct: number };
  slots: Record<string, any>; markers: string[];
}>(style: S, mode: 'on' | 'off' | null, spans: readonly string[]): { style: S; applied: { mode: 'on' | 'off' | null; spans: string[] } } {
  let out = style;
  const markers = [...style.markers];
  const declared = style.textEffectDeclared;
  let appliedMode: 'on' | 'off' | null = null;
  if (mode === 'off') {
    const { textEffect: _drop, ...rest } = out;
    out = rest as S; appliedMode = 'off';
  } else if (mode === 'on') {
    if (declared) { out = { ...out, textEffect: { ...declared } }; appliedMode = 'on'; }
    else markers.push("OVERLAY_SHADOW_NOT_DECLARED: se pidió sombra y la marca no declara layout.text_effect; se compone sin ella");
  }
  let found: string[] = [];
  const hl = out.slots?.headline;
  if (spans.length && hl) {
    if (!declared) {
      markers.push('OVERLAY_SHADOW_NOT_DECLARED: hay tramos con la sombra al revés y la marca no declara layout.text_effect; se compone sin tocarlos');
    } else {
      const split = splitEmphasis(String(hl.text ?? ''), [...spans]);
      if (split.missing.length) markers.push(`OVERLAY_SHADOW_SPAN_NOT_IN_HEADLINE: ${split.missing.map((m) => `«${m}»`).join(', ')} no está literal en el titular`);
      const ranges: Array<[number, number]> = [];
      let pos = 0;
      for (const p of split.parts) { if (p.keyword) ranges.push([pos, pos + p.text.length]); pos += p.text.length; }
      if (ranges.length) { out = { ...out, slots: { ...out.slots, headline: { ...hl, shadowFlip: ranges } } }; found = split.found; }
    }
  }
  return { style: { ...out, markers }, applied: { mode: appliedMode, spans: found } };
}

/**
 * 1.9.0 — los tramos del titular con la marca de sombra al revés (`flip`). PURA. Parte los tramos de énfasis (o el
 * titular entero) en los bordes de cada rango; el texto visible no cambia.
 */
export function withShadowFlip(
  text: string, parts: Array<{ text: string; keyword: boolean }> | null | undefined, ranges: ReadonlyArray<[number, number]>,
): Array<{ text: string; keyword: boolean; flip?: boolean }> {
  const base = parts && parts.length ? parts : [{ text, keyword: false }];
  const cuts = new Set<number>();
  for (const [a, b] of ranges) { cuts.add(a); cuts.add(b); }
  const inFlip = (i: number) => ranges.some(([a, b]) => i >= a && i < b);
  const out: Array<{ text: string; keyword: boolean; flip?: boolean }> = [];
  let pos = 0;
  for (const p of base) {
    let start = 0;
    for (let k = 1; k <= p.text.length; k++) {
      if (k === p.text.length || cuts.has(pos + k)) {
        const seg = p.text.slice(start, k);
        if (seg) out.push({ text: seg, keyword: p.keyword, ...(inFlip(pos + start) ? { flip: true } : {}) });
        start = k;
      }
    }
    pos += p.text.length;
  }
  return out;
}

export function parseEmphasisRequest(raw: unknown): string[] {
  if (raw == null) return [];
  const bad = (msg: string) => new CompositorError('COMPOSITOR_EMPHASIS_INVALID', msg, 400);
  if (!Array.isArray(raw)) throw bad('emphasis debe ser una lista de subcadenas del titular');
  if (raw.length > EMPHASIS_MAX_TERMS) throw bad(`emphasis trae ${raw.length} tramos; el máximo es ${EMPHASIS_MAX_TERMS}`);
  const out: string[] = [];
  raw.forEach((v, k) => {
    if (typeof v !== 'string' || !v.trim()) throw bad(`emphasis[${k}] debe ser texto no vacío`);
    if (v.length > EMPHASIS_MAX_CHARS) throw bad(`emphasis[${k}] excede ${EMPHASIS_MAX_CHARS} caracteres`);
    if (!out.includes(v)) out.push(v);
  });
  return out;
}

/**
 * Parte el titular en tramos alrededor de VARIAS subcadenas literales. Cada término marca su primera
 * aparición que no se solape con un término anterior (el orden de la lista es la prioridad). Los que
 * no aparecen se devuelven en `missing`; el titular nunca cambia. Con un solo término el resultado es
 * el mismo que el de `splitKeyword`.
 */
export function splitEmphasis(headline: string, terms: Array<string | null | undefined>): {
  parts: Array<{ text: string; keyword: boolean }>; found: string[]; missing: string[];
} {
  const h = String(headline ?? '');
  const ranges: Array<[number, number]> = [];
  const found: string[] = [];
  const missing: string[] = [];
  for (const raw of terms ?? []) {
    const k = raw ?? '';
    if (!k) continue;
    let from = 0;
    let at = -1;
    while (from <= h.length) {
      const i = h.indexOf(k, from);
      if (i < 0) break;
      if (!ranges.some(([a, b]) => i < b && i + k.length > a)) { at = i; break; }
      from = i + 1;
    }
    if (at < 0) { missing.push(k); continue; }
    ranges.push([at, at + k.length]);
    found.push(k);
  }
  if (!h) return { parts: [], found, missing };
  ranges.sort((a, b) => a[0] - b[0]);
  const parts: Array<{ text: string; keyword: boolean }> = [];
  let cur = 0;
  for (const [a, b] of ranges) {
    if (a > cur) parts.push({ text: h.slice(cur, a), keyword: false });
    parts.push({ text: h.slice(a, b), keyword: true });
    cur = b;
  }
  if (cur < h.length) parts.push({ text: h.slice(cur), keyword: false });
  return { parts, found, missing };
}

/** Estilo de un tramo enfatizado: lo que la marca declara y, lo que no declara, heredado del titular. */
export interface EmphasisType {
  role: string; family: string; cssImport: string | null; fallback: string | null; fontUrl: string | null;
  weight: number; italic: boolean; transform: string; letterSpacingEm: number; sizeScale: number;
}

/**
 * Resuelve `…headline.emphasis` contra `brand_typography`. Token ausente ⇒ null (la marca no declara
 * énfasis: la escena sale como antes). Token presente y mal escrito ⇒ se acumula en `missing` y el
 * llamador falla nombrando, como el resto del bloque.
 */
export function resolveEmphasisType(
  tok: unknown,
  base: { role: string; weight: number; italic: boolean; transform: string; letterSpacingEm: number },
  typoBy: Map<string, { role: string; font_family: string; css_import?: string | null; fallback?: string | null }>,
  where: string,
  missing: string[],
): EmphasisType | null {
  if (!isPlain(tok) || Object.keys(tok).length === 0) return null;
  const e = tok as Record<string, any>;
  const role = e.role != null ? String(e.role) : base.role;
  const typo = typoBy.get(role);
  if (!typo) { missing.push(`brand_typography.role='${role}' (pedido por ${where}.role)`); return null; }
  const scale = e.size_scale == null ? 1 : Number(e.size_scale);
  if (!Number.isFinite(scale) || scale < EMPHASIS_SCALE_MIN || scale > EMPHASIS_SCALE_MAX) {
    missing.push(`${where}.size_scale=${e.size_scale} (válido: ${EMPHASIS_SCALE_MIN}..${EMPHASIS_SCALE_MAX})`);
    return null;
  }
  return {
    role, family: String(typo.font_family),
    cssImport: typo.css_import ? String(typo.css_import) : null,
    fallback: typo.fallback ? String(typo.fallback) : null,
    fontUrl: e.font_url ? String(e.font_url) : null,
    weight: e.weight != null ? Number(e.weight) : base.weight,
    italic: e.italic != null ? e.italic === true : base.italic,
    transform: e.transform != null ? String(e.transform) : base.transform,
    letterSpacingEm: e.letter_spacing_em != null ? Number(e.letter_spacing_em) : base.letterSpacingEm,
    sizeScale: scale,
  };
}

/**
 * Largo efectivo de un titular con tramos de otra escala, para la escalera `fit_steps` (que cuenta
 * caracteres): un tramo al 130 % ocupa como 1,3 veces sus caracteres. Sin énfasis es el largo de siempre.
 */
export function emphasisEffectiveLength(parts: Array<{ text: string; keyword: boolean }>, scale: number): number {
  let n = 0;
  for (const p of parts) n += p.keyword ? p.text.length * scale : p.text.length;
  return Math.round(n);
}

/** Error del compositor con etiqueta estable: es lo que el carril asienta y lo que se grepea. */
export class CompositorError extends Error {
  label: string;
  status: number;
  constructor(label: string, message: string, status = 422) {
    super(message);
    this.label = label;
    this.status = status;
  }
}

/** Objeto plano (no array, no null). Lo usa el merge de capas. */
function isPlain(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Merge profundo, la capa de la derecha gana clave a clave. Los arrays se REEMPLAZAN, nunca se
 * concatenan: un `fit_steps` de marca tiene que poder sustituir al global entero, no mezclarse con él.
 */
export function deepMergeTokens<T extends Record<string, unknown>>(base: T, over: Record<string, unknown>): T {
  const out: Record<string, unknown> = { ...base };
  for (const k of Object.keys(over)) {
    const a = out[k];
    const b = over[k];
    out[k] = isPlain(a) && isPlain(b) ? deepMergeTokens(a, b) : b;
  }
  return out as T;
}

/**
 * Precedencia de `imagelab_overlay_tokens`, por especificidad y de menos a más:
 *
 *   global (brand NULL, canal NULL) → global de canal → marca → marca + canal
 *
 * Es la MISMA forma que `imagelab_presets` resuelve para el estilo visual (#95-C) y por la misma
 * razón: lo global rellena, la marca declara y el canal ajusta. Las capas se acumulan (merge), no
 * se excluyen: una marca que sólo declara la posición hereda del global el resto.
 *
 * Una fila cuyo brand_id o canal no corresponden a esta llamada se descarta (specificity -1).
 */
export function pickOverlayTokens(
  rows: Array<Record<string, any>>, brandId: string, canal: string | null,
): { tokens: Record<string, any>; source: string; layers: string[] } {
  const scored = (rows ?? [])
    .filter((r) => r && r.active !== false)
    .map((r) => {
      const b = r.brand_id == null ? 0 : (r.brand_id === brandId ? 2 : -1);
      const c = r.canal == null ? 0 : (canal && r.canal === canal ? 1 : -1);
      return { row: r, score: b < 0 || c < 0 ? -1 : b + c };
    })
    .filter((s) => s.score >= 0)
    // Orden estable y total: la especificidad manda; a igual especificidad, el id desempata para
    // que dos filas gemelas no dependan del orden en que PostgREST las devolvió.
    .sort((a, b) => (a.score - b.score) || String(a.row.id ?? '').localeCompare(String(b.row.id ?? '')));

  if (scored.length === 0) {
    throw new CompositorError(
      'COMPOSITOR_TOKENS_MISSING',
      `no hay fila de imagelab_overlay_tokens para brand_id='${brandId}' canal='${canal ?? '∅'}' (ni global). ` +
      'La tipografía, la paleta y la posición son DATO por marca: sin fila no hay composición y el motor no inventa una.',
    );
  }

  let tokens: Record<string, any> = {};
  const layers: string[] = [];
  for (const s of scored) {
    tokens = deepMergeTokens(tokens, (s.row.tokens ?? {}) as Record<string, unknown>);
    layers.push(`${s.row.brand_id ?? '*'}:${s.row.canal ?? '*'}`);
  }
  return { tokens, source: layers[layers.length - 1], layers };
}

/**
 * Elige el tamaño de fuente sin tocar el TEXTO. `fit_steps` es una escalera declarada por la marca
 * (`[{max_chars, size_pct}, …]`): gana el primer escalón cuyo `max_chars` alcanza. Si ninguno
 * alcanza, se usa el último (el más chico) y se emite un marcador — el titular entra igual, más
 * chico, y queda constancia. NUNCA se recorta ni se reescribe: el texto es el copy ya juzgado.
 */
export function fitFontSizePct(
  fitSteps: Array<{ max_chars: number; size_pct: number }>, text: string,
): { sizePct: number; overflow: boolean } {
  const steps = [...(fitSteps ?? [])].sort((a, b) => Number(a.max_chars) - Number(b.max_chars));
  const len = String(text ?? '').length;
  for (const s of steps) if (len <= Number(s.max_chars)) return { sizePct: Number(s.size_pct), overflow: false };
  return { sizePct: Number(steps[steps.length - 1].size_pct), overflow: true };
}

/** `#RRGGBB` (o `#RGB`) + alfa → `rgba()`. El hex sale de `brand_palette`; aquí no hay ninguno. */
export function hexToRgba(hex: string, alpha = 1): string {
  const h = String(hex ?? '').trim().replace(/^#/, '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    throw new CompositorError('COMPOSITOR_COLOR_INVALID', `hex inválido en brand_palette: '${hex}'`);
  }
  const n = parseInt(full, 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return alpha >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Une las tres fuentes de DATO en un estilo concreto:
 *   · `imagelab_overlay_tokens` — qué rol tipográfico y qué rol de paleta juega cada ranura, y dónde
 *     va el bloque. Es el único que declara la POSICIÓN.
 *   · `brand_typography`        — un ROL tipográfico de la marca → familia + import de la fuente.
 *   · `brand_palette`           — un ROL de color de la marca → hex.
 *
 * Los ROLES los nombra la MARCA en sus propios tokens; el motor sólo los sigue. Dos marcas con
 * catálogos de rol disjuntos —una que llama a sus colores por material y otra por función— componen
 * con este mismo código sin que aparezca aquí el nombre de ninguna. Esa indirección es lo que hace
 * que el motor sobreviva a la marca N+1; el test lo verifica grepeando este bloque.
 *
 * FAIL-LOUD ACUMULATIVO: junta TODO lo que falta y lo reporta junto (un solo viaje para el que
 * siembra el dato), y no compone. Un default de fuente o de color aquí anularía el brief entero.
 */
// ── 1.13.0 · EL TEXTO NO TAPA EL CUERPO DE LA PERSONA ──────────────────────────────────────────────────────────
// EJE (código): QUÉ se evita —la caja del texto no cruza la figura humana completa, con un margen— y CÓMO —las anclas o
// colocaciones de siempre; si ninguna libra, el bloque se estrecha al lado libre de la figura; si ni así, el último
// recurso declarado—. INSTANCIA (dato): si se aplica, el margen, el ancho mínimo y el último recurso, en
// `layout.avoid_people` y `carousel.avoid_people`. El código no nombra marcas.
export interface OverlayAvoidPeople {
  marginPct: number;
  // % del ANCHO de la imagen por debajo del cual el bloque no se estrecha. null ⇒ no se estrecha.
  minWidthPct: number | null;
  // Último recurso 'band' del overlay: color ya resuelto (rgba) y relleno alrededor del texto (% del lado corto).
  band: null | { color: string; padPct: number };
}
// Ancho mínimo admitido para estrechar: por debajo, una columna de texto se vuelve una lista de palabras sueltas.
const AVOID_PEOPLE_MIN_WIDTH = { lo: 20, hi: 95 };

/** 1.13.0 — lee la forma común de `avoid_people` (overlay y lámina). Fail-loud acumulado, como los demás tokens. PURO.
 *  `fallback` sólo existe en el overlay ('band'); la lámina usa el último recurso de `carousel.avoid_faces`. */
export function parseAvoidPeople(tok: unknown, path: string, allowFallback: boolean): {
  missing: string[]; value: null | { marginPct: number; minWidthPct: number | null; fallback: 'band' | null };
} {
  const missing: string[] = [];
  const a = tok as Record<string, any>;
  if (!isPlain(tok) || a.enabled !== true) {
    missing.push(`${path} (objeto { enabled: true, margin_pct?: 0..20, min_width_pct?: ${AVOID_PEOPLE_MIN_WIDTH.lo}..${AVOID_PEOPLE_MIN_WIDTH.hi}${allowFallback ? ", fallback?: 'band', band?: { color, alpha, pad_pct? }" : ''} }; llegó ${JSON.stringify(tok)})`);
    return { missing, value: null };
  }
  const marginPct = Number(a.margin_pct ?? 1);
  if (!Number.isFinite(marginPct) || marginPct < 0 || marginPct > 20) missing.push(`${path}.margin_pct=${JSON.stringify(a.margin_pct)} (0 ≤ x ≤ 20)`);
  const minWidthPct = a.min_width_pct == null ? null : Number(a.min_width_pct);
  if (minWidthPct !== null && !(Number.isFinite(minWidthPct) && minWidthPct >= AVOID_PEOPLE_MIN_WIDTH.lo && minWidthPct <= AVOID_PEOPLE_MIN_WIDTH.hi)) {
    missing.push(`${path}.min_width_pct=${JSON.stringify(a.min_width_pct)} (${AVOID_PEOPLE_MIN_WIDTH.lo} ≤ x ≤ ${AVOID_PEOPLE_MIN_WIDTH.hi}, % del ancho)`);
  }
  let fallback: 'band' | null = null;
  if (a.fallback != null) {
    if (!allowFallback) missing.push(`${path}.fallback: la lámina usa el último recurso de carousel.avoid_faces.fallback`);
    else if (a.fallback !== 'band') missing.push(`${path}.fallback=${JSON.stringify(a.fallback)} (válido: 'band')`);
    else fallback = 'band';
  }
  return { missing, value: missing.length ? null : { marginPct, minWidthPct, fallback } };
}

export function resolveOverlayStyle(args: {
  tokens: Record<string, any>;
  typography: Array<{ role: string; font_family: string; css_import?: string | null; fallback?: string | null }>;
  palette: Array<{ role: string; hex: string }>;
  text: OverlayText;
}): {
  layout: {
    anchor: string; marginPct: number; maxWidthPct: number; gapPct: number; align: 'left' | 'center' | 'right';
    // 1.5.0 — sólo existen si la marca o el canal los declaran.
    maxTextAreaPct?: number;
    safeZonePct?: { top: number; bottom: number; left: number; right: number };
    // 1.6.0 — sólo existe si la marca o el canal lo declaran.
    avoidFaces?: { anchors: string[]; marginPct: number; keepAlign: boolean };
    // 1.6.3 — sólo existen si la marca o el canal los declaran.
    avoidSceneText?: { marginPct: number; blurPct: number | null };
    // 1.11.0 — sólo existe si la marca o el canal lo declaran. Va con `avoidFaces`: comparte su detección.
    avoidProducts?: { marginPct: number };
    // 1.13.0 — sólo existe si la marca o el canal lo declaran. Va con `avoidFaces`: comparte su detección.
    avoidPeople?: OverlayAvoidPeople;
    emphasisContrast?: { minContrast: number; fallbacks: Array<{ role: string; hex: string }>; minContrastVsText?: number };
  };
  // 1.13.0 — el último recurso 'band' de `avoid_people`: una banda bajo el texto (px del lienzo). Sólo existe si se usó.
  band?: { x0: number; y0: number; x1: number; y1: number; color: string };
  // 1.6.0 — sombra por glifo del overlay. Sólo existe si la marca la declara.
  // 1.6.2 — `when: 'low_contrast'` ⇒ sólo se aplica si la medición del fondo lo pide (`decideTextEffect`).
  textEffect?: { color: string; blurPct: number; offsetPct: number; when?: 'always' | 'low_contrast'; minContrast?: number; shadowHex?: string };
  // 1.9.0 — la sombra que la marca declara, se aplique hoy o no (`when: 'on_request'` sólo existe aquí). La usan
  // `text_shadow: 'on'` y los tramos de `shadow_spans`.
  textEffectDeclared?: { color: string; blurPct: number; offsetPct: number };
  slots: Record<Slot, null | {
    text: string; role: string; family: string; fallback: string | null; cssImport: string | null;
    fontUrl: string | null; weight: number; italic: boolean; transform: string;
    lineHeight: number; letterSpacingEm: number; sizePct: number; color: string;
    // 1.4.0 — tramos del titular con énfasis. null ⇒ la ranura se dibuja como en 1.3.4 (un solo texto).
    parts?: null | Array<{ text: string; keyword: boolean }>;
    emphasis?: null | (EmphasisType & { color: string });
    // 1.7.0 — dónde se corta el titular, en tramos [inicio, fin). Ausente ⇒ satori envuelve solo (1.6.4).
    lines?: Array<[number, number]>;
    // 1.9.0 — tramos del titular [inicio, fin) cuya sombra va al revés del resto. Ausente ⇒ como 1.8.0.
    shadowFlip?: Array<[number, number]>;
    // 1.5.0 — los escalones de `fit_steps` MÁS CHICOS que el elegido, de mayor a menor: el límite de área
    // baja por ellos. Lo usa sólo `fitOverlayTextArea`; la escena no lo lee.
    fitSmaller?: number[];
  }>;
  scrim: null | { mode: string; color: string; opacity: number; coveragePct: number };
  rule: null | { color: string; widthPct: number; thicknessPx: number; gapPct: number };
  identity: null | { mode: string; color: string; widthPct: number; fullBleed: boolean };
  markers: string[];
} {
  const missing: string[] = [];
  const markers: string[] = [];
  const t = args.tokens ?? {};
  const typoBy = new Map((args.typography ?? []).map((r) => [String(r.role), r]));
  const palBy = new Map((args.palette ?? []).map((r) => [String(r.role), r]));

  const layoutTok = (t.layout ?? {}) as Record<string, any>;
  const anchor = String(layoutTok.anchor ?? '');
  if (!ANCHORS[anchor]) missing.push(`layout.anchor='${anchor || '∅'}' (válidos: ${Object.keys(ANCHORS).join(', ')})`);
  for (const k of ['margin_pct', 'max_width_pct']) {
    if (!Number.isFinite(Number(layoutTok[k]))) missing.push(`layout.${k}`);
  }

  const slots = { headline: null, subheadline: null } as ReturnType<typeof resolveOverlayStyle>['slots'];
  for (const slot of SLOTS) {
    const raw = slot === 'headline' ? args.text?.headline : args.text?.subheadline;
    const value = String(raw ?? '');
    // Ranura sin texto = ranura que no se dibuja. `subheadline` es opcional POR CONTRATO: una pieza
    // sin bajada compone igual. `headline` vacío no llega aquí (lo rechaza el handler).
    if (!value.trim()) continue;

    const st = ((t.typography ?? {})[slot] ?? {}) as Record<string, any>;
    // Ranura NO DECLARADA por la marca —distinto de declarada a medias, que sí es un error— : la
    // marca decidió que su composición no la lleva. Se salta con marcador y se compone el resto.
    // `headline` no admite esta salida: sin titular no hay nada que componer.
    if (slot !== 'headline' && Object.keys(st).length === 0) {
      markers.push(`OVERLAY_SLOT_NOT_DECLARED: la marca no declara typography.${slot}; se compone sin esa ranura`);
      continue;
    }
    const typoRole = String(st.role ?? '');
    const palRole = String((t.palette ?? {})[slot] ?? '');
    const typo = typoBy.get(typoRole);
    const pal = palBy.get(palRole);
    if (!typoRole) missing.push(`typography.${slot}.role`);
    else if (!typo) missing.push(`brand_typography.role='${typoRole}' (pedido por typography.${slot}.role)`);
    if (!palRole) missing.push(`palette.${slot}`);
    else if (!pal) missing.push(`brand_palette.role='${palRole}' (pedido por palette.${slot})`);
    const steps = Array.isArray(st.fit_steps) ? st.fit_steps : [];
    if (steps.length === 0) missing.push(`typography.${slot}.fit_steps`);
    if (!typo || !pal || steps.length === 0) continue;

    // 1.4.0 — énfasis: sólo en el titular. El token se valida siempre que exista (un dato mal escrito
    // se ve aunque esta pieza no traiga tramos); los tramos se aplican sólo si la marca lo declara.
    let parts: Array<{ text: string; keyword: boolean }> | null = null;
    let emphasis: (EmphasisType & { color: string }) | null = null;
    if (slot === 'headline') {
      const emType = resolveEmphasisType(st.emphasis, {
        role: typoRole, weight: Number(st.weight ?? 400), italic: st.italic === true,
        transform: String(st.transform ?? 'none'), letterSpacingEm: Number(st.letter_spacing_em ?? 0),
      }, typoBy, `typography.${slot}.emphasis`, missing);
      const emRole = (t.palette ?? {}).headline_emphasis;
      let emColor = hexToRgba(String(pal.hex), 1);
      if (emType && emRole != null) {
        const ep = palBy.get(String(emRole));
        if (!ep) missing.push(`brand_palette.role='${emRole}' (pedido por palette.headline_emphasis)`);
        else emColor = hexToRgba(String(ep.hex), 1);
      }
      const terms = (args.text?.emphasis ?? []).filter((x) => typeof x === 'string' && x);
      if (terms.length && !emType) {
        markers.push('OVERLAY_EMPHASIS_NOT_DECLARED: la petición trae tramos de énfasis y la marca no declara typography.headline.emphasis; se compone sin énfasis');
      } else if (terms.length && emType) {
        const split = splitEmphasis(value, terms);
        if (split.missing.length) {
          markers.push(`OVERLAY_EMPHASIS_NOT_IN_HEADLINE: ${split.missing.map((m) => `«${m}»`).join(', ')} no está literal en el titular; ese tramo no se resalta`);
        }
        if (split.found.length) { parts = split.parts; emphasis = { ...emType, color: emColor }; }
      }
    }
    // 1.7.0 — dónde se corta el titular: lo escrito a mano manda; con énfasis, la regla. Sin ninguno, null
    // y la ranura queda como en 1.6.4.
    // `typography.headline.line_breaks` es DATO: 'emphasis_rule' (sin el token) aplica la regla; 'auto' la
    // apaga y deja que satori envuelva solo. Un salto escrito se respeta en los dos.
    const lbTok = slot === 'headline' ? (st.line_breaks ?? 'emphasis_rule') : 'auto';
    if (lbTok !== 'emphasis_rule' && lbTok !== 'auto') missing.push(`typography.${slot}.line_breaks ('emphasis_rule' o 'auto'; llegó ${JSON.stringify(st.line_breaks)})`);
    const lines = slot === 'headline'
      ? headlineLineRanges(value, parts && emphasis && lbTok === 'emphasis_rule' ? parts : null) : null;
    if (lines) markers.push(`OVERLAY_HEADLINE_LINES: ${lines.ranges.length} líneas (${lines.source === 'manual' ? 'escritas en el titular' : 'regla del énfasis'})`);

    const fit = fitFontSizePct(steps, parts && emphasis ? 'x'.repeat(emphasisEffectiveLength(parts, emphasis.sizeScale)) : value);
    if (fit.overflow) {
      markers.push(
        `OVERLAY_TEXT_OVERFLOW: ${slot} de ${value.length} caracteres excede el último escalón declarado ` +
        `(${steps[steps.length - 1].max_chars}); se compone entero al tamaño más chico (${fit.sizePct}%). ` +
        'El texto NO se recorta: es el copy ya juzgado.',
      );
    }
    slots[slot] = {
      text: value,
      role: typoRole,
      family: String(typo.font_family),
      fallback: typo.fallback ? String(typo.fallback) : null,
      cssImport: typo.css_import ? String(typo.css_import) : null,
      fontUrl: st.font_url ? String(st.font_url) : null,
      weight: Number(st.weight ?? 400),
      italic: st.italic === true,
      transform: String(st.transform ?? 'none'),
      lineHeight: Number(st.line_height ?? 1.15),
      letterSpacingEm: Number(st.letter_spacing_em ?? 0),
      sizePct: fit.sizePct,
      color: hexToRgba(String(pal.hex), 1),
      // Sin tramos, las dos claves no existen: la ranura es la de 1.3.4, clave por clave.
      ...(parts && emphasis ? { parts, emphasis } : {}),
      // 1.7.0 — sin cortes impuestos la clave no existe: la ranura es la de 1.6.4.
      ...(lines ? { lines: lines.ranges } : {}),
      fitSmaller: [...new Set(steps.map((x: any) => Number(x.size_pct)))]
        .filter((x) => Number.isFinite(x) && x > 0 && x < fit.sizePct).sort((a, b) => b - a),
    };
  }

  // Velo. Existe para una razón medible: un titular sobre foto sin velo es ilegible en la mitad de
  // las escenas. Su modo, su color (rol de paleta) y su cobertura son DATO.
  let scrim: ReturnType<typeof resolveOverlayStyle>['scrim'] = null;
  const scrimTok = (layoutTok.scrim ?? null) as Record<string, any> | null;
  if (scrimTok && String(scrimTok.mode ?? 'none') !== 'none') {
    const mode = String(scrimTok.mode);
    if (!SCRIM_MODES.has(mode)) missing.push(`layout.scrim.mode='${mode}' (válidos: ${[...SCRIM_MODES].join(', ')})`);
    const role = String(scrimTok.palette ?? '');
    const pal = palBy.get(role);
    if (!role) missing.push('layout.scrim.palette');
    else if (!pal) missing.push(`brand_palette.role='${role}' (pedido por layout.scrim.palette)`);
    if (pal && SCRIM_MODES.has(mode)) {
      scrim = {
        mode,
        color: String(pal.hex),
        opacity: Number(scrimTok.opacity ?? 1),
        coveragePct: Number(scrimTok.coverage_pct ?? 100),
      };
    }
  }

  // Filete de marca. Opcional y también dato.
  let rule: ReturnType<typeof resolveOverlayStyle>['rule'] = null;
  const ruleTok = (layoutTok.rule ?? null) as Record<string, any> | null;
  if (ruleTok && ruleTok.enabled === true) {
    const role = String(ruleTok.palette ?? '');
    const pal = palBy.get(role);
    if (!role) missing.push('layout.rule.palette');
    else if (!pal) missing.push(`brand_palette.role='${role}' (pedido por layout.rule.palette)`);
    if (pal) {
      rule = {
        color: hexToRgba(String(pal.hex), 1),
        widthPct: Number(ruleTok.width_pct ?? 10),
        thicknessPx: Number(ruleTok.thickness_px ?? 3),
        gapPct: Number(ruleTok.gap_pct ?? 2),
      };
    }
  }

  // BRIEF 8 · D — la franja de identidad. Ausente ⇒ null y la escena queda como antes de este brief:
  // aditivo, igual que todo lo demás. Declarada a medias (modo desconocido, rol de paleta que la
  // marca no tiene) ⇒ falla nombrando, como el resto del bloque: el sello de una marca no se dibuja
  // «aproximadamente».
  let identity: ReturnType<typeof resolveOverlayStyle>['identity'] = null;
  const identityTok = (t.identity ?? null) as Record<string, any> | null;
  if (identityTok && String(identityTok.mode ?? 'none') !== 'none') {
    const mode = String(identityTok.mode);
    if (!IDENTITY_MODES.has(mode)) missing.push(`identity.mode='${mode}' (válidos: ${[...IDENTITY_MODES].join(', ')})`);
    const role = String(identityTok.palette ?? '');
    const pal = palBy.get(role);
    if (!role) missing.push('identity.palette');
    else if (!pal) missing.push(`brand_palette.role='${role}' (pedido por identity.palette)`);
    const widthPct = Number(identityTok.width_pct);
    if (!Number.isFinite(widthPct) || widthPct <= 0) missing.push('identity.width_pct');
    if (pal && IDENTITY_MODES.has(mode) && Number.isFinite(widthPct) && widthPct > 0) {
      identity = {
        mode,
        color: hexToRgba(String(pal.hex), 1),
        widthPct,
        // `full_bleed: false` NO es "más corta": es una declaración que este motor todavía no sabe
        // dibujar de otra manera, y se dice en vez de silenciarse. La franja siempre corre el borde
        // entero; un día que exista un modo parcial, este flag es donde vive.
        fullBleed: identityTok.full_bleed !== false,
      };
      if (identityTok.full_bleed === false) {
        markers.push('IDENTITY_FULL_BLEED_IGNORED: identity.full_bleed=false no está implementado; la franja se dibuja a sangre completa (nunca un marco cerrado)');
      }
    }
  }

  // 1.5.0 — los requisitos de la plataforma, como dato del canal. Declarados mal ⇒ fail-loud, como el resto.
  let maxTextAreaPct: number | null = null;
  if (layoutTok.max_text_area_pct != null) {
    const v = Number(layoutTok.max_text_area_pct);
    if (!Number.isFinite(v) || v <= 0 || v > 100) missing.push(`layout.max_text_area_pct=${layoutTok.max_text_area_pct} (válido: 0 < x ≤ 100)`);
    else maxTextAreaPct = v;
  }
  let safeZonePct: { top: number; bottom: number; left: number; right: number } | null = null;
  if (layoutTok.safe_zone_pct != null) {
    const z = layoutTok.safe_zone_pct as Record<string, unknown>;
    const sides = ['top', 'bottom', 'left', 'right'] as const;
    const vals = sides.map((k) => Number(isPlain(z) ? (z[k] ?? 0) : NaN));
    if (!isPlain(z) || vals.some((v) => !Number.isFinite(v) || v < 0 || v >= 50)) {
      missing.push(`layout.safe_zone_pct (objeto { top, bottom, left, right } con 0 ≤ x < 50; llegó ${JSON.stringify(layoutTok.safe_zone_pct)})`);
    } else safeZonePct = { top: vals[0], bottom: vals[1], left: vals[2], right: vals[3] };
  }

  // 1.6.0 — el texto no tapa una cara. Ausente o `enabled: false` ⇒ no existe y nada cambia.
  let avoidFaces: { anchors: string[]; marginPct: number; keepAlign: boolean } | null = null;
  const afTok = layoutTok.avoid_faces as unknown;
  if (afTok != null && !(isPlain(afTok) && (afTok as Record<string, unknown>).enabled === false)) {
    const af = afTok as Record<string, unknown>;
    if (!isPlain(afTok) || af.enabled !== true) {
      missing.push(`layout.avoid_faces (objeto { enabled: true, anchors?: [anclas], margin_pct?: 0..20 }; llegó ${JSON.stringify(afTok)})`);
    } else {
      const list = af.anchors == null ? faceAnchorCandidates(anchor) : (Array.isArray(af.anchors) ? af.anchors.map(String) : null);
      const bad = list === null ? ['(no es una lista)'] : list.filter((a) => !ANCHORS[a]);
      const marginPct = Number(af.margin_pct ?? 2);
      if (bad.length) missing.push(`layout.avoid_faces.anchors: ${bad.join(', ')} (válidos: ${Object.keys(ANCHORS).join(', ')})`);
      if (!Number.isFinite(marginPct) || marginPct < 0 || marginPct > 20) missing.push(`layout.avoid_faces.margin_pct=${af.margin_pct} (0 ≤ x ≤ 20)`);
      if (!bad.length && list && ANCHORS[anchor] && Number.isFinite(marginPct) && marginPct >= 0 && marginPct <= 20) {
        avoidFaces = { anchors: [...new Set([anchor, ...list])], marginPct, keepAlign: layoutTok.align != null };
      }
    }
  }
  // 1.6.0 — sombra por glifo del overlay: la MISMA forma que `carousel.text_effect` (1.3.4), con el color como
  // ROL de `brand_palette` (como el velo y el filete del overlay), no como función del cromo de carrusel.
  let textEffect: { color: string; blurPct: number; offsetPct: number; when?: 'always' | 'low_contrast'; minContrast?: number; shadowHex?: string } | null = null;
  let textEffectDeclared: { color: string; blurPct: number; offsetPct: number } | null = null;
  if (layoutTok.text_effect != null) {
    try {
      const te = parseCarouselTextEffect(layoutTok.text_effect);
      // 1.6.2 — el color es un ROL de `brand_palette` (capa de marca) o un hex literal (capa global: una regla del
      // sistema no puede nombrar un rol que la marca N+1 quizá no tenga). Ambos son dato; el código no trae color.
      const pal = HEX_COLOR.test(te.fn) ? { role: te.fn, hex: te.fn } : palBy.get(te.fn);
      // 1.6.2 — cuándo se aplica. Ausente ⇒ siempre (1.6.0). 'low_contrast' exige su umbral: sin él no hay regla.
      const rawTe = layoutTok.text_effect as Record<string, unknown>;
      const when = rawTe.when == null ? 'always' : String(rawTe.when);
      const minContrast = Number(rawTe.min_contrast);
      let whenOk = true;
      if (!TEXT_EFFECT_WHEN.has(when)) { whenOk = false; missing.push(`layout.text_effect.when='${when}' (válidos: ${[...TEXT_EFFECT_WHEN].join(', ')})`); }
      else if (when === 'low_contrast' && !(Number.isFinite(minContrast) && minContrast >= 1 && minContrast <= 21)) {
        whenOk = false;
        missing.push(`layout.text_effect.min_contrast=${JSON.stringify(rawTe.min_contrast)} (razón de contraste, 1 ≤ x ≤ 21; obligatoria con when='low_contrast')`);
      }
      if (!pal) missing.push(`brand_palette.role='${te.fn}' (pedido por layout.text_effect.color; también admite un hex #RRGGBB)`);
      else if (whenOk) {
        textEffectDeclared = { color: hexToRgba(String(pal.hex), te.alpha), blurPct: te.blurPct, offsetPct: te.offsetPct };
        // 1.9.0 — 'on_request': declarada, disponible para quien la pida, y apagada por defecto.
        if (when !== 'on_request') textEffect = { ...textEffectDeclared };
        if (when === 'low_contrast') textEffect = { ...textEffect!, when: 'low_contrast', minContrast, shadowHex: String(pal.hex) };
      }
    } catch (e) {
      missing.push(`layout.text_effect: ${e instanceof Error ? e.message.replace(/carousel\.text_effect/g, 'layout.text_effect').replace('función de tokens.palette', 'rol de brand_palette') : String(e)}`);
    }
  }

  // 1.6.3 — el texto esquiva los letreros de la escena. Va con `avoid_faces`: usa su detección y sus anclas.
  let avoidSceneText: { marginPct: number; blurPct: number | null } | null = null;
  const astTok = layoutTok.avoid_scene_text as unknown;
  if (astTok != null && !(isPlain(astTok) && (astTok as Record<string, unknown>).enabled === false)) {
    const a = astTok as Record<string, unknown>;
    const marginPct = Number(a.margin_pct ?? 1);
    const blurPct = a.blur_pct == null ? null : Number(a.blur_pct);
    if (!isPlain(astTok) || a.enabled !== true) {
      missing.push(`layout.avoid_scene_text (objeto { enabled: true, margin_pct?: 0..20, blur_pct?: 0..3 }; llegó ${JSON.stringify(astTok)})`);
    } else if (!Number.isFinite(marginPct) || marginPct < 0 || marginPct > 20) {
      missing.push(`layout.avoid_scene_text.margin_pct=${a.margin_pct} (0 ≤ x ≤ 20)`);
    } else if (blurPct !== null && !(Number.isFinite(blurPct) && blurPct > 0 && blurPct <= 3)) {
      missing.push(`layout.avoid_scene_text.blur_pct=${a.blur_pct} (0 < x ≤ 3, % del ancho)`);
    } else if (!avoidFaces) {
      missing.push('layout.avoid_scene_text pide layout.avoid_faces encendido: comparte su detección y sus anclas');
    } else {
      avoidSceneText = { marginPct, blurPct };
    }
  }
  // 1.11.0 — el texto tampoco tapa un producto de la escena. Va con `avoid_faces`: la MISMA llamada de detección pide
  // los productos, y cuentan como una cara (deciden el ancla y el tamaño). Ausente o apagado ⇒ no existe.
  let avoidProducts: { marginPct: number } | null = null;
  const apTok = layoutTok.avoid_products as unknown;
  if (apTok != null && !(isPlain(apTok) && (apTok as Record<string, unknown>).enabled === false)) {
    const a = apTok as Record<string, unknown>;
    const marginPct = Number(a.margin_pct ?? 1);
    if (!isPlain(apTok) || a.enabled !== true) {
      missing.push(`layout.avoid_products (objeto { enabled: true, margin_pct?: 0..20 }; llegó ${JSON.stringify(apTok)})`);
    } else if (!Number.isFinite(marginPct) || marginPct < 0 || marginPct > 20) {
      missing.push(`layout.avoid_products.margin_pct=${a.margin_pct} (0 ≤ x ≤ 20)`);
    } else if (!avoidFaces) {
      missing.push('layout.avoid_products pide layout.avoid_faces encendido: comparte su detección y sus anclas');
    } else {
      avoidProducts = { marginPct };
    }
  }
  // 1.13.0 — el texto tampoco tapa el CUERPO de una persona. Va con `avoid_faces`: la MISMA llamada de detección pide la
  // figura humana completa, y cuenta como una cara. Ausente o apagado ⇒ no existe y la elección es la de 1.12.0.
  let avoidPeople: OverlayAvoidPeople | null = null;
  const aplTok = layoutTok.avoid_people as unknown;
  if (aplTok != null && !(isPlain(aplTok) && (aplTok as Record<string, unknown>).enabled === false)) {
    const r = parseAvoidPeople(aplTok, 'layout.avoid_people', true);
    missing.push(...r.missing);
    if (!r.missing.length && r.value) {
      let band: OverlayAvoidPeople['band'] = null;
      if (r.value.fallback === 'band') {
        const b = (aplTok as Record<string, any>).band;
        const colorTok = isPlain(b) ? String(b.color ?? '') : '';
        const alpha = Number(isPlain(b) ? b.alpha : NaN);
        const padPct = Number(isPlain(b) && b.pad_pct != null ? b.pad_pct : 2);
        const pal = HEX_COLOR.test(colorTok) ? { hex: colorTok } : palBy.get(colorTok);
        if (!pal) missing.push(`layout.avoid_people.band.color='${colorTok || '∅'}' (un rol de brand_palette o un hex #RRGGBB; obligatorio con fallback 'band')`);
        if (!(Number.isFinite(alpha) && alpha > 0 && alpha <= 1)) missing.push(`layout.avoid_people.band.alpha (0 < x ≤ 1; obligatoria con fallback 'band'; llegó ${JSON.stringify(b)})`);
        if (!(Number.isFinite(padPct) && padPct >= 0 && padPct <= 10)) missing.push(`layout.avoid_people.band.pad_pct=${JSON.stringify(b?.pad_pct)} (0 ≤ x ≤ 10, % del lado corto)`);
        if (pal && Number.isFinite(alpha) && alpha > 0 && alpha <= 1 && Number.isFinite(padPct) && padPct >= 0 && padPct <= 10) {
          band = { color: hexToRgba(String(pal.hex), alpha), padPct };
        }
      }
      if (!avoidFaces) missing.push('layout.avoid_people pide layout.avoid_faces encendido: comparte su detección y sus anclas');
      else avoidPeople = { marginPct: r.value.marginPct, minWidthPct: r.value.minWidthPct, band };
    }
  }
  // 1.6.3 — el énfasis se lee: umbral y colores alternativos, por rol de la marca.
  let emphasisContrast: { minContrast: number; fallbacks: Array<{ role: string; hex: string }>; minContrastVsText?: number } | null = null;
  if (layoutTok.emphasis_contrast != null) {
    const ec = layoutTok.emphasis_contrast as Record<string, unknown>;
    const min = Number(isPlain(ec) ? ec.min_contrast : NaN);
    const roles = isPlain(ec) && Array.isArray(ec.fallbacks) ? (ec.fallbacks as unknown[]).map(String) : null;
    if (!isPlain(ec) || !(Number.isFinite(min) && min >= 1 && min <= 21) || !roles || !roles.length) {
      missing.push(`layout.emphasis_contrast (objeto { min_contrast: 1..21, fallbacks: [roles de brand_palette] }; llegó ${JSON.stringify(layoutTok.emphasis_contrast)})`);
    } else {
      const fb: Array<{ role: string; hex: string }> = [];
      for (const r of roles) {
        const pal = palBy.get(r);
        if (!pal) missing.push(`brand_palette.role='${r}' (pedido por layout.emphasis_contrast.fallbacks)`);
        else fb.push({ role: r, hex: String(pal.hex) });
      }
      // 1.6.4 — `min_contrast_vs_text`: la alternativa también tiene que separarse del resto del titular.
      const vsText = isPlain(ec) && ec.min_contrast_vs_text != null ? Number(ec.min_contrast_vs_text) : null;
      if (vsText != null && !(Number.isFinite(vsText) && vsText >= 1 && vsText <= 21)) {
        missing.push(`layout.emphasis_contrast.min_contrast_vs_text (número 1..21; llegó ${JSON.stringify(ec.min_contrast_vs_text)})`);
      }
      if (fb.length === roles.length) emphasisContrast = { minContrast: min, fallbacks: fb, ...(vsText != null ? { minContrastVsText: vsText } : {}) };
    }
  }

  if (missing.length) {
    throw new CompositorError(
      'COMPOSITOR_TOKENS_INCOMPLETE',
      `faltan datos de marca para componer: ${missing.join(' · ')}. ` +
      'El motor no tiene fuentes ni colores propios con los que rellenar (BRIEF 7, regla b).',
    );
  }

  return {
    layout: {
      anchor,
      marginPct: Number(layoutTok.margin_pct),
      maxWidthPct: Number(layoutTok.max_width_pct),
      gapPct: Number(layoutTok.gap_pct ?? 2),
      align: (layoutTok.align ? String(layoutTok.align) : ANCHORS[anchor].align) as 'left' | 'center' | 'right',
      ...(maxTextAreaPct != null ? { maxTextAreaPct } : {}),
      ...(safeZonePct ? { safeZonePct } : {}),
      ...(avoidFaces ? { avoidFaces } : {}),
      ...(avoidSceneText ? { avoidSceneText } : {}),
      ...(avoidProducts ? { avoidProducts } : {}),
      ...(avoidPeople ? { avoidPeople } : {}),
      ...(emphasisContrast ? { emphasisContrast } : {}),
    },
    ...(textEffect ? { textEffect } : {}),
    ...(textEffectDeclared ? { textEffectDeclared } : {}),
    slots,
    scrim,
    rule,
    identity,
    markers,
  };
}

// ── CAPA DE PRODUCTO (2026-09-27) ──────────────────────────────────────────────────────────────
// El PNG REAL del producto, pegado por código sobre la escena limpia: el generador no lo redibuja,
// igual que no redibuja el titular. Misma disciplina que el resto del bloque: la POSICIÓN y el TAMAÑO
// son dato de la marca (`tokens.product`); el motor sólo sabe de anclas y porcentajes.
//
//   tokens.product = { mode: 'composite', anchor, height_pct, margin_pct, max_items?, overlap_pct? }
//   (sin `mode: 'composite'` el producto NO se pega: lo pinta el generador — opción (c), 2026-09-27)
//
// · Ausente ⇒ la marca no compone producto: se omite con marcador, la escena sale como antes.
// · Declarada a medias ⇒ falla nombrando, como la tipografía.
// · Misma ancla que el titular ⇒ falla: dos capas en la misma esquina se tapan, y esa colisión no se
//   resuelve "aproximadamente".
// Un kit llega como VARIOS productos (sus componentes): se dibujan en fila, solapados `overlap_pct`
// sobre su propio ancho, hasta `max_items`.
export interface ProductImageIn { src: string; width: number; height: number; name?: string | null }

export function resolveProductLayer(args: {
  tokens: Record<string, any>; textAnchor: string | null; count: number;
}): { layer: null | { anchor: string; heightPct: number; marginPct: number; maxItems: number; overlapPct: number }; markers: string[] } {
  const markers: string[] = [];
  if (!args.count) return { layer: null, markers };
  const tok = (args.tokens ?? {}).product as Record<string, any> | undefined;
  if (!tok || Object.keys(tok).length === 0) {
    markers.push('PRODUCT_LAYER_NOT_DECLARED: llegaron productos pero la marca no declara tokens.product; se compone sin producto');
    return { layer: null, markers };
  }
  // Opción (c) (Sam, 2026-09-27): por defecto el producto lo PINTA el generador en la escena, a su
  // tamaño real. El compositor sólo lo pega si la marca lo pide explícitamente con `mode: 'composite'`.
  if (tok.mode !== 'composite') {
    markers.push(`PRODUCT_IN_SCENE: la marca declara product.mode='${tok.mode ?? '∅'}' — el producto va pintado en la escena, no se pega`);
    return { layer: null, markers };
  }
  const missing: string[] = [];
  const anchor = String(tok.anchor ?? '');
  if (!ANCHORS[anchor]) missing.push(`product.anchor='${anchor || '∅'}' (válidos: ${Object.keys(ANCHORS).join(', ')})`);
  else if (args.textAnchor && anchor === args.textAnchor) missing.push(`product.anchor='${anchor}' coincide con layout.anchor del titular: las dos capas se taparían`);
  const heightPct = Number(tok.height_pct);
  if (!Number.isFinite(heightPct) || heightPct <= 0 || heightPct > 100) missing.push('product.height_pct');
  const marginPct = Number(tok.margin_pct);
  if (!Number.isFinite(marginPct) || marginPct < 0) missing.push('product.margin_pct');
  if (missing.length) {
    throw new CompositorError('COMPOSITOR_TOKENS_INCOMPLETE',
      `faltan datos de marca para la capa de producto: ${missing.join(' · ')}.`);
  }
  const maxItems = Math.max(1, Math.floor(Number(tok.max_items ?? 1)));
  const overlapPct = Math.min(90, Math.max(0, Number(tok.overlap_pct ?? 0)));
  if (args.count > maxItems) markers.push(`PRODUCT_LAYER_TRIMMED: llegaron ${args.count} productos y la marca compone hasta ${maxItems}; se dibujan los primeros`);
  return { layer: { anchor, heightPct, marginPct, maxItems, overlapPct }, markers };
}

/**
 * La escena que come satori: un árbol JSON plano (`{type, props}`), sin JSX y sin dependencias.
 * Función PURA de (estilo, dimensiones, fondo) — misma entrada ⇒ mismo árbol, clave por clave.
 *
 * Las medidas: los tamaños de fuente y los márgenes se derivan del ANCHO (el ojo lee líneas, y el
 * ancho es lo que fija cuántos caracteres entran por línea); la cobertura del velo, del ALTO. Un
 * mismo token rinde igual en 1:1 que en 9:16 sin una tabla por formato.
 */
/**
 * 1.5.0 — la caja donde vive el bloque de texto del overlay: los cuatro rellenos y el ancho máximo. PURO.
 * Sin zona segura es la de siempre (margen uniforme y `max_width_pct`); con ella, cada borde toma el mayor
 * entre el margen y el % que la interfaz de la plataforma tapa, y el ancho no pasa del hueco que queda.
 */
export function overlayTextBox(style: ReturnType<typeof resolveOverlayStyle>, width: number, height: number): {
  safe: boolean; top: number; right: number; bottom: number; left: number; maxWidth: number;
} {
  const px = (pct: number, base: number) => Math.round((pct / 100) * base * 100) / 100;
  const m = px(style.layout.marginPct, width);
  const mw = px(style.layout.maxWidthPct, width);
  const z = style.layout.safeZonePct;
  if (!z) return { safe: false, top: m, right: m, bottom: m, left: m, maxWidth: mw };
  const top = Math.max(m, px(z.top, height));
  const bottom = Math.max(m, px(z.bottom, height));
  const left = Math.max(m, px(z.left, width));
  const right = Math.max(m, px(z.right, width));
  return { safe: true, top, right, bottom, left, maxWidth: Math.min(mw, Math.round((width - left - right) * 100) / 100) };
}

// Ancho medio de glifo (en em) cuando no hay métricas de la fuente: la medición queda ESTIMADA y se dice.
const AREA_FALLBACK_EM = 0.6;

type OverlayFontLike = { family: string; weight: number; italic: boolean; transform: string; letterSpacingEm: number };
/** El ancho (px) de un texto en una fuente del overlay, a un tamaño, con su tracking y su transformación. Sin métricas
 *  de esa fuente, el ancho medio genérico, y la familia se anota en `estimated`. PURO (salvo `estimated`, que es suyo). */
export function overlayWidthFn(metrics: Record<string, FontAdvance | null | undefined> | null | undefined, estimated: string[]) {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return (f: OverlayFontLike, size: number) => {
    const m = metrics?.[fitFontKey(f)] ?? null;
    if (!m && !estimated.includes(f.family)) estimated.push(f.family);
    const ls = r2(f.letterSpacingEm * size);
    return (s: string) => {
      const str = f.transform === 'uppercase' ? s.toUpperCase() : f.transform === 'lowercase' ? s.toLowerCase() : s;
      let w = 0;
      for (const ch of str) {
        const cp = ch.codePointAt(0)!;
        const em = m ? (m.advances.get(cp) ?? (cp === 0xa0 ? m.advances.get(0x20) : undefined) ?? m.avgEm) : AREA_FALLBACK_EM;
        w += em * size + ls;
      }
      return w;
    };
  };
}

/** 1.13.0 — los átomos (palabras) de una ranura del overlay por tramo de línea impuesto, con su ancho (px) medido como
 *  `measureOverlayText`. Un tramo sin cortes impuestos es la ranura entera. PURO. */
export function overlaySlotAtoms(
  s: NonNullable<ReturnType<typeof resolveOverlayStyle>['slots']['headline']>, width: number,
  metrics: Record<string, FontAdvance | null | undefined> | null | undefined, estimated: string[],
): Array<{ range: [number, number]; atoms: Array<{ a: number; b: number; w: number; keyword: boolean }> }> {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const wf = overlayWidthFn(metrics, estimated);
  const size = r2((s.sizePct / 100) * width);
  const base = wf(s, size);
  const em = s.parts && s.emphasis ? s.emphasis : null;
  const emw = em ? wf(em, r2(size * em.sizeScale)) : base;
  const allParts = s.parts && em ? s.parts : [{ text: s.text, keyword: false }];
  const ranges: Array<[number, number]> = s.lines ? s.lines : [[0, s.text.length]];
  return ranges.map(([a, b]) => {
    const atoms = headlineAtoms(partsInRange(allParts, a, b));
    const words = [...s.text.slice(a, b).matchAll(/\S+/g)];
    return { range: [a, b] as [number, number], atoms: atoms.map((atom, k) => ({
      a: a + (words[k]?.index ?? 0), b: a + (words[k]?.index ?? 0) + (words[k]?.[0].length ?? 0),
      w: atom.reduce((acc, p) => acc + (p.keyword && em ? emw(p.text) : base(p.text)), 0),
      keyword: atom.some((p) => p.keyword),
    })) };
  });
}

/** 1.13.0 — ¿alguna palabra del overlay es más ancha que su caja? Se partiría o se saldría del bloque. PURO. */
export function overlayWordOverflow(style: ReturnType<typeof resolveOverlayStyle>, width: number, height: number,
  metrics: Record<string, FontAdvance | null | undefined> | null | undefined,
): boolean {
  const maxW = overlayTextBox(style, width, height).maxWidth;
  for (const slot of SLOTS) {
    const s = style.slots[slot];
    if (!s) continue;
    for (const g of overlaySlotAtoms(s, width, metrics, [])) if (g.atoms.some((x) => x.w > maxW + 0.5)) return true;
  }
  return false;
}

// ── 1.13.0 · NINGUNA PALABRA SOLA EN SU LÍNEA ──────────────────────────────────────────────────────────────────
// EL CASO (2026-10-22, d9e97f57): «She told it the plan. It told her she was right.», con «she was right» resaltado. La
// regla de 1.7.0 abre línea en el énfasis; el tramo anterior no cabe en una y satori lo envuelve palabra a palabra:
// «…It told» / «her» / «she was right.». La palabra sola queda colgada justo antes del énfasis.
// EJE (código, regla tipográfica de viuda/huérfana): el corte voraz de cada tramo de línea —el mismo de satori y de
// `measureOverlayText`— no deja UNA palabra en la última línea del tramo cuando lo que sigue empieza un énfasis, ni en la
// última línea del bloque. Si la línea anterior tiene `ORPHAN_MIN_PREV_WORDS` palabras o más y la pareja cabe, su
// última palabra baja a acompañarla. Cambia el corte, nunca el tamaño, la caja ni el número de líneas. Cero marcas, cero
// idiomas: las palabras son lo que separa el espacio.
export const ORPHAN_MIN_PREV_WORDS = 3;

/** El corte voraz de una fila de átomos de anchos dados (px) en `maxW`: índices por línea. El mismo criterio que
 *  `measureOverlayText` (un átomo que no cabe abre línea, salvo que la línea esté vacía). PURO. */
export function greedyAtomLines(widths: number[], maxW: number): number[][] {
  const lines: number[][] = [];
  let cur = 0;
  for (let k = 0; k < widths.length; k++) {
    if (lines.length && cur > 0 && cur + widths[k] > maxW + 0.01) { lines.push([k]); cur = widths[k]; }
    else { if (!lines.length) lines.push([]); lines[lines.length - 1].push(k); cur += widths[k]; }
  }
  return lines;
}

/** El corte voraz SIN palabra sola al final: con `protect`, si la última línea tiene una palabra y la anterior
 *  `ORPHAN_MIN_PREV_WORDS` o más, la última de la anterior baja, siempre que la pareja quepa con 1 px de holgura. PURO. */
export function orphanFreeLines(widths: number[], maxW: number, protect: boolean): { lines: number[][]; moved: number | null } {
  const lines = greedyAtomLines(widths, maxW);
  if (!protect || lines.length < 2) return { lines, moved: null };
  const last = lines[lines.length - 1];
  const prev = lines[lines.length - 2];
  if (last.length !== 1 || prev.length < ORPHAN_MIN_PREV_WORDS) return { lines, moved: null };
  const k = prev[prev.length - 1];
  if (widths[k] + widths[last[0]] > maxW - 1) return { lines, moved: null };
  return { lines: [...lines.slice(0, -2), prev.slice(0, -1), [k, ...last]], moved: k };
}

/** 1.13.0 — cuántos tramos de línea del overlay terminan, aun con la regla de la palabra sola aplicada, en una línea de
 *  UNA palabra que no se pudo acompañar (la anterior tiene menos de `ORPHAN_MIN_PREV_WORDS`, o la pareja no cabe). Sin
 *  métricas de la fuente cuenta 0: no se sabe. PURO. */
export function overlayLoneWords(style: ReturnType<typeof resolveOverlayStyle>, width: number, height: number,
  metrics: Record<string, FontAdvance | null | undefined> | null | undefined,
): number {
  const maxW = overlayTextBox(style, width, height).maxWidth;
  let n = 0;
  for (const slot of SLOTS) {
    const s = style.slots[slot];
    if (!s) continue;
    const estimated: string[] = [];
    const groups = overlaySlotAtoms(s, width, metrics, estimated);
    if (estimated.length) continue;
    groups.forEach((g, i) => {
      const next = groups[i + 1];
      const protect = !next || !!next.atoms[0]?.keyword;
      const r = orphanFreeLines(g.atoms.map((x) => x.w), maxW, protect);
      if (protect && r.lines.length >= 2 && r.lines[r.lines.length - 1].length === 1) n++;
    });
  }
  return n;
}

/**
 * 1.13.0 — aplica la regla de la palabra sola al overlay ya decidido (tamaño, ancla y ancho finales). PURO. Para cada
 * ranura y cada tramo de línea: si su corte voraz deja una palabra sola en la última línea y lo que sigue empieza un
 * énfasis o es el fin de la ranura, impone los cortes de ese tramo (`lines`), con una palabra bajada. Sin palabra sola, o
 * sin métricas de la fuente (el corte no se puede medir), devuelve EL MISMO estilo.
 */
export function avoidOrphanLines(style: ReturnType<typeof resolveOverlayStyle>, width: number, height: number,
  metrics: Record<string, FontAdvance | null | undefined> | null | undefined,
): { style: ReturnType<typeof resolveOverlayStyle>; report: Array<{ slot: string; word: string; moved: string }> } {
  const maxW = overlayTextBox(style, width, height).maxWidth;
  const report: Array<{ slot: string; word: string; moved: string }> = [];
  let slots = style.slots;
  for (const slot of SLOTS) {
    const s = style.slots[slot];
    if (!s) continue;
    const estimated: string[] = [];
    const groups = overlaySlotAtoms(s, width, metrics, estimated);
    if (estimated.length) continue;
    let changed = false;
    const ranges: Array<[number, number]> = [];
    groups.forEach((g, i) => {
      const next = groups[i + 1];
      const protect = !next || !!next.atoms[0]?.keyword;
      const r = orphanFreeLines(g.atoms.map((x) => x.w), maxW, protect);
      if (r.moved == null) { ranges.push(g.range); return; }
      changed = true;
      for (const ln of r.lines) ranges.push([g.atoms[ln[0]].a, g.atoms[ln[ln.length - 1]].b]);
      const lastLine = r.lines[r.lines.length - 1];
      const lone = g.atoms[lastLine[lastLine.length - 1]];
      const mv = g.atoms[r.moved];
      report.push({ slot, word: s.text.slice(lone.a, lone.b), moved: s.text.slice(mv.a, mv.b) });
    });
    if (changed) slots = { ...slots, [slot]: { ...s, lines: ranges } };
  }
  if (!report.length) return { style, report };
  const label: Record<string, string> = { headline: 'titular', subheadline: 'bajada' };
  return { style: { ...style, slots, markers: [...style.markers,
    ...report.map((x) => `OVERLAY_ORPHAN_AVOIDED: «${x.word}» no queda sola en su línea (${label[x.slot] ?? x.slot}); baja «${x.moved}» a acompañarla`)] }, report };
}

/**
 * 1.5.0 — el tamaño del bloque de texto del overlay (titular, filete y bajada), con las MISMAS medidas que
 * `buildOverlayScene`: tamaños en % del ancho, corte de línea voraz por palabras dentro de la caja, cada
 * tramo con énfasis medido con su fuente y su tamaño, y cada línea tan alta como su letra más grande. PURO.
 * Mide la caja de LÍNEAS (con su interlineado), que es un poco mayor que la de los glifos: el límite queda
 * del lado seguro.
 */
export function measureOverlayText(style: ReturnType<typeof resolveOverlayStyle>, width: number, height: number,
  metrics: Record<string, FontAdvance | null | undefined> | null | undefined,
): { width: number; height: number; areaPct: number; estimated: string[] } {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const box = overlayTextBox(style, width, height);
  const estimated: string[] = [];
  const widthFn = overlayWidthFn(metrics, estimated);
  let maxLine = 0;
  let total = 0;
  const slotBlock = (s: NonNullable<ReturnType<typeof resolveOverlayStyle>['slots']['headline']>) => {
    const size = r2((s.sizePct / 100) * width);
    const base = widthFn(s, size);
    const em = s.parts && s.emphasis ? s.emphasis : null;
    const esize = em ? r2(size * em.sizeScale) : size;
    const emw = em ? widthFn(em, esize) : base;
    const allParts = s.parts && em ? s.parts : [{ text: s.text, keyword: false }];
    // 1.7.0 — con cortes impuestos, cada línea empieza fila: se mide línea por línea.
    const groups = s.lines ? s.lines.map(([a, b]) => headlineAtoms(partsInRange(allParts, a, b))) : [headlineAtoms(allParts)];
    let h = 0;
    for (const atoms of groups) {
      let cur = 0, lineMax = 0;
      for (const atom of atoms) {
        const aw = atom.reduce((acc, p) => acc + (p.keyword && em ? emw(p.text) : base(p.text)), 0);
        const ah = Math.max(...atom.map((p) => (p.keyword && em ? esize : size)));
        if (cur > 0 && cur + aw > box.maxWidth + 0.01) { h += lineMax; maxLine = Math.max(maxLine, cur); cur = aw; lineMax = ah; }
        else { cur += aw; lineMax = Math.max(lineMax, ah); }
      }
      maxLine = Math.max(maxLine, Math.min(cur, box.maxWidth));
      h += lineMax;
    }
    return h * s.lineHeight;
  };
  const hl = style.slots.headline;
  if (hl) total += slotBlock(hl);
  if (style.rule && hl) {
    total += r2((style.rule.gapPct / 100) * width) + style.rule.thicknessPx;
    maxLine = Math.max(maxLine, r2((style.rule.widthPct / 100) * width));
  }
  if (style.slots.subheadline) total += r2((style.layout.gapPct / 100) * width) + slotBlock(style.slots.subheadline);
  const w = Math.min(maxLine, box.maxWidth);
  return { width: r2(w), height: r2(total), areaPct: Math.round((10000 * w * total) / (width * height)) / 100, estimated };
}

/**
 * 1.5.0 — el límite de área de la plataforma (`layout.max_text_area_pct`). PURO y determinista. Si el
 * bloque cabe —o la marca no declara límite— devuelve EL MISMO estilo: la escena sale idéntica. Si no
 * cabe, baja por los escalones del titular, luego por los de la bajada, luego quita la bajada; si aun así
 * excede, compone al mínimo y lo marca. El texto nunca se recorta ni se reescribe.
 */
export function fitOverlayTextArea(args: {
  style: ReturnType<typeof resolveOverlayStyle>; width: number; height: number;
  metrics?: Record<string, FontAdvance | null | undefined> | null;
}): { style: ReturnType<typeof resolveOverlayStyle>; report: null | { limit_pct: number; area_pct_before: number; area_pct: number; adjusted: boolean; dropped_subheadline: boolean; exceeded: boolean; estimated_fonts: string[] } } {
  const base = args.style;
  const limit = base.layout.maxTextAreaPct;
  if (limit == null || !base.slots.headline) return { style: base, report: null };
  const first = measureOverlayText(base, args.width, args.height, args.metrics);
  const est = first.estimated.length
    ? [`OVERLAY_TEXT_AREA_ESTIMATED: sin métricas de ${first.estimated.join(', ')}; el área se estimó con un ancho medio genérico`] : [];
  if (first.areaPct <= limit) {
    return { style: est.length ? { ...base, markers: [...base.markers, ...est] } : base,
      report: { limit_pct: limit, area_pct_before: first.areaPct, area_pct: first.areaPct, adjusted: false, dropped_subheadline: false, exceeded: false, estimated_fonts: first.estimated } };
  }
  type St = { h: number; s: number | null; drop: boolean };
  const hl = base.slots.headline;
  const sub = base.slots.subheadline;
  const ladder: St[] = [];
  let st: St = { h: hl.sizePct, s: sub ? sub.sizePct : null, drop: false };
  for (const h of hl.fitSmaller ?? []) ladder.push(st = { ...st, h });
  if (sub) for (const x of sub.fitSmaller ?? []) ladder.push(st = { ...st, s: x });
  if (sub) ladder.push(st = { ...st, drop: true });
  const apply = (x: St): ReturnType<typeof resolveOverlayStyle> => ({
    ...base,
    slots: {
      headline: { ...hl, sizePct: x.h },
      subheadline: !sub || x.drop ? null : { ...sub, sizePct: x.s ?? sub.sizePct },
    },
  });
  let chosen: St | null = null;
  let out = base;
  let m = first;
  for (const x of ladder) {
    out = apply(x);
    m = measureOverlayText(out, args.width, args.height, args.metrics);
    if (m.areaPct <= limit) { chosen = x; break; }
  }
  const final = chosen ?? ladder[ladder.length - 1] ?? { h: hl.sizePct, s: sub ? sub.sizePct : null, drop: false };
  if (!chosen) { out = apply(final); m = measureOverlayText(out, args.width, args.height, args.metrics); }
  const markers = [...base.markers, ...est];
  const what: string[] = [];
  if (final.h !== hl.sizePct) what.push(`titular ${hl.sizePct}→${final.h} %`);
  if (sub && final.s != null && final.s !== sub.sizePct && !final.drop) what.push(`bajada ${sub.sizePct}→${final.s} %`);
  if (final.drop) what.push('sin bajada');
  if (what.length) markers.push(`OVERLAY_TEXT_AREA_REDUCED: el texto ocupaba ${first.areaPct} % de la imagen (límite ${limit} %); ${what.join(' · ')} → ${m.areaPct} %`);
  if (!chosen) markers.push(`OVERLAY_TEXT_AREA_EXCEEDED: ni al tamaño mínimo cabe en ${limit} % (queda en ${m.areaPct} %); se compone igual, el texto no se recorta`);
  return { style: { ...out, markers },
    report: { limit_pct: limit, area_pct_before: first.areaPct, area_pct: m.areaPct, adjusted: true, dropped_subheadline: !!(sub && final.drop), exceeded: !chosen, estimated_fonts: first.estimated } };
}

/**
 * 1.4.0 — los átomos del titular con énfasis, como nodos de satori. PURO. Un átomo es una palabra
 * (con su espacio duro al final, ver `headlineAtoms`); cada tramo enfatizado lleva su familia, peso,
 * estilo, tamaño (escala del titular), tracking, transformación y color. Los demás heredan del padre.
 */
function emphasisAtomsNode(
  parts: Array<{ text: string; keyword: boolean; flip?: boolean }>,
  base: { sizePct: number },
  em: (EmphasisType & { color: string }) | null | undefined,
  width: number,
  // 1.6.0 — la sombra del overlay viaja también a los tramos con énfasis (sin depender de la herencia).
  textShadow?: string,
  // 1.9.0 — con tramos de sombra al revés, cada tramo lleva la suya explícita (la ranura no la hereda).
  shadowOf?: (p: { flip?: boolean }) => string | undefined,
): Array<Record<string, any>> {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const size = em ? r2((base.sizePct * em.sizeScale / 100) * width) : 0;
  const emStyle = em ? {
    fontFamily: em.family, fontWeight: em.weight, fontStyle: em.italic ? 'italic' : 'normal',
    fontSize: size, letterSpacing: r2(em.letterSpacingEm * size), textTransform: em.transform, color: em.color,
    ...(textShadow && !shadowOf ? { textShadow } : {}),
  } : {};
  const styleOf = (p: { keyword: boolean; flip?: boolean }) => {
    const st = p.keyword && em ? emStyle : {};
    if (!shadowOf) return st;
    const sh = shadowOf(p);
    return sh ? { ...st, textShadow: sh } : st;
  };
  return headlineAtoms(parts).map((atom) => ({
    type: 'div',
    props: {
      style: { display: 'flex', flexDirection: 'row', alignItems: 'baseline' },
      children: atom.map((p) => ({ type: 'span', props: { style: styleOf(p), children: p.text } })),
    },
  }));
}

/** 1.9.0 — la sombra de cada tramo cuando hay tramos al revés: el resto lleva la base; los marcados, lo contrario. PURA. */
export function shadowForSpan(flip: boolean | undefined, baseShadow: string | undefined, declaredShadow: string): string | undefined {
  if (!flip) return baseShadow;
  return baseShadow ? undefined : declaredShadow;
}

/**
 * 1.7.0 — el titular con cortes impuestos, como filas de satori. PURO. Cada línea es una fila que se envuelve
 * sola si no cabe; con énfasis, la fila lleva los átomos de 1.4.0 de ESA línea.
 */
function headlineRowsNode(
  s: { text: string; lines?: Array<[number, number]>; parts?: Array<{ text: string; keyword: boolean }> | null; emphasis?: any; sizePct: number },
  width: number, textShadow: string | undefined, align: string,
  // 1.9.0 — tramos de sombra al revés: el titular entero va por átomos, cada uno con su sombra.
  flip?: { parts: Array<{ text: string; keyword: boolean; flip?: boolean }>; shadowOf: (p: { flip?: boolean }) => string | undefined },
): Array<Record<string, any>> {
  const justify = align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start';
  return (s.lines ?? []).map(([a, b]) => ({
    type: 'div',
    props: {
      style: { display: 'flex', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: justify },
      children: flip
        ? emphasisAtomsNode(partsInRange(flip.parts, a, b), s, s.emphasis, width, textShadow, flip.shadowOf)
        : s.parts && s.emphasis
        ? emphasisAtomsNode(partsInRange(s.parts, a, b), s, s.emphasis, width, textShadow)
        : s.text.slice(a, b),
    },
  }));
}

export function buildOverlayScene(args: {
  style: ReturnType<typeof resolveOverlayStyle>;
  width: number; height: number; backgroundSrc: string;
  products?: ProductImageIn[];
  productLayer?: ReturnType<typeof resolveProductLayer>['layer'];
}): Record<string, any> {
  const { style, width, height, backgroundSrc } = args;
  const px = (pct: number, base: number) => Math.round((pct / 100) * base * 100) / 100;
  const a = ANCHORS[style.layout.anchor];
  const children: Array<Record<string, any>> = [];

  children.push({
    type: 'img',
    props: {
      src: backgroundSrc, width, height,
      style: { position: 'absolute', top: 0, left: 0, width, height, objectFit: 'cover' },
    },
  });

  if (style.scrim) {
    const cover = px(style.scrim.coveragePct, height);
    const from = hexToRgba(style.scrim.color, style.scrim.opacity);
    const to = hexToRgba(style.scrim.color, 0);
    const grad = style.scrim.mode === 'solid'
      ? { backgroundColor: from }
      : { backgroundImage: `linear-gradient(${style.scrim.mode === 'gradient_top' ? '180deg' : '0deg'}, ${from} 0%, ${to} 100%)` };
    children.push({
      type: 'div',
      props: {
        style: {
          position: 'absolute', left: 0, width,
          height: cover,
          ...(style.scrim.mode === 'gradient_top' ? { top: 0 } : { bottom: 0 }),
          ...grad,
        },
      },
    });
  }

  // BRIEF 8 · D — la franja de identidad, ENCIMA del velo (que si no se la comería) y debajo del
  // texto. D.1 — el grosor se calcula sobre el LADO CORTO, no sobre el ancho: con el ancho, un 1,8%
  // rinde 18px en un 1:1 de 1024 y 18px en un 9:16 de 1024×1792 pero 34px en un 16:9 de 1920×1080 —
  // la misma marca se vería tres grosores distintos según el formato. Con el lado corto, el sello se
  // lee IGUAL en 1:1, 4:5, 9:16 y 16:9. Y el borde elegido es constante entre formatos: la franja no
  // se reposiciona ni se deforma porque cambie el aspecto.
  if (style.identity) {
    const shortSide = Math.min(width, height);
    const thickness = Math.max(1, Math.round(px(style.identity.widthPct, shortSide)));
    const vertical = style.identity.mode === 'edge_left' || style.identity.mode === 'edge_right';
    children.push({
      type: 'div',
      props: {
        style: {
          position: 'absolute',
          backgroundColor: style.identity.color,
          // A sangre completa del borde elegido: 100% del lado que recorre. Nunca dos bordes a la
          // vez — eso sería un marco, que es exactamente lo que la regla dura prohíbe.
          ...(vertical
            ? { top: 0, height, width: thickness, ...(style.identity.mode === 'edge_left' ? { left: 0 } : { right: 0 }) }
            : { left: 0, width, height: thickness, bottom: 0 }),
        },
      },
    });
  }

  // CAPA DE PRODUCTO — encima del velo y del sello, debajo del texto. El alto sale del ALTO de la
  // escena (un frasco se mide de pie); el ancho, del aspecto REAL del PNG: nunca se deforma.
  const pl = args.productLayer ?? null;
  const prods = (args.products ?? []).slice(0, pl?.maxItems ?? 0);
  if (pl && prods.length) {
    const pa = ANCHORS[pl.anchor];
    const h = px(pl.heightPct, height);
    children.push({
      type: 'div',
      props: {
        style: {
          position: 'absolute', top: 0, left: 0, width, height,
          display: 'flex', flexDirection: 'row',
          justifyContent: pa.x, alignItems: pa.y,
          padding: px(pl.marginPct, width),
        },
        children: [{
          type: 'div',
          props: {
            style: { display: 'flex', flexDirection: 'row', alignItems: 'flex-end' },
            children: prods.map((p, k) => {
              const w = Math.round((h * p.width / p.height) * 100) / 100;
              return {
                type: 'img',
                props: {
                  src: p.src, width: w, height: h,
                  style: { width: w, height: h, ...(k > 0 ? { marginLeft: -Math.round((pl.overlapPct / 100) * w) } : {}) },
                },
              };
            }),
          },
        }],
      },
    });
  }

  // 1.13.0 — el último recurso 'band' de `avoid_people`: sólo bajo el texto, nunca la foto entera. Sin él, nada cambia.
  if (style.band) {
    const b = style.band;
    children.push({ type: 'div', props: { style: { position: 'absolute', left: b.x0, top: b.y0, width: Math.round((b.x1 - b.x0) * 100) / 100,
      height: Math.round((b.y1 - b.y0) * 100) / 100, backgroundColor: b.color } } });
  }
  const box = overlayTextBox(style, width, height);
  const textChildren: Array<Record<string, any>> = [];
  // 1.6.0 — sin token es undefined y ningún estilo cambia: la escena es la de 1.5.0, clave por clave.
  const shadow = style.textEffect ? overlayTextShadow(style.textEffect, width) : undefined;
  // 1.9.0 — tramos con la sombra al revés: sólo con sombra declarada (sin ella `applyTextShadowRequest` no los marca).
  const declaredShadow = style.textEffectDeclared ? overlayTextShadow(style.textEffectDeclared, width) : null;
  const flipOf = (s: NonNullable<ReturnType<typeof resolveOverlayStyle>['slots']['headline']>) =>
    s.shadowFlip?.length && declaredShadow
      ? { parts: withShadowFlip(s.text, s.parts, s.shadowFlip), shadowOf: (p: { flip?: boolean }) => shadowForSpan(p.flip, shadow, declaredShadow) }
      : undefined;
  const slotNode = (s: NonNullable<ReturnType<typeof resolveOverlayStyle>['slots']['headline']>, marginTop: number) => {
    const flip = flipOf(s);
    return {
    type: 'div',
    props: {
      style: {
        display: 'flex',
        marginTop,
        fontFamily: s.family,
        fontSize: px(s.sizePct, width),
        fontWeight: s.weight,
        fontStyle: s.italic ? 'italic' : 'normal',
        color: s.color,
        lineHeight: s.lineHeight,
        letterSpacing: px(s.letterSpacingEm * s.sizePct, width),
        textTransform: s.transform,
        textAlign: style.layout.align,
        ...(shadow && !flip ? { textShadow: shadow } : {}),
        // 1.4.0 — con tramos, la ranura es una fila que envuelve átomos (palabras que no se cortan),
        // alineados por la línea de base: un tramo más grande no descoloca a sus vecinos.
        // 1.7.0 — con cortes impuestos, la ranura es una COLUMNA de filas: una por línea.
        ...(s.lines ? {
          flexDirection: 'column',
          alignItems: style.layout.align === 'center' ? 'center' : style.layout.align === 'right' ? 'flex-end' : 'flex-start',
        } : (s.parts && s.emphasis) || flip ? {
          flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline',
          justifyContent: style.layout.align === 'center' ? 'center' : style.layout.align === 'right' ? 'flex-end' : 'flex-start',
        } : {}),
      },
      children: s.lines ? headlineRowsNode(s, width, shadow, style.layout.align, flip)
        : flip ? emphasisAtomsNode(flip.parts, s, s.emphasis, width, shadow, flip.shadowOf)
        : s.parts && s.emphasis ? emphasisAtomsNode(s.parts, s, s.emphasis, width, shadow) : s.text,
    },
  };
  };

  if (style.slots.headline) textChildren.push(slotNode(style.slots.headline, 0));
  // El filete acompaña al TITULAR: sin titular no hay nada que subrayar. (La franja de identidad es
  // otra cosa y sí se dibuja sola — una firma la marca, un filete separa texto.)
  if (style.rule && style.slots.headline) {
    textChildren.push({
      type: 'div',
      props: {
        style: {
          marginTop: px(style.rule.gapPct, width),
          width: px(style.rule.widthPct, width),
          height: style.rule.thicknessPx,
          backgroundColor: style.rule.color,
        },
      },
    });
  }
  if (style.slots.subheadline) {
    textChildren.push(slotNode(style.slots.subheadline, px(style.layout.gapPct, width)));
  }

  // Sin ninguna ranura de texto no se emite el contenedor: la escena queda SELLADA (franja) y sin
  // tipografía. Es el caso de una pieza cuyo título todavía no existe — se sella hoy y se recompone
  // con el titular cuando lo tenga, sin volver a generar la escena.
  if (textChildren.length === 0) {
    return { type: 'div', props: { style: { display: 'flex', position: 'relative', width, height }, children } };
  }

  children.push({
    type: 'div',
    props: {
      style: {
        position: 'absolute', top: 0, left: 0, width, height,
        display: 'flex', flexDirection: 'column',
        justifyContent: a.y, alignItems: a.x,
        // 1.5.0 — con zona segura, cada borde lleva el mayor entre el margen y lo que la interfaz tapa.
        ...(box.safe ? { paddingTop: box.top, paddingRight: box.right, paddingBottom: box.bottom, paddingLeft: box.left }
          : { padding: px(style.layout.marginPct, width) }),
      },
      children: [{
        type: 'div',
        props: {
          style: {
            display: 'flex', flexDirection: 'column',
            alignItems: a.x,
            maxWidth: box.maxWidth,
          },
          children: textChildren,
        },
      }],
    },
  });

  return { type: 'div', props: { style: { display: 'flex', position: 'relative', width, height }, children } };
}

/**
 * Dimensiones REALES del PNG/JPEG que devolvió el generador. No se asumen por el canal: el aspect
 * ratio pedido y el entregado no siempre coinciden, y componer sobre dimensiones supuestas descoloca
 * el texto. PNG: cabecera IHDR. JPEG: primer marcador SOFn.
 */
export function imageDimensions(bytes: Uint8Array): { width: number; height: number; mime: string } {
  const b = bytes;
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    const rd = (o: number) => (b[o] << 24 | b[o + 1] << 16 | b[o + 2] << 8 | b[o + 3]) >>> 0;
    return { width: rd(16), height: rd(20), mime: 'image/png' };
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let o = 2;
    while (o + 9 < b.length) {
      if (b[o] !== 0xff) { o++; continue; }
      const marker = b[o + 1];
      const len = (b[o + 2] << 8) | b[o + 3];
      // SOF0..SOF15 menos los marcadores que no son de trama (DHT 0xc4, JPG 0xc8, DAC 0xcc).
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: (b[o + 7] << 8) | b[o + 8], height: (b[o + 5] << 8) | b[o + 6], mime: 'image/jpeg' };
      }
      o += 2 + len;
    }
  }
  throw new CompositorError('COMPOSITOR_IMAGE_UNSUPPORTED', 'la imagen limpia no es PNG ni JPEG legible', 415);
}

/**
 * `@font-face` de una hoja de Google Fonts (`css_import` de `brand_typography`) → candidatos.
 * Pedida con un User-Agent viejo, la css2 devuelve TTF, que es lo que satori sabe leer (woff2 no).
 * Puro: recibe el CSS ya bajado.
 */
export function parseFontFaces(css: string): Array<{ family: string; weight: number; italic: boolean; url: string }> {
  const out: Array<{ family: string; weight: number; italic: boolean; url: string }> = [];
  for (const m of String(css ?? '').matchAll(/@font-face\s*\{([\s\S]*?)\}/g)) {
    const block = m[1];
    const family = (block.match(/font-family:\s*['"]?([^;'"]+)['"]?\s*;/) ?? [])[1] ?? '';
    const weight = Number((block.match(/font-weight:\s*([0-9]+)/) ?? [])[1] ?? 400);
    const italic = /font-style:\s*italic/.test(block);
    const url = (block.match(/url\(([^)]+)\)/) ?? [])[1] ?? '';
    if (url) out.push({ family: family.trim(), weight, italic, url: url.replace(/['"]/g, '').trim() });
  }
  return out;
}

/**
 * 1.3.1 — la fuente que recibe satori, SIN KERNING. Devuelve una COPIA con las tablas `kern` y `GPOS`
 * renombradas en el directorio de tablas (`kern`→`xern`, `GPOS`→`xPOS`), así el lector de fuentes de
 * satori no las encuentra; el resto de los bytes no se toca. Acepta sfnt (TrueType u OpenType/CFF)
 * y WOFF; cualquier otra cosa vuelve intacta con `neutralized: []`. Puro e idempotente.
 *
 * POR QUÉ, medido (satori 0.12.2, 2026-10-03): satori UBICA cada palabra sumando el avance de cada
 * grafema por separado —sin pares de kerning— y la DIBUJA con kerning. Toda palabra con pares
 * negativos queda más corta que su caja y el hueco sobrante aparece pegado a la palabra siguiente:
 * hasta +9,8 px después de una palabra de cinco letras con pares fuertes, en una familia condensada
 * en negrita a 90,7 px (un espacio de esa fuente mide 18,6 px). Pasa en cualquier texto y cualquier
 * marca, con mayúsculas o sin ellas, dentro o fuera de `headlineAtoms`; se nota más donde la familia
 * tiene pares fuertes y el cuerpo es grande. Sin kerning, la medida y el dibujo coinciden: el espacio
 * entre palabras vuelve a ser el de la fuente.
 * En el lector de satori `GPOS` sólo aporta kerning (no hay posicionamiento de marcas), así que
 * renombrarlo no mueve ningún acento: los TTF traen las letras acentuadas compuestas.
 */
export function neutralizeKerning(bytes: Uint8Array): { bytes: Uint8Array; neutralized: string[] } {
  const out = new Uint8Array(bytes);
  const neutralized: string[] = [];
  const u16 = (o: number) => (out[o] << 8) | out[o + 1];
  const tag = (o: number) => String.fromCharCode(out[o], out[o + 1], out[o + 2], out[o + 3]);
  if (out.length < 12) return { bytes: out, neutralized };
  const sig = tag(0);
  const sfnt = sig === '\u0000\u0001\u0000\u0000' || sig === 'OTTO' || sig === 'true';
  const woff = sig === 'wOFF';
  if (!sfnt && !woff) return { bytes: out, neutralized };
  const count = u16(woff ? 12 : 4);
  const dirAt = woff ? 44 : 12;
  const entry = woff ? 20 : 16;
  for (let k = 0; k < count; k++) {
    const o = dirAt + k * entry;
    if (o + 4 > out.length) break;
    const t = tag(o);
    if (t === 'kern' || t === 'GPOS') { out[o] = 0x78; neutralized.push(t); }   // 0x78 = 'x'
  }
  return { bytes: out, neutralized };
}

/** El @font-face más cercano al peso pedido, respetando la itálica. Determinista ante empates. */
export function pickFontFace(
  faces: Array<{ family: string; weight: number; italic: boolean; url: string }>,
  want: { weight: number; italic: boolean },
): { family: string; weight: number; italic: boolean; url: string } | null {
  const pool = faces.filter((f) => f.italic === want.italic);
  const use = pool.length ? pool : faces;
  if (!use.length) return null;
  return [...use].sort((a, b) =>
    (Math.abs(a.weight - want.weight) - Math.abs(b.weight - want.weight)) ||
    (a.weight - b.weight) || a.url.localeCompare(b.url))[0];
}

// ── F3 (2026-10-02) · LÁMINAS DE CARRUSEL SEGÚN LA MAQUETA v4 ──────────────────────────────────
// Cada lámina lleva: barra de progreso por lámina, número `i / n`, etiqueta superior, UNA palabra
// clave del titular resaltada, cifra con barra a escala y su fuente, pasos con uno crítico, CTA de
// texto subrayado (sólo en el cierre, nunca con forma de botón), el aviso de deslizar con flecha (sólo en la
// portada) y el logotipo de la marca en el pie.
//
// EJE Y INSTANCIA, igual que el resto del bloque:
//   · EJE (código): qué elemento existe, dónde va y qué FUNCIÓN de color lo pinta — la regla de la
//     maqueta (`CAROUSEL_ELEMENT_COLOR`). También las proporciones internas, derivadas de los tamaños
//     de letra (un punto mide media letra de cuerpo en cualquier marca).
//   · INSTANCIA (dato): qué ROL de `brand_palette` juega cada función (`tokens.palette`), qué ROL de
//     `brand_typography` y qué tamaño lleva cada familia de texto, el lienzo, el margen, el velo y el
//     texto del aviso de deslizar, por idioma (`tokens.carousel`), y el logotipo (`public.brand_logo`).
// Sin `tokens.carousel` en la fila resuelta, el campo `carousel` de la petición se ignora y la escena
// es la de 1.2.0, byte por byte.

const CAROUSEL_ROLES = new Set(['cover', 'body', 'closing']);
const CAROUSEL_BACKGROUNDS = new Set(['image', 'surface']);
const CAROUSEL_MAX_SLIDES = 10;
const CAROUSEL_MAX_STEPS = 5;

// Funciones de color que una marca con carrusel DEBE declarar en `tokens.palette` (valor: rol de
// `brand_palette`, o `{ role, alpha }`). Las opcionales tienen un reemplazo declarado abajo.
const CAROUSEL_COLOR_FUNCTIONS = ['keyword', 'progress_on', 'progress_off', 'counter', 'critical', 'light', 'muted', 'surface', 'figure'];

// EL REPARTO elemento → función de color. Es la regla de la maqueta v4 y es del sistema: acento 1 en
// la barra de progreso y en la palabra clave; acento 2 en `i / n`, el paso crítico y el punto de la
// fuente; la «luz» en el aviso de deslizar y el subrayado del CTA. Qué hex es cada acento lo dice la marca.
const CAROUSEL_ELEMENT_COLOR: Record<string, string> = {
  progress_done: 'progress_on', progress_todo: 'progress_off',
  eyebrow: 'muted', counter: 'counter',
  headline: 'text', keyword: 'keyword', subheadline: 'text_soft',
  figure: 'figure', bar_track: 'progress_off', bar_from: 'progress_on', bar_to: 'counter',
  source_text: 'muted', source_mark: 'counter',
  step_text: 'text_soft', step_mark: 'keyword', step_critical_text: 'text', step_critical_mark: 'critical',
  cta_text: 'text', cta_underline: 'light', swipe: 'light',
};

// 1.11.0 — claves de `tokens.carousel` que son POLÍTICA (qué evita el bloque de texto), no cromo. Pueden vivir en la
// capa global para todas las marcas; por sí solas no declaran un carrusel: una marca sin cromo propio sigue
// componiendo como 1.2.0 (`CAROUSEL_NOT_DECLARED`), aunque la capa global encienda la política.
export const CAROUSEL_POLICY_KEYS = new Set(['avoid_faces', 'avoid_products', 'avoid_people']);

/** ¿La fila resuelta declara el CROMO de carrusel? Las claves de política no cuentan. PURO. */
export function carouselChromeDeclared(ct: unknown): boolean {
  return isPlain(ct) && Object.keys(ct).some((k) => !CAROUSEL_POLICY_KEYS.has(k));
}

export interface CarouselIn {
  index: number; total: number; role: 'cover' | 'body' | 'closing'; background: 'image' | 'surface';
  eyebrow: string | null; keyword: string | null;
  figure: null | { value: string; bar: null | { from: number; to: number }; source: string };
  steps: Array<{ text: string; critical: boolean }>;
  cta: string | null;
}

/**
 * Valida el campo `carousel` de la petición contra el contrato F3. Errores 400 con etiqueta estable:
 * son errores del LLAMADOR (la misma regla la valida el carril antes de llamar). Ausente ⇒ null.
 * No toca el texto: lo que llega es copy ya juzgado y se devuelve tal cual.
 */
export function parseCarouselRequest(raw: unknown): CarouselIn | null {
  if (raw == null) return null;
  const bad = (label: string, msg: string) => new CompositorError(label, msg, 400);
  if (!isPlain(raw)) throw bad('CAROUSEL_BAD_REQUEST', 'carousel debe ser un objeto');
  const r = raw as Record<string, any>;
  const index = Number(r.index);
  const total = Number(r.total);
  if (!Number.isInteger(index) || index < 1 || !Number.isInteger(total) || total < index || total > CAROUSEL_MAX_SLIDES) {
    throw bad('CAROUSEL_INDEX_INVALID', `carousel.index/total inválidos (${r.index}/${r.total}): index ≥ 1, index ≤ total ≤ ${CAROUSEL_MAX_SLIDES}`);
  }
  const role = String(r.role ?? '');
  if (!CAROUSEL_ROLES.has(role)) throw bad('CAROUSEL_ROLE_INVALID', `carousel.role='${role || '∅'}' (válidos: ${[...CAROUSEL_ROLES].join(', ')})`);
  const background = r.background == null ? 'image' : String(r.background);
  if (!CAROUSEL_BACKGROUNDS.has(background)) {
    throw bad('CAROUSEL_BACKGROUND_INVALID', `carousel.background='${background}' (válidos: ${[...CAROUSEL_BACKGROUNDS].join(', ')})`);
  }
  const optText = (v: unknown, field: string): string | null => {
    if (v == null) return null;
    if (typeof v !== 'string') throw bad('CAROUSEL_BAD_REQUEST', `carousel.${field} debe ser texto`);
    return v.trim() ? v : null;
  };
  const eyebrow = optText(r.eyebrow, 'eyebrow');
  const keyword = optText(r.keyword, 'keyword');

  let figure: CarouselIn['figure'] = null;
  if (r.figure != null) {
    if (!isPlain(r.figure)) throw bad('CAROUSEL_FIGURE_INVALID', 'carousel.figure debe ser un objeto { value, bar?, source }');
    const f = r.figure as Record<string, any>;
    const value = typeof f.value === 'string' ? f.value : '';
    if (!value.trim()) throw bad('CAROUSEL_FIGURE_INVALID', 'carousel.figure.value es obligatorio');
    const source = typeof f.source === 'string' ? f.source : '';
    if (!source.trim()) {
      throw bad('CAROUSEL_FIGURE_WITHOUT_SOURCE', 'una cifra sin fuente no se compone: carousel.figure.source es obligatorio');
    }
    let bar: { from: number; to: number } | null = null;
    if (f.bar != null) {
      const from = Number(f.bar?.from);
      const to = Number(f.bar?.to);
      if (!isPlain(f.bar) || !Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to > 100 || from > to) {
        throw bad('CAROUSEL_FIGURE_BAR_INVALID', `carousel.figure.bar fuera de escala (${f.bar?.from}..${f.bar?.to}): 0 ≤ from ≤ to ≤ 100`);
      }
      bar = { from, to };
    }
    figure = { value, bar, source };
  }

  let steps: CarouselIn['steps'] = [];
  if (r.steps != null) {
    if (!Array.isArray(r.steps)) throw bad('CAROUSEL_BAD_REQUEST', 'carousel.steps debe ser una lista');
    if (r.steps.length > CAROUSEL_MAX_STEPS) throw bad('CAROUSEL_STEPS_TOO_MANY', `carousel.steps trae ${r.steps.length} pasos; el máximo es ${CAROUSEL_MAX_STEPS}`);
    steps = r.steps.map((s: any, k: number) => {
      const text = isPlain(s) && typeof s.text === 'string' ? s.text : '';
      if (!text.trim()) throw bad('CAROUSEL_STEP_INVALID', `carousel.steps[${k}].text es obligatorio`);
      return { text, critical: s.critical === true };
    });
    if (steps.filter((s) => s.critical).length > 1) throw bad('CAROUSEL_STEPS_CRITICAL_MULTIPLE', 'como máximo un paso crítico por lámina');
  }

  const cta = optText(r.cta, 'cta');
  if (cta && role !== 'closing') throw bad('CAROUSEL_CTA_OUTSIDE_CLOSING', `el CTA va sólo en la lámina de cierre (role='${role}')`);

  return { index, total, role: role as CarouselIn['role'], background: background as CarouselIn['background'], eyebrow, keyword, figure, steps, cta };
}

/**
 * Parte el titular en tramos alrededor de la palabra clave. La clave es una subcadena LITERAL del
 * titular (como máximo una, la primera aparición); si no está, el titular sale entero sin resaltar.
 */
export function splitKeyword(headline: string, keyword: string | null): { parts: Array<{ text: string; keyword: boolean }>; found: boolean } {
  const h = String(headline ?? '');
  const k = keyword ?? '';
  const at = k ? h.indexOf(k) : -1;
  if (at < 0) return { parts: h ? [{ text: h, keyword: false }] : [], found: false };
  const parts = [
    { text: h.slice(0, at), keyword: false },
    { text: k, keyword: true },
    { text: h.slice(at + k.length), keyword: false },
  ].filter((p) => p.text.length > 0);
  return { parts, found: true };
}

/** Ancho y alto intrínsecos de un SVG: atributos numéricos o, si no, el viewBox. Puro: recibe el texto. */
export function svgDimensions(svg: string): { width: number; height: number } | null {
  const tag = (String(svg ?? '').match(/<svg\b[^>]*>/i) ?? [])[0] ?? '';
  const attr = (n: string) => (tag.match(new RegExp(`\\s${n}\\s*=\\s*["']([^"']+)["']`, 'i')) ?? [])[1] ?? '';
  const w = attr('width');
  const h = attr('height');
  if (/^[0-9.]+(px)?$/.test(w) && /^[0-9.]+(px)?$/.test(h) && parseFloat(w) > 0 && parseFloat(h) > 0) {
    return { width: parseFloat(w), height: parseFloat(h) };
  }
  const vb = attr('viewBox').trim().split(/[\s,]+/).map(Number);
  if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) return { width: vb[2], height: vb[3] };
  return null;
}

/** `0.04em` / `.04` / 0.04 → 0.04. Lo que no es número cae a 0 (el tracking es un ajuste, no un dato crítico). */
function emValue(v: unknown): number {
  const n = parseFloat(String(v ?? '0').replace(/em$/i, ''));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Color de un elemento: un ROL de `brand_palette` (o `{ role, alpha }`) y, sólo para el logotipo
 * declarado en `brand_logo`, también un hex literal de la marca (#RGB, #RRGGBB o #RRGGBBAA). Devuelve
 * null si no resuelve: quien llama decide si eso es un faltante (fail-loud) o un aviso.
 */
function carouselColor(
  spec: unknown, palBy: Map<string, { role: string; hex: string }>, opts: { allowHex: boolean; alpha?: number },
): string | null {
  let role = '';
  let alpha = opts.alpha ?? 1;
  if (typeof spec === 'string') role = spec;
  else if (isPlain(spec)) {
    role = String(spec.role ?? '');
    if (spec.alpha != null && Number.isFinite(Number(spec.alpha))) alpha = Number(spec.alpha);
  }
  if (!role) return null;
  const pal = palBy.get(role);
  if (pal) return hexToRgba(String(pal.hex), alpha);
  if (opts.allowHex && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(role)) {
    if (role.length === 9) return hexToRgba(role.slice(0, 7), Math.round((parseInt(role.slice(7), 16) / 255) * alpha * 100) / 100);
    return hexToRgba(role, alpha);
  }
  return null;
}

export interface CarouselLogoIn {
  kind: string; src?: string | null; spec?: Record<string, any> | null;
  intrinsic?: { width: number; height: number } | null;
}
type CarouselType = { role: string; family: string; cssImport: string | null; weight: number; italic: boolean; transform: string; lineHeight: number; letterSpacingEm: number; sizePct: number };
type CarouselLogo =
  | { kind: 'image'; src: string; heightPct: number; aspect: number }
  | { kind: 'wordmark'; sizePct: number; parts: Array<{ text: string; family: string; weight: number; italic: boolean; color: string; letterSpacingEm: number; scale: number; stretch: { x: number; y: number } | null; spaceBeforeEm: number }> };

// ── 1.3.4 · EFECTO DE TEXTO DE LAS LÁMINAS CON FOTO ──────────────────────────────────────────────
// DEFECTO, medido en producción (2026-10-03): en láminas con foto, el texto en el color de acento se
// leía mal sobre caras o fondos cálidos. Oscurecer el velo lo resolvía tapando la foto, y cuánto
// oscurecer era un juicio por lámina. La corrección es una capa que va CON el texto: una sombra por
// glifo, que da contraste local alrededor de cada letra y no pinta ningún rectángulo.
//
// EJE (código): QUÉ es el efecto —dos sombras apiladas por glifo, una centrada (halo) y otra caída
// hacia abajo— y A QUÉ texto se aplica (el de las láminas con foto, nunca el logotipo ni la barra).
// INSTANCIA (dato, `tokens.carousel.text_effect`): la función de color, su alfa, y el desenfoque y el
// desplazamiento como PORCENTAJE del ancho del lienzo. Ningún tamaño en px vive en el código de marca.
const TEXT_EFFECT_KINDS = new Set(['shadow']);
// Tope de desenfoque y desplazamiento, en % del ancho: por encima, la sombra deja de seguir al glifo y
// se convierte en una mancha — el velo que este efecto existe para no tener que oscurecer.
const TEXT_EFFECT_MAX_PCT = 5;

export interface CarouselTextEffect { kind: 'shadow'; fn: string; alpha: number; blurPct: number; offsetPct: number; color?: string }

/**
 * Valida la FORMA de `tokens.carousel.text_effect`. PURO. Un token mal formado es un error con
 * etiqueta estable (400 `CAROUSEL_TEXT_EFFECT_INVALID`), no un efecto silenciosamente omitido.
 * No resuelve el color: eso lo hace `resolveCarouselChrome` contra la paleta de la marca.
 */
export function parseCarouselTextEffect(raw: unknown): CarouselTextEffect {
  const bad = (why: string) => new CompositorError('CAROUSEL_TEXT_EFFECT_INVALID',
    `carousel.text_effect mal formado: ${why}. Forma: { kind: 'shadow', color: <función de tokens.palette>, ` +
    `alpha: 0..1, blur_pct: 0..${TEXT_EFFECT_MAX_PCT}, offset_pct: 0..${TEXT_EFFECT_MAX_PCT} } (% del ancho del lienzo)`, 400);
  if (!isPlain(raw)) throw bad('debe ser un objeto');
  const r = raw as Record<string, unknown>;
  const kind = String(r.kind ?? '');
  if (!TEXT_EFFECT_KINDS.has(kind)) throw bad(`kind='${kind || '∅'}' (válidos: ${[...TEXT_EFFECT_KINDS].join(', ')})`);
  if (typeof r.color !== 'string' || !r.color.trim()) throw bad('color debe ser el nombre de una función de tokens.palette');
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
  const alpha = num(r.alpha);
  const blurPct = num(r.blur_pct);
  const offsetPct = num(r.offset_pct);
  if (!(alpha > 0 && alpha <= 1)) throw bad(`alpha=${JSON.stringify(r.alpha)} (número, 0 < alpha ≤ 1)`);
  for (const [k, v, raw2] of [['blur_pct', blurPct, r.blur_pct], ['offset_pct', offsetPct, r.offset_pct]] as const) {
    if (!(v >= 0 && v <= TEXT_EFFECT_MAX_PCT)) throw bad(`${k}=${JSON.stringify(raw2)} (número, 0 ≤ ${k} ≤ ${TEXT_EFFECT_MAX_PCT})`);
  }
  if (blurPct === 0 && offsetPct === 0) throw bad('blur_pct y offset_pct en 0: la sombra quedaría oculta bajo el glifo');
  return { kind: 'shadow', fn: r.color.trim(), alpha, blurPct, offsetPct };
}

/**
 * Resuelve el «cromo» de una lámina de carrusel: colores por FUNCIÓN, familias y tamaños por ROL,
 * textos y logotipo. PURO. Devuelve `applied:false` si la marca no declara `tokens.carousel`.
 * FAIL-LOUD ACUMULATIVO para lo que la marca declaró a medias (como `resolveOverlayStyle`); el
 * logotipo es la excepción declarada: si su fila está incompleta se avisa y se compone sin él.
 */
export function resolveCarouselChrome(args: {
  tokens: Record<string, any>;
  typography: Array<{ role: string; font_family: string; css_import?: string | null }>;
  palette: Array<{ role: string; hex: string }>;
  carousel: CarouselIn | null;
  text: OverlayText;
  logo?: CarouselLogoIn | null;
}): { applied: false } | {
  applied: true;
  slide: CarouselIn;
  canvas: { width: number; height: number };
  marginPct: number;
  colors: Record<string, string>;
  surface: string;
  shade: null | Array<{ pos: number; color: string }>;
  // 1.3.4 — sombra del texto de las láminas con foto; null si la marca no declara `carousel.text_effect`.
  textEffect: null | CarouselTextEffect;
  type: Record<'headline' | 'body' | 'label' | 'figure', CarouselType>;
  headline: Array<{ text: string; keyword: boolean }>;
  // 1.4.0 — cómo se ven los tramos resaltados del titular (palabra clave + énfasis). null ⇒ sólo
  // cambian de color, como en 1.3.4.
  headlineEmphasis: null | (CarouselType & { sizeScale: number });
  subheadline: string | null;
  swipeText: string;
  logo: CarouselLogo | null;
  fonts: Array<{ role: string; family: string; cssImport: string | null; weight: number; italic: boolean }>;
  warnings: string[];
  // 1.3.3 — los escalones de `fit_steps` MÁS CHICOS que el elegido, de mayor a menor: el ajuste vertical
  // baja por ellos si el bloque central no cabe. `fitGuard` lo pone sólo `fitCarouselContent`.
  fitLadder: { headline: number[] };
  fitGuard?: boolean;
  // 1.5.0 — el límite de área de la plataforma; sólo rige la PORTADA (las láminas interiores son
  // tarjetas de texto por diseño, decisión de Sam del 2026-10-13). Ausente ⇒ sin límite.
  maxTextAreaPct?: number;
  // 1.11.0 — dónde va el bloque de texto, y el último recurso si ninguna colocación libra caras y productos. Los pone
  // SÓLO `chooseCarouselPlacement`; ausentes ⇒ el bloque en el centro de la maqueta, a todo el ancho (1.10.0).
  block?: CarouselBlock;
  inset?: { x0: number; y0: number; x1: number; y1: number };
  band?: { y0: number; y1: number; color: string };
  // 1.13.0 — índices de los átomos del titular que ABREN línea a la fuerza (la palabra que baja para no dejar otra sola).
  // Los pone SÓLO `carouselAvoidOrphan`; ausente ⇒ satori envuelve solo (1.12.0).
  headlineBreaks?: number[];
} {
  const t = args.tokens ?? {};
  const ctRaw: unknown = t.carousel;
  if (!args.carousel || !carouselChromeDeclared(ctRaw)) return { applied: false };
  const ct = ctRaw as Record<string, any>;
  const slide = args.carousel;
  const missing: string[] = [];
  const warnings: string[] = [];
  const typoBy = new Map((args.typography ?? []).map((r) => [String(r.role), r]));
  const palBy = new Map((args.palette ?? []).map((r) => [String(r.role), r]));
  const palTok = (t.palette ?? {}) as Record<string, unknown>;

  // ── colores por función ──
  const fn: Record<string, string> = {};
  const need = (name: string, spec: unknown, where: string) => {
    const c = carouselColor(spec, palBy, { allowHex: false });
    if (c) { fn[name] = c; return; }
    const role = typeof spec === 'string' ? spec : isPlain(spec) ? String(spec.role ?? '') : '';
    missing.push(role ? `brand_palette.role='${role}' (pedido por ${where})` : where);
  };
  for (const name of CAROUSEL_COLOR_FUNCTIONS) need(name, palTok[name], `palette.${name}`);
  // Opcionales con reemplazo: el texto del carrusel hereda el de las ranuras de 1.2.0.
  need('text', palTok.text ?? palTok.headline, palTok.text != null ? 'palette.text' : 'palette.text (o palette.headline)');
  need('text_soft', palTok.text_soft ?? palTok.subheadline ?? palTok.headline,
    palTok.text_soft != null ? 'palette.text_soft' : 'palette.text_soft (o palette.subheadline)');
  if (palTok.surface_closing != null) need('surface_closing', palTok.surface_closing, 'palette.surface_closing');

  // ── lienzo y margen ──
  const canvasW = Number(ct.canvas?.width);
  const canvasH = Number(ct.canvas?.height);
  if (!Number.isInteger(canvasW) || canvasW <= 0 || !Number.isInteger(canvasH) || canvasH <= 0) missing.push('carousel.canvas.width/height');
  const marginPct = Number(ct.margin_pct);
  if (!Number.isFinite(marginPct) || marginPct < 0) missing.push('carousel.margin_pct');

  // ── tipografía: cuatro familias de texto, cada una un ROL de la marca ──
  const fonts: Array<{ role: string; family: string; cssImport: string | null; weight: number; italic: boolean }> = [];
  const addFont = (f: { role: string; family: string; cssImport: string | null; weight: number; italic: boolean }) => {
    if (!fonts.some((x) => x.family === f.family && x.weight === f.weight && x.italic === f.italic)) fonts.push(f);
  };
  const type = {} as Record<'headline' | 'body' | 'label' | 'figure', CarouselType>;
  let headlineOverflow = false;
  let headlineSmaller: number[] = [];
  for (const kind of ['headline', 'body', 'label', 'figure'] as const) {
    const st = ((ct.typography ?? {})[kind] ?? {}) as Record<string, any>;
    const role = String(st.role ?? '');
    const typo = typoBy.get(role);
    if (!role) { missing.push(`carousel.typography.${kind}.role`); continue; }
    if (!typo) { missing.push(`brand_typography.role='${role}' (pedido por carousel.typography.${kind}.role)`); continue; }
    let sizePct = Number(st.size_pct);
    if (kind === 'headline') {
      const steps = Array.isArray(st.fit_steps) ? st.fit_steps : [];
      if (steps.length === 0) { missing.push('carousel.typography.headline.fit_steps'); continue; }
      const fit = fitFontSizePct(steps, String(args.text?.headline ?? ''));
      sizePct = fit.sizePct;
      headlineSmaller = [...new Set(steps.map((s: any) => Number(s.size_pct)))]
        .filter((x) => Number.isFinite(x) && x > 0 && x < sizePct).sort((a, b) => b - a);
      headlineOverflow = fit.overflow && !!String(args.text?.headline ?? '').trim();
    } else if (!Number.isFinite(sizePct) || sizePct <= 0) { missing.push(`carousel.typography.${kind}.size_pct`); continue; }
    type[kind] = {
      role, family: String(typo.font_family), cssImport: typo.css_import ? String(typo.css_import) : null,
      weight: Number(st.weight ?? 400), italic: st.italic === true,
      transform: String(st.transform ?? 'none'),
      lineHeight: Number(st.line_height ?? 1.2),
      letterSpacingEm: Number(st.letter_spacing_em ?? 0),
      sizePct,
    };
    addFont({ role, family: type[kind].family, cssImport: type[kind].cssImport, weight: type[kind].weight, italic: type[kind].italic });
  }
  // 1.4.0 — énfasis de la lámina: `carousel.typography.headline.emphasis`. Hereda del titular lo que no declara.
  let headlineEmphasis: null | (CarouselType & { sizeScale: number }) = null;
  if (type.headline) {
    const hb = type.headline;
    const em = resolveEmphasisType(((ct.typography ?? {}).headline ?? {}).emphasis,
      { role: hb.role, weight: hb.weight, italic: hb.italic, transform: hb.transform, letterSpacingEm: hb.letterSpacingEm },
      typoBy, 'carousel.typography.headline.emphasis', missing);
    if (em) {
      headlineEmphasis = {
        role: em.role, family: em.family, cssImport: em.cssImport, weight: em.weight, italic: em.italic,
        transform: em.transform, lineHeight: hb.lineHeight, letterSpacingEm: em.letterSpacingEm,
        sizePct: hb.sizePct, sizeScale: em.sizeScale,
      };
      addFont({ role: em.role, family: em.family, cssImport: em.cssImport, weight: em.weight, italic: em.italic });
    }
  }
  if (headlineOverflow) {
    warnings.push(`CAROUSEL_HEADLINE_OVERFLOW: el titular excede el último escalón de carousel.typography.headline.fit_steps; se compone entero al tamaño más chico`);
  }

  // ── aviso de deslizar: el texto es DATO por idioma; la flecha es geometría ──
  const swipeText = typeof ct.swipe?.text === 'string' ? ct.swipe.text : '';
  if (!swipeText.trim()) missing.push('carousel.swipe.text');

  // ── velo de las láminas con foto (opcional; sin él, el velo de 1.2.0 de la marca) ──
  let shade: null | Array<{ pos: number; color: string }> = null;
  if (ct.shade != null) {
    const stops = Array.isArray(ct.shade?.stops) ? ct.shade.stops : [];
    const role = palTok.shade;
    const ok = stops.length >= 2 && stops.every((s: any) => Array.isArray(s) && s.length === 2 && Number.isFinite(Number(s[0])) && Number.isFinite(Number(s[1])));
    if (!ok) missing.push('carousel.shade.stops ([[posición %, alfa], …], al menos dos)');
    const spec = typeof role === 'string' ? role : isPlain(role) ? String(role.role ?? '') : '';
    if (!spec) missing.push('palette.shade (pedido por carousel.shade)');
    else if (!palBy.get(spec)) missing.push(`brand_palette.role='${spec}' (pedido por palette.shade)`);
    if (ok && spec && palBy.get(spec)) {
      shade = stops.map((s: any) => ({ pos: Number(s[0]), color: hexToRgba(String(palBy.get(spec)!.hex), Number(s[1])) }));
    }
  }

  // ── 1.3.4 · efecto de texto de las láminas con foto (opcional; sin él, la escena de 1.3.3) ──
  // La FORMA del token es contrato y se valida con 400; el COLOR es una función de `tokens.palette` y,
  // si no resuelve, falla como cualquier otro color del carrusel (faltante acumulado, fail-loud).
  let textEffect: null | CarouselTextEffect = null;
  if (ct.text_effect != null) {
    const te = parseCarouselTextEffect(ct.text_effect);
    const spec = palTok[te.fn];
    const role = typeof spec === 'string' ? spec : isPlain(spec) ? String(spec.role ?? '') : '';
    if (spec == null || !role) missing.push(`palette.${te.fn} (pedido por carousel.text_effect.color)`);
    else {
      // El alfa es el del efecto, no el que la función pueda llevar para su propio elemento.
      const color = carouselColor(role, palBy, { allowHex: false, alpha: te.alpha });
      if (!color) missing.push(`brand_palette.role='${role}' (pedido por palette.${te.fn}, vía carousel.text_effect.color)`);
      else textEffect = { ...te, color };
    }
  }

  if (missing.length) {
    throw new CompositorError(
      'COMPOSITOR_TOKENS_INCOMPLETE',
      `faltan datos de marca para componer la lámina de carrusel: ${missing.join(' · ')}. ` +
      'El motor no tiene fuentes ni colores propios con los que rellenar (BRIEF 7, regla b; F3).',
    );
  }

  // ── textos ──
  // 1.4.0 — la palabra clave de la lámina y los tramos de `emphasis` se resaltan juntos; la clave
  // tiene prioridad si se solapan. Con sólo la clave, el resultado es el de `splitKeyword` (1.3.4).
  const emTerms = (args.text?.emphasis ?? []).filter((x) => typeof x === 'string' && x && x !== slide.keyword);
  const split = splitEmphasis(String(args.text?.headline ?? ''), [slide.keyword, ...emTerms]);
  if (slide.keyword && split.missing.includes(slide.keyword)) {
    warnings.push('CAROUSEL_KEYWORD_NOT_IN_HEADLINE');
  }
  const emMissing = emTerms.filter((x) => split.missing.includes(x));
  if (emMissing.length) {
    warnings.push(`CAROUSEL_EMPHASIS_NOT_IN_HEADLINE: ${emMissing.map((m) => `«${m}»`).join(', ')} no está literal en el titular; ese tramo no se resalta`);
  }
  const sub = String(args.text?.subheadline ?? '');

  // ── logotipo del pie: tolerante. Sin fila ⇒ sin logotipo; fila incompleta ⇒ aviso y sin logotipo ──
  let logo: CarouselLogo | null = null;
  const lg = args.logo ?? null;
  const logoTok = (ct.logo ?? {}) as Record<string, any>;
  if (lg) {
    if (lg.kind === 'image') {
      const h = Number(logoTok.height_pct);
      const iw = Number(lg.intrinsic?.width);
      const ih = Number(lg.intrinsic?.height);
      const src = String(lg.src ?? '');
      if (!/^(https:\/\/|data:image\/)/.test(src)) warnings.push('CAROUSEL_LOGO_INVALID: brand_logo.src no es https ni data:image; se compone sin logotipo');
      else if (!Number.isFinite(h) || h <= 0) warnings.push('CAROUSEL_LOGO_SIZE_NOT_DECLARED: falta carousel.logo.height_pct; se compone sin logotipo');
      else if (!(iw > 0 && ih > 0)) warnings.push('CAROUSEL_LOGO_INVALID: no se pudieron medir las dimensiones del logotipo; se compone sin logotipo');
      else logo = { kind: 'image', src, heightPct: h, aspect: iw / ih };
    } else if (lg.kind === 'wordmark') {
      const size = Number(logoTok.size_pct);
      const parts = Array.isArray(lg.spec?.parts) ? lg.spec!.parts : [];
      const bad: string[] = [];
      const out = parts.map((p: any, k: number) => {
        const text = typeof p?.text === 'string' ? p.text : '';
        const typo = typoBy.get(String(p?.font ?? ''));
        const color = carouselColor(p?.color, palBy, { allowHex: true, alpha: p?.alpha != null ? Number(p.alpha) : undefined });
        if (!text) bad.push(`parts[${k}].text`);
        if (!typo) bad.push(`parts[${k}].font='${p?.font ?? '∅'}' (rol de brand_typography)`);
        if (!color) bad.push(`parts[${k}].color='${p?.color ?? '∅'}'`);
        const sx = Number(p?.stretch?.x);
        const sy = Number(p?.stretch?.y);
        return {
          text, family: typo ? String(typo.font_family) : '', cssImport: typo?.css_import ? String(typo.css_import) : null,
          role: String(p?.font ?? ''), weight: Number(p?.weight ?? 400), italic: p?.style === 'italic',
          color: color ?? '', letterSpacingEm: emValue(p?.tracking),
          scale: Number.isFinite(Number(p?.scale)) && Number(p?.scale) > 0 ? Number(p.scale) : 1,
          stretch: sx > 0 && sy > 0 ? { x: sx, y: sy } : null,
          spaceBeforeEm: Number.isFinite(Number(p?.space_before)) ? Number(p.space_before) : 0,
        };
      });
      if (!parts.length) bad.push('spec.parts vacío');
      if (!Number.isFinite(size) || size <= 0) warnings.push('CAROUSEL_LOGO_SIZE_NOT_DECLARED: falta carousel.logo.size_pct; se compone sin logotipo');
      else if (bad.length) warnings.push(`CAROUSEL_LOGO_INVALID: brand_logo (wordmark) incompleto — ${bad.join(' · ')}; se compone sin logotipo`);
      else {
        for (const p of out) addFont({ role: p.role, family: p.family, cssImport: p.cssImport, weight: p.weight, italic: p.italic });
        logo = {
          kind: 'wordmark', sizePct: size,
          parts: out.map(({ cssImport: _c, role: _r, ...rest }) => rest),
        };
      }
    } else {
      warnings.push(`CAROUSEL_LOGO_INVALID: brand_logo.kind='${lg.kind}' desconocido; se compone sin logotipo`);
    }
  }

  const colors: Record<string, string> = {};
  for (const [element, f] of Object.entries(CAROUSEL_ELEMENT_COLOR)) colors[element] = fn[f];
  const surface = slide.role === 'closing' && fn.surface_closing ? fn.surface_closing : fn.surface;

  return {
    applied: true, slide,
    canvas: { width: canvasW, height: canvasH },
    marginPct, colors, surface, shade, textEffect, type,
    headline: split.parts,
    headlineEmphasis,
    subheadline: sub.trim() ? sub : null,
    swipeText, logo, fonts, warnings,
    fitLadder: { headline: headlineSmaller },
    ...(Number.isFinite(Number((t.layout ?? {}).max_text_area_pct)) && Number(t.layout.max_text_area_pct) > 0
      ? { maxTextAreaPct: Number(t.layout.max_text_area_pct) } : {}),
  };
}

/**
 * El titular, en «átomos» para el ajuste de línea: un átomo es una palabra (o una palabra partida
 * entre la clave y lo que la rodea, como «BROKEN» + «.»), y nunca se corta por dentro. El espacio
 * entre palabras viaja como espacio duro al final del átomo: satori recorta los espacios normales en
 * el borde de cada tramo y, sin esto, «SAME GOAL.» + «THREE» se pegarían. Puro: no cambia el texto
 * visible, sólo cómo se agrupa.
 * (Los huecos desiguales entre palabras de 1.3.0 no venían de aquí sino del kerning: ver
 * `neutralizeKerning`. Lo que sí aporta el átomo es redondear su caja al píxel de arriba: ≤ 1 px.)
 */
/**
 * 1.7.0 — DÓNDE SE CORTA EL TITULAR. PURO. Devuelve los tramos [inicio, fin) del titular, uno por línea, o
 * `null` si no hay corte que imponer (satori envuelve solo, como en 1.6.4).
 *
 * EL CASO (Sam, 2026-10-19): «queda una palabra justo al lado del accent text de las palabras clave y el
 * resto en la siguiente línea». Satori corta por ancho, palabra a palabra, y no sabe dónde empieza o termina
 * un tramo con énfasis: «Nunca te preguntó DÓNDE» / «VIVES.»; «¿Por qué el color SE VA» / «ANTES de…».
 *
 *   · MANUAL — un salto de línea escrito en el titular manda: cada línea escrita es una línea. Es la vía de
 *     quien corrige en la bandeja, y no se discute con la regla.
 *   · REGLA (sólo con tramos de énfasis). Las palabras con énfasis forman BLOQUES; dos tramos separados por
 *     2 palabras o menos, sin fin de frase en medio, son un mismo bloque («Tu PUNTA y tu RAÍZ»). Un bloque
 *     abre línea si en la suya ya hay 3 palabras o más; lo que lo sigue baja de línea si son 3 palabras o más
 *     hasta el fin de la frase o el próximo bloque. Así: «¿Por qué el color» / «SE VA ANTES» / «de la próxima
 *     cita?», y «75 MINUTOS de blowout.» / «MENOS DE 5» / «en el estacionamiento.».
 * Una línea larga sigue envolviéndose sola dentro de su fila: la regla dice dónde SE CORTA, no el ancho.
 * Cero marcas, cero idiomas: la frase termina en . ? ! … y las palabras son lo que separa el espacio.
 */
export const HEADLINE_BREAK_MIN_WORDS = 3;
export const HEADLINE_BLOCK_MAX_GAP = 2;
export function headlineLineRanges(
  headline: string, parts: Array<{ text: string; keyword: boolean }> | null,
): { ranges: Array<[number, number]>; source: 'manual' | 'rule' } | null {
  const h = String(headline ?? '');
  if (/\n/.test(h)) {
    const ranges: Array<[number, number]> = [];
    let at = 0;
    for (const line of h.split('\n')) {
      const lead = line.length - line.trimStart().length;
      const t = line.trim();
      if (t) ranges.push([at + lead, at + lead + t.length]);
      at += line.length + 1;
    }
    return ranges.length > 1 ? { ranges, source: 'manual' } : null;
  }
  if (!parts || !parts.some((p) => p.keyword)) return null;
  // Las zonas con énfasis, en coordenadas del titular.
  const kw: Array<[number, number]> = [];
  let pos = 0;
  for (const p of parts) { if (p.keyword) kw.push([pos, pos + p.text.length]); pos += p.text.length; }
  const words: Array<{ a: number; b: number; key: boolean; end: boolean }> = [];
  for (const m of h.matchAll(/\S+/g)) {
    const a = m.index ?? 0; const b = a + m[0].length;
    words.push({ a, b, key: kw.some(([x, y]) => a < y && b > x), end: /[.?!…]["'»”)]*$/.test(m[0]) });
  }
  if (words.length < 2) return null;
  // Bloques: corridas de palabras con énfasis, unidas por huecos cortos sin fin de frase.
  const block: number[] = words.map(() => -1);
  let nb = -1;
  for (let k = 0; k < words.length; k++) {
    if (!words[k].key) continue;
    let prev = k - 1;
    while (prev >= 0 && !words[prev].key) prev--;
    const gap = k - prev - 1;
    const sentenceBetween = prev >= 0 && words.slice(prev, k).some((w) => w.end);
    if (prev >= 0 && gap <= HEADLINE_BLOCK_MAX_GAP && !sentenceBetween) {
      for (let g = prev + 1; g <= k; g++) block[g] = block[prev];
    } else block[k] = ++nb;
  }
  const breaks = new Set<number>();   // índice de la palabra que ABRE línea
  let lineStart = 0;
  for (let k = 0; k < words.length; k++) {
    const startsBlock = block[k] >= 0 && (k === 0 || block[k - 1] !== block[k]);
    if (startsBlock && k - lineStart >= HEADLINE_BREAK_MIN_WORDS) { breaks.add(k); lineStart = k; }
    const endsBlock = block[k] >= 0 && (k === words.length - 1 || block[k + 1] !== block[k]);
    if (endsBlock && k + 1 < words.length) {
      let n = 0;
      for (let r = k + 1; r < words.length && block[r] < 0; r++) { n++; if (words[r].end) break; }
      if (n >= HEADLINE_BREAK_MIN_WORDS) { breaks.add(k + 1); lineStart = k + 1; }
    }
  }
  if (!breaks.size) return null;
  // Una palabra corta (2 letras o menos: «a», «de», «tu», «to») no queda colgada al final de la línea: baja
  // con lo que sigue. Nunca vacía la línea anterior.
  const short = (w: { a: number; b: number }) => h.slice(w.a, w.b).replace(/[^\p{L}\p{N}]/gu, '').length <= 2;
  const moved = new Set<number>();
  for (const k of [...breaks].sort((x, y) => x - y)) {
    let c = k;
    const prevCut = Math.max(0, ...[...moved].filter((x) => x < k));
    while (c - 1 > prevCut && !words[c - 1].end && short(words[c - 1]) && block[c - 1] < 0) c--;
    moved.add(c);
  }
  const cuts = [0, ...[...moved].sort((x, y) => x - y)];
  const ranges = cuts.map((c, i) => [words[c].a, words[(i + 1 < cuts.length ? cuts[i + 1] : words.length) - 1].b] as [number, number]);
  return { ranges, source: 'rule' };
}

/** 1.7.0 — los trozos (con su marca de énfasis) que caen dentro de [a, b) del titular. PURO. */
export function partsInRange<P extends { text: string; keyword: boolean }>(parts: P[], a: number, b: number): P[] {
  const out: P[] = [];
  let pos = 0;
  for (const p of parts) {
    const x = Math.max(a, pos); const y = Math.min(b, pos + p.text.length);
    // 1.9.0 — el tramo conserva sus marcas (la sombra al revés), no sólo el énfasis.
    if (y > x) out.push({ ...p, text: p.text.slice(x - pos, y - pos) });
    pos += p.text.length;
  }
  return out;
}

export function headlineAtoms<P extends { text: string; keyword: boolean }>(parts: P[]): P[][] {
  const atoms: P[][] = [[]];
  for (const p of parts) {
    for (const piece of p.text.split(/(\s+)/)) {
      if (!piece) continue;
      if (/^\s+$/.test(piece)) { if (atoms[atoms.length - 1].length) atoms.push([]); continue; }
      atoms[atoms.length - 1].push({ ...p, text: piece });
    }
  }
  const out = atoms.filter((a) => a.length);
  for (let k = 0; k < out.length - 1; k++) {
    const last = out[k][out[k].length - 1];
    out[k][out[k].length - 1] = { ...last, text: `${last.text}\u00a0` };
  }
  return out;
}

/**
 * 1.3.4 — el `textShadow` de satori para el efecto de texto. PURO. Dos sombras apiladas del mismo
 * color: un halo centrado (contraste en todo el contorno del glifo, también por arriba) y una caída
 * hacia abajo (asienta la letra sobre la foto). Desenfoque y desplazamiento son % del ANCHO del lienzo.
 */
export function carouselTextShadow(te: CarouselTextEffect, canvasWidth: number): string {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const blur = r2((te.blurPct / 100) * canvasWidth);
  const off = r2((te.offsetPct / 100) * canvasWidth);
  return `0px 0px ${blur}px ${te.color}, 0px ${off}px ${blur}px ${te.color}`;
}

/**
 * La escena de una lámina de carrusel. PURA, misma disciplina que `buildOverlayScene`: todo se mide
 * en porcentaje del ANCHO del lienzo, y las proporciones internas (puntos, barras, separaciones) se
 * derivan del tamaño de letra de su familia — eso es geometría del eje, no dato de una marca.
 *
 * Estructura (la de la maqueta v4): arriba la barra de progreso y la fila etiqueta · `i / n`; al
 * centro el contenido; abajo el aviso de deslizar (portada) y el logotipo. Con foto: imagen a sangre + velo +
 * franja de identidad (si la marca la declara). Sin foto: el color de la función `surface`.
 */
export function buildCarouselScene(args: {
  chrome: Extract<ReturnType<typeof resolveCarouselChrome>, { applied: true }>;
  style: ReturnType<typeof resolveOverlayStyle>;
  backgroundSrc: string | null;
}): Record<string, any> {
  const { chrome, style } = args;
  const W = chrome.canvas.width;
  const H = chrome.canvas.height;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const px = (pct: number) => r2((pct / 100) * W);
  const c = chrome.colors;
  const T = chrome.type;
  const L = px(T.label.sizePct);
  const B = px(T.body.sizePct);
  const M = px(chrome.marginPct);
  const inner = r2(W - 2 * M);
  // 1.11.0 — el bloque central se compone al ancho de SU columna (`chrome.block`); sin ella, a todo el ancho.
  const blockW = carouselBlockWidth(chrome, inner);
  const slide = chrome.slide;
  // 1.11.0 — con `inset` (último recurso) la lámina va sobre la superficie y la foto, reducida, debajo del texto.
  const withImage = slide.background === 'image' && !!args.backgroundSrc && !chrome.inset;
  const children: Array<Record<string, any>> = [];
  // 1.3.4 — efecto de texto: sólo sobre foto, y sólo en nodos de TEXTO (no en el logotipo, la barra de
  // progreso, las marcas de los pasos ni las flechas). Sin token `fx` es {}: ningún estilo cambia y la
  // escena es la de 1.3.3, clave por clave.
  const fx: Record<string, string> = withImage && chrome.textEffect ? { textShadow: carouselTextShadow(chrome.textEffect, W) } : {};

  const text = (value: string, s: Record<string, any>) => ({ type: 'div', props: { style: { display: 'flex', ...s }, children: value } });
  const font = (k: CarouselType, size: number) => ({
    fontFamily: k.family, fontWeight: k.weight, fontStyle: k.italic ? 'italic' : 'normal',
    fontSize: size, lineHeight: k.lineHeight, letterSpacing: r2(k.letterSpacingEm * size), textTransform: k.transform,
  });
  // Flecha GEOMÉTRICA (la familia display de una marca puede no tener «→»): un trazo vectorial con el
  // color de su función. No es un carácter: no depende de qué glifos traiga la fuente.
  // La DIRECCIÓN es eje y la fija el rol de la lámina, no la marca: en la portada señala a la derecha
  // (hay más láminas: el gesto existe); en el cierre señala ABAJO, al texto del post y al botón real
  // del anuncio. Una flecha a la derecha en la última lámina promete un deslizamiento que no existe
  // (Sam, 2026-10-03; Meta rechaza en anuncios la funcionalidad inexistente).
  const arrow = (color: string, size: number, direction: 'right' | 'down' = 'right') => {
    const down = direction === 'down';
    const w = r2(size * (down ? 0.62 : 1.25));
    const h = r2(size * (down ? 0.84 : 0.62));
    const svg = down
      ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 16" width="${w}" height="${h}">` +
        `<path d="M6 1V14.5M2 10.5L6 14.5L10 10.5" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`
      : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 12" width="${w}" height="${h}">` +
        `<path d="M1 6H22.5M17.5 1.5L22.5 6L17.5 10.5" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    return {
      type: 'img',
      props: { src: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`, width: w, height: h, style: { width: w, height: h, flexShrink: 0, marginLeft: r2(size * 0.45) } },
    };
  };

  // ── fondo ──
  if (withImage) {
    children.push({ type: 'img', props: { src: args.backgroundSrc, width: W, height: H, style: { position: 'absolute', top: 0, left: 0, width: W, height: H, objectFit: 'cover' } } });
    if (chrome.shade) {
      const stops = chrome.shade.map((s) => `${s.color} ${s.pos}%`).join(', ');
      children.push({ type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, width: W, height: H, backgroundImage: `linear-gradient(180deg, ${stops})` } } });
    } else if (style.scrim) {
      const from = hexToRgba(style.scrim.color, style.scrim.opacity);
      const to = hexToRgba(style.scrim.color, 0);
      const cover = r2((style.scrim.coveragePct / 100) * H);
      children.push({
        type: 'div',
        props: {
          style: {
            position: 'absolute', left: 0, width: W, height: cover,
            ...(style.scrim.mode === 'gradient_top' ? { top: 0 } : { bottom: 0 }),
            ...(style.scrim.mode === 'solid' ? { backgroundColor: from }
              : { backgroundImage: `linear-gradient(${style.scrim.mode === 'gradient_top' ? '180deg' : '0deg'}, ${from} 0%, ${to} 100%)` }),
          },
        },
      });
    }
    if (style.identity) {
      const thickness = Math.max(1, Math.round((style.identity.widthPct / 100) * Math.min(W, H)));
      const vertical = style.identity.mode === 'edge_left' || style.identity.mode === 'edge_right';
      children.push({
        type: 'div',
        props: {
          style: {
            position: 'absolute', backgroundColor: style.identity.color,
            ...(vertical
              ? { top: 0, height: H, width: thickness, ...(style.identity.mode === 'edge_left' ? { left: 0 } : { right: 0 }) }
              : { left: 0, width: W, height: thickness, bottom: 0 }),
          },
        },
      });
    }
    // 1.11.0 — último recurso 'band': una banda de la superficie de la marca bajo el texto, a sangre. Sólo ahí:
    // el resto de la foto no se oscurece (Sam, 2026-10-15).
    if (chrome.band) {
      children.push({ type: 'div', props: { style: { position: 'absolute', left: 0, width: W, top: chrome.band.y0, height: r2(chrome.band.y1 - chrome.band.y0), backgroundColor: chrome.band.color } } });
    }
  } else {
    children.push({ type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, width: W, height: H, backgroundColor: chrome.surface } } });
    // 1.11.0 — último recurso 'inset': la foto entera de la lámina, reducida al hueco libre que deja el texto.
    if (chrome.inset && slide.background === 'image' && args.backgroundSrc) {
      const iw = r2(chrome.inset.x1 - chrome.inset.x0);
      const ih = r2(chrome.inset.y1 - chrome.inset.y0);
      children.push({ type: 'img', props: { src: args.backgroundSrc, width: iw, height: ih, style: { position: 'absolute', left: chrome.inset.x0, top: chrome.inset.y0, width: iw, height: ih, objectFit: 'cover' } } });
    }
  }

  // ── arriba: progreso por lámina + etiqueta · i / n ──
  const segGap = r2(L * 0.42);
  const segs = Array.from({ length: slide.total }, (_, k) => ({
    type: 'div',
    props: {
      style: {
        flexGrow: 1, flexBasis: 0, height: Math.max(2, r2(L * 0.21)),
        ...(k < slide.total - 1 ? { marginRight: segGap } : {}),
        backgroundColor: k < slide.index ? c.progress_done : c.progress_todo,
      },
    },
  }));
  const labelFont = font(T.label, L);
  const top = {
    type: 'div',
    props: {
      style: { display: 'flex', flexDirection: 'column', width: inner },
      children: [
        { type: 'div', props: { style: { display: 'flex', flexDirection: 'row', width: inner }, children: segs } },
        {
          type: 'div',
          props: {
            style: { display: 'flex', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: r2(L * 0.95), width: inner },
            children: [
              slide.eyebrow ? text(slide.eyebrow, { ...labelFont, color: c.eyebrow, ...fx }) : { type: 'div', props: { style: { display: 'flex' } } },
              text(`${slide.index} / ${slide.total}`, { ...labelFont, color: c.counter, textTransform: 'none', ...fx }),
            ],
          },
        },
      ],
    },
  };

  // ── centro ──
  const mid: Array<Record<string, any>> = [];
  if (chrome.headline.length) {
    const hs = px(T.headline.sizePct);
    const hf = font(T.headline, hs);
    const HE = chrome.headlineEmphasis;
    mid.push({
      type: 'div',
      props: {
        style: { display: 'flex', flexWrap: 'wrap', width: blockW, ...hf, color: c.headline, ...fx, ...(HE ? { alignItems: 'baseline' } : {}) },
        children: headlineAtoms(chrome.headline).flatMap((atom, k) => [
          // 1.13.0 — un corte a la fuerza es un hueco del ancho del bloque y alto cero: la fila se parte justo ahí.
          ...(chrome.headlineBreaks?.includes(k) ? [{ type: 'div', props: { style: { display: 'flex', width: blockW, height: 0 } } }] : []),
          {
          type: 'div',
          props: {
            style: { display: 'flex', flexDirection: 'row', ...(HE ? { alignItems: 'baseline' } : {}) },
            children: atom.map((p) => ({
              type: 'span',
              props: {
                style: {
                  textTransform: T.headline.transform, color: p.keyword ? c.keyword : c.headline, ...fx,
                  // 1.4.0 — el tramo resaltado con la tipografía de énfasis de la marca.
                  ...(HE && p.keyword ? { ...font(HE, r2(hs * HE.sizeScale)) } : {}),
                },
                children: p.text,
              },
            })),
          },
        }]),
      },
    });
  }
  const subNode = (marginTop: number) => text(chrome.subheadline!, { ...font(T.body, B), color: c.subheadline, marginTop, width: blockW, ...fx });
  if (slide.figure) {
    const fs = px(T.figure.sizePct);
    mid.push(text(slide.figure.value, { ...font(T.figure, fs), color: c.figure, marginTop: mid.length ? r2(B * 0.8) : 0, width: blockW, ...fx }));
    if (slide.figure.bar) {
      const bh = Math.max(2, r2(L * 0.53));
      const from = r2((slide.figure.bar.from / 100) * blockW);
      const w = r2(((slide.figure.bar.to - slide.figure.bar.from) / 100) * blockW);
      mid.push({
        type: 'div',
        props: {
          style: { display: 'flex', position: 'relative', width: blockW, height: bh, marginTop: r2(L * 1.26), borderRadius: r2(bh / 2), backgroundColor: c.bar_track, overflow: 'hidden' },
          children: [{
            type: 'div',
            props: { style: { position: 'absolute', top: 0, left: from, width: w, height: bh, backgroundImage: `linear-gradient(90deg, ${c.bar_from}, ${c.bar_to})` } },
          }],
        },
      });
    }
    if (chrome.subheadline) mid.push(subNode(r2(B * 0.69)));
    const dot = r2(L * 0.63);
    mid.push({
      type: 'div',
      props: {
        style: { display: 'flex', flexDirection: 'row', alignItems: 'center', marginTop: r2(B * 0.69), width: blockW },
        children: [
          { type: 'div', props: { style: { width: dot, height: dot, borderRadius: r2(dot / 2), backgroundColor: c.source_mark, marginRight: r2(L * 0.74), flexShrink: 0 } } },
          text(slide.figure.source, { ...font(T.label, r2(L * 1.1)), letterSpacing: r2(T.label.letterSpacingEm * 0.4 * L * 1.1), textTransform: 'none', color: c.source_text, ...fx }),
        ],
      },
    });
  } else if (chrome.subheadline) {
    mid.push(subNode(mid.length ? r2(B * 0.69) : 0));
  }
  if (slide.steps.length) {
    const ss = r2(B * 0.86);
    const mark = r2(B * 0.55);
    const bw = Math.max(1, r2(B * 0.07));
    mid.push({
      type: 'div',
      props: {
        style: { display: 'flex', flexDirection: 'column', marginTop: mid.length ? r2(B * 0.83) : 0, width: blockW },
        children: slide.steps.map((s, k) => ({
          type: 'div',
          props: {
            style: { display: 'flex', flexDirection: 'row', alignItems: 'center', ...(k > 0 ? { marginTop: r2(B * 0.48) } : {}) },
            children: [
              {
                type: 'div',
                props: {
                  style: {
                    width: mark, height: mark, borderRadius: r2(mark / 2), flexShrink: 0, marginRight: r2(B * 0.62),
                    border: `${bw}px solid ${s.critical ? c.step_critical_mark : c.step_mark}`,
                    ...(s.critical ? { backgroundColor: c.step_critical_mark } : {}),
                  },
                },
              },
              text(s.text, { ...font(T.body, ss), lineHeight: 1.35, color: s.critical ? c.step_critical_text : c.step_text, ...fx }),
            ],
          },
        })),
      },
    });
  }
  if (slide.cta && slide.role === 'closing') {
    const cs = r2(L * 1.16);
    mid.push({
      type: 'div',
      props: {
        style: { display: 'flex', flexDirection: 'row', marginTop: mid.length ? r2(B * 0.97) : 0 },
        children: [{
          type: 'div',
          props: {
            // Subrayado, sin forma de botón: en una imagen nada se toca (maqueta v4).
            style: { display: 'flex', flexDirection: 'row', alignItems: 'center', maxWidth: blockW, paddingBottom: r2(cs * 0.45), borderBottom: `${Math.max(1, r2(cs * 0.09))}px solid ${c.cta_underline}` },
            children: [
              text(slide.cta, { ...font(T.label, cs), letterSpacing: r2(T.label.letterSpacingEm * 0.75 * cs), color: c.cta_text, flexShrink: 1, ...fx }),
              arrow(c.cta_underline, cs, 'down'),
            ],
          },
        }],
      },
    });
  }

  // ── abajo: aviso de deslizar (sólo portada) + logotipo ──
  let logoNode: Record<string, any> = { type: 'div', props: { style: { display: 'flex' } } };
  if (chrome.logo?.kind === 'image') {
    const h = px(chrome.logo.heightPct);
    const w = r2(h * chrome.logo.aspect);
    logoNode = { type: 'img', props: { src: chrome.logo.src, width: w, height: h, style: { width: w, height: h } } };
  } else if (chrome.logo?.kind === 'wordmark') {
    const S = px(chrome.logo.sizePct);
    logoNode = {
      type: 'div',
      props: {
        style: { display: 'flex', flexDirection: 'row', alignItems: 'flex-end', lineHeight: 1 },
        children: chrome.logo.parts.map((p) => {
          const size = r2(S * p.scale);
          return {
            type: 'span',
            props: {
              style: {
                fontFamily: p.family, fontWeight: p.weight, fontStyle: p.italic ? 'italic' : 'normal',
                fontSize: size, color: p.color, letterSpacing: r2(p.letterSpacingEm * size), lineHeight: 1,
                ...(p.spaceBeforeEm ? { marginLeft: r2(p.spaceBeforeEm * S) } : {}),
                ...(p.stretch ? { transform: `scale(${p.stretch.x}, ${p.stretch.y})` } : {}),
              },
              children: p.text,
            },
          };
        }),
      },
    };
  }
  const swipe = slide.role === 'cover'
    ? {
      type: 'div',
      props: {
        style: { display: 'flex', flexDirection: 'row', alignItems: 'center' },
        children: [text(chrome.swipeText, { ...labelFont, color: c.swipe, ...fx }), arrow(c.swipe, L)],
      },
    }
    : { type: 'div', props: { style: { display: 'flex' } } };
  const foot = {
    type: 'div',
    props: {
      style: { display: 'flex', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', width: inner },
      children: [swipe, logoNode],
    },
  };

  // 1.3.3 — si el ajuste vertical tuvo que actuar (`fitGuard`), la cabecera y el pie quedan rígidos y
  // el bloque central es el único que cede: aunque la estimación se quedara corta, el pie no se tapa
  // ni sale del lienzo. Una lámina que ya cabía no lleva estas claves y su escena no cambia.
  const guard = chrome.fitGuard === true;
  const rigid = (node: Record<string, any>) => (guard ? { ...node, props: { ...node.props, style: { ...node.props.style, flexShrink: 0 } } } : node);
  // 1.11.0 — la colocación del bloque (`chrome.block`): arriba o abajo, un espaciador se queda con el hueco y el
  // bloque guarda el aire mínimo de la medición; la columna derecha empuja el bloque. Sin `block`, la de 1.10.0.
  const blk = chrome.block ?? null;
  const gapB = r2(L * FIT_MIN_GAP_LABELS);
  const midNode = { type: 'div', props: { style: {
    display: 'flex', flexDirection: 'column', width: blockW,
    ...(blk && blk.side === 'right' ? { marginLeft: r2(inner - blockW) } : {}),
    ...(blk && blk.place === 'top' ? { marginTop: gapB } : {}),
    ...(blk && blk.place === 'bottom' ? { marginBottom: gapB } : {}),
    ...(guard ? { flexShrink: 1, minHeight: 0, overflow: 'hidden' } : {}) }, children: mid } };
  const spacer = { type: 'div', props: { style: { display: 'flex', flexGrow: 1 } } };
  children.push({
    type: 'div',
    props: {
      style: {
        position: 'absolute', top: 0, left: 0, width: W, height: H,
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: M,
      },
      children: blk && blk.place === 'top' ? [rigid(top), midNode, spacer, rigid(foot)]
        : blk && blk.place === 'bottom' ? [rigid(top), spacer, midNode, rigid(foot)]
        : [rigid(top), midNode, rigid(foot)],
    },
  });

  return { type: 'div', props: { style: { display: 'flex', position: 'relative', width: W, height: H }, children } };
}

// ── 1.3.3 (2026-10-03) · AJUSTE VERTICAL DE LA LÁMINA ─────────────────────────────────────────────
// DEFECTO, medido en producción (barrido del 2026-10-03): el bloque central —titular, bajada, cifra,
// pasos, CTA— se dimensionaba por número de caracteres (`fit_steps`) y nadie comprobaba que cupiera
// entre la cabecera (progreso, etiqueta, i / n) y el pie (aviso de deslizar, logotipo). Una cifra de
// 26,5 % del ancho más cuatro pasos empujaba el pie fuera del lienzo: el cuarto paso cortado y el
// logotipo perdido, o una cifra de dos palabras partida en dos líneas que desplazaba el logotipo.
//
// LA CORRECCIÓN, determinista y sin red: se MIDE la altura que el bloque central va a ocupar con las
// métricas de avance de la MISMA fuente que recibe satori (sin kerning desde 1.3.1, así que la suma
// de avances es exactamente lo que satori mide), se reparte en líneas con el mismo ancho disponible
// y, si no cabe, se reduce por escalones en un orden fijo:
//   1. la cifra (hasta la mitad de su tamaño declarado),
//   2. el titular (los escalones siguientes de su `fit_steps`),
//   3. el cuerpo y los pasos (hasta el 85 %),
//   4. y, si ni así cabe, se omiten pasos desde el final —nunca el crítico— con aviso.
// Si una lámina ya cabe, nada de esto toca la escena: sale idéntica, clave por clave.
// Todo es eje: los escalones son proporciones del tamaño que la marca declara, no tamaños de marca.

// Proporción del tamaño declarado en cada escalón de reducción (el primero es «sin reducir»).
const FIT_FIGURE_SCALES = [1, 0.85, 0.72, 0.6, 0.5];
const FIT_BODY_SCALES = [0.92, 0.85];
// Aire mínimo entre la cabecera y el bloque central, y entre éste y el pie, en tamaños de etiqueta.
const FIT_MIN_GAP_LABELS = 0.6;
// Ancho medio de glifo (en em) cuando no hay métricas de la fuente: el ajuste queda ESTIMADO y avisa.
const FIT_FALLBACK_EM = 0.6;

/** Métricas de avance de una fuente: ancho de cada carácter en em, y la media de los imprimibles ASCII. */
export interface FontAdvance { advances: Map<number, number>; avgEm: number }

/**
 * Lee de una fuente sfnt (TrueType u OpenType/CFF) el avance horizontal de cada carácter: `cmap`
 * (formato 4 o 12) → glifo → `hmtx`, dividido por `unitsPerEm` (`head`). PURO: recibe los bytes. Es
 * la misma métrica con la que satori ubica el texto (sin kerning, 1.3.1). Lo que no sea una fuente
 * legible —WOFF comprimido, bytes cortos, tablas fuera del búfer— devuelve null: el ajuste avisa y
 * estima, no falla.
 */
export function fontAdvanceMetrics(bytes: Uint8Array): FontAdvance | null {
  const b = bytes;
  if (!b || b.length < 12) return null;
  const u16 = (o: number) => (b[o] << 8) | b[o + 1];
  const u32 = (o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  const tag = (o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
  const sig = tag(0);
  if (!(sig === '\u0000\u0001\u0000\u0000' || sig === 'OTTO' || sig === 'true')) return null;
  const tables: Record<string, { off: number; len: number }> = {};
  for (let k = 0, n = u16(4); k < n; k++) {
    const o = 12 + k * 16;
    if (o + 16 > b.length) break;
    tables[tag(o)] = { off: u32(o + 8), len: u32(o + 12) };
  }
  const { head, hhea, hmtx, cmap } = tables;
  if (!head || !hhea || !hmtx || !cmap) return null;
  if ([head, hhea, hmtx, cmap].some((t) => t.off + t.len > b.length) || head.len < 20 || hhea.len < 36) return null;
  const upem = u16(head.off + 18);
  const nH = u16(hhea.off + 34);
  if (!upem || !nH || hmtx.len < nH * 4) return null;
  const adv = (g: number) => u16(hmtx.off + 4 * Math.min(g, nH - 1)) / upem;

  // Subtabla de cmap: Unicode completo (formato 12) antes que BMP (formato 4).
  let sub = -1;
  let rank = 0;
  for (let k = 0, n = u16(cmap.off + 2); k < n; k++) {
    const r = cmap.off + 4 + k * 8;
    if (r + 8 > b.length) break;
    const pid = u16(r);
    const eid = u16(r + 2);
    const at = cmap.off + u32(r + 4);
    if (at + 4 > b.length) continue;
    const fmt = u16(at);
    const unicode = pid === 0 || (pid === 3 && (eid === 1 || eid === 10));
    const rk = !unicode ? 0 : fmt === 12 ? 2 : fmt === 4 ? 1 : 0;
    if (rk > rank) { rank = rk; sub = at; }
  }
  if (sub < 0) return null;

  const advances = new Map<number, number>();
  const LIMIT = 200_000;
  if (u16(sub) === 4) {
    const segX2 = u16(sub + 6);
    const ends = sub + 14;
    const starts = ends + segX2 + 2;
    const deltas = starts + segX2;
    const ros = deltas + segX2;
    if (ros + segX2 > b.length) return null;
    for (let s = 0; s < segX2 / 2 && advances.size < LIMIT; s++) {
      const end = u16(ends + 2 * s);
      const start = u16(starts + 2 * s);
      const delta = u16(deltas + 2 * s);
      const ro = u16(ros + 2 * s);
      for (let c = start; c <= end && c !== 0xffff; c++) {
        let g: number;
        if (ro === 0) g = (c + delta) & 0xffff;
        else {
          const a = ros + 2 * s + ro + 2 * (c - start);
          if (a + 2 > b.length) continue;
          g = u16(a);
          if (g) g = (g + delta) & 0xffff;
        }
        if (g) advances.set(c, adv(g));
      }
    }
  } else {
    const groups = u32(sub + 12);
    for (let k = 0; k < groups && advances.size < LIMIT; k++) {
      const o = sub + 16 + k * 12;
      if (o + 12 > b.length) break;
      const s = u32(o);
      const e = Math.min(u32(o + 4), s + LIMIT);
      const g0 = u32(o + 8);
      for (let c = s; c <= e; c++) advances.set(c, adv(g0 + c - s));
    }
  }
  let sum = 0;
  let cnt = 0;
  for (let c = 0x20; c <= 0x7e; c++) {
    const a = advances.get(c);
    if (a != null) { sum += a; cnt++; }
  }
  if (!cnt) return null;
  return { advances, avgEm: sum / cnt };
}

/** Clave de una fuente en el mapa de métricas: la misma familia, peso y estilo que pide el cromo. */
export function fitFontKey(f: { family: string; weight: number; italic: boolean }): string {
  return `${f.family}|${f.weight}|${f.italic ? 'italic' : 'normal'}`;
}

type CarouselChrome = Extract<ReturnType<typeof resolveCarouselChrome>, { applied: true }>;
type FitMetrics = Record<string, FontAdvance | null | undefined>;

/**
 * Altura que ocupan la cabecera, el bloque central y el pie de una lámina, con las MISMAS medidas
 * que `buildCarouselScene` (si una cambia allí, cambia aquí: el smoke compara esta estimación con la
 * caja que satori dibuja). PURO. `estimated` = alguna fuente no tenía métricas y se usó el ancho medio
 * genérico.
 */
/** Ancho (px) de un texto de la lámina en una familia, a un tamaño, con su tracking y su transformación. Sin métricas de
 *  la familia, el ancho medio genérico, y se anota en `estimated`. PURO (salvo `estimated`, que es suyo). */
export function carouselWidthFn(metrics: FitMetrics | null | undefined, estimated: string[]) {
  return (k: CarouselType, size: number, letterSpacing: number, transform: string) => {
    const m = metrics?.[fitFontKey(k)] ?? null;
    if (!m && !estimated.includes(k.family)) estimated.push(k.family);
    return (s: string) => {
      const str = transform === 'uppercase' ? s.toUpperCase() : transform === 'lowercase' ? s.toLowerCase() : s;
      let w = 0;
      for (const ch of str) {
        const cp = ch.codePointAt(0)!;
        const em = m ? (m.advances.get(cp) ?? (cp === 0xa0 ? m.advances.get(0x20) : undefined) ?? m.avgEm) : FIT_FALLBACK_EM;
        w += em * size + letterSpacing;
      }
      return w;
    };
  };
}

/**
 * 1.13.0 — LA PALABRA SOLA, EN LA LÁMINA. PURO. El titular de la lámina se envuelve solo (átomos en una fila que se
 * parte); si su corte voraz —medido como `measureCarouselLayout`, al ancho de su columna— deja UNA palabra en la última
 * línea y la anterior tiene `ORPHAN_MIN_PREV_WORDS` o más, la última de la anterior abre línea a la fuerza
 * (`chrome.headlineBreaks`). Mismo número de líneas, misma caja. Sin palabra sola, o sin métricas, EL MISMO ajuste.
 */
export function carouselAvoidOrphan<F extends { chrome: CarouselChrome; warnings: string[] }>(fit: F, metrics: FitMetrics | null | undefined): F {
  const chrome = fit.chrome;
  if (!chrome.headline.length) return fit;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const W = chrome.canvas.width;
  const M = r2((chrome.marginPct / 100) * W);
  const blockW = carouselBlockWidth(chrome, r2(W - 2 * M));
  const T = chrome.type;
  const estimated: string[] = [];
  const wf = carouselWidthFn(metrics, estimated);
  const hs = r2((T.headline.sizePct / 100) * W);
  const wOf = wf(T.headline, hs, r2(T.headline.letterSpacingEm * hs), T.headline.transform);
  const HE = chrome.headlineEmphasis;
  const es = HE ? r2(hs * HE.sizeScale) : hs;
  const eOf = HE ? wf(HE, es, r2(HE.letterSpacingEm * es), HE.transform) : wOf;
  const atoms = headlineAtoms(chrome.headline);
  const widths = atoms.map((atom) => Math.ceil(atom.reduce((acc, p) => acc + (HE && p.keyword ? eOf(p.text) : wOf(p.text)), 0)));
  if (estimated.length) return fit;
  const r = orphanFreeLines(widths, blockW, true);
  if (r.moved == null) return fit;
  const lone = atoms[atoms.length - 1].map((p) => p.text).join('').trim();
  const moved = atoms[r.moved].map((p) => p.text).join('').trim();
  return { ...fit, chrome: { ...chrome, headlineBreaks: [r.moved] },
    warnings: [...fit.warnings, `CAROUSEL_ORPHAN_AVOIDED: «${lone}» no queda sola en su línea del titular; baja «${moved}» a acompañarla`] };
}

export function measureCarouselLayout(chrome: CarouselChrome, metrics: FitMetrics | null | undefined): {
  top: number; mid: number; foot: number; available: number; gap: number; slack: number; estimated: string[];
  // 1.11.0 — ancho de la línea más larga del bloque central (px), y el ancho del que dispone (la columna, si la hay).
  midWidth: number; blockWidth: number;
  // 1.11.0 — alguna palabra del bloque central es más ancha que su columna: no cabe sin partirse ni salirse.
  wordOverflow: boolean;
} {
  const W = chrome.canvas.width;
  const H = chrome.canvas.height;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const px = (pct: number) => r2((pct / 100) * W);
  const T = chrome.type;
  const L = px(T.label.sizePct);
  const B = px(T.body.sizePct);
  const M = px(chrome.marginPct);
  const inner = r2(W - 2 * M);
  // 1.11.0 — el bloque central se mide al ancho de SU columna; sin `block`, el de siempre.
  const blockW = carouselBlockWidth(chrome, inner);
  const slide = chrome.slide;
  const estimated: string[] = [];
  let midW = 0;
  let wide = false;

  // Ancho de un texto en una familia, a un tamaño, con su tracking y su transformación.
  const widthFn = carouselWidthFn(metrics, estimated);
  // Líneas de un texto partido en palabras, a lo ancho disponible (corte voraz, como el de satori).
  // 1.11.0 — devuelve también el ancho de la línea más larga (para la caja del bloque).
  const linesW = (s: string, widthOf: (s: string) => number, maxW: number) => {
    const words = String(s ?? '').split(/\s+/).filter(Boolean);
    if (!words.length) return { n: 0, w: 0, over: false };
    const space = widthOf(' ');
    let n = 1;
    let cur = -1;
    let wMax = 0;
    let over = false;
    for (const w of words) {
      const ww = widthOf(w);
      if (ww > maxW + 0.5) over = true;
      if (cur < 0) cur = ww;
      else if (cur + space + ww <= maxW + 0.01) cur += space + ww;
      else { n++; wMax = Math.max(wMax, cur); cur = ww; }
    }
    return { n, w: Math.min(maxW, Math.max(wMax, cur)), over };
  };
  const textHW = (k: CarouselType, size: number, s: string, maxW: number, letterSpacing = r2(k.letterSpacingEm * size), transform = k.transform, lh = k.lineHeight) => {
    const r = linesW(s, widthFn(k, size, letterSpacing, transform), maxW);
    return { h: r.n * size * lh, w: r.w, over: r.over };
  };
  const textH = (k: CarouselType, size: number, s: string, maxW: number, letterSpacing = r2(k.letterSpacingEm * size), transform = k.transform, lh = k.lineHeight) =>
    textHW(k, size, s, maxW, letterSpacing, transform, lh).h;
  const seen = (w: number, over = false) => { midW = Math.max(midW, w); if (over) wide = true; };

  // ── cabecera ──
  const counterW = widthFn(T.label, L, r2(T.label.letterSpacingEm * L), 'none')(`${slide.index} / ${slide.total}`);
  const top = Math.max(2, r2(L * 0.21)) + r2(L * 0.95) +
    Math.max(L * T.label.lineHeight, slide.eyebrow ? textH(T.label, L, slide.eyebrow, inner - counterW) : 0);

  // ── centro ──
  let mid = 0;
  let any = false;
  if (chrome.headline.length) {
    const hs = px(T.headline.sizePct);
    const wOf = widthFn(T.headline, hs, r2(T.headline.letterSpacingEm * hs), T.headline.transform);
    const HE = chrome.headlineEmphasis;
    if (!HE) {
      let n = 1;
      let cur = 0;
      for (const atom of headlineAtoms(chrome.headline)) {
        const aw = Math.ceil(atom.reduce((s, p) => s + wOf(p.text), 0));
        if (aw > blockW + 0.5) wide = true;
        if (cur > 0 && cur + aw > blockW + 0.01) { n++; seen(cur); cur = aw; } else cur += aw;
      }
      seen(Math.min(cur, blockW));
      mid += n * hs * T.headline.lineHeight;
    } else {
      // 1.4.0 — con énfasis, cada tramo se mide con SU fuente y SU tamaño, y cada línea es tan alta
      // como su letra más grande.
      const es = r2(hs * HE.sizeScale);
      const eOf = widthFn(HE, es, r2(HE.letterSpacingEm * es), HE.transform);
      let cur = 0;
      let lineMax = 0;
      let total = 0;
      for (const atom of headlineAtoms(chrome.headline)) {
        const aw = Math.ceil(atom.reduce((s, p) => s + (p.keyword ? eOf(p.text) : wOf(p.text)), 0));
        const ah = Math.max(...atom.map((p) => (p.keyword ? es : hs)));
        if (aw > blockW + 0.5) wide = true;
        if (cur > 0 && cur + aw > blockW + 0.01) { total += lineMax; seen(cur); cur = aw; lineMax = ah; }
        else { cur += aw; lineMax = Math.max(lineMax, ah); }
      }
      seen(Math.min(cur, blockW));
      mid += (total + lineMax) * T.headline.lineHeight;
    }
    any = true;
  }
  if (slide.figure) {
    const fs = px(T.figure.sizePct);
    const fv = textHW(T.figure, fs, slide.figure.value, blockW);
    mid += (any ? r2(B * 0.8) : 0) + fv.h;
    seen(fv.w, fv.over);
    any = true;
    if (slide.figure.bar) { mid += r2(L * 1.26) + Math.max(2, r2(L * 0.53)); seen(blockW); }
    if (chrome.subheadline) { const sb = textHW(T.body, B, chrome.subheadline, blockW); mid += r2(B * 0.69) + sb.h; seen(sb.w, sb.over); }
    const dot = r2(L * 0.63);
    const ls = r2(L * 1.1);
    const src = textHW(T.label, ls, slide.figure.source, blockW - dot - r2(L * 0.74), r2(T.label.letterSpacingEm * 0.4 * ls), 'none');
    mid += r2(B * 0.69) + Math.max(dot, src.h);
    seen(dot + r2(L * 0.74) + src.w, src.over);
  } else if (chrome.subheadline) {
    const sb = textHW(T.body, B, chrome.subheadline, blockW);
    mid += (any ? r2(B * 0.69) : 0) + sb.h;
    seen(sb.w, sb.over);
    any = true;
  }
  if (slide.steps.length) {
    const ss = r2(B * 0.86);
    const mark = r2(B * 0.55);
    mid += any ? r2(B * 0.83) : 0;
    slide.steps.forEach((s, k) => {
      const st = textHW(T.body, ss, s.text, blockW - mark - r2(B * 0.62), undefined, undefined, 1.35);
      mid += (k > 0 ? r2(B * 0.48) : 0) + Math.max(mark, st.h);
      seen(mark + r2(B * 0.62) + st.w, st.over);
    });
    any = true;
  }
  if (slide.cta && slide.role === 'closing') {
    const cs = r2(L * 1.16);
    const arrowW = r2(cs * 0.62) + r2(cs * 0.45);
    const ct = textHW(T.label, cs, slide.cta, blockW - arrowW, r2(T.label.letterSpacingEm * 0.75 * cs));
    mid += (any ? r2(B * 0.97) : 0) +
      Math.max(r2(cs * 0.84), ct.h) +
      r2(cs * 0.45) + Math.max(1, r2(cs * 0.09));
    seen(ct.w + arrowW, ct.over);
  }

  // ── pie ──
  let logoH = 0;
  if (chrome.logo?.kind === 'image') logoH = px(chrome.logo.heightPct);
  else if (chrome.logo?.kind === 'wordmark') {
    const S = px(chrome.logo.sizePct);
    logoH = Math.max(0, ...chrome.logo.parts.map((p) => r2(S * p.scale)));
  }
  const swipeH = slide.role === 'cover' ? Math.max(L * T.label.lineHeight, r2(L * 0.62)) : 0;
  const foot = Math.max(logoH, swipeH);

  const available = H - 2 * M - top - foot;
  const gap = r2(L * FIT_MIN_GAP_LABELS);
  const r = (n: number) => Math.round(n * 100) / 100;
  return { top: r(top), mid: r(mid), foot: r(foot), available: r(available), gap, slack: r(available - mid - 2 * gap), estimated,
    midWidth: r(Math.min(midW, blockW)), blockWidth: r(blockW), wordOverflow: wide };
}

/**
 * El ajuste vertical: devuelve el cromo con el que la lámina CABE entre la cabecera y el pie, y los
 * avisos de lo que hubo que reducir. PURO y determinista. Si la lámina ya cabe devuelve EL MISMO
 * objeto `chrome`, sin tocar: la escena sale idéntica. Sin `metrics` (o con una fuente sin métricas)
 * estima con un ancho medio genérico y lo avisa.
 */
export function fitCarouselContent(args: { chrome: CarouselChrome; metrics?: FitMetrics | null }): {
  chrome: CarouselChrome; warnings: string[];
  report: { adjusted: boolean; slack_px: number; figure_scale: number; headline_size_pct: number | null;
    body_scale: number; steps_dropped: number; overflow: boolean; estimated_fonts: string[] };
} {
  const base = args.chrome;
  const first = measureCarouselLayout(base, args.metrics);
  const headlineFrom = base.headline.length ? base.type.headline.sizePct : null;
  const untouched = {
    chrome: base, warnings: [] as string[],
    report: { adjusted: false, slack_px: first.slack, figure_scale: 1, headline_size_pct: headlineFrom, body_scale: 1, steps_dropped: 0, overflow: false, estimated_fonts: first.estimated },
  };
  if (first.estimated.length) {
    untouched.warnings.push(`CAROUSEL_FIT_ESTIMATED: sin métricas de ${first.estimated.join(', ')}; el ajuste usó un ancho medio genérico`);
  }
  if (first.slack >= 0) return untouched;

  // Escalera de estados, en el orden fijado: cifra → titular → cuerpo y pasos → pasos omitidos.
  type State = { figure: number; headline: number; body: number; drop: number };
  const ladder: State[] = [];
  let st: State = { figure: 1, headline: base.type.headline.sizePct, body: 1, drop: 0 };
  if (base.slide.figure) for (const f of FIT_FIGURE_SCALES.slice(1)) ladder.push(st = { ...st, figure: f });
  if (base.headline.length) for (const h of base.fitLadder.headline) ladder.push(st = { ...st, headline: h });
  if (base.subheadline || base.slide.steps.length) for (const b of FIT_BODY_SCALES) ladder.push(st = { ...st, body: b });
  const droppable = base.slide.steps.filter((s) => !s.critical).length;
  for (let d = 1; d <= droppable; d++) ladder.push(st = { ...st, drop: d });

  const apply = (s: State): CarouselChrome => {
    // Se omiten los pasos NO críticos empezando por el último; el orden de los que quedan no cambia.
    let toDrop = s.drop;
    const keep = [...base.slide.steps].reverse().filter((p) => {
      if (toDrop > 0 && !p.critical) { toDrop--; return false; }
      return true;
    }).reverse();
    return {
      ...base,
      slide: { ...base.slide, steps: keep },
      type: {
        ...base.type,
        figure: { ...base.type.figure, sizePct: Math.round(base.type.figure.sizePct * s.figure * 1000) / 1000 },
        headline: { ...base.type.headline, sizePct: s.headline },
        body: { ...base.type.body, sizePct: Math.round(base.type.body.sizePct * s.body * 1000) / 1000 },
      },
      fitGuard: true,
    };
  };

  let chosen: State | null = null;
  let fitted: CarouselChrome = base;
  let m = first;
  for (const s of ladder) {
    fitted = apply(s);
    m = measureCarouselLayout(fitted, args.metrics);
    if (m.slack >= 0) { chosen = s; break; }
  }
  const final = chosen ?? ladder[ladder.length - 1] ?? { figure: 1, headline: base.type.headline.sizePct, body: 1, drop: 0 };
  if (!chosen) { fitted = apply(final); m = measureCarouselLayout(fitted, args.metrics); }

  const warnings: string[] = [];
  const what: string[] = [];
  if (final.figure !== 1) what.push(`cifra ×${final.figure}`);
  if (headlineFrom != null && final.headline !== headlineFrom) what.push(`titular ${headlineFrom}→${final.headline} %`);
  if (final.body !== 1) what.push(`cuerpo y pasos ×${final.body}`);
  if (what.length) {
    warnings.push(`CAROUSEL_CONTENT_FIT_REDUCED: el bloque central no cabía entre la cabecera y el pie (faltaban ${Math.ceil(-first.slack)} px); ${what.join(' · ')}`);
  }
  if (final.drop > 0) {
    warnings.push(`CAROUSEL_STEPS_TRUNCATED: se omitieron ${final.drop} de ${base.slide.steps.length} pasos desde el final para que la lámina quepa; el paso crítico se conserva`);
  }
  if (!chosen) {
    warnings.push(`CAROUSEL_CONTENT_OVERFLOW: ni con el mínimo legible cabe (faltan ${Math.ceil(-m.slack)} px); el pie queda en su sitio y el bloque central se recorta`);
  }
  return {
    chrome: fitted, warnings: [...warnings, ...untouched.warnings],
    report: { adjusted: true, slack_px: m.slack, figure_scale: final.figure, headline_size_pct: headlineFrom == null ? null : final.headline,
      body_scale: final.body, steps_dropped: final.drop, overflow: !chosen, estimated_fonts: first.estimated },
  };
}
/**
 * 1.5.0 — el área que ocupa el titular (y la bajada, si la lámina la lleva) de una lámina, con las mismas
 * medidas que `measureCarouselLayout`. PURO. Caja de líneas: un poco mayor que la de los glifos.
 */
export function carouselTextArea(chrome: CarouselChrome, metrics: FitMetrics | null | undefined): { areaPct: number; estimated: string[] } {
  const W = chrome.canvas.width;
  const H = chrome.canvas.height;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const T = chrome.type;
  const inner = r2(W - 2 * r2((chrome.marginPct / 100) * W));
  const estimated: string[] = [];
  const widthFn = (k: { family: string; weight: number; italic: boolean; transform: string; letterSpacingEm: number }, size: number) => {
    const m = metrics?.[fitFontKey(k)] ?? null;
    if (!m && !estimated.includes(k.family)) estimated.push(k.family);
    const ls = r2(k.letterSpacingEm * size);
    return (s: string) => {
      const str = k.transform === 'uppercase' ? s.toUpperCase() : k.transform === 'lowercase' ? s.toLowerCase() : s;
      let w = 0;
      for (const ch of str) {
        const cp = ch.codePointAt(0)!;
        w += (m ? (m.advances.get(cp) ?? (cp === 0xa0 ? m.advances.get(0x20) : undefined) ?? m.avgEm) : FIT_FALLBACK_EM) * size + ls;
      }
      return w;
    };
  };
  let maxW = 0;
  let total = 0;
  if (chrome.headline.length) {
    const hs = r2((T.headline.sizePct / 100) * W);
    const HE = chrome.headlineEmphasis;
    const es = HE ? r2(hs * HE.sizeScale) : hs;
    const wOf = widthFn(T.headline, hs);
    const eOf = HE ? widthFn(HE, es) : wOf;
    let cur = 0, lineMax = 0, h = 0;
    for (const atom of headlineAtoms(chrome.headline)) {
      const aw = Math.ceil(atom.reduce((acc, p) => acc + (p.keyword && HE ? eOf(p.text) : wOf(p.text)), 0));
      const ah = Math.max(...atom.map((p) => (p.keyword && HE ? es : hs)));
      if (cur > 0 && cur + aw > inner + 0.01) { h += lineMax; maxW = Math.max(maxW, cur); cur = aw; lineMax = ah; }
      else { cur += aw; lineMax = Math.max(lineMax, ah); }
    }
    maxW = Math.max(maxW, Math.min(cur, inner));
    total += (h + lineMax) * T.headline.lineHeight;
  }
  if (chrome.subheadline) {
    const B = r2((T.body.sizePct / 100) * W);
    const bOf = widthFn(T.body, B);
    let cur = 0, n = chrome.subheadline.split(/\s+/).filter(Boolean).length ? 1 : 0;
    for (const word of chrome.subheadline.split(/\s+/).filter(Boolean)) {
      const ww = bOf(word);
      if (cur > 0 && cur + bOf(' ') + ww > inner + 0.01) { n++; maxW = Math.max(maxW, cur); cur = ww; } else cur = cur > 0 ? cur + bOf(' ') + ww : ww;
    }
    maxW = Math.max(maxW, Math.min(cur, inner));
    total += r2(B * 0.69) + n * B * T.body.lineHeight;
  }
  return { areaPct: Math.round((10000 * Math.min(maxW, inner) * total) / (W * H)) / 100, estimated };
}

/**
 * 1.5.0 — el límite de área en la PORTADA del carrusel. PURO. Si la lámina no es portada, la marca no
 * declara límite o ya cabe, devuelve EL MISMO cromo. Si no cabe, baja el titular por sus escalones; si ni
 * al mínimo cabe, lo dice. No toca el texto.
 */
export function fitCarouselCoverArea(args: { chrome: CarouselChrome; metrics?: FitMetrics | null }): {
  chrome: CarouselChrome; warnings: string[]; report: null | { limit_pct: number; area_pct_before: number; area_pct: number; exceeded: boolean };
} {
  const c = args.chrome;
  const limit = c.maxTextAreaPct;
  if (limit == null || c.slide.role !== 'cover' || !c.headline.length) return { chrome: c, warnings: [], report: null };
  const first = carouselTextArea(c, args.metrics);
  if (first.areaPct <= limit) return { chrome: c, warnings: [], report: { limit_pct: limit, area_pct_before: first.areaPct, area_pct: first.areaPct, exceeded: false } };
  let out = c;
  let m = first;
  for (const h of c.fitLadder.headline) {
    out = { ...c, type: { ...c.type, headline: { ...c.type.headline, sizePct: h } },
      fitLadder: { headline: c.fitLadder.headline.filter((x) => x < h) } };
    m = carouselTextArea(out, args.metrics);
    if (m.areaPct <= limit) break;
  }
  const warnings: string[] = [];
  if (out.type.headline.sizePct !== c.type.headline.sizePct) {
    warnings.push(`CAROUSEL_TEXT_AREA_REDUCED: la portada ocupaba ${first.areaPct} % (límite ${limit} %); titular ${c.type.headline.sizePct}→${out.type.headline.sizePct} % → ${m.areaPct} %`);
  }
  if (m.areaPct > limit) warnings.push(`CAROUSEL_TEXT_AREA_EXCEEDED: ni al tamaño mínimo cabe en ${limit} % (queda en ${m.areaPct} %); se compone igual`);
  return { chrome: out, warnings, report: { limit_pct: limit, area_pct_before: first.areaPct, area_pct: m.areaPct, exceeded: m.areaPct > limit } };
}
// ── 1.6.0 · EL TEXTO NO TAPA UNA CARA ──────────────────────────────────────────────────────────────
// EJE (código): QUÉ se evita —la caja del bloque de texto no toca la caja de una cara, con un margen— y CÓMO se
// elige —la primera ancla candidata libre; si ninguna, la de menor solape—. INSTANCIA (dato): si se aplica, en
// qué anclas se prueba y con qué margen (`layout.avoid_faces`). Las cajas de las caras las mide un modelo de
// visión fuera de este bloque; aquí entran como dato (0..1 sobre el ancho y el alto).
export interface FaceBox { x0: number; y0: number; x1: number; y1: number }

/** Candidatas por defecto: la declarada y luego las otras dos filas de SU MISMA columna (la marca eligió un lado
 *  de la imagen; se respeta). Abajo ⇒ arriba, medio. Arriba ⇒ abajo, medio. Medio ⇒ arriba, abajo. PURO. */
export function faceAnchorCandidates(anchor: string): string[] {
  const a = ANCHORS[anchor];
  if (!a) return [];
  const col = Object.entries(ANCHORS).filter(([, v]) => v.x === a.x).map(([k, v]) => ({ k, y: v.y }));
  const order = a.y === 'flex-end' ? ['flex-start', 'center'] : a.y === 'flex-start' ? ['flex-end', 'center'] : ['flex-start', 'flex-end'];
  return [anchor, ...order.map((y) => col.find((c) => c.y === y)?.k).filter((k): k is string => !!k)];
}

/** La caja (px) del bloque de texto con un ancla dada: las mismas medidas que `measureOverlayText` y los mismos
 *  rellenos que `overlayTextBox`, colocada como la coloca el flex de `buildOverlayScene`. PURO. */
export function overlayTextRect(style: ReturnType<typeof resolveOverlayStyle>, width: number, height: number,
  metrics: Record<string, FontAdvance | null | undefined> | null | undefined, anchor: string,
): { x0: number; y0: number; x1: number; y1: number } {
  const a = ANCHORS[anchor];
  const box = overlayTextBox(style, width, height);
  const m = measureOverlayText(style, width, height, metrics);
  const innerW = width - box.left - box.right;
  const innerH = height - box.top - box.bottom;
  const x0 = a.x === 'flex-start' ? box.left : a.x === 'center' ? box.left + (innerW - m.width) / 2 : width - box.right - m.width;
  const y0 = a.y === 'flex-start' ? box.top : a.y === 'center' ? box.top + (innerH - m.height) / 2 : height - box.bottom - m.height;
  return { x0, y0, x1: x0 + m.width, y1: y0 + m.height };
}

/** Las cajas de caras que devuelve el modelo (`{ faces: [{ box_2d: [ymin, xmin, ymax, xmax] }] }`, 0..1000) a
 *  0..1. Lo que no tiene forma de caja se descarta; nunca se inventa una. PURO. */
export function parseFaceBoxes(text: string, key: 'faces' | 'signs' | 'products' | 'people' = 'faces'): FaceBox[] {
  let data: any;
  try { data = JSON.parse(text); } catch { return []; }
  const list = Array.isArray(data?.[key]) ? data[key] : (key === 'faces' && Array.isArray(data)) ? data : [];
  const out: FaceBox[] = [];
  for (const f of list) {
    const b = Array.isArray(f?.box_2d) ? f.box_2d.map(Number) : null;
    if (!b || b.length !== 4 || b.some((v: number) => !Number.isFinite(v))) continue;
    const c = (v: number) => Math.min(1, Math.max(0, v / 1000));
    const [y0, x0, y1, x1] = [c(b[0]), c(b[1]), c(b[2]), c(b[3])];
    if (x1 > x0 && y1 > y0) out.push({ x0, y0, x1, y1 });
  }
  return out;
}

/** Los escalones para que el bloque quepa en un hueco: el titular baja por sus `fit_steps` más chicos, luego la
 *  bajada por los suyos, y por último la bajada se quita — el mismo orden que el límite de área de 1.5.0. El
 *  texto nunca se recorta ni se reescribe. PURO. */
function faceFitLadder(base: ReturnType<typeof resolveOverlayStyle>): Array<{ style: ReturnType<typeof resolveOverlayStyle>; what: string[] }> {
  const hl = base.slots.headline;
  const sub = base.slots.subheadline;
  if (!hl) return [];
  type St = { h: number; s: number | null; drop: boolean };
  const out: Array<{ style: ReturnType<typeof resolveOverlayStyle>; what: string[] }> = [];
  let st: St = { h: hl.sizePct, s: sub ? sub.sizePct : null, drop: false };
  const push = (x: St) => {
    const what: string[] = [];
    if (x.h !== hl.sizePct) what.push(`titular ${hl.sizePct}→${x.h} %`);
    if (sub && !x.drop && x.s != null && x.s !== sub.sizePct) what.push(`bajada ${sub.sizePct}→${x.s} %`);
    if (x.drop) what.push('sin bajada');
    out.push({ what, style: { ...base, slots: {
      headline: { ...hl, sizePct: x.h },
      subheadline: !sub || x.drop ? null : { ...sub, sizePct: x.s ?? sub.sizePct },
    } } });
  };
  for (const h of (hl.fitSmaller ?? []).filter((v) => v < hl.sizePct)) push(st = { ...st, h });
  if (sub) for (const v of (sub.fitSmaller ?? []).filter((v) => v < sub.sizePct)) push(st = { ...st, s: v });
  if (sub) push(st = { ...st, drop: true });
  return out;
}

/** Elige el ancla del bloque de texto que no tapa ninguna cara. Sin `avoidFaces` o sin titular devuelve EL MISMO
 *  estilo. Orden: (1) la primera candidata libre al tamaño de siempre; (2) si ninguna, la que queda libre con el
 *  MENOR ajuste (escalones de `faceFitLadder`); (3) si ni así, la de menor solape al tamaño de siempre, y se dice.
 *  El ancla de la capa de producto (si se pega) no es candidata: las dos capas se taparían. PURO. */
export function chooseOverlayAnchor(args: {
  style: ReturnType<typeof resolveOverlayStyle>; width: number; height: number;
  metrics?: Record<string, FontAdvance | null | undefined> | null; faces: FaceBox[]; productAnchor?: string | null;
  // 1.6.3 — letreros de la escena (0..1). Sólo cuentan con `layout.avoidSceneText`; nunca deciden el tamaño.
  signs?: FaceBox[] | null;
  // 1.11.0 — productos de la escena (0..1). Sólo cuentan con `layout.avoidProducts`, y cuentan como una cara.
  products?: FaceBox[] | null;
  // 1.12.0 — la fila que pidió una persona (ya aplicada con `applyTextPlace`): si tapa algo, se compone igual y se dice.
  textPlace?: TextPlace | null;
  // 1.13.0 — figuras humanas completas (0..1). Sólo cuentan con `layout.avoidPeople`, y cuentan como una cara.
  people?: FaceBox[] | null;
}): { style: ReturnType<typeof resolveOverlayStyle>; report: null | {
  faces: number; anchor_declared: string; anchor_used: string; moved: boolean; overlap_pct: number;
  candidates: Array<{ anchor: string; overlap_pct: number }>; reduced: string[];
  // 1.6.3 — sólo con letreros detectados y el token encendido.
  signs?: number; sign_overlap_pct?: number; signs_under_text?: FaceBox[];
  // 1.11.0 — sólo con el token encendido.
  products?: number;
  // 1.13.0 — sólo con `avoid_people` encendido: cuántas figuras, si el bloque se estrechó y el último recurso.
  people?: number; narrowed?: null | { max_width_pct_declared: number; max_width_pct_used: number };
  fallback?: null | 'band'; band?: { x0: number; y0: number; x1: number; y1: number };
} } {
  const { style, width, height } = args;
  const af = style.layout.avoidFaces;
  if (!af || !style.slots.headline) return { style, report: null };
  const declared = style.layout.anchor;
  const pad = (af.marginPct / 100) * Math.min(width, height);
  const boxes = args.faces.map((f) => ({ x0: f.x0 * width - pad, y0: f.y0 * height - pad, x1: f.x1 * width + pad, y1: f.y1 * height + pad }));
  // 1.11.0 — los productos se suman a las cajas que el texto no toca, con su propio margen. Sin el token, nada cambia.
  const ap = style.layout.avoidProducts ?? null;
  const prodList = ap ? (args.products ?? []) : [];
  if (ap) {
    const pp = (ap.marginPct / 100) * Math.min(width, height);
    for (const f of prodList) boxes.push({ x0: f.x0 * width - pp, y0: f.y0 * height - pp, x1: f.x1 * width + pp, y1: f.y1 * height + pp });
  }
  // 1.13.0 — las figuras humanas completas se suman a las cajas que el texto no toca, con su propio margen.
  const apl = style.layout.avoidPeople ?? null;
  const peopleList = apl ? (args.people ?? []) : [];
  const peopleBoxes: typeof boxes = [];
  if (apl) {
    const pp = (apl.marginPct / 100) * Math.min(width, height);
    for (const f of peopleList) peopleBoxes.push({ x0: f.x0 * width - pp, y0: f.y0 * height - pp, x1: f.x1 * width + pp, y1: f.y1 * height + pp });
    boxes.push(...peopleBoxes);
  }
  const tapa = apl ? (ap ? 'una cara, una persona o un producto' : 'una cara o una persona') : ap ? 'una cara o un producto' : 'una cara';
  const libre = apl ? (ap ? 'libre de caras, personas y productos' : 'libre de caras y personas') : ap ? 'libre de caras y productos' : 'libre de caras';
  const cands = af.anchors.filter((a) => ANCHORS[a] && a !== (args.productAnchor ?? null));
  const overlapOf = (r: { x0: number; y0: number; x1: number; y1: number }) => {
    const area = Math.max(1, (r.x1 - r.x0) * (r.y1 - r.y0));
    let inter = 0;
    for (const b of boxes) {
      const w = Math.min(r.x1, b.x1) - Math.max(r.x0, b.x0);
      const h = Math.min(r.y1, b.y1) - Math.max(r.y0, b.y0);
      if (w > 0 && h > 0) inter += w * h;
    }
    return Math.round((10000 * inter) / area) / 100;
  };
  const score = (st: ReturnType<typeof resolveOverlayStyle>) => cands.map((anchor) => ({
    anchor, overlap_pct: overlapOf(overlayTextRect(st, width, height, args.metrics, anchor)),
  }));
  const scored = score(style);
  if (!scored.length) return { style, report: null };
  // 1.13.0 — ESTRECHAR AL LADO LIBRE. Sólo con `avoid_people.min_width_pct` y figuras detectadas, y sólo en un ancla de
  // columna lateral: el bloque termina donde empieza la figura más cercana (con su margen), nunca por debajo del mínimo
  // declarado ni por encima del ancho de siempre. Un bloque estrechado que se sale de su caja (más alto que el hueco) o
  // que deja una palabra más ancha que la columna no cuenta como libre.
  const narrowed = (st: ReturnType<typeof resolveOverlayStyle>, anchor: string): ReturnType<typeof resolveOverlayStyle> | null => {
    if (!apl || apl.minWidthPct == null || !peopleBoxes.length) return null;
    const ax = ANCHORS[anchor]?.x;
    if (!ax || ax === 'center') return null;
    const box = overlayTextBox(st, width, height);
    const avail = ax === 'flex-start'
      ? Math.min(...peopleBoxes.filter((b) => b.x1 > box.left).map((b) => b.x0)) - box.left
      : (width - box.right) - Math.max(...peopleBoxes.filter((b) => b.x0 < width - box.right).map((b) => b.x1));
    if (!Number.isFinite(avail) || avail >= box.maxWidth - 0.5) return null;
    const pct = Math.floor((10000 * avail) / width) / 100;
    if (pct < apl.minWidthPct) return null;
    const ns = { ...st, layout: { ...st.layout, maxWidthPct: pct } };
    const nb = overlayTextBox(ns, width, height);
    const r = overlayTextRect(ns, width, height, args.metrics, anchor);
    if (r.y0 < nb.top - 0.5 || r.y1 > height - nb.bottom + 0.5) return null;
    if (overlayWordOverflow(ns, width, height, args.metrics)) return null;
    return ns;
  };
  const probarEstrecho = (st: ReturnType<typeof resolveOverlayStyle>) => {
    for (const anchor of cands) {
      const ns = narrowed(st, anchor);
      if (ns && overlapOf(overlayTextRect(ns, width, height, args.metrics, anchor)) === 0) return { c: { anchor, overlap_pct: 0 }, st: ns };
    }
    return null;
  };
  let base = style;
  let what: string[] = [];
  let narrowInfo: null | { max_width_pct_declared: number; max_width_pct_used: number } = null;
  let best = scored.find((c) => c.overlap_pct === 0) ?? null;
  // 1.13.0 — un bloque estrechado se alarga, y en una columna angosta es fácil que la última línea quede con UNA palabra
  // que no se puede acompañar («twelve» / «months.»). Se prefiere, en este orden: estrechado sin palabra sola al tamaño
  // de siempre; un escalón más chico (a todo el ancho libre, o estrechado sin palabra sola); y sólo después, el primer
  // estrechado aunque deje una palabra sola. Medido con `overlayLoneWords`; sin métricas cuenta 0 y nada cambia.
  let narrowWithLone: null | { n: { c: { anchor: string; overlap_pct: number }; st: ReturnType<typeof resolveOverlayStyle> }; what: string[] } = null;
  const tomarEstrecho = (n: { c: { anchor: string; overlap_pct: number }; st: ReturnType<typeof resolveOverlayStyle> }, w: string[]) => {
    best = n.c; base = n.st; what = w;
    narrowInfo = { max_width_pct_declared: style.layout.maxWidthPct, max_width_pct_used: n.st.layout.maxWidthPct };
  };
  if (!best && apl) {
    const n = probarEstrecho(style);
    if (n && overlayLoneWords(n.st, width, height, args.metrics) === 0) tomarEstrecho(n, []);
    else if (n) narrowWithLone = { n, what: [] };
  }
  if (!best) {
    // 1.6.1 — sin ancla libre al tamaño de siempre: el menor ajuste que la libera; si ninguno la libera, el MENOR
    // solape entre todas las combinaciones (ancla × escalón) y, a igual solape, el menor ajuste.
    let low = { c: scored.reduce((m, c) => (c.overlap_pct < m.overlap_pct ? c : m), scored[0]), st: style, what: [] as string[] };
    for (const step of faceFitLadder(style)) {
      const sc = score(step.style);
      const free = sc.find((c) => c.overlap_pct === 0);
      if (free) { best = free; base = step.style; what = step.what; break; }
      // 1.13.0 — en cada escalón, también el bloque estrechado al lado libre de la figura.
      const n = apl ? probarEstrecho(step.style) : null;
      if (n && overlayLoneWords(n.st, width, height, args.metrics) === 0) { tomarEstrecho(n, step.what); break; }
      if (n && !narrowWithLone) narrowWithLone = { n, what: step.what };
      const m = sc.reduce((a, c) => (c.overlap_pct < a.overlap_pct ? c : a), sc[0]);
      if (m && m.overlap_pct < low.c.overlap_pct) low = { c: m, st: step.style, what: step.what };
    }
    if (!best && narrowWithLone) tomarEstrecho(narrowWithLone.n, narrowWithLone.what);
    if (!best) { best = low.c; base = low.st; what = low.what; }
  }
  // 1.6.3 — LETREROS. Las caras ya decidieron el tamaño (`base`) y el solape mínimo de caras (`best`). Entre las
  // anclas de ese mismo tamaño que tapan lo mismo de caras, gana la que menos tapa un letrero; a igualdad, la que ya
  // ganó y luego el orden de las candidatas. Sin letreros o sin el token, nada de esto existe.
  const faceAnchor = best.anchor;
  const ast = style.layout.avoidSceneText;
  const signList = ast && args.signs && args.signs.length ? args.signs : null;
  let signOverlap = 0;
  let signsUnder: FaceBox[] = [];
  const signMarkers: string[] = [];
  if (signList) {
    const sp = (ast!.marginPct / 100) * Math.min(width, height);
    const sboxes = signList.map((f) => ({ x0: f.x0 * width - sp, y0: f.y0 * height - sp, x1: f.x1 * width + sp, y1: f.y1 * height + sp }));
    const overlapWith = (r: { x0: number; y0: number; x1: number; y1: number }, bs: typeof sboxes) => {
      const area = Math.max(1, (r.x1 - r.x0) * (r.y1 - r.y0));
      let inter = 0;
      for (const b of bs) {
        const w = Math.min(r.x1, b.x1) - Math.max(r.x0, b.x0);
        const h = Math.min(r.y1, b.y1) - Math.max(r.y0, b.y0);
        if (w > 0 && h > 0) inter += w * h;
      }
      return Math.round((10000 * inter) / area) / 100;
    };
    const atBase = score(base);
    const tied = atBase.filter((c) => c.overlap_pct <= best!.overlap_pct)
      .map((c) => ({ ...c, sign: overlapWith(overlayTextRect(base, width, height, args.metrics, c.anchor), sboxes) }));
    const current = tied.find((c) => c.anchor === best!.anchor);
    const minSign = Math.min(...tied.map((c) => c.sign));
    const pick = current && current.sign === minSign ? current : tied.find((c) => c.sign === minSign);
    if (pick) {
      if (pick.anchor !== best.anchor) {
        signMarkers.push(`OVERLAY_ANCHOR_MOVED_FOR_SIGN: en ${best.anchor} el texto tapaba un letrero (${current?.sign ?? '?'} % de su caja); se compone en ${pick.anchor}`);
        best = { anchor: pick.anchor, overlap_pct: pick.overlap_pct };
      }
      signOverlap = pick.sign;
      const r = overlayTextRect(base, width, height, args.metrics, pick.anchor);
      signsUnder = signList.filter((f, k) => overlapWith(r, [sboxes[k]]) > 0);
      if (signOverlap > 0) signMarkers.push(`OVERLAY_SIGN_OVERLAP: ninguna ancla libre de caras deja el texto lejos de los letreros; ${pick.anchor} tapa ${signOverlap} %`);
    }
  }

  const declaredScore = scored.find((c) => c.anchor === declared)?.overlap_pct ?? 0;
  const markers = [...style.markers];
  if (faceAnchor !== declared) {
    markers.push(`OVERLAY_ANCHOR_MOVED_FOR_FACE: en ${declared} el texto tapaba ${tapa} (${declaredScore} % de su caja); se compone en ${faceAnchor}`);
  }
  if (what.length) markers.push(`OVERLAY_TEXT_REDUCED_FOR_FACE: para que el texto quepa en ${best.anchor} ${best.overlap_pct > 0 ? 'tapando lo menos posible' : `sin tapar ${tapa}`}: ${what.join(' · ')}`);
  if (best.overlap_pct > 0) {
    markers.push(`OVERLAY_FACE_OVERLAP_UNAVOIDABLE: ninguna ancla candidata (${cands.join(', ')}) deja el texto ${libre} ni al tamaño mínimo; se usa ${best.anchor}, que tapa ${best.overlap_pct} %`);
  }
  markers.push(...signMarkers);
  const forcedRow = args.textPlace === 'top' || args.textPlace === 'bottom';
  if (forcedRow && best.overlap_pct > 0) {
    markers.push(`OVERLAY_TEXT_PLACE_COVERS: se pidió el texto ${TEXT_PLACE_LABEL[args.textPlace as 'top' | 'bottom']}; ninguna columna de esa fila lo deja ${libre}; se compone igual en ${best.anchor}, que tapa ${best.overlap_pct} %`);
  }
  if (narrowInfo) {
    markers.push(`OVERLAY_TEXT_NARROWED_FOR_PERSON: a todo el ancho el texto tapaba ${tapa}; en ${best.anchor} se estrecha al lado libre de la figura (ancho ${narrowInfo.max_width_pct_declared}→${narrowInfo.max_width_pct_used} %)`);
  }
  let out = best.anchor === declared && markers.length === style.markers.length ? style : {
    ...base,
    layout: { ...base.layout, anchor: best.anchor, align: af.keepAlign ? base.layout.align : ANCHORS[best.anchor].align },
    markers,
  };
  // 1.13.0 — ÚLTIMO RECURSO 'band': ninguna colocación libra la figura. Una banda del color y alfa que declara la marca,
  // sólo bajo el texto, con su relleno: la foto entera nunca se oscurece. Con una fila pedida, no (taparía lo pedido).
  let fallback: null | 'band' = null;
  let bandOut: { x0: number; y0: number; x1: number; y1: number } | undefined;
  if (apl?.band && best.overlap_pct > 0 && !forcedRow) {
    bandOut = overlayBandRect(out, width, height, args.metrics)!;
    fallback = 'band';
    out = { ...out, band: { ...bandOut, color: apl.band.color },
      markers: [...out.markers, `OVERLAY_BAND_FOR_PERSON: ninguna ancla (${cands.join(', ')}) deja el texto ${libre}, ni estrechado; en ${best.anchor} se pone una banda bajo el texto (sólo ahí; la foto no se oscurece)`] };
  }
  return { style: out, report: {
    faces: args.faces.length, anchor_declared: declared, anchor_used: best.anchor, moved: best.anchor !== declared,
    overlap_pct: best.overlap_pct, candidates: scored, reduced: what,
    ...(signList ? { signs: signList.length, sign_overlap_pct: signOverlap, signs_under_text: signsUnder } : {}),
    ...(ap ? { products: prodList.length } : {}),
    ...(apl ? { people: peopleList.length, narrowed: narrowInfo, fallback, ...(bandOut ? { band: bandOut } : {}) } : {}),
  } };
}

/** 1.13.0 — la caja (px) de la banda del último recurso: la del texto en su ancla, con el relleno que declara la marca,
 *  sin salir del lienzo. null si la marca no declara banda. PURO. */
export function overlayBandRect(style: ReturnType<typeof resolveOverlayStyle>, width: number, height: number,
  metrics: Record<string, FontAdvance | null | undefined> | null | undefined,
): { x0: number; y0: number; x1: number; y1: number } | null {
  const b = style.layout.avoidPeople?.band;
  if (!b || !style.slots.headline) return null;
  const r = overlayTextRect(style, width, height, metrics, style.layout.anchor);
  const pad = (b.padPct / 100) * Math.min(width, height);
  const rr = (n: number) => Math.round(n * 100) / 100;
  return { x0: rr(Math.max(0, r.x0 - pad)), y0: rr(Math.max(0, r.y0 - pad)), x1: rr(Math.min(width, r.x1 + pad)), y1: rr(Math.min(height, r.y1 + pad)) };
}

/** 1.13.0 — la banda sigue al texto: después de cambiar el corte (la palabra sola), la caja se vuelve a medir. Sin banda,
 *  EL MISMO estilo. PURO. */
export function refitOverlayBand(style: ReturnType<typeof resolveOverlayStyle>, width: number, height: number,
  metrics: Record<string, FontAdvance | null | undefined> | null | undefined,
): ReturnType<typeof resolveOverlayStyle> {
  if (!style.band) return style;
  const r = overlayBandRect(style, width, height, metrics);
  return r ? { ...style, band: { ...r, color: style.band.color } } : style;
}

// ── 1.12.0 · LA UBICACIÓN DEL TEXTO LA PIDE UNA PERSONA ──────────────────────────────────────────
// EJE (código): qué filas se pueden pedir —arriba, abajo, o la elección automática— y cómo se aplican a la geometría
// del overlay y de la lámina. INSTANCIA (dato): todo lo demás —el ancla declarada, su columna, la política de caras y
// productos, la zona segura del canal—, que sigue saliendo de los tokens de la marca. El código no nombra marcas.
export type TextPlace = 'top' | 'bottom' | 'auto';
export const TEXT_PLACES: readonly TextPlace[] = ['top', 'bottom', 'auto'];

/** 1.12.0 — `text_place`: 'top' | 'bottom' | 'auto'. Ausente = null (lo de siempre). Otro valor es 400. PURO. */
export function parseTextPlaceRequest(raw: unknown): TextPlace | null {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'string' && (TEXT_PLACES as readonly string[]).includes(raw)) return raw as TextPlace;
  throw new CompositorError('COMPOSITOR_TEXT_PLACE_INVALID', "text_place debe ser 'top', 'bottom' o 'auto' (o no venir)", 400);
}

/** 1.12.0 — las anclas de una fila, la columna dada primero y luego las otras por cercanía (centro ⇒ izquierda,
 *  derecha; un lado ⇒ centro, el otro lado). PURO. */
export function textPlaceRowAnchors(place: 'top' | 'bottom', declaredAnchor: string): string[] {
  const a = ANCHORS[declaredAnchor];
  if (!a) return [];
  const y = place === 'top' ? 'flex-start' : 'flex-end';
  const xs = a.x === 'center' ? ['center', 'flex-start', 'flex-end']
    : a.x === 'flex-start' ? ['flex-start', 'center', 'flex-end'] : ['flex-end', 'center', 'flex-start'];
  return xs.map((x) => Object.keys(ANCHORS).find((k) => ANCHORS[k].y === y && ANCHORS[k].x === x)!).filter(Boolean);
}

const TEXT_PLACE_LABEL: Record<'top' | 'bottom', string> = { top: 'arriba', bottom: 'abajo' };

/**
 * 1.12.0 — aplica al estilo del overlay la fila pedida. PURO. Sin `place`, o con 'auto', el estilo sale IGUAL (con
 * 'auto' y sin la política de caras, se dice que 'auto' es el ancla declarada). Con 'top'/'bottom':
 *   · el ancla pasa a la de esa fila en la columna declarada (si la capa de producto ocupa esa esquina, la siguiente
 *     columna de la fila, y se dice);
 *   · con `avoid_faces`, las candidatas pasan a ser las columnas de ESA fila: se sigue esquivando, sin salir de ella;
 *   · un velo en degradado que oscurece el borde contrario sigue al texto (`gradient_bottom` ⇄ `gradient_top`);
 *   · la alineación sigue a la columna, salvo que la marca la declare (`layout.align`).
 * La zona segura no se toca: la caja del texto se calcula siempre dentro de ella.
 */
export function applyTextPlace<S extends ReturnType<typeof resolveOverlayStyle>>(
  style: S, place: TextPlace | null, productAnchor: string | null = null,
): { style: S; applied: null | { requested: TextPlace; anchor_declared: string; anchor_forced: string | null; row_candidates: string[] } } {
  if (!place) return { style, applied: null };
  const declared = style.layout.anchor;
  if (place === 'auto') {
    const markers = style.layout.avoidFaces || !style.slots.headline ? style.markers
      : [...style.markers, `OVERLAY_TEXT_PLACE_AUTO_WITHOUT_POLICY: se pidió que el texto no tape cara ni producto, pero la marca no declara layout.avoid_faces; se compone en el ancla declarada (${declared})`];
    return { style: markers === style.markers ? style : { ...style, markers }, applied: { requested: 'auto', anchor_declared: declared, anchor_forced: null, row_candidates: [] } };
  }
  if (!style.slots.headline) return { style, applied: { requested: place, anchor_declared: declared, anchor_forced: null, row_candidates: [] } };
  const row = textPlaceRowAnchors(place, declared).filter((k) => k !== productAnchor);
  if (!row.length) return { style, applied: { requested: place, anchor_declared: declared, anchor_forced: null, row_candidates: [] } };
  const forced = row[0];
  const markers = [...style.markers];
  if (ANCHORS[forced].x !== ANCHORS[declared].x) {
    markers.push(`OVERLAY_TEXT_PLACE_COLUMN_MOVED: la capa de producto ocupa ${productAnchor}; el texto ${TEXT_PLACE_LABEL[place]} va en ${forced}`);
  }
  const alignDeclared = style.layout.align !== ANCHORS[declared].align || !!style.layout.avoidFaces?.keepAlign;
  const align = alignDeclared ? style.layout.align : ANCHORS[forced].align;
  let scrim = style.scrim;
  const flip = place === 'top' ? 'gradient_bottom' : 'gradient_top';
  if (scrim && scrim.mode === flip) {
    scrim = { ...scrim, mode: place === 'top' ? 'gradient_top' : 'gradient_bottom' };
    markers.push(`OVERLAY_SCRIM_FOLLOWS_TEXT: el velo ${flip} oscurecía el borde contrario al texto pedido ${TEXT_PLACE_LABEL[place]}; se compone ${scrim.mode}`);
  }
  const af = style.layout.avoidFaces;
  return {
    style: { ...style, scrim, markers,
      layout: { ...style.layout, anchor: forced, align, ...(af ? { avoidFaces: { ...af, anchors: row } } : {}) } },
    applied: { requested: place, anchor_declared: declared, anchor_forced: forced, row_candidates: af ? row : [forced] },
  };
}

/**
 * 1.6.3 — ¿Se lee el énfasis? PURO. Mide el contraste del color actual del énfasis contra el fondo con la MEDIANA
 * del área (no el peor 10 % de la sombra: para ELEGIR un color, el peor 10 % castiga a todos por igual —pelo
 * oscuro a uno, camisa clara a otro— y no separa; medido en c3762333: azul 2,34 vs marino 6,02 en mediana, 1,22 vs
 * 1,31 en el peor 10 %). Si la mediana no llega a `minContrast`, prueba los roles alternativos de la marca y se queda
 * con el que MÁS contrasta, sólo si contrasta más que el actual. Sin muestras no cambia nada.
 */
export function decideEmphasisColor(args: {
  currentColor: string; fallbacks: Array<{ role: string; hex: string }>; bgLuminances: number[]; minContrast: number;
  textColor?: string; minContrastVsText?: number;
}): { changed: boolean; role: string | null; hex: string | null; contrast_before: number | null; contrast_after: number | null;
  min_contrast: number; reason: string } {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const base = { min_contrast: args.minContrast };
  if (!args.bgLuminances.length) {
    return { changed: false, role: null, hex: null, contrast_before: null, contrast_after: null, ...base, reason: 'sin muestras del fondo: no se cambia el énfasis' };
  }
  const median = (color: string) => {
    const L = relLuminanceHex(color);
    const cs = args.bgLuminances.map((bgL) => contrastRatio(L, bgL)).sort((x, y) => x - y);
    const m = cs.length >> 1;
    return cs.length % 2 ? cs[m] : (cs[m - 1] + cs[m]) / 2;
  };
  const before = median(args.currentColor);
  if (before >= args.minContrast) {
    return { changed: false, role: null, hex: null, contrast_before: r2(before), contrast_after: r2(before), ...base,
      reason: `contraste ${r2(before)} ≥ ${args.minContrast}: el énfasis se lee con su color` };
  }
  // 1.6.4 — una alternativa que contrasta con el fondo pero se confunde con el resto del titular no resalta nada
  // (medido en 5b842958: la alternativa elegida quedó a 1,22:1 del color del titular). Con el token, sólo
  // compiten las que se separan del texto.
  const vsText = args.textColor && args.minContrastVsText != null ? args.minContrastVsText : null;
  const textL = vsText != null ? relLuminanceHex(args.textColor!) : null;
  const pool = textL == null ? args.fallbacks
    : args.fallbacks.filter((f) => contrastRatio(relLuminanceHex(f.hex), textL) >= vsText!);
  const best = pool.map((f) => ({ ...f, c: median(f.hex) })).sort((a, b) => b.c - a.c)[0];
  if (!best || best.c <= before) {
    const why = textL != null && pool.length < args.fallbacks.length
      ? ` que se separe del titular (≥ ${vsText}:1)` : '';
    return { changed: false, role: null, hex: null, contrast_before: r2(before), contrast_after: r2(before), ...base,
      reason: `contraste ${r2(before)} < ${args.minContrast} y ningún rol alternativo${why} contrasta más` };
  }
  return { changed: true, role: best.role, hex: best.hex, contrast_before: r2(before), contrast_after: r2(best.c), ...base,
    reason: `contraste ${r2(before)} < ${args.minContrast}: el énfasis pasa a ${best.role} (${r2(best.c)})` };
}

/** 1.6.3 — el estilo con el color del énfasis cambiado. PURO; devuelve el MISMO objeto si no hay énfasis. */
export function withEmphasisColor<S extends { slots: Record<string, any> }>(style: S, color: string): S {
  const hl = style.slots.headline;
  if (!hl?.emphasis) return style;
  return { ...style, slots: { ...style.slots, headline: { ...hl, emphasis: { ...hl.emphasis, color } } } } as S;
}

// ── 1.6.2 — CUÁNDO SE APLICA LA SOMBRA: MEDIDO, NO DECLARADO POR PIEZA ──
// EJE (código): el contraste se mide como razón WCAG entre el color del texto y la luminancia del fondo que
// queda DEBAJO del bloque; se mira el 10 % del área que peor contrasta (no la media: un cielo claro detrás de
// media frase no se compensa con una pared oscura detrás de la otra mitad). INSTANCIA (dato): el umbral
// `min_contrast` y el color de la sombra. Cero marcas, cero colores en el código.
const TEXT_EFFECT_WHEN = new Set(['always', 'low_contrast', 'on_request']);
/** Un color literal en un token (sólo `layout.text_effect.color`): #RGB o #RRGGBB. */
const HEX_COLOR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
/** Fracción del área que decide el contraste: el peor 10 %. */
export const TEXT_EFFECT_WORST_SHARE = 0.1;

/** Luminancia relativa WCAG de un canal sRGB 0..255. PURO. */
const linear = (c: number) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
/** Luminancia relativa WCAG de un color r,g,b 0..255. PURO. */
export function relLuminanceRgb(r: number, g: number, b: number): number {
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}
/** Luminancia relativa WCAG de un color resuelto: el hex de `brand_palette` o el `rgb()`/`rgba()` que deja
 *  `hexToRgba` en las ranuras (el alfa no cuenta: se mide el color). PURO. */
export function relLuminanceHex(color: string): number {
  const c = String(color ?? '').trim();
  const m = c.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*[\d.]+\s*)?\)$/i);
  if (m) return relLuminanceRgb(Number(m[1]), Number(m[2]), Number(m[3]));
  const h = c.replace(/^#/, '');
  const full = h.length === 3 ? h.split('').map((x) => x + x).join('') : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) throw new CompositorError('COMPOSITOR_COLOR_INVALID', `color inválido: '${color}'`);
  const n = parseInt(full, 16);
  return relLuminanceRgb((n >> 16) & 255, (n >> 8) & 255, n & 255);
}
/** Razón de contraste WCAG entre dos luminancias (1..21). PURO. */
export function contrastRatio(a: number, b: number): number {
  const [hi, lo] = a >= b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * ¿Lleva sombra el texto? PURO. `bgLuminances` son las luminancias del fondo debajo del bloque (una por píxel
 * muestreado); `textHexes`, los colores de las ranuras dibujadas. Decide el PEOR texto contra el peor 10 % del
 * fondo. Se aplica si ese contraste queda bajo `minContrast` y la sombra contrasta con el texto más que el fondo
 * (una sombra oscura no ayuda a un texto oscuro). Sin muestras no se decide a ciegas: se aplica y se dice.
 */
export function decideTextEffect(args: {
  textHexes: string[]; bgLuminances: number[]; minContrast: number; shadowHex: string;
}): { apply: boolean; contrast: number | null; min_contrast: number; text_luminance: number | null;
  background_luminance: number | null; shadow_contrast: number | null; reason: string } {
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const base = { min_contrast: args.minContrast };
  if (!args.bgLuminances.length || !args.textHexes.length) {
    return { apply: true, contrast: null, text_luminance: null, background_luminance: null, shadow_contrast: null, ...base,
      reason: 'sin muestras del fondo: se aplica la sombra declarada' };
  }
  const shadowL = relLuminanceHex(args.shadowHex);
  let worst: { contrast: number; textL: number; bgL: number } | null = null;
  for (const hex of args.textHexes) {
    const textL = relLuminanceHex(hex);
    const cs = args.bgLuminances.map((bgL) => ({ c: contrastRatio(textL, bgL), bgL })).sort((x, y) => x.c - y.c);
    const k = Math.max(1, Math.ceil(cs.length * TEXT_EFFECT_WORST_SHARE));
    const tail = cs.slice(0, k);
    const contrast = tail.reduce((a, x) => a + x.c, 0) / tail.length;
    const bgL = tail.reduce((a, x) => a + x.bgL, 0) / tail.length;
    if (!worst || contrast < worst.contrast) worst = { contrast, textL, bgL };
  }
  const w = worst!;
  const shadowContrast = contrastRatio(w.textL, shadowL);
  const low = w.contrast < args.minContrast;
  const helps = shadowContrast > w.contrast;
  return {
    apply: low && helps, contrast: r2(w.contrast), text_luminance: r3(w.textL), background_luminance: r3(w.bgL),
    shadow_contrast: r2(shadowContrast), ...base,
    reason: !low ? `contraste ${r2(w.contrast)} ≥ ${args.minContrast}: el texto se lee sin sombra`
      : !helps ? `contraste ${r2(w.contrast)} < ${args.minContrast}, pero la sombra (${r2(shadowContrast)}) no contrasta más que el fondo`
      : `contraste ${r2(w.contrast)} < ${args.minContrast}: se aplica la sombra (${r2(shadowContrast)} contra el texto)`,
  };
}

/** 1.6.2 — el estilo de la escena SIN texto: la foto con el velo, la franja y el producto tal como quedan debajo
 *  del bloque. El contraste se mide sobre ESO, no sobre la foto limpia: el velo de la marca ya oscurece (o no) lo
 *  que el texto tiene detrás, y medir sin él pondría sombra donde no hace falta. PURO. */
export function backgroundOnlyStyle<S extends { slots: Record<string, unknown> }>(style: S): S {
  return { ...style, slots: Object.fromEntries(Object.keys(style.slots).map((k) => [k, null])) } as S;
}

/** 1.6.0 — el `textShadow` del overlay: las mismas dos sombras que `carouselTextShadow` (halo y caída). PURO. */
export function overlayTextShadow(te: { color: string; blurPct: number; offsetPct: number }, canvasWidth: number): string {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const blur = r2((te.blurPct / 100) * canvasWidth);
  const off = r2((te.offsetPct / 100) * canvasWidth);
  return `0px 0px ${blur}px ${te.color}, 0px ${off}px ${blur}px ${te.color}`;
}

// ── 1.11.0 · EL TEXTO DE LA LÁMINA NO TAPA CARAS NI PRODUCTOS ──────────────────────────────────────────────────────
// EL CASO (Sam, 2026-10-22, pieza 3c58d5a1, cinco láminas): «todo el texto está sobre la cara o los
// productos, se suponía que eso ya estaba corregido». 1.6.x protegía sólo el overlay; la lámina componía su bloque en
// el centro fijo de la maqueta v4 sin mirar la foto.
// EJE (código): QUÉ se evita —la caja del bloque central no toca la caja de una cara ni de un producto, con margen—,
// DÓNDE puede ir el bloque —las filas de la maqueta (centro, abajo, arriba) y, si la marca la declara, una columna a la
// izquierda o a la derecha— y CÓMO se elige —la primera colocación libre sin reducir más que en el centro; si no, la
// primera libre que cabe; si ninguna, el último recurso declarado—. INSTANCIA (dato): todo lo demás, en
// `tokens.carousel.avoid_faces` y `tokens.carousel.avoid_products`. Las cajas entran como dato (0..1 del LIENZO).
export interface CarouselBlock { place: 'top' | 'center' | 'bottom'; side: 'left' | 'right' | null; columnPct: number }
export interface CarouselAvoid {
  marginPct: number; products: null | { marginPct: number };
  // Anchos de columna (% del ancho interior), en orden de preferencia: el más ancho primero suele romper menos líneas.
  placements: string[]; columnPcts: number[];
  fallback: Array<'inset' | 'band'>; insetMinPct: number; bandAlpha: number | null;
  // 1.11.1 — el 'inset' alterna de lado por lámina (texto arriba en las impares, abajo en las pares).
  insetAlternate: boolean;
  // 1.13.0 — figuras humanas completas. `minWidthPct`: % del ancho INTERIOR por debajo del cual la columna estrechada
  // al lado libre no se usa; null ⇒ no se estrecha. Ausente ⇒ la lámina es la de 1.12.0.
  people?: { marginPct: number; minWidthPct: number | null };
}
const CAROUSEL_PLACE_RE = /^(top|center|bottom)(?:_(left|right))?$/;
const CAROUSEL_FALLBACKS = new Set(['inset', 'band']);
// Orden por defecto: el centro de la maqueta (lo de siempre), y luego las otras dos filas a todo el ancho. Las columnas
// sólo existen si la marca declara su ancho (`column_pct`), y van después: estrechan el bloque y lo alargan.
export const CAROUSEL_DEFAULT_ROWS = ['center', 'bottom', 'top'];

/** Ancho (px) del bloque central: el de su columna si `chrome.block` la declara; si no, el interior entero. PURO. */
export function carouselBlockWidth(chrome: { block?: CarouselBlock }, inner: number): number {
  const b = chrome.block;
  if (!b || !b.side) return inner;
  return Math.round(inner * b.columnPct) / 100;
}

/**
 * Lee y valida la política de la lámina. Ausente o `enabled: false` ⇒ null y la lámina es la de 1.10.0. Mal escrita ⇒
 * falla nombrando, como el resto de los tokens (fail-loud acumulado). PURO.
 */
export function resolveCarouselAvoid(tokens: Record<string, any> | null | undefined): CarouselAvoid | null {
  const ct = (tokens ?? {}).carousel;
  if (!isPlain(ct)) return null;
  const missing: string[] = [];
  const off = (v: unknown) => v == null || (isPlain(v) && (v as Record<string, unknown>).enabled === false);
  const af = ct.avoid_faces as unknown;
  const ap = ct.avoid_products as unknown;
  const apl = ct.avoid_people as unknown;
  if (off(af)) {
    if (!off(apl)) {
      throw new CompositorError('COMPOSITOR_TOKENS_INCOMPLETE',
        'faltan datos de marca para componer la lámina de carrusel: carousel.avoid_people pide carousel.avoid_faces encendido: comparte su detección y sus colocaciones.');
    }
    if (!off(ap)) {
      throw new CompositorError('COMPOSITOR_TOKENS_INCOMPLETE',
        'faltan datos de marca para componer la lámina de carrusel: carousel.avoid_products pide carousel.avoid_faces encendido: comparte su detección y sus colocaciones.');
    }
    return null;
  }
  const a = af as Record<string, any>;
  if (!isPlain(af) || a.enabled !== true) {
    missing.push(`carousel.avoid_faces (objeto { enabled: true, margin_pct?, placements?, column_pct?, fallback? }; llegó ${JSON.stringify(af)})`);
  }
  const marginPct = Number(a?.margin_pct ?? 2);
  if (!Number.isFinite(marginPct) || marginPct < 0 || marginPct > 20) missing.push(`carousel.avoid_faces.margin_pct=${a?.margin_pct} (0 ≤ x ≤ 20)`);
  // `column_pct`: un ancho o una lista de anchos, cada uno 30..95 % del ancho interior.
  let columnPcts: number[] = [];
  if (a?.column_pct != null) {
    const raw = Array.isArray(a.column_pct) ? a.column_pct : [a.column_pct];
    const vals = raw.map(Number);
    if (!raw.length || vals.some((c: number) => !Number.isFinite(c) || c < 30 || c > 95)) {
      missing.push(`carousel.avoid_faces.column_pct=${JSON.stringify(a.column_pct)} (un número o una lista; cada uno 30 ≤ x ≤ 95, % del ancho interior)`);
    } else columnPcts = [...new Set(vals as number[])];
  }
  const columnPct = columnPcts.length ? columnPcts[0] : null;
  let placements: string[] = [...CAROUSEL_DEFAULT_ROWS];
  if (columnPct != null && a?.placements == null) {
    for (const side of ['left', 'right']) for (const row of CAROUSEL_DEFAULT_ROWS) placements.push(`${row}_${side}`);
  }
  if (a?.placements != null) {
    const list = Array.isArray(a.placements) ? a.placements.map(String) : null;
    const bad = list === null ? ['(no es una lista)'] : list.filter((p) => !CAROUSEL_PLACE_RE.test(p));
    if (bad.length) missing.push(`carousel.avoid_faces.placements: ${bad.join(', ')} (válidos: top, center, bottom y, con column_pct, <fila>_left o <fila>_right)`);
    else if (list && columnPct == null && list.some((p) => p.includes('_'))) {
      missing.push('carousel.avoid_faces.placements pide columnas y falta carousel.avoid_faces.column_pct');
    } else if (list) placements = [...new Set(list)];
  }
  const fbRaw = a?.fallback == null ? [] : (Array.isArray(a.fallback) ? a.fallback : [a.fallback]).map(String);
  const fbBad = fbRaw.filter((f: string) => !CAROUSEL_FALLBACKS.has(f));
  if (fbBad.length) missing.push(`carousel.avoid_faces.fallback: ${fbBad.join(', ')} (válidos: ${[...CAROUSEL_FALLBACKS].join(', ')})`);
  const insetMinPct = Number(a?.inset_min_pct ?? 25);
  if (!Number.isFinite(insetMinPct) || insetMinPct < 5 || insetMinPct > 80) missing.push(`carousel.avoid_faces.inset_min_pct=${a?.inset_min_pct} (5 ≤ x ≤ 80, % del alto)`);
  let bandAlpha: number | null = null;
  if (fbRaw.includes('band')) {
    const al = Number(isPlain(a?.band) ? a.band.alpha : NaN);
    if (!Number.isFinite(al) || al <= 0 || al > 1) missing.push(`carousel.avoid_faces.band.alpha (0 < x ≤ 1; obligatoria con fallback 'band'; llegó ${JSON.stringify(a?.band)})`);
    else bandAlpha = al;
  }
  // 1.11.1 — `inset_alternate`: booleano. Ausente ⇒ false, y el 'inset' es el de 1.11.0 (texto siempre arriba).
  if (a?.inset_alternate != null && typeof a.inset_alternate !== 'boolean') {
    missing.push(`carousel.avoid_faces.inset_alternate=${JSON.stringify(a.inset_alternate)} (true o false)`);
  }
  const insetAlternate = a?.inset_alternate === true;
  let products: CarouselAvoid['products'] = null;
  if (!off(ap)) {
    const p = ap as Record<string, any>;
    const pm = Number(p?.margin_pct ?? 1);
    if (!isPlain(ap) || p.enabled !== true) missing.push(`carousel.avoid_products (objeto { enabled: true, margin_pct?: 0..20 }; llegó ${JSON.stringify(ap)})`);
    else if (!Number.isFinite(pm) || pm < 0 || pm > 20) missing.push(`carousel.avoid_products.margin_pct=${p.margin_pct} (0 ≤ x ≤ 20)`);
    else products = { marginPct: pm };
  }
  // 1.13.0 — la figura humana completa. Misma forma que en el overlay, sin último recurso propio (usa el de arriba).
  let people: CarouselAvoid['people'] = undefined;
  if (!off(apl)) {
    const r = parseAvoidPeople(apl, 'carousel.avoid_people', false);
    missing.push(...r.missing);
    if (r.value) people = { marginPct: r.value.marginPct, minWidthPct: r.value.minWidthPct };
  }
  if (missing.length) {
    throw new CompositorError('COMPOSITOR_TOKENS_INCOMPLETE',
      `faltan datos de marca para componer la lámina de carrusel: ${missing.join(' · ')}.`);
  }
  return { marginPct, products, placements, columnPcts, fallback: [...new Set(fbRaw)] as Array<'inset' | 'band'>, insetMinPct, bandAlpha, insetAlternate,
    ...(people ? { people } : {}) };
}

/** Cajas medidas sobre la FOTO (0..1) → cajas sobre el LIENZO de la lámina (0..1), con el `objectFit: cover` con que la
 *  escena la dibuja: escala para cubrir y centra. Lo que queda fuera del lienzo se descarta. PURO. */
export function coverMapBoxes(boxes: FaceBox[], imgW: number, imgH: number, W: number, H: number): FaceBox[] {
  if (!(imgW > 0 && imgH > 0 && W > 0 && H > 0)) return [];
  const k = Math.max(W / imgW, H / imgH);
  const ox = (W - imgW * k) / 2;
  const oy = (H - imgH * k) / 2;
  const cx = (v: number) => Math.min(1, Math.max(0, (v * imgW * k + ox) / W));
  const cy = (v: number) => Math.min(1, Math.max(0, (v * imgH * k + oy) / H));
  const out: FaceBox[] = [];
  for (const b of boxes ?? []) {
    const m = { x0: cx(b.x0), y0: cy(b.y0), x1: cx(b.x1), y1: cy(b.y1) };
    if (m.x1 > m.x0 && m.y1 > m.y0) out.push(m);
  }
  return out;
}

/** La caja (px) del bloque central de una lámina, con las MISMAS medidas que `buildCarouselScene`: x desde el margen
 *  (o desde la columna derecha) hasta la línea más larga; y según la fila. PURO. */
export function carouselBlockRect(chrome: CarouselChrome, metrics: FitMetrics | null | undefined): {
  rect: { x0: number; y0: number; x1: number; y1: number }; m: ReturnType<typeof measureCarouselLayout>;
} {
  const W = chrome.canvas.width;
  const H = chrome.canvas.height;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const M = r2((chrome.marginPct / 100) * W);
  const inner = r2(W - 2 * M);
  const m = measureCarouselLayout(chrome, metrics);
  const b = chrome.block ?? null;
  const x0 = M + (b && b.side === 'right' ? inner - m.blockWidth : 0);
  const place = b ? b.place : 'center';
  const y0 = place === 'top' ? M + m.top + m.gap
    : place === 'bottom' ? H - M - m.foot - m.gap - m.mid
      : M + m.top + Math.max(0, m.available - m.mid) / 2;
  return { rect: { x0: r2(x0), y0: r2(y0), x1: r2(x0 + m.midWidth), y1: r2(y0 + m.mid) }, m };
}

/** % de la caja del bloque que cae sobre las cajas dadas (px). PURO. */
function rectOverlapPct(r: { x0: number; y0: number; x1: number; y1: number }, boxes: Array<{ x0: number; y0: number; x1: number; y1: number }>): number {
  const area = Math.max(1, (r.x1 - r.x0) * (r.y1 - r.y0));
  let inter = 0;
  for (const b of boxes) {
    const w = Math.min(r.x1, b.x1) - Math.max(r.x0, b.x0);
    const h = Math.min(r.y1, b.y1) - Math.max(r.y0, b.y0);
    if (w > 0 && h > 0) inter += w * h;
  }
  return Math.round((10000 * Math.min(inter, area)) / area) / 100;
}

/** Un color `rgb(…)`/`rgba(…)` con otro alfa. PURO. */
function withAlphaRgb(color: string, alpha: number): string {
  const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(String(color ?? ''));
  return m ? `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${alpha})` : color;
}

/**
 * ELIGE DÓNDE VA EL BLOQUE DE LA LÁMINA. PURO y determinista. Recibe el cromo ANTES del ajuste vertical y devuelve el
 * ajuste (`fitCarouselContent`) de la colocación elegida, para que el llamador lo use en vez de ajustar por su cuenta.
 *   1. El centro de la maqueta (lo de siempre). Libre ⇒ devuelve EXACTAMENTE el ajuste de 1.10.0: la escena no cambia.
 *   2. La primera colocación de `placements` que queda libre sin reducir más de lo que se reducía en el centro.
 *   3. La primera libre que cabe, aunque reduzca el tamaño (el ajuste vertical lo dice). Nunca una que omita más pasos que
 *      el centro: mover el texto no cuesta contenido.
 *   3 bis. El titular por los escalones más chicos de su `fit_steps`, en cada colocación: la primera que libra.
 *   4. El último recurso, en el orden de `fallback`: 'inset' (texto arriba sobre la superficie y la foto reducida en el
 *      hueco que queda, si mide al menos `inset_min_pct` del alto) o 'band' (la colocación que menos tapa, con una
 *      banda de superficie bajo el texto). Sin último recurso aplicable: la que menos tapa, y se dice.
 */
export function chooseCarouselPlacement(args: {
  chrome: CarouselChrome; metrics?: FitMetrics | null; faces: FaceBox[]; products?: FaceBox[] | null; avoid: CarouselAvoid;
  /** 1.13.0 — figuras humanas completas (0..1 del LIENZO). Sólo cuentan con `avoid.people`, y cuentan como una cara. */
  people?: FaceBox[] | null;
  /** 1.11.1 — el número de la lámina (1..N). Sólo lo usa el 'inset' con `inset_alternate`. */
  slideIndex?: number | null;
  /** 1.12.0 — la fila que pidió una persona. 'top'/'bottom': sólo esa fila y sus columnas declaradas, sin último
   *  recurso; si tapa, se compone igual y se dice. 'auto' o ausente: la elección de siempre. */
  textPlace?: TextPlace | null;
}): {
  fit: ReturnType<typeof fitCarouselContent>; warnings: string[];
  report: {
    faces: number; products: number | null; placement_declared: 'center' | 'top' | 'bottom'; placement_used: string; column_pct: number | null; moved: boolean;
    overlap_pct: number; candidates: Array<{ placement: string; column_pct: number | null; overlap_pct: number; face_overlap_pct: number; product_overlap_pct: number; reduced: boolean; overflow: boolean }>;
    fallback: null | 'inset' | 'band'; reason: string; headline_size_pct?: number;
    inset?: { x0: number; y0: number; x1: number; y1: number }; band?: { y0: number; y1: number };
    text_place?: 'top' | 'bottom';
    // 1.13.0 — sólo con `carousel.avoid_people`.
    people?: number; narrowed_column_pct?: { left: number | null; right: number | null };
  };
} {
  const { chrome, avoid } = args;
  const metrics = args.metrics ?? null;
  const W = chrome.canvas.width;
  const H = chrome.canvas.height;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const M = r2((chrome.marginPct / 100) * W);
  const toPx = (list: FaceBox[], marginPct: number) => {
    const p = (marginPct / 100) * Math.min(W, H);
    return list.map((f) => ({ x0: f.x0 * W - p, y0: f.y0 * H - p, x1: f.x1 * W + p, y1: f.y1 * H + p }));
  };
  const faceBoxes = toPx(args.faces ?? [], avoid.marginPct);
  const prodList = avoid.products ? (args.products ?? []) : [];
  const prodBoxes = avoid.products ? toPx(prodList, avoid.products.marginPct) : [];
  // 1.13.0 — la figura humana completa, con su margen. Sin `avoid.people`, ninguna caja más.
  const peopleList = avoid.people ? (args.people ?? []) : [];
  const peopleBoxes = avoid.people ? toPx(peopleList, avoid.people.marginPct) : [];
  const allBoxes = [...faceBoxes, ...prodBoxes, ...peopleBoxes];
  const fitKey = (r: ReturnType<typeof fitCarouselContent>['report']) =>
    `${r.figure_scale}|${r.headline_size_pct}|${r.body_scale}|${r.steps_dropped}|${r.overflow}`;
  // Cada colocación con columna se prueba con cada ancho declarado, en su orden; las filas a todo el ancho, una vez.
  type Slot = { code: string; col: number | null };
  // 1.12.0 — con una fila pedida, el punto de partida es esa fila a todo el ancho (no el centro) y las candidatas son
  // sólo sus columnas declaradas: se esquiva sin salir de donde se pidió.
  const forced = args.textPlace === 'top' || args.textPlace === 'bottom' ? args.textPlace : null;
  const declaredPlace: 'center' | 'top' | 'bottom' = forced ?? 'center';
  const slots: Slot[] = avoid.placements
    .filter((p) => (forced ? p.startsWith(`${forced}_`) : p !== 'center'))
    .flatMap((p) => (p.includes('_') ? avoid.columnPcts.map((col) => ({ code: p, col })) : [{ code: p, col: null }]));
  // 1.13.0 — ESTRECHAR AL LADO LIBRE: con `avoid.people.minWidthPct` y figuras detectadas, una columna más por lado, del
  // ancho que deja libre la figura más cercana (con su margen), en cada fila candidata. Nunca por debajo del mínimo
  // declarado ni del 100 %. Van después de las colocaciones declaradas: primero lo que la marca eligió.
  const innerW = r2(W - 2 * M);
  const narrowCol: { left: number | null; right: number | null } = { left: null, right: null };
  if (avoid.people?.minWidthPct != null && peopleBoxes.length) {
    const left = Math.min(...peopleBoxes.filter((b) => b.x1 > M).map((b) => b.x0)) - M;
    const right = (W - M) - Math.max(...peopleBoxes.filter((b) => b.x0 < W - M).map((b) => b.x1));
    for (const [side, avail] of [['left', left], ['right', right]] as const) {
      if (!Number.isFinite(avail)) continue;
      const pct = Math.floor((1000 * avail) / innerW) / 10;
      if (pct >= avoid.people.minWidthPct && pct < 100) narrowCol[side] = pct;
    }
    const rows = forced ? [forced] : CAROUSEL_DEFAULT_ROWS;
    for (const side of ['left', 'right'] as const) {
      const col = narrowCol[side];
      if (col == null) continue;
      for (const row of rows) if (!slots.some((x) => x.code === `${row}_${side}` && x.col === col)) slots.push({ code: `${row}_${side}`, col });
    }
  }
  const baseSlot: Slot | null = forced ? { code: forced, col: null } : null;
  const withBlockOf = (from: CarouselChrome, sl: Slot): CarouselChrome => {
    const mm = CAROUSEL_PLACE_RE.exec(sl.code)!;
    const side = (mm[2] ?? null) as CarouselBlock['side'];
    return { ...from, block: { place: mm[1] as CarouselBlock['place'], side, columnPct: side ? (sl.col ?? 100) : 100 } };
  };
  const evalC = (sl: Slot | null, from: CarouselChrome = chrome) => {
    const fit = fitCarouselContent({ chrome: sl === null ? from : withBlockOf(from, sl), metrics });
    const { rect, m } = carouselBlockRect(fit.chrome, metrics);
    return { placement: sl?.code ?? 'center', column_pct: sl?.col ?? null, fit, rect, m, key: fitKey(fit.report),
      overlap_pct: rectOverlapPct(rect, allBoxes), face_overlap_pct: rectOverlapPct(rect, faceBoxes), product_overlap_pct: rectOverlapPct(rect, prodBoxes) };
  };
  const what = avoid.people ? (avoid.products ? 'una cara, una persona o un producto' : 'una cara o una persona')
    : avoid.products ? 'una cara o un producto' : 'una cara';
  const label = (c: { placement: string; column_pct: number | null }) => (c.column_pct != null ? `${c.placement} (columna ${c.column_pct} %)` : c.placement);
  const base = evalC(baseSlot);
  const cands = slots.map((sl) => evalC(sl));
  const all = [base, ...cands];
  const report = (used: typeof base, fallback: null | 'inset' | 'band', reason: string, extra: Record<string, unknown> = {}) => ({
    faces: (args.faces ?? []).length, products: avoid.products ? prodList.length : null,
    placement_declared: declaredPlace, placement_used: used.placement, column_pct: used.column_pct, moved: used.placement !== declaredPlace,
    overlap_pct: fallback === 'inset' ? 0 : used.overlap_pct,
    candidates: all.map((c) => ({ placement: c.placement, column_pct: c.column_pct, overlap_pct: c.overlap_pct, face_overlap_pct: c.face_overlap_pct,
      product_overlap_pct: c.product_overlap_pct, reduced: c.key !== base.key, overflow: c.fit.report.overflow })),
    fallback, reason, ...(forced ? { text_place: forced } : {}),
    ...(avoid.people ? { people: peopleList.length, narrowed_column_pct: narrowCol } : {}), ...extra,
  });
  const where = forced ? `${TEXT_PLACE_LABEL[forced]}, donde se pidió,` : 'en el centro';
  if (base.overlap_pct === 0) {
    return { fit: base.fit, warnings: [], report: report(base, null, allBoxes.length ? `${where} el texto no toca ${what}` : 'no se detectó nada que evitar') };
  }
  // Mover el texto nunca cuesta contenido: una colocación que omite más pasos que el centro no es libre.
  // Ni una palabra más ancha que su columna: se partiría o se saldría del bloque.
  const ok = (c: typeof base) => c.overlap_pct === 0 && !c.fit.report.overflow && !c.m.wordOverflow
    && c.fit.report.steps_dropped <= base.fit.report.steps_dropped;
  const chosen = cands.find((c) => ok(c) && c.key === base.key) ?? cands.find(ok);
  if (chosen) {
    const reason = `${where} el texto tapaba ${what} (${base.overlap_pct} % de su caja); se compone en ${label(chosen)}`;
    return { fit: chosen.fit, warnings: [`CAROUSEL_BLOCK_MOVED_FOR_SUBJECT: ${reason}`], report: report(chosen, null, reason) };
  }
  // 3 bis. El titular, un escalón más chico de su `fit_steps` cada vez, en cada colocación: la foto se ve entera antes
  // de llegar al último recurso. El primer escalón y la primera colocación que libran ganan, y se dice.
  for (const h of chrome.fitLadder.headline) {
    const shrunk: CarouselChrome = { ...chrome, type: { ...chrome.type, headline: { ...chrome.type.headline, sizePct: h } },
      fitLadder: { headline: chrome.fitLadder.headline.filter((x) => x < h) } };
    for (const sl of [baseSlot, ...slots]) {
      const c = evalC(sl, shrunk);
      if (ok(c)) {
        const reason = `ninguna colocación libra ${what} al tamaño de siempre (la menor tapa ${Math.min(...all.map((x) => x.overlap_pct))} %); ` +
          `con el titular ${chrome.type.headline.sizePct}→${h} % se compone en ${label(c)}`;
        return { fit: c.fit, warnings: [`CAROUSEL_TEXT_REDUCED_FOR_SUBJECT: ${reason}`], report: report(c, null, reason, { headline_size_pct: h }) };
      }
    }
  }
  // La que menos tapa, entre las que no omiten pasos (el centro siempre está entre ellas).
  const keep = all.filter((c) => c === base || (c.fit.report.steps_dropped <= base.fit.report.steps_dropped && !c.m.wordOverflow));
  const least = keep.reduce((acc, c) => (c.overlap_pct < acc.overlap_pct ? c : acc), keep[0]);
  // 1.12.0 — la fila la pidió una persona: ni 'inset' ni 'band' (moverían o taparían lo que se pidió). Se compone en la
  // columna de esa fila que menos tapa, y se dice.
  if (forced) {
    const reason = `se pidió el texto ${TEXT_PLACE_LABEL[forced]}; ninguna colocación de esa fila (${all.map(label).join(', ')}) libra ${what}; ` +
      `se compone igual en ${label(least)}, que tapa ${least.overlap_pct} %`;
    return { fit: least.fit, warnings: [`CAROUSEL_TEXT_PLACE_COVERS: ${reason}`], report: report(least, null, reason) };
  }
  for (const mode of avoid.fallback) {
    if (mode === 'inset') {
      // 1.11.1 — VARIEDAD, NO PATRÓN (Sam, 2026-10-22: «me gusta el recurso… mientras aporte variedad y no un patrón»).
      // Medido ese día en 3c58d5a1: tres láminas con 'inset', las tres con el texto arriba. Con `inset_alternate`, las
      // láminas pares llevan el texto abajo y la foto arriba; las impares, como en 1.11.0. Determinista por número de
      // lámina: recomponer no cambia el lado, y dos láminas seguidas con 'inset' nunca repiten disposición.
      const abajo = avoid.insetAlternate && Number.isInteger(args.slideIndex) && (args.slideIndex as number) % 2 === 0;
      const lado = abajo ? 'bottom' : 'top';
      const c0 = all.find((c) => c.placement === lado) ?? evalC({ code: lado, col: null });
      const y0 = abajo ? r2(M + c0.m.top + c0.m.gap) : r2(M + c0.m.top + c0.m.gap + c0.m.mid + c0.m.gap);
      const y1 = abajo ? r2(H - M - c0.m.foot - c0.m.gap - c0.m.mid - c0.m.gap) : r2(H - M - c0.m.foot - c0.m.gap);
      const pct = Math.round((10000 * (y1 - y0)) / H) / 100;
      if (c0.fit.report.overflow || pct < avoid.insetMinPct) continue;
      const inset = { x0: M, y0, x1: r2(W - M), y1 };
      const reason = `ninguna colocación (${all.map(label).join(', ')}) libra ${what}; la menor tapa ${least.overlap_pct} %. ` +
        (abajo
          ? `Último recurso 'inset': el texto abajo sobre la superficie de la marca y la foto reducida arriba (${pct} % del alto)`
          : `Último recurso 'inset': el texto arriba sobre la superficie de la marca y la foto reducida debajo (${pct} % del alto)`);
      return { fit: { ...c0.fit, chrome: { ...c0.fit.chrome, inset } }, warnings: [`CAROUSEL_PHOTO_INSET_FOR_SUBJECT: ${reason}`],
        report: report(c0, 'inset', reason, { inset, inset_text: lado }) };
    }
    if (mode === 'band' && avoid.bandAlpha != null) {
      const band = { y0: Math.max(0, r2(least.rect.y0 - least.m.gap)), y1: Math.min(H, r2(least.rect.y1 + least.m.gap)) };
      const reason = `ninguna colocación (${all.map(label).join(', ')}) libra ${what}; se usa ${label(least)}, que tapa ${least.overlap_pct} %. ` +
        `Último recurso 'band': una banda de la superficie de la marca bajo el texto (alfa ${avoid.bandAlpha})`;
      return { fit: { ...least.fit, chrome: { ...least.fit.chrome, band: { ...band, color: withAlphaRgb(chrome.surface, avoid.bandAlpha) } } },
        warnings: [`CAROUSEL_BAND_FOR_SUBJECT: ${reason}`], report: report(least, 'band', reason, { band }) };
    }
  }
  const reason = `ninguna colocación (${all.map(label).join(', ')}) libra ${what} y no hay último recurso aplicable; se usa ${label(least)}, que tapa ${least.overlap_pct} %`;
  return { fit: least.fit, warnings: [`CAROUSEL_SUBJECT_OVERLAP_UNAVOIDABLE: ${reason}`], report: report(least, null, reason) };
}

/** 1.12.0 — la lámina SIN la política (o sin foto, o con la detección caída) y con una fila pedida: el bloque se
 *  compone en esa fila, a todo el ancho, con el ajuste de siempre. 'auto' o ausente ⇒ el ajuste de siempre. PURO. */
export function fitCarouselAtPlace(args: { chrome: CarouselChrome; metrics?: FitMetrics | null; textPlace?: TextPlace | null }): ReturnType<typeof fitCarouselContent> {
  const p = args.textPlace;
  if (p !== 'top' && p !== 'bottom') return fitCarouselContent({ chrome: args.chrome, metrics: args.metrics });
  return fitCarouselContent({ chrome: { ...args.chrome, block: { place: p, side: null, columnPct: 100 } }, metrics: args.metrics });
}

/** El recorte (px de la FOTO) para el último recurso 'inset': la proporción del hueco, centrado en lo que hay que ver
 *  (la unión de caras y productos, 0..1 de la foto) o, si no cabe, desde su parte de arriba; sin nada, en el centro.
 *  Nunca sale de la foto. PURO. */
export function insetCropRect(imgW: number, imgH: number, boxW: number, boxH: number, focus: FaceBox[]): { left: number; top: number; width: number; height: number } {
  const aspect = boxW / boxH;
  let width = imgW, height = imgH;
  if (imgW / imgH > aspect) width = Math.max(1, Math.round(imgH * aspect));
  else height = Math.max(1, Math.round(imgW / aspect));
  const clamp = (v: number, hi: number) => Math.min(Math.max(0, v), Math.max(0, hi));
  let left = Math.round((imgW - width) / 2), top = Math.round((imgH - height) / 2);
  if (focus && focus.length) {
    const u = focus.reduce((a, b) => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) }));
    // Centrado en la unión; si la unión no cabe en el recorte, se conserva su parte de ARRIBA (la frente de una cara,
    // la tapa y la etiqueta de un envase), con un respiro del 4 % del recorte.
    left = (u.x1 - u.x0) * imgW > width ? Math.round(u.x0 * imgW - 0.04 * width) : Math.round(((u.x0 + u.x1) / 2) * imgW - width / 2);
    top = (u.y1 - u.y0) * imgH > height ? Math.round(u.y0 * imgH - 0.04 * height) : Math.round(((u.y0 + u.y1) / 2) * imgH - height / 2);
  }
  return { left: clamp(left, imgW - width), top: clamp(top, imgH - height), width, height };
}

// ── COMPOSITOR:END ──

// ── Transporte (impuro) ────────────────────────────────────────────────────

/** 1.6.3 — desenfoca, en la foto limpia, las cajas de los letreros que quedan bajo el texto (0..1). Sutil: el
 *  desenfoque es un % del ancho y la caja se agranda un poco para que no quede un borde duro. Devuelve PNG. Nunca
 *  lanza: si falla, el letrero queda como está y se dice. */
async function blurRegions(bytes: Uint8Array, boxes: FaceBox[], width: number, height: number, blurPct: number)
  : Promise<{ bytes: Uint8Array | null; error: string | null }> {
  try {
    const sigma = Math.max(0.3, (blurPct / 100) * width);
    const grow = Math.round(sigma * 2);
    const layers: Array<{ input: Buffer; left: number; top: number }> = [];
    for (const b of boxes) {
      const left = Math.max(0, Math.floor(b.x0 * width) - grow);
      const top = Math.max(0, Math.floor(b.y0 * height) - grow);
      const w = Math.min(width - left, Math.ceil(b.x1 * width) + grow - left);
      const h = Math.min(height - top, Math.ceil(b.y1 * height) + grow - top);
      if (w < 2 || h < 2) continue;
      const input = await sharp(Buffer.from(bytes)).extract({ left, top, width: w, height: h }).blur(sigma).png().toBuffer();
      layers.push({ input, left, top });
    }
    if (!layers.length) return { bytes: null, error: 'cajas de letrero vacías' };
    const out = await sharp(Buffer.from(bytes)).composite(layers).png().toBuffer();
    return { bytes: new Uint8Array(out), error: null };
  } catch (e) {
    return { bytes: null, error: `desenfoque falló: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200) };
  }
}

/** 1.6.2 — luminancias WCAG del fondo debajo del bloque de texto. Se reduce la región a ≤ 64 px de ancho (la
 *  decisión es de área, no de detalle). Nunca lanza: sin muestras, `decideTextEffect` aplica la sombra y se dice. */
async function sampleRegionLuminance(bytes: Uint8Array, rect: { x0: number; y0: number; x1: number; y1: number },
  width: number, height: number): Promise<{ luminances: number[]; error: string | null }> {
  try {
    const left = Math.max(0, Math.min(width - 1, Math.floor(rect.x0)));
    const top = Math.max(0, Math.min(height - 1, Math.floor(rect.y0)));
    const w = Math.max(1, Math.min(width - left, Math.ceil(rect.x1) - left));
    const h = Math.max(1, Math.min(height - top, Math.ceil(rect.y1) - top));
    const { data, info } = await sharp(Buffer.from(bytes)).removeAlpha().toColourspace('srgb')
      .extract({ left, top, width: w, height: h })
      .resize({ width: Math.min(64, w), fit: 'fill', kernel: 'nearest' })
      .raw().toBuffer({ resolveWithObject: true });
    const out: number[] = [];
    for (let i = 0; i + 2 < data.length; i += info.channels) out.push(relLuminanceRgb(data[i], data[i + 1], data[i + 2]));
    return { luminances: out, error: null };
  } catch (e) {
    return { luminances: [], error: `muestreo del fondo falló: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200) };
  }
}

function normalizeSupabaseUrl(raw: string): string {
  let v = raw.trim().replace(/\/+$/, '');
  if (!v) return '';
  if (!/^https?:\/\//i.test(v)) {
    if (!v.includes('.')) v = `${v}.supabase.co`;
    v = `https://${v}`;
  }
  return v;
}
const SB_URL = () => normalizeSupabaseUrl(process.env.SUPABASE_URL ?? '');
const SB_KEY = () => process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

/**
 * Lector de PostgREST, FAIL-LOUD (misma disciplina que `sb()` de `api/execute.ts`, #95-B): 200+[]
 * es ausencia legítima y devuelve []; un 4xx/5xx es un BUG (columna que no existe, RLS, permiso) y
 * LANZA. Se duplica en vez de importarse: cada función de Vercel se empaqueta por separado y
 * `api/execute.ts` es una ruta, no una librería — un import cruzado acoplaría dos deploys.
 */
async function sbSelect<T = any>(path: string): Promise<T[]> {
  const base = SB_URL();
  const key = SB_KEY();
  if (!base || !key) {
    throw new CompositorError('COMPOSITOR_SUPABASE_ENV_MISSING',
      'faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en el entorno de ImageLab', 500);
  }
  const res = await fetch(`${base}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new CompositorError('COMPOSITOR_DB_QUERY_FAILED',
      `select '${path}' devolvió ${res.status}: ${(await res.text()).slice(0, 240)}`, 500);
  }
  return (await res.json()) as T[];
}

const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');

function dataUrlToBytes(d: string): Uint8Array {
  const comma = d.indexOf(',');
  return new Uint8Array(Buffer.from(comma >= 0 ? d.slice(comma + 1) : d, 'base64'));
}

async function fetchBytes(url: string, label: string): Promise<Uint8Array> {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/4.0 (compatible; ImageLab compositor)' } });
  if (!res.ok) throw new CompositorError(label, `GET ${url.slice(0, 120)} → ${res.status}`, 502);
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * Bytes de la fuente de una ranura. Dos caminos, los dos DATO:
 *   1. `typography.<slot>.font_url` en los tokens — un archivo fijado por la marca. Gana.
 *   2. `brand_typography.css_import` — hoja css2 de Google, de la que sale el TTF del peso pedido.
 * Sin ninguno de los dos: FALLA con el nombre del rol. El motor no tiene una fuente de reserva.
 */
async function loadFont(slot: Slot | string, s: {
  role: string; family: string; cssImport: string | null; fontUrl: string | null; weight: number; italic: boolean;
}): Promise<{ name: string; data: Uint8Array; weight: number; style: 'normal' | 'italic'; source: string }> {
  // Toda fuente pasa por `neutralizeKerning` antes de llegar a satori (1.3.1): sin eso, el espacio
  // entre palabras sale desigual. El porqué, medido, está en la función.
  if (s.fontUrl) {
    return { name: s.family, data: neutralizeKerning(await fetchBytes(s.fontUrl, 'COMPOSITOR_FONT_FETCH_FAILED')).bytes,
      weight: s.weight, style: s.italic ? 'italic' : 'normal', source: s.fontUrl };
  }
  if (!s.cssImport || !/^https?:\/\//i.test(s.cssImport)) {
    throw new CompositorError('COMPOSITOR_FONT_UNRESOLVED',
      `la ranura '${slot}' usa brand_typography.role='${s.role}' (${s.family}) y esa fila no trae un css_import ` +
      `descargable ('${s.cssImport ?? '∅'}'). Siembra css_import (hoja css2) o typography.${slot}.font_url con un .ttf/.otf.`);
  }
  const css = new TextDecoder().decode(await fetchBytes(s.cssImport, 'COMPOSITOR_FONT_CSS_FAILED'));
  const face = pickFontFace(parseFontFaces(css), { weight: s.weight, italic: s.italic });
  if (!face) {
    throw new CompositorError('COMPOSITOR_FONT_UNRESOLVED',
      `css_import de '${s.role}' (${s.family}) no declara ningún @font-face descargable: ${s.cssImport}`);
  }
  return { name: s.family, data: neutralizeKerning(await fetchBytes(face.url, 'COMPOSITOR_FONT_FETCH_FAILED')).bytes,
    weight: face.weight, style: face.italic ? 'italic' : 'normal', source: face.url };
}

/**
 * F3 — el logotipo de firma de la marca (`public.brand_logo`, role 'signature', activo). TOLERANTE por
 * contrato: sin fila, sin tabla, sin permiso o con un `src` que no baja ⇒ null y un aviso; nunca un
 * error. Una lámina sin logotipo es una lámina legible; una lámina que no sale no lo es.
 * Las imágenes se embeben como data URI y se miden aquí (PNG/JPEG por cabecera, SVG por viewBox).
 */
async function loadSignatureLogo(brandId: string, warnings: string[]): Promise<CarouselLogoIn | null> {
  let rows: any[] = [];
  try {
    rows = await sbSelect(`brand_logo?brand_id=eq.${encodeURIComponent(brandId)}&role=eq.signature&active=eq.true&select=kind,src,spec,width,height&limit=1`);
  } catch (e) {
    warnings.push(`CAROUSEL_LOGO_UNAVAILABLE: no se pudo leer brand_logo (${(e as Error)?.message?.slice(0, 160) ?? e}); se compone sin logotipo`);
    return null;
  }
  const row = rows[0];
  if (!row) return null;
  if (row.kind !== 'image') return { kind: String(row.kind), spec: row.spec ?? null };
  try {
    let src = String(row.src ?? '');
    let bytes: Uint8Array | null = null;
    let mime = '';
    if (/^https:\/\//.test(src)) {
      bytes = await fetchBytes(src, 'CAROUSEL_LOGO_FETCH_FAILED');
      const head = new TextDecoder().decode(bytes.slice(0, 256));
      mime = /<svg|<\?xml/i.test(head) ? 'image/svg+xml' : imageDimensions(bytes).mime;
      src = `data:${mime};base64,${b64(bytes)}`;
    } else {
      mime = (src.match(/^data:([^;,]+)/) ?? [])[1] ?? '';
      const comma = src.indexOf(',');
      const payload = src.slice(comma + 1);
      bytes = /;base64,/.test(src.slice(0, comma + 1))
        ? new Uint8Array(Buffer.from(payload, 'base64'))
        : new TextEncoder().encode(decodeURIComponent(payload));
    }
    let intrinsic: { width: number; height: number } | null = null;
    if (Number(row.width) > 0 && Number(row.height) > 0) intrinsic = { width: Number(row.width), height: Number(row.height) };
    else if (mime === 'image/svg+xml') intrinsic = svgDimensions(new TextDecoder().decode(bytes));
    else { const d = imageDimensions(bytes); intrinsic = { width: d.width, height: d.height }; }
    return { kind: 'image', src, intrinsic };
  } catch (e) {
    warnings.push(`CAROUSEL_LOGO_UNAVAILABLE: el logotipo de brand_logo no se pudo cargar (${(e as Error)?.message?.slice(0, 160) ?? e}); se compone sin logotipo`);
    return null;
  }
}

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export const config = { maxDuration: 60 };


// ── 1.6.0 · DETECCIÓN DE CARAS (red) ─────────────────────────────────────────────────────────────────
// Sólo corre si la marca o el canal declaran `layout.avoid_faces`. Usa la misma vía de Vertex que el inspector
// (`api/inspect.ts`): las dos copias de abajo son LITERALES de las suyas, y `tests/compositor_caras_test.mjs`
// exige que no diverjan. NUNCA tumba la composición: si falla, se compone en el ancla declarada y se dice.
const FACES_GCP_PROJECT  = () => process.env.GOOGLE_CLOUD_PROJECT ?? '';
const FACES_GCP_LOCATION = () => process.env.GOOGLE_CLOUD_LOCATION ?? 'us-central1';
// El modelo del detector es DATO: el rol `face_detection` de `public.ops_lab_models` (bloque MODELO-POR-ROL,
// MULTIBRAND_RULE.md §11). ALIAS LEGACY: el que había escrito aquí antes de la tabla; sólo si no se puede consultar.
const FACES_ROLE = 'face_detection';
const LEGACY_FACES_MODEL = { model: 'gemini-2.5-flash', generationParams: { thinkingConfig: { thinkingBudget: 0 } } };
const FACES_TIMEOUT_MS = 15_000;
const FACES_PROMPT =
  'Detect every human face visible in this image, including faces in profile, partially visible or turned away. ' +
  'Return each one as box_2d = [ymin, xmin, ymax, xmax], integers normalized to 0-1000, tightly around the FACE ONLY: ' +
  'from the eyebrows to the chin and from ear to ear. Do not include hair, neck or shoulders. If there are no faces, return an empty list.';
// 1.6.3 — se suma sólo si la marca declara `avoid_scene_text`: sin el token, la petición es la de 1.6.2.
const SIGNS_PROMPT =
  ' Also detect every area of legible text or signage that is part of the scene itself: lit signs (for example an ON AIR sign), ' +
  'posters, screens, boards and lettering on walls. Return each one in signs as box_2d with the same format, tightly around the sign. ' +
  'Do not include product packaging or labels, nor text on clothing. If there are none, return an empty signs list.';
// 1.11.0 — se suma sólo si la marca declara `avoid_products` (overlay o lámina): sin el token, la petición es la de 1.6.3.
const PRODUCTS_PROMPT =
  ' Also detect every product that is a protagonist of the scene: bottles, jars, tubes, boxes, packages, devices or any ' +
  'other object shown on purpose, held or displayed. Do not include furniture, walls, plants or background objects. ' +
  'Return each one in products as box_2d with the same format, tightly around the object. If there are none, return an empty products list.';
// 1.13.0 — se suma sólo si la marca declara `avoid_people` (overlay o lámina): sin el token, la petición es la de 1.11.0.
const PEOPLE_PROMPT =
  ' Also detect every person visible in this image. Return each one in people as box_2d with the same format, around the ' +
  'WHOLE visible figure: from the top of the head to the lowest visible part of the body (the feet if they are visible), ' +
  'including arms, hands and clothing. If there are none, return an empty people list.';

// ── ENDPOINT-VERTEX:BEGIN ── (2026-10-01) bloque PURO: de una ubicación a la URL base de Vertex.
// Lo extrae `tests/endpoint_vertex_test.mjs` por estos sentinelas.
//
// Una región (`us-central1`) vive en `{region}-aiplatform.googleapis.com`. La ubicación `global` NO
// sigue ese patrón: su host es `aiplatform.googleapis.com`, sin prefijo. Construir la URL con la
// plantilla regional daría `global-aiplatform.googleapis.com`, un host que no existe.
//
// Por qué importa: Gemini 2.5 en Vertex usa cuota compartida dinámica y el endpoint `global` reparte
// la carga entre regiones, en vez de depender de la capacidad de una sola. El carril midió 429
// «Resource exhausted» en la región fija (138 en agosto, 32 en septiembre, en
// public.ops_generation_ledger).
//
// La ubicación sigue siendo DATO (`GOOGLE_CLOUD_LOCATION`); este bloque no elige ninguna. Sin la
// variable, el comportamiento es idéntico al de antes (`us-central1`).
export function vertexBaseUrl(location: string, project: string): string {
  const loc = String(location ?? '').trim();
  if (!loc) throw new Error('VERTEX_LOCATION_EMPTY: GOOGLE_CLOUD_LOCATION está vacío.');
  const host = loc === 'global' ? 'aiplatform.googleapis.com' : `${loc}-aiplatform.googleapis.com`;
  return `https://${host}/v1/projects/${project}/locations/${loc}`;
}
// ── ENDPOINT-VERTEX:END ──

// ── AUTH-VERTEX:BEGIN ── copia literal de la autenticación de `api/execute.ts`.
let _auth: GoogleAuth | null = null;
function getAuth(): GoogleAuth {
  if (_auth) return _auth;
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY ?? '';
  if (!raw) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY missing — paste the Service Account JSON into Vercel env vars.');
  }
  let credentials: any;
  try {
    credentials = JSON.parse(raw);
  } catch {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY is not valid JSON. Paste the raw JSON of the SA key.');
  }
  _auth = new GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });
  return _auth;
}

async function getAccessToken(): Promise<string> {
  const client = await getAuth().getClient();
  const tokenResponse = await client.getAccessToken();
  if (!tokenResponse.token) throw new Error('Failed to obtain GCP access token from Service Account.');
  return tokenResponse.token;
}
// ── AUTH-VERTEX:END ──

// ── MODELO-POR-ROL:BEGIN ── (2026-10-19) MULTIBRAND_RULE.md §11: el modelo de cada rol es DATO.
// Copia LITERAL en `api/inspect.ts` y `api/compose.ts`: cada función de Vercel se empaqueta por separado.
// `tests/modelo_por_rol_test.mjs` la extrae por estos sentinelas y exige que las dos copias no diverjan.
//
// Qué modelo usa un rol, en este orden:
//   1. Fuera de producción, la cabecera `x-lab-model` (y opcionalmente `x-lab-model-params`, JSON): calibrar un
//      modelo candidato con piezas reales sin tocar la tabla. En producción se ignora siempre.
//   2. La fila activa de `public.ops_lab_models` para (lab, role), leída con service_role.
//   3. El ALIAS LEGACY —el literal que había antes de la tabla— SÓLO si la consulta no se pudo hacer (entorno sin
//      Supabase, red o 5xx), con `MODEL_ROLE_LEGACY_ALIAS` en el log. Se retira cuando el log lleve una semana
//      sin esa línea.
// Si la consulta responde y NO hay fila, falla: `MODEL_ROLE_UNSEEDED`. Nunca un modelo inventado.
// La respuesta se guarda 60 s por instancia caliente: un UPDATE de la fila manda en un minuto, sin despliegue.
export interface LabModel {
  model: string;
  location: string | null;
  generationParams: Record<string, unknown>;
  source: 'ops_lab_models' | 'calibration_header' | 'legacy_alias';
}

export class ModelRoleError extends Error {
  readonly label: string;
  constructor(label: string, message: string) {
    super(`${label}: ${message}`);
    this.label = label;
  }
}

export const LAB_MODEL_TTL_MS = 60_000;
const LAB_MODEL_TIMEOUT_MS = 5_000;
const _labModelCache = new Map<string, { at: number; value: LabModel }>();
export function resetLabModelCache(): void { _labModelCache.clear(); }

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/** De las filas que devolvió PostgREST a un modelo. Puro. */
export function labModelFromRows(rows: unknown, lab: string, role: string): LabModel {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new ModelRoleError('MODEL_ROLE_UNSEEDED', `no hay fila activa en ops_lab_models para (${lab}, ${role})`);
  }
  if (rows.length > 1) {
    throw new ModelRoleError('MODEL_ROLE_AMBIGUOUS', `${rows.length} filas activas en ops_lab_models para (${lab}, ${role})`);
  }
  const r = rows[0] as Record<string, unknown>;
  const model = typeof r?.model_id === 'string' ? r.model_id.trim() : '';
  if (!model) throw new ModelRoleError('MODEL_ROLE_INVALID', `la fila de (${lab}, ${role}) no trae model_id`);
  const location = typeof r.location === 'string' && r.location.trim() ? r.location.trim() : null;
  const generationParams = isPlainObject(r.generation_params) ? r.generation_params : {};
  return { model, location, generationParams, source: 'ops_lab_models' };
}

/** La calibración sólo existe fuera de producción. Devuelve null si no aplica. Puro. */
export function calibrationFromHeaders(
  headers: Record<string, unknown>, vercelEnv: string | undefined,
): { model: string; params: Record<string, unknown> | null } | null {
  if (vercelEnv === 'production') return null;
  const model = String(headers?.['x-lab-model'] ?? '').trim().replace(/[^a-z0-9.\-]/gi, '').slice(0, 60);
  if (!model) return null;
  let params: Record<string, unknown> | null = null;
  const raw = headers?.['x-lab-model-params'];
  if (typeof raw === 'string' && raw.trim()) {
    try { const p = JSON.parse(raw); if (isPlainObject(p)) params = p; } catch { /* sin params: se usan los de la fila */ }
  }
  return { model, params };
}

/** Los parámetros del modelo se fusionan sobre los del rol. Puro. */
export function mergeGenerationConfig(
  base: Record<string, unknown>, params: Record<string, unknown>,
): Record<string, unknown> {
  return { ...base, ...params };
}

function labModelsBaseUrl(raw: string): string {
  let v = String(raw ?? '').trim().replace(/\/+$/, '');
  if (!v) return '';
  if (!/^https?:\/\//i.test(v)) {
    if (!v.includes('.')) v = `${v}.supabase.co`;
    v = `https://${v}`;
  }
  return v;
}

/** El modelo de un rol. Lanza `ModelRoleError` si la tabla responde sin fila para el rol. */
export async function resolveLabModel(
  lab: string,
  role: string,
  legacy: { model: string; generationParams: Record<string, unknown> },
  calibration: { model: string; params: Record<string, unknown> | null } | null = null,
  now: number = Date.now(),
): Promise<LabModel> {
  let resolved: LabModel;
  const key = `${lab}/${role}`;
  const hit = _labModelCache.get(key);
  if (hit && now - hit.at < LAB_MODEL_TTL_MS) {
    resolved = hit.value;
  } else {
    const base = labModelsBaseUrl(process.env.SUPABASE_URL ?? '');
    const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
    const alias = (why: string): LabModel => {
      console.warn(`[ImageLab][modelo] MODEL_ROLE_LEGACY_ALIAS lab=${lab} role=${role} model=${legacy.model}: ${why}`);
      return { model: legacy.model, location: null, generationParams: legacy.generationParams, source: 'legacy_alias' };
    };
    let rows: unknown = null;
    let failure: string | null = null;
    if (!base || !sbKey) {
      failure = 'faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY';
    } else {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), LAB_MODEL_TIMEOUT_MS);
      try {
        const q = `lab=eq.${encodeURIComponent(lab)}&role=eq.${encodeURIComponent(role)}&active=eq.true` +
          '&select=model_id,location,generation_params&limit=2';
        const res = await fetch(`${base}/rest/v1/ops_lab_models?${q}`, {
          headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}`, Accept: 'application/json' },
          signal: controller.signal,
        });
        if (res.ok) rows = await res.json();
        else failure = `ops_lab_models respondió ${res.status}: ${(await res.text()).slice(0, 160)}`;
      } catch (err) {
        failure = err instanceof Error && err.name === 'AbortError'
          ? `ops_lab_models superó ${LAB_MODEL_TIMEOUT_MS / 1000} s`
          : `ops_lab_models no respondió: ${err instanceof Error ? err.message : String(err)}`.slice(0, 200);
      } finally {
        clearTimeout(tid);
      }
    }
    if (failure) {
      resolved = alias(failure);   // no se guarda: la próxima llamada vuelve a intentar la tabla
    } else {
      resolved = labModelFromRows(rows, lab, role);
      _labModelCache.set(key, { at: now, value: resolved });
    }
  }
  if (!calibration) return resolved;
  return {
    model: calibration.model,
    location: resolved.location,
    generationParams: calibration.params ?? resolved.generationParams,
    source: 'calibration_header',
  };
}
// ── MODELO-POR-ROL:END ──

// ── LIBRO-DIRECTO:BEGIN ── (2026-10-20) bloque IDÉNTICO en api/execute.ts, api/inspect.ts y
// api/compose.ts. Lo extrae `tests/libro_directo_test.mjs` por estos sentinelas y falla si las copias
// divergen. Usa sólo `fetch` y `process.env`: nada de fuera del bloque.
//
// EL DEFECTO QUE CIERRA, medido el 2026-10-20: en octubre Google facturó ≈ 19,67 USD que
// `public.ops_generation_ledger` no tenía, ≈ 465 imágenes con sus prompts e inspecciones generadas por
// llamadas DIRECTAS a ImageLab (interfaz, BluePrints, scripts) el 3, 4 y 18 de octubre. ImageLab no
// asentaba nada: el libro sólo lo escribía el carril de `unrlvl-iid-functions`, y sólo para las
// llamadas que él mismo hacía. Toda otra llamada a Vertex era gasto invisible.
//
// LA REGLA: toda llamada a Vertex hecha por ImageLab queda en el libro UNA sola vez.
//   · el cuerpo trae `ledger_by_caller: true` → la asienta quien llama (el carril); ImageLab no escribe
//     nada y la respuesta es byte a byte la de antes;
//   · cualquier otro cuerpo → ImageLab asienta cada llamada que HIZO (éxito, fallo y descartada) por la
//     puerta canónica, el RPC `ops_log_generation`, con `source_app = 'imagelab-directo'`.
// Una llamada que NO se hizo (validación, entorno, rol sin modelo) no deja fila: no hubo gasto.
//
// UNIDADES, las mismas que el carril: imagen y texto por tokens (`tokens_in` en el libro = fila con
// entrada y salida). El PRECIO lo pone la base contra `ops_lab_rates`: este bloque no conoce tarifas.
// Sin consumo reportado no se inventa un número: el asiento dice por qué (`NOT_BILLED:…` o
// `USAGE_UNREPORTED`), con el mismo vocabulario que el bloque LLAMADA-FALLIDA del carril.
//
// MARCA: la que trae la petición, verificada contra `public.brands`. Sin marca válida se asienta IGUAL
// (un gasto sin asentar es peor) con `p_brand_id = null`: la base la manda a operaciones del estudio
// (COSTOS-03) y `error_msg` lleva `LEDGER_SIN_MARCA`.
//
// UN FALLO AL ASENTAR NO ROMPE LA RESPUESTA: cada asiento va en try/catch con un tope de tiempo,
// `console.error` sin credenciales, y la respuesta sale igual.
//
// MULTIBRAND: cero marcas, cero canales, cero modelos. El modelo es el que la llamada usó; la marca, la
// de la petición; el proveedor, el de Vertex (este bloque sólo asienta llamadas a Vertex).
const LEDGER_LAB = 'imagelab';
export const LEDGER_DIRECT_SOURCE_APP = 'imagelab-directo';
const LEDGER_VERTEX_PROVIDER = 'google';
export const LEDGER_SIN_MARCA = 'LEDGER_SIN_MARCA';
const LEDGER_MARCA_NO_VERIFICADA = 'LEDGER_MARCA_NO_VERIFICADA';
const LEDGER_USAGE_MISSING = 'LEDGER_USAGE_MISSING: Vertex respondió 2xx sin el conteo de salida — sin estimación';
const LEDGER_NOT_BILLED = 'NOT_BILLED:';
const LEDGER_USAGE_UNREPORTED = 'USAGE_UNREPORTED';
export const LEDGER_RPC_TIMEOUT_MS = 4_000;
const LEDGER_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Una fila del libro, antes de la marca y del contexto de la petición. */
export interface LedgerRow {
  output_type: string;
  model_id: string;
  input_units: number;
  output_units: number;
  status: 'success' | 'failed' | 'discarded';
  /** Motivo de un asiento sin precio (sin consumo reportado). `null` = lo precia la base. */
  unpriced: string | null;
  markers: string[];
  billable?: 'refacturable' | 'estructura';
  duration_ms?: number | null;
}

/** ¿Asienta quien llama? Sólo `true` estricto: cualquier otro valor deja el asiento a ImageLab. */
export function ledgerByCaller(body: unknown): boolean {
  return !!body && typeof body === 'object' && (body as Record<string, unknown>).ledger_by_caller === true;
}

/** La marca que trae la petición (`brand_id` o `brandId`), recortada. `null` si no trae ninguna. */
export function ledgerBrandOf(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  for (const v of [b.brand_id, b.brandId]) {
    if (typeof v === 'string' && v.trim() && v.trim().toUpperCase() !== 'NULL') return v.trim();
  }
  return null;
}

/** El consumo de una respuesta, en cualquiera de las dos formas que viajan en ImageLab: el
 *  `usageMetadata` crudo de Vertex (promptTokenCount / candidatesTokenCount) o `{ input_tokens,
 *  output_tokens }`. Sin coacción: un texto no es un número. `null` = no hay consumo reportado. */
export function ledgerTokens(usage: unknown): { input: number; output: number; outputReported: boolean } | null {
  if (!usage || typeof usage !== 'object') return null;
  const u = usage as Record<string, unknown>;
  const fin = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
  const pin = fin(u.promptTokenCount) ? u.promptTokenCount : fin(u.input_tokens) ? u.input_tokens : null;
  const pout = fin(u.candidatesTokenCount) ? u.candidatesTokenCount : fin(u.output_tokens) ? u.output_tokens : null;
  if (pin === null && pout === null) return null;
  return { input: (pin as number | null) ?? 0, output: (pout as number | null) ?? 0, outputReported: pout !== null };
}

/** Por qué una llamada hecha y sin consumo reportado no lleva precio. */
export function ledgerUnpricedReason(httpStatus: unknown): string {
  if (Number.isInteger(httpStatus) && ((httpStatus as number) < 200 || (httpStatus as number) > 299))
    return `${LEDGER_NOT_BILLED}PROVIDER_HTTP_${httpStatus}`;
  return LEDGER_USAGE_UNREPORTED;
}

/** Una llamada a Vertex hecha, como fila. `ok` = la llamada cumplió; `httpStatus` = el código de Vertex
 *  (`null` sin respuesta). Con consumo → la precia la base; sin él → el motivo, nunca un número. */
export function ledgerCallRow(p: {
  outputType: string; model: string | null | undefined; usage: unknown; ok: boolean; httpStatus?: number | null;
  status?: LedgerRow['status']; markers?: string[]; billable?: LedgerRow['billable']; durationMs?: number | null;
}): LedgerRow {
  const t = ledgerTokens(p.usage);
  const markers = [...(p.markers ?? [])];
  const model = typeof p.model === 'string' && p.model.trim() ? p.model.trim() : 'UNKNOWN';
  if (model === 'UNKNOWN') markers.push('LEDGER_MODEL_MISSING: la llamada no dejó dicho su modelo');
  let unpriced: string | null = null;
  if (!t) unpriced = p.ok ? LEDGER_USAGE_UNREPORTED : ledgerUnpricedReason(p.httpStatus ?? null);
  else if (p.ok && !t.outputReported) { unpriced = LEDGER_USAGE_UNREPORTED; markers.push(LEDGER_USAGE_MISSING); }
  return {
    output_type: p.outputType, model_id: model,
    input_units: t?.input ?? 0, output_units: t?.output ?? 0,
    status: p.status ?? (p.ok ? 'success' : 'failed'), unpriced, markers,
    ...(p.billable ? { billable: p.billable } : {}),
    ...(p.durationMs !== undefined ? { duration_ms: p.durationMs } : {}),
  };
}

/** Las filas de una respuesta de `/api/execute` (éxito o fallo, modo directo o del orquestador): la
 *  imagen entregada o fallida, cada intento descartado, y el constructor de prompt si se llamó. Lee el
 *  MISMO cuerpo que el carril lee para asentar, así que las dos vías no pueden contar distinto. */
export function ledgerRowsFromExecute(payload: unknown): LedgerRow[] {
  if (!payload || typeof payload !== 'object') return [];
  const p = payload as Record<string, any>;
  const rows: LedgerRow[] = [];
  const delivered = typeof p.image_data_url === 'string' && p.image_data_url.length > 0;
  if (delivered) {
    rows.push(ledgerCallRow({ outputType: 'image', model: p.model, usage: p.usage, ok: true }));
  } else if (p.status === 'error' && p.provider_called === true) {
    rows.push(ledgerCallRow({ outputType: 'image', model: p.model, usage: p.usage, ok: false, httpStatus: p.provider_http_status }));
  }
  if (Array.isArray(p.discarded_attempts)) {
    for (const d of p.discarded_attempts) {
      if (!d || typeof d !== 'object') continue;
      const reason = typeof d.reason === 'string' && d.reason.trim() ? d.reason.trim() : 'UNSPECIFIED';
      rows.push(ledgerCallRow({ outputType: 'image', model: d.model ?? p.model, usage: d.usage, ok: true,
        status: 'discarded', markers: [`IMAGE_ATTEMPT_DISCARDED:${reason}`], durationMs: 0 }));
    }
  }
  const builderModel = typeof p.prompt_builder_model === 'string' ? p.prompt_builder_model.trim() : '';
  if (builderModel) {
    const failed = p.prompt_builder_failed === true;
    rows.push(ledgerCallRow({ outputType: 'image_prompt', model: builderModel, usage: p.prompt_builder_usage,
      ok: !failed, httpStatus: failed ? p.prompt_builder_http_status : null,
      markers: p.prompt_builder_version ? [`prompt_builder v${p.prompt_builder_version}`] : [] }));
  }
  return rows;
}

/** El `piece_id` de la petición si es un UUID; si no, `null` (el RPC lo castea y un texto lo rompería). */
export function ledgerPieceId(body: unknown): string | null {
  const v = body && typeof body === 'object' ? (body as Record<string, unknown>).piece_id : null;
  return typeof v === 'string' && LEDGER_UUID.test(v.trim()) ? v.trim() : null;
}

/** Los argumentos de `ops_log_generation` para una fila. Sin precio declarado: la base lo resuelve. */
export function ledgerRpcArgs(row: LedgerRow, ctx: {
  brandId: string | null; brandNote: string | null; platform: string | null; pieceId: string | null; durationMs: number | null;
}): Record<string, unknown> {
  const errorMsg = [...row.markers, ctx.brandNote].filter(Boolean).join(' | ') || null;
  const dur = row.duration_ms !== undefined ? row.duration_ms : ctx.durationMs;
  return {
    p_lab: LEDGER_LAB, p_brand_id: ctx.brandId, p_job_id: null, p_piece_id: ctx.pieceId,
    p_output_type: row.output_type, p_platform: ctx.platform, p_provider: LEDGER_VERTEX_PROVIDER,
    p_model_id: row.model_id, p_unit_type: 'tokens_in',
    p_input_units: row.input_units, p_output_units: row.output_units,
    // Sin consumo: costo cero con el motivo en `rate_source` (el criterio de `unpricedRate` del carril).
    // Con consumo: ni costo ni tarifa, y la base resuelve la tarifa vigente del modelo.
    ...(row.unpriced ? { p_cost_usd: 0, p_rate_source: row.unpriced } : {}),
    p_status: row.status,
    p_duration_ms: Number.isFinite(dur) ? Math.round(dur as number) : null,
    p_error_msg: errorMsg,
    p_source_app: LEDGER_DIRECT_SOURCE_APP,
    ...(row.billable ? { p_billable: row.billable } : {}),
  };
}

function ledgerBaseUrl(raw: string): string {
  const s = raw.trim().replace(/\/+$/, '');
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  if (s.includes('.')) return `https://${s}`;
  return `https://${s}.supabase.co`;
}

async function ledgerFetch(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), LEDGER_RPC_TIMEOUT_MS);
  try { return await fetch(url, { ...init, signal: controller.signal }); }
  finally { clearTimeout(tid); }
}

/** La marca del asiento: la de la petición si existe en `public.brands`. Sin marca o con una que no
 *  existe → `null` y LEDGER_SIN_MARCA. Si la verificación misma falla, se conserva la de la petición y
 *  se dice que no se verificó: perder la marca por un fallo de lectura sería peor que no verificarla. */
export async function ledgerResolveBrand(raw: string | null, base: string, key: string): Promise<{ brandId: string | null; note: string | null }> {
  if (!raw) return { brandId: null, note: `${LEDGER_SIN_MARCA}: la petición no trae brand_id` };
  const shown = JSON.stringify(raw.slice(0, 64));
  try {
    const res = await ledgerFetch(`${base}/rest/v1/brands?id=eq.${encodeURIComponent(raw)}&select=id&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!res.ok) return { brandId: raw, note: `${LEDGER_MARCA_NO_VERIFICADA}: brands respondió ${res.status}` };
    const rows = await res.json();
    if (Array.isArray(rows) && rows.length) return { brandId: raw, note: null };
    return { brandId: null, note: `${LEDGER_SIN_MARCA}: la marca ${shown} de la petición no existe en public.brands` };
  } catch (err) {
    return { brandId: raw, note: `${LEDGER_MARCA_NO_VERIFICADA}: ${(err instanceof Error ? err.message : String(err)).slice(0, 120)}` };
  }
}

/** Asienta las filas de una petición directa. NUNCA lanza y NUNCA cambia la respuesta: devuelve cuántas
 *  filas escribió, para el log y los tests. Con `ledger_by_caller: true`, no hace nada (ni red). */
export async function ledgerRecordDirect(body: unknown, rows: LedgerRow[], ctx: {
  platform?: string | null; durationMs?: number | null; tag: string;
}): Promise<{ skipped: boolean; written: number; failed: number }> {
  if (ledgerByCaller(body) || !rows.length) return { skipped: true, written: 0, failed: 0 };
  let written = 0, failed = 0;
  try {
    const base = ledgerBaseUrl(process.env.SUPABASE_URL ?? '');
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
    if (!base || !key) {
      console.error(`[ImageLab][LIBRO] ${ctx.tag} LEDGER_ENV_MISSING: faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY; ${rows.length} asiento(s) sin escribir`);
      return { skipped: false, written: 0, failed: rows.length };
    }
    const brand = await ledgerResolveBrand(ledgerBrandOf(body), base, key);
    const pieceId = ledgerPieceId(body);
    const platform = typeof ctx.platform === 'string' && ctx.platform.trim() ? ctx.platform.trim() : null;
    await Promise.all(rows.map(async (row) => {
      try {
        const res = await ledgerFetch(`${base}/rest/v1/rpc/ops_log_generation`, {
          method: 'POST',
          headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(ledgerRpcArgs(row, { brandId: brand.brandId, brandNote: brand.note, platform, pieceId, durationMs: ctx.durationMs ?? null })),
        });
        if (!res.ok) {
          failed++;
          console.error(`[ImageLab][LIBRO] ${ctx.tag} ops_log_generation ${res.status} (${row.output_type} ${row.model_id}): ${(await res.text()).slice(0, 200)}`);
        } else written++;
      } catch (err) {
        failed++;
        console.error(`[ImageLab][LIBRO] ${ctx.tag} asiento no escrito (${row.output_type} ${row.model_id}): ${(err instanceof Error ? err.message : String(err)).slice(0, 200)}`);
      }
    }));
    console.log(`[ImageLab][LIBRO] ${ctx.tag} asientos=${written}/${rows.length} marca=${brand.brandId ?? 'operaciones'}${brand.note ? ` (${brand.note.split(':')[0]})` : ''}`);
  } catch (err) {
    console.error(`[ImageLab][LIBRO] ${ctx.tag} libro no disponible: ${(err instanceof Error ? err.message : String(err)).slice(0, 200)}`);
    return { skipped: false, written, failed: rows.length - written };
  }
  return { skipped: false, written, failed };
}
// ── LIBRO-DIRECTO:END ──

type FaceCheck = {
  faces: FaceBox[] | null; signs: FaceBox[] | null; products: FaceBox[] | null; people: FaceBox[] | null; model: string; model_source?: LabModel['source']; called: boolean; http_status: number | null;
  usage: { input_tokens: number; output_tokens: number } | null; error: string | null; duration_ms: number;
};

async function detectFaces(
  bytes: Uint8Array, mime: string,
  opts: { signs?: boolean; products?: boolean; people?: boolean; calibration?: { model: string; params: Record<string, unknown> | null } | null } = {},
): Promise<FaceCheck> {
  const t0 = Date.now();
  const out: FaceCheck = { faces: null, signs: null, products: null, people: null, model: 'UNKNOWN', called: false, http_status: null, usage: null, error: null, duration_ms: 0 };
  const boxList = { type: 'ARRAY', items: { type: 'OBJECT', required: ['box_2d'], properties: { box_2d: { type: 'ARRAY', items: { type: 'INTEGER' } } } } };
  // Las listas que se piden: caras siempre; letreros (1.6.3) y productos (1.11.0) sólo si la marca los declara.
  const schemaKeys = ['faces', ...(opts.signs ? ['signs'] : []), ...(opts.products ? ['products'] : [])];
  // 1.13.0 — las figuras humanas completas, sólo si la marca declara `avoid_people`: sin él, la petición es la de 1.11.0.
  if (opts.people) schemaKeys.push('people');
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), FACES_TIMEOUT_MS);
  try {
    if (!FACES_GCP_PROJECT()) throw new Error('GOOGLE_CLOUD_PROJECT missing in env.');
    const lm = await resolveLabModel('imagelab', FACES_ROLE, LEGACY_FACES_MODEL, opts.calibration ?? null);
    out.model = lm.model;
    out.model_source = lm.source;
    const token = await getAccessToken();
    const url = `${vertexBaseUrl(lm.location ?? FACES_GCP_LOCATION(), FACES_GCP_PROJECT())}/publishers/google/models/${encodeURIComponent(out.model)}:generateContent`;
    out.called = true;
    const res = await fetch(url, {
      method: 'POST', signal: controller.signal,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ inlineData: { mimeType: mime, data: b64(bytes) } }, { text: FACES_PROMPT + (opts.signs ? SIGNS_PROMPT : '') + (opts.products ? PRODUCTS_PROMPT : '') + (opts.people ? PEOPLE_PROMPT : '') }] }],
        generationConfig: mergeGenerationConfig({
          temperature: 0, responseMimeType: 'application/json',
          responseSchema: { type: 'OBJECT', required: schemaKeys, properties: Object.fromEntries(schemaKeys.map((k) => [k, boxList])) },
        }, lm.generationParams),
      }),
    });
    out.http_status = res.status;
    if (!res.ok) throw new Error(`Vertex ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    const um = data?.usageMetadata;
    if (typeof um?.promptTokenCount === 'number' && typeof um?.candidatesTokenCount === 'number') {
      out.usage = { input_tokens: um.promptTokenCount, output_tokens: um.candidatesTokenCount + (Number(um.thoughtsTokenCount) || 0) };
    }
    const text = (data?.candidates?.[0]?.content?.parts ?? []).map((p: any) => (typeof p?.text === 'string' ? p.text : '')).join('');
    if (!text) throw new Error(`sin respuesta (${data?.candidates?.[0]?.finishReason ?? 'sin texto'})`);
    out.faces = parseFaceBoxes(text);
    if (opts.signs) out.signs = parseFaceBoxes(text, 'signs');
    if (opts.products) out.products = parseFaceBoxes(text, 'products');
    if (opts.people) out.people = parseFaceBoxes(text, 'people');
  } catch (err) {
    out.error = err instanceof Error && err.name === 'AbortError' ? `el detector superó ${FACES_TIMEOUT_MS / 1000} s`
      : (err instanceof Error ? err.message : String(err)).slice(0, 240);
  } finally {
    clearTimeout(tid);
    out.duration_ms = Date.now() - t0;
  }
  return out;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed', error_label: 'METHOD_NOT_ALLOWED' }); return; }

  let body: any;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? null);
  } catch { body = null; }
  if (!body || typeof body !== 'object') {
    res.status(400).json({ error: 'Invalid JSON', error_label: 'COMPOSITOR_BAD_REQUEST', status: 'error' });
    return;
  }

  const t0 = Date.now();
  try {
    const brandId = String(body.brand_id ?? '').trim();
    const canal = body.canal == null ? null : String(body.canal).trim().toUpperCase();
    const headline = String(body.headline ?? '');
    const subheadline = body.subheadline == null ? null : String(body.subheadline);
    if (!brandId) throw new CompositorError('COMPOSITOR_BRAND_MISSING', 'brand_id es obligatorio: los tokens son por marca', 400);
    // F3 — el campo `carousel` se valida contra el contrato ANTES de leer nada: un 400 es un error
    // del llamador y no depende de los datos de la marca.
    const carouselIn = parseCarouselRequest(body.carousel);
    // 1.4.0 — tramos de énfasis del titular. Se validan con el resto del contrato, antes de leer dato.
    const emphasisIn = parseEmphasisRequest(body.emphasis);
    const emphasisRoleIn = parseEmphasisRoleRequest(body.emphasis_role);
    // 1.9.0 — la sombra y el filete elegidos por una persona. Se validan con el resto del contrato.
    const textShadowIn = parseTextShadowRequest(body.text_shadow);
    const shadowSpansIn = parseShadowSpansRequest(body.shadow_spans);
    const ruleRoleIn = parseRuleRoleRequest(body.rule_role);
    // 1.10.0 — el color de la franja de identidad elegido por una persona.
    const identityRoleIn = parseIdentityRoleRequest(body.identity_role);
    // 1.12.0 — la fila del texto pedida por una persona. Sin el campo, todo lo de abajo es 1.11.1.
    const textPlaceIn = parseTextPlaceRequest(body.text_place);
    const hasImage = !!(body.image_data_url || body.image_url);
    // BRIEF 8 · D — un titular vacío ya NO es motivo suficiente para rechazar: si la marca declara
    // franja de identidad, la escena se SELLA igual (el sello no es un adorno del texto). La guarda
    // de BRIEF 7 sigue viva para el caso en que no habría NADA que dibujar, y se evalúa abajo,
    // cuando los tokens ya dijeron si hay identidad. Lo que no cambia: aquí no se escribe texto.
    // F3 — una lámina de carrusel con fondo de superficie no lleva foto: la imagen no se exige aquí y
    // se vuelve a exigir abajo si la marca no tiene `tokens.carousel` (sin cromo no hay superficie).
    if (!hasImage && carouselIn?.background !== 'surface') {
      throw new CompositorError('COMPOSITOR_IMAGE_MISSING', 'falta image_data_url o image_url (la imagen limpia a componer)', 400);
    }

    // Las tres capas de dato, en paralelo. Cada una fail-loud por su cuenta.
    const [tokenRows, typography, palette] = await Promise.all([
      sbSelect(`imagelab_overlay_tokens?or=(brand_id.eq.${encodeURIComponent(brandId)},brand_id.is.null)&select=id,brand_id,canal,tokens,active`),
      sbSelect(`brand_typography?brand_id=eq.${encodeURIComponent(brandId)}&select=role,font_family,css_import,fallback`),
      sbSelect(`brand_palette?brand_id=eq.${encodeURIComponent(brandId)}&select=role,hex`),
    ]);

    const picked = pickOverlayTokens(tokenRows as any[], brandId, canal);
    const resolved = resolveOverlayStyle({ tokens: picked.tokens, typography: typography as any[], palette: palette as any[], text: { headline, subheadline, emphasis: emphasisIn } });
    // 1.8.0 — el color del resaltado elegido por una persona, si lo hay.
    const roleApplied = applyEmphasisRole(resolved, emphasisRoleIn, palette as any[], emphasisAllowedRoles(picked.tokens));
    // 1.9.0 — el filete y la sombra elegidos por una persona, si los hay. Sin campos, el estilo sale igual.
    const ruleApplied = applyRuleRole(roleApplied.style, ruleRoleIn, palette as any[], ruleAllowedRoles(picked.tokens));
    const identityApplied = applyIdentityRole(ruleApplied.style, identityRoleIn, palette as any[], identityAllowedRoles(picked.tokens));
    const shadowApplied = textShadowIn || shadowSpansIn.length
      ? applyTextShadowRequest(identityApplied.style, textShadowIn, shadowSpansIn) : null;
    const style = shadowApplied ? shadowApplied.style : identityApplied.style;

    // ── F3 · lámina de carrusel ── Sólo si llega `carousel` Y la marca declara `tokens.carousel`.
    // Si no, todo lo de abajo es exactamente 1.2.0.
    const warnings: string[] = [];
    const carouselTokens = picked.tokens.carousel;
    // 1.11.0 — las claves de política (`avoid_faces`, `avoid_products`) no declaran un carrusel: viven en la capa global.
    const carouselOn = !!carouselIn && carouselChromeDeclared(carouselTokens);
    if (carouselIn && !carouselOn) {
      warnings.push(`CAROUSEL_NOT_DECLARED: la marca no declara tokens.carousel (capas: ${picked.layers.join(' < ')}); se compone como 1.2.0`);
      if (!hasImage) {
        throw new CompositorError('COMPOSITOR_IMAGE_MISSING',
          'carousel.background=surface sin imagen, y la marca no declara tokens.carousel: sin cromo de carrusel no hay superficie que pintar', 400);
      }
    }
    if (carouselOn) {
      if (!headline.trim() && !carouselIn!.figure) {
        throw new CompositorError('COMPOSITOR_TEXT_MISSING',
          'lámina de carrusel sin titular y sin cifra: no hay nada que componer. El compositor NO escribe texto (BRIEF 7, regla a).', 400);
      }
      const logo = await loadSignatureLogo(brandId, warnings);
      const chrome = resolveCarouselChrome({
        tokens: picked.tokens, typography: typography as any[], palette: palette as any[],
        carousel: carouselIn, text: { headline, subheadline, emphasis: emphasisIn }, logo,
      });
      if (!chrome.applied) throw new CompositorError('COMPOSITOR_FAILED', 'cromo de carrusel no resuelto', 500);
      warnings.push(...chrome.warnings);
      const prodPick = resolveProductLayer({ tokens: picked.tokens, textAnchor: null, count: Array.isArray(body.products) ? body.products.length : 0 });
      if (prodPick.layer) warnings.push('CAROUSEL_PRODUCT_LAYER_NOT_COMPOSED: la lámina de carrusel no pega la capa de producto');

      // Fondo: la foto se baja sólo si la lámina la usa. El lienzo es el de la marca (dato), así que
      // todas las láminas de un carrusel salen del MISMO tamaño, tengan foto o no.
      let backgroundSrc: string | null = null;
      let slideBytes: Uint8Array | null = null;
      let slideDims: ReturnType<typeof imageDimensions> | null = null;
      if (chrome.slide.background === 'image') {
        const cleanBytes = body.image_data_url
          ? dataUrlToBytes(String(body.image_data_url))
          : await fetchBytes(String(body.image_url), 'COMPOSITOR_IMAGE_FETCH_FAILED');
        const d = imageDimensions(cleanBytes);
        backgroundSrc = `data:${d.mime};base64,${b64(cleanBytes)}`;
        slideBytes = cleanBytes;
        slideDims = d;
      }
      // 1.11.0 — la política de la lámina (dato). Se valida siempre; sólo actúa sobre foto.
      const avoid = resolveCarouselAvoid(picked.tokens);
      const fonts = await Promise.all(chrome.fonts.map(async (f) => ({
        slot: `carousel:${f.role}`,
        ...(await loadFont(`carousel:${f.role}`, { role: f.role, family: f.family, cssImport: f.cssImport, fontUrl: null, weight: f.weight, italic: f.italic })),
      })));
      // 1.3.3 — el ajuste vertical se mide con las MISMAS fuentes que recibe satori (ya sin kerning).
      const metrics: Record<string, FontAdvance | null> = {};
      chrome.fonts.forEach((f, k) => { metrics[fitFontKey(f)] = fontAdvanceMetrics(fonts[k].data); });
      // 1.5.0 — primero el límite de área de la plataforma (sólo portada), después el ajuste vertical.
      const area = fitCarouselCoverArea({ chrome, metrics });
      warnings.push(...area.warnings);
      // 1.11.0 — EL TEXTO NO TAPA CARAS NI PRODUCTOS. Con la política y foto: la MISMA detección de 1.6.x (más
      // productos, si se declaran) y la colocación libre de la maqueta. Sin política, sin foto o si la detección falla,
      // el ajuste de siempre: la lámina de 1.10.0.
      let fit: ReturnType<typeof fitCarouselContent>;
      let slideFaceMeta: Record<string, unknown> | null = null;
      let avoidMeta: Record<string, unknown> | null = null;
      if (avoid && slideBytes && slideDims) {
        const fc = await detectFaces(slideBytes, slideDims.mime, { products: !!avoid.products, people: !!avoid.people,
          calibration: calibrationFromHeaders(req.headers as Record<string, unknown>, process.env.VERCEL_ENV) });
        slideFaceMeta = { model: fc.model, model_source: fc.model_source ?? null, provider_called: fc.called, provider_http_status: fc.http_status,
          usage: fc.usage, duration_ms: fc.duration_ms, boxes: fc.faces, ...(avoid.products ? { product_boxes: fc.products } : {}),
          ...(avoid.people ? { people_boxes: fc.people } : {}), error: fc.error };
        // LIBRO-DIRECTO — como en el overlay: la llamada se asienta en cuanto se hizo. El carril (`ledger_by_caller`) la
        // asienta él con `logComposeFaces`, que lee este mismo `meta.faces`.
        if (fc.called) {
          try {
            await ledgerRecordDirect(body, [ledgerCallRow({ outputType: 'image_overlay_faces', model: fc.model, usage: fc.usage,
              ok: !fc.error, httpStatus: fc.http_status, billable: 'estructura', durationMs: fc.duration_ms,
              markers: fc.error ? [String(fc.error).slice(0, 240)] : [] })], { platform: canal, durationMs: fc.duration_ms, tag: 'compose' });
          } catch (err) {
            console.error(`[ImageLab][LIBRO] compose asiento omitido: ${(err instanceof Error ? err.message : String(err)).slice(0, 200)}`);
          }
        }
        if (fc.faces) {
          const { width: cw, height: ch } = area.chrome.canvas;
          const pick = chooseCarouselPlacement({ chrome: area.chrome, metrics, avoid, slideIndex: carouselIn!.index, textPlace: textPlaceIn,
            faces: coverMapBoxes(fc.faces, slideDims.width, slideDims.height, cw, ch),
            products: coverMapBoxes(fc.products ?? [], slideDims.width, slideDims.height, cw, ch),
            people: coverMapBoxes(fc.people ?? [], slideDims.width, slideDims.height, cw, ch) });
          fit = pick.fit;
          warnings.push(...pick.warnings);
          avoidMeta = pick.report;
          // Último recurso 'inset': la foto se recorta a la proporción del hueco, centrada en lo que hay que ver.
          const ins = fit.chrome.inset;
          if (ins) {
            try {
              const cr = insetCropRect(slideDims.width, slideDims.height, ins.x1 - ins.x0, ins.y1 - ins.y0,
                [...fc.faces, ...(avoid.products ? (fc.products ?? []) : []), ...(avoid.people ? (fc.people ?? []) : [])]);
              const cropped = await sharp(Buffer.from(slideBytes)).extract(cr).png().toBuffer();
              backgroundSrc = `data:image/png;base64,${b64(new Uint8Array(cropped))}`;
              avoidMeta = { ...avoidMeta, inset_crop: cr };
            } catch (e) {
              warnings.push(`CAROUSEL_PHOTO_INSET_CROP_FAILED: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}; la foto entra entera, centrada`);
            }
          }
        } else {
          // 1.12.0 — con una fila pedida, la detección caída no la deshace: se compone en esa fila.
          const rowIn = textPlaceIn === 'top' || textPlaceIn === 'bottom' ? textPlaceIn : null;
          fit = fitCarouselAtPlace({ chrome: area.chrome, metrics, textPlace: textPlaceIn });
          warnings.push(`CAROUSEL_FACE_CHECK_UNAVAILABLE: ${fc.error ?? 'sin respuesta'}; ${rowIn ? `se compone en la fila pedida (${rowIn})` : 'se compone en el centro de la maqueta, como siempre'}`);
          avoidMeta = { faces: null, placement_used: rowIn ?? 'center', moved: false, fallback: null, reason: `detección no disponible: ${fc.error ?? 'sin respuesta'}` };
        }
      } else {
        // 1.12.0 — sin la política o sin foto, la fila pedida se aplica igual; sin pedido, el ajuste de siempre.
        fit = fitCarouselAtPlace({ chrome: area.chrome, metrics, textPlace: textPlaceIn });
        if (textPlaceIn === 'auto' && !avoid && chrome.slide.background === 'image') {
          warnings.push('CAROUSEL_TEXT_PLACE_AUTO_WITHOUT_POLICY: se pidió que el texto no tape cara ni producto, pero la marca no declara carousel.avoid_faces; se compone en el centro de la maqueta');
        }
      }
      // 1.13.0 — ninguna palabra sola al final del titular, con la colocación y el tamaño ya decididos.
      fit = carouselAvoidOrphan(fit, metrics);
      warnings.push(...fit.warnings);
      const scene = buildCarouselScene({ chrome: fit.chrome, style, backgroundSrc });
      const { width, height } = chrome.canvas;
      const svg = await satori(scene as any, {
        width, height,
        fonts: fonts.map((f) => ({ name: f.name, data: Buffer.from(f.data), weight: f.weight as any, style: f.style })),
      });
      const png = new Resvg(svg, { fitTo: { mode: 'original' } }).render().asPng();
      console.log(
        `[Compositor][F3] brand=${brandId} canal=${canal ?? '∅'} piece=${body.piece_id ?? '∅'} ` +
        `lámina=${chrome.slide.index}/${chrome.slide.total} ${chrome.slide.role} fondo=${chrome.slide.background} ` +
        `tokens=${picked.source} ${width}x${height} logotipo=${chrome.logo ? chrome.logo.kind : 'ninguno'} ` +
        `ajuste=${fit.report.adjusted ? `sí (holgura ${fit.report.slack_px}px)` : 'no'} avisos=${warnings.length} ${Date.now() - t0}ms`,
      );
      res.status(200).json({
        status: 'ok',
        image_data_url: `data:image/png;base64,${b64(new Uint8Array(png))}`,
        compositor_version: COMPOSITOR_VERSION,
        tokens_source: picked.source,
        tokens_layers: picked.layers,
        width, height,
        fonts: fonts.map((f) => ({ slot: f.slot, family: f.name, weight: f.weight, source: f.source })),
        // La franja de identidad sólo se dibuja en láminas con foto (sobre superficie, el logotipo firma).
        identity: style.identity && backgroundSrc && !fit.chrome.inset
          ? { mode: style.identity.mode, color: style.identity.color, width_pct: style.identity.widthPct,
              thickness_px: Math.max(1, Math.round((style.identity.widthPct / 100) * Math.min(width, height))),
              short_side: Math.min(width, height) }
          : null,
        sealed_without_title: false,
        product_layer: null,
        markers: style.markers,
        text: { headline, subheadline, ...(emphasisIn.length ? { emphasis: emphasisIn } : {}) },
        meta: {
          carousel_applied: true,
          warnings,
          // 1.11.0 — la detección de la lámina, con la forma del overlay: el carril la asienta (`logComposeFaces`).
          ...(slideFaceMeta ? { faces: slideFaceMeta } : {}),
          carousel: {
            index: chrome.slide.index, total: chrome.slide.total, role: chrome.slide.role, background: chrome.slide.background,
            keyword_found: !!chrome.headline.find((p) => p.keyword), logo: chrome.logo ? chrome.logo.kind : null,
            // 1.4.0 — qué tramos se resaltaron y con qué estilo (null si la marca no declara énfasis).
            emphasis: emphasisIn.length || chrome.headlineEmphasis
              ? { requested: emphasisIn, highlighted: chrome.headline.filter((p) => p.keyword).map((p) => p.text),
                  styled: !!chrome.headlineEmphasis }
              : null,
            // 1.3.4 — si la lámina llevó efecto de texto, y cuál: sólo en láminas con foto.
            text_effect: chrome.textEffect && backgroundSrc && !fit.chrome.inset
              ? { kind: chrome.textEffect.kind, color: chrome.textEffect.fn, alpha: chrome.textEffect.alpha,
                  blur_pct: chrome.textEffect.blurPct, offset_pct: chrome.textEffect.offsetPct, text_shadow: carouselTextShadow(chrome.textEffect, width) }
              : null,
            // 1.3.3 — qué hizo el ajuste vertical: sin esto no se puede auditar una lámina reducida.
            fit: fit.report,
            // 1.5.0 — el límite de área de la portada, si rigió.
            ...(area.report ? { text_area: area.report } : {}),
            // 1.11.0 — qué se detectó, dónde quedó el bloque y por qué (sólo con la política y foto).
            ...(avoidMeta ? { avoid: avoidMeta } : {}),
            // 1.12.0 — la fila pedida y dónde quedó el bloque (sólo si llegó `text_place`).
            ...(textPlaceIn ? { text_place: { requested: textPlaceIn, placement_used: fit.chrome.block?.place ?? 'center',
              column: fit.chrome.block?.side ?? null } } : {}),
          },
        },
        duration_ms: Date.now() - t0,
      });
      return;
    }

    const sealOnly = !headline.trim();
    if (sealOnly && !style.identity) {
      throw new CompositorError('COMPOSITOR_TEXT_MISSING',
        'headline vacío y la marca no declara franja de identidad: no hay nada que componer. El compositor NO escribe texto — compone el que le llega, que sale del copy ya juzgado (BRIEF 7, regla a).', 400);
    }
    if (sealOnly) {
      style.markers.push('OVERLAY_SEALED_WITHOUT_TITLE: se compuso la franja de identidad sin titular; recomponer cuando la pieza tenga título (no hace falta regenerar la escena)');
    }

    // CAPA DE PRODUCTO — `products: [{ image_url, name? }]`. Lo resuelve el carril desde la ficha
    // (`product_blueprints`); aquí sólo se baja, se mide y se pega.
    const productsIn = (Array.isArray(body.products) ? body.products : [])
      .filter((p: any) => p && typeof p.image_url === 'string' && /^https?:\/\//.test(p.image_url));
    // 1.12.0 — la fila pedida, antes de la capa de producto: el texto no cae en la esquina que el producto ocupa.
    // Sin `text_place`, `oStyle` es EL MISMO objeto que `style` y todo lo de abajo es 1.11.1.
    const prodTok = (picked.tokens ?? {}).product as Record<string, any> | undefined;
    const prodAnchorIn = productsIn.length && prodTok?.mode === 'composite' && prodTok.anchor ? String(prodTok.anchor) : null;
    const placeApplied = applyTextPlace(style, textPlaceIn, prodAnchorIn);
    const oStyle = placeApplied.style;
    const prodPick = resolveProductLayer({ tokens: picked.tokens, textAnchor: oStyle.slots.headline ? oStyle.layout.anchor : null, count: productsIn.length });
    oStyle.markers.push(...prodPick.markers);
    const productImgs: ProductImageIn[] = [];
    if (prodPick.layer) {
      for (const p of productsIn.slice(0, prodPick.layer.maxItems)) {
        const bytes = await fetchBytes(String(p.image_url), 'COMPOSITOR_PRODUCT_FETCH_FAILED');
        const d = imageDimensions(bytes);
        if (d.mime !== 'image/png') oStyle.markers.push(`PRODUCT_NOT_PNG: ${String(p.image_url).slice(0, 120)} no es PNG — sin alfa se verá su fondo`);
        productImgs.push({ src: `data:${d.mime};base64,${b64(bytes)}`, width: d.width, height: d.height, name: p.name ?? null });
      }
    }

    const cleanBytes = body.image_data_url
      ? dataUrlToBytes(String(body.image_data_url))
      : await fetchBytes(String(body.image_url), 'COMPOSITOR_IMAGE_FETCH_FAILED');
    const dims = imageDimensions(cleanBytes);

    // Sin ranuras de texto no se baja ninguna fuente: sellar una escena no debería costar una
    // descarga ni fallar por un css_import que la marca todavía no sembró.
    const fonts = await Promise.all(
      SLOTS.filter((s) => style.slots[s]).map(async (s) => ({ slot: s, ...(await loadFont(s, style.slots[s]!)) })),
    );
    // 1.4.0 — la fuente del énfasis, si es otra familia, otro peso u otro estilo que la del titular.
    // Si la hoja de la marca no sirve ese peso exacto se compone con el más cercano y SE DICE.
    const hl = style.slots.headline;
    if (hl?.emphasis) {
      const em = hl.emphasis;
      const same = fonts.some((f) => f.name === em.family && f.weight === em.weight && (f.style === 'italic') === em.italic);
      if (!same) {
        const f = await loadFont('headline:emphasis', em);
        if (f.weight !== em.weight || (f.style === 'italic') !== em.italic) {
          oStyle.markers.push(`OVERLAY_EMPHASIS_FONT_SUBSTITUTED: ${em.family} ${em.weight}${em.italic ? ' itálica' : ''} no está en css_import; se usó ${f.weight}${f.style === 'italic' ? ' itálica' : ''}`);
        }
        fonts.push({ slot: 'headline:emphasis' as any, ...f });
      }
    }

    // 1.5.0 — el límite de área de la plataforma, medido con las MISMAS fuentes que recibe satori.
    const areaMetrics: Record<string, FontAdvance | null> = {};
    for (const f of fonts) {
      const slotStyle = (f.slot as string) === 'headline:emphasis' ? style.slots.headline?.emphasis : style.slots[f.slot as Slot];
      if (slotStyle) areaMetrics[fitFontKey(slotStyle)] = fontAdvanceMetrics(f.data);
    }
    const areaFit = fitOverlayTextArea({ style: oStyle, width: dims.width, height: dims.height, metrics: areaMetrics });
    let finalStyle = areaFit.style;

    // 1.6.0 — el texto no tapa una cara. Sólo si la marca o el canal lo declaran y hay titular.
    // 1.6.3 — con `avoid_scene_text`, la MISMA llamada pide también los letreros de la escena.
    let faceMeta: Record<string, unknown> | null = null;
    let signsUnder: FaceBox[] = [];
    if (finalStyle.layout.avoidFaces && finalStyle.slots.headline) {
      const wantSigns = !!finalStyle.layout.avoidSceneText;
      // 1.11.0 — con `avoid_products`, la MISMA llamada pide también los productos de la escena.
      const wantProducts = !!finalStyle.layout.avoidProducts;
      // 1.13.0 — con `avoid_people`, la MISMA llamada pide también las figuras humanas completas.
      const wantPeople = !!finalStyle.layout.avoidPeople;
      const fc = await detectFaces(cleanBytes, dims.mime, { signs: wantSigns, products: wantProducts, people: wantPeople,
        calibration: calibrationFromHeaders(req.headers as Record<string, unknown>, process.env.VERCEL_ENV) });
      faceMeta = { model: fc.model, model_source: fc.model_source ?? null, provider_called: fc.called, provider_http_status: fc.http_status, usage: fc.usage,
        duration_ms: fc.duration_ms, boxes: fc.faces, ...(wantSigns ? { sign_boxes: fc.signs } : {}),
        ...(wantProducts ? { product_boxes: fc.products } : {}), ...(wantPeople ? { people_boxes: fc.people } : {}), error: fc.error };
      // LIBRO-DIRECTO — la llamada al detector se asienta AQUÍ, en cuanto se hizo: si la composición
      // falla después, el gasto ya existió. Clase 'estructura', como la asienta el carril.
      if (fc.called) {
        try {
          await ledgerRecordDirect(body, [ledgerCallRow({ outputType: 'image_overlay_faces', model: fc.model, usage: fc.usage,
            ok: !fc.error, httpStatus: fc.http_status, billable: 'estructura', durationMs: fc.duration_ms,
            markers: fc.error ? [String(fc.error).slice(0, 240)] : [] })], { platform: canal, durationMs: fc.duration_ms, tag: 'compose' });
        } catch (err) {
          console.error(`[ImageLab][LIBRO] compose asiento omitido: ${(err instanceof Error ? err.message : String(err)).slice(0, 200)}`);
        }
      }
      if (fc.faces) {
        const ch = chooseOverlayAnchor({ style: finalStyle, width: dims.width, height: dims.height, metrics: areaMetrics,
          faces: fc.faces, people: fc.people, productAnchor: prodPick.layer && productImgs.length ? prodPick.layer.anchor : null, signs: fc.signs, products: fc.products,
          textPlace: textPlaceIn });
        finalStyle = ch.style;
        faceMeta = { ...faceMeta, ...(ch.report ?? {}) };
        signsUnder = ch.report?.signs_under_text ?? [];
      } else {
        finalStyle = { ...finalStyle, markers: [...finalStyle.markers,
          `OVERLAY_FACE_CHECK_UNAVAILABLE: ${fc.error ?? 'sin respuesta'}; se compone en el ancla declarada (${finalStyle.layout.anchor})`] };
      }
    }

    // 1.13.0 — NINGUNA PALABRA SOLA EN SU LÍNEA: con el tamaño, el ancla y el ancho ya decididos. Sin palabra sola, el
    // estilo es el mismo y la escena la de 1.12.0.
    const orphan = avoidOrphanLines(finalStyle, dims.width, dims.height, areaMetrics);
    finalStyle = refitOverlayBand(orphan.style, dims.width, dims.height, areaMetrics);

    // 1.6.3 — si el texto igual cae sobre un letrero y la marca declara `blur_pct`, ese letrero se desenfoca.
    let bgBytes: Uint8Array = cleanBytes;
    const blurPct = finalStyle.layout.avoidSceneText?.blurPct ?? null;
    if (signsUnder.length && blurPct) {
      const bl = await blurRegions(cleanBytes, signsUnder, dims.width, dims.height, blurPct);
      if (bl.bytes) {
        bgBytes = bl.bytes;
        finalStyle = { ...finalStyle, markers: [...finalStyle.markers, `OVERLAY_SIGN_BLURRED: ${signsUnder.length} letrero(s) bajo el texto, desenfoque ${blurPct} % del ancho`] };
        if (faceMeta) faceMeta = { ...faceMeta, signs_blurred: signsUnder.length };
      } else {
        finalStyle = { ...finalStyle, markers: [...finalStyle.markers, `OVERLAY_SIGN_BLUR_FAILED: ${bl.error}; el letrero queda como está`] };
      }
    }
    // `blurRegions` devuelve PNG; sin desenfoque, la foto limpia con su tipo de siempre.
    const bgSrc = `data:${bgBytes === cleanBytes ? dims.mime : 'image/png'};base64,${b64(bgBytes)}`;

    // 1.6.2 / 1.6.3 — lo que se mide sobre el fondo debajo del bloque YA ubicado: el color del énfasis
    // (`emphasis_contrast`) y la sombra con `when: 'low_contrast'`. Una sola composición sin texto para las dos.
    let textEffectMeta: Record<string, unknown> | null = null;
    let emphasisContrastMeta: Record<string, unknown> | null = null;
    const teLow = finalStyle.textEffect?.when === 'low_contrast' ? finalStyle.textEffect : null;
    const ec = finalStyle.layout.emphasisContrast && finalStyle.slots.headline?.emphasis ? finalStyle.layout.emphasisContrast : null;
    if ((teLow || ec) && finalStyle.slots.headline) {
      const rect = overlayTextRect(finalStyle, dims.width, dims.height, areaMetrics, finalStyle.layout.anchor);
      // Lo que el texto tendrá detrás: la escena entera sin texto (foto + velo + franja + producto).
      let underBytes: Uint8Array = bgBytes;
      try {
        const under = buildOverlayScene({ style: backgroundOnlyStyle(finalStyle), width: dims.width, height: dims.height,
          backgroundSrc: bgSrc, products: productImgs, productLayer: prodPick.layer });
        const underSvg = await satori(under as any, { width: dims.width, height: dims.height,
          fonts: fonts.map((f) => ({ name: f.name, data: Buffer.from(f.data), weight: f.weight as any, style: f.style })) });
        underBytes = new Uint8Array(new Resvg(underSvg, { fitTo: { mode: 'original' } }).render().asPng());
      } catch (e) {
        finalStyle = { ...finalStyle, markers: [...finalStyle.markers, `OVERLAY_CONTRAST_ON_CLEAN_IMAGE: no se pudo componer el fondo sin texto (${e instanceof Error ? e.message.slice(0, 120) : String(e)}); se mide sobre la foto limpia`] };
      }
      const bg = await sampleRegionLuminance(underBytes, rect, dims.width, dims.height);
      const rectOut = { x0: Math.round(rect.x0), y0: Math.round(rect.y0), x1: Math.round(rect.x1), y1: Math.round(rect.y1) };

      if (ec) {
        const d = decideEmphasisColor({ currentColor: finalStyle.slots.headline!.emphasis!.color, fallbacks: ec.fallbacks,
          bgLuminances: bg.luminances, minContrast: ec.minContrast,
          ...(ec.minContrastVsText != null ? { textColor: finalStyle.slots.headline!.color, minContrastVsText: ec.minContrastVsText } : {}) });
        emphasisContrastMeta = { ...d, samples: bg.luminances.length, rect: rectOut };
        if (d.changed && d.hex) {
          finalStyle = withEmphasisColor(finalStyle, hexToRgba(d.hex, 1));
          finalStyle = { ...finalStyle, markers: [...finalStyle.markers, `OVERLAY_EMPHASIS_RECOLORED: ${d.reason}`] };
        }
      }

      if (teLow) {
        const textHexes = (['headline', 'subheadline'] as const).flatMap((s) => {
          const sl = finalStyle.slots[s];
          return sl ? [sl.color, ...(sl.emphasis?.color ? [sl.emphasis.color] : [])] : [];
        });
        const d = decideTextEffect({ textHexes, bgLuminances: bg.luminances, minContrast: teLow.minContrast!, shadowHex: teLow.shadowHex! });
        textEffectMeta = { when: 'low_contrast', applied: d.apply, ...d, samples: bg.luminances.length, rect: rectOut,
          ...(bg.error ? { sample_error: bg.error } : {}) };
        if (!d.apply) {
          const { textEffect: _omit, ...rest } = finalStyle;
          finalStyle = rest as typeof finalStyle;
        }
        if (bg.error) finalStyle = { ...finalStyle, markers: [...finalStyle.markers, `OVERLAY_CONTRAST_UNMEASURED: ${bg.error}; se aplica la sombra declarada`] };
      }
    }

    const scene = buildOverlayScene({
      style: finalStyle, width: dims.width, height: dims.height,
      backgroundSrc: bgSrc,
      products: productImgs, productLayer: prodPick.layer,
    });

    const svg = await satori(scene as any, {
      width: dims.width, height: dims.height,
      fonts: fonts.map((f) => ({ name: f.name, data: Buffer.from(f.data), weight: f.weight as any, style: f.style })),
    });
    const png = new Resvg(svg, { fitTo: { mode: 'original' } }).render().asPng();

    console.log(
      `[Compositor][BRIEF7] brand=${brandId} canal=${canal ?? '∅'} piece=${body.piece_id ?? '∅'} ` +
      `tokens=${picked.source} (capas: ${picked.layers.join(' < ')}) ${dims.width}x${dims.height} ` +
      `fuentes=${fonts.map((f) => `${f.slot}:${f.name}@${f.weight}`).join(', ') || '∅ (sello sin titular)'} ` +
      `identidad=${style.identity ? style.identity.mode : 'ninguna'} ` +
      `producto=${productImgs.length ? `${productImgs.length}@${prodPick.layer!.anchor}` : 'ninguno'} ` +
      `markers=${finalStyle.markers.length} ${Date.now() - t0}ms`,
    );

    res.status(200).json({
      status: 'ok',
      image_data_url: `data:image/png;base64,${b64(new Uint8Array(png))}`,
      compositor_version: COMPOSITOR_VERSION,
      tokens_source: picked.source,
      tokens_layers: picked.layers,
      width: dims.width, height: dims.height,
      fonts: fonts.map((f) => ({ slot: f.slot, family: f.name, weight: f.weight, source: f.source })),
      // BRIEF 8 · D — el eco del sello: qué se dibujó y con qué grosor REAL en píxeles, calculado
      // sobre el lado corto. Sin este número no se puede verificar que el sello se lee igual en los
      // cuatro formatos, que es justamente lo que D.1 exige.
      identity: style.identity
        ? { mode: style.identity.mode, color: style.identity.color, width_pct: style.identity.widthPct,
            thickness_px: Math.max(1, Math.round((style.identity.widthPct / 100) * Math.min(dims.width, dims.height))),
            short_side: Math.min(dims.width, dims.height) }
        : null,
      sealed_without_title: sealOnly,
      // Eco de la capa de producto: qué se pegó y dónde. Sin esto no se puede auditar la imagen.
      product_layer: prodPick.layer && productImgs.length
        ? { anchor: prodPick.layer.anchor, height_pct: prodPick.layer.heightPct, items: productImgs.map((p) => p.name ?? null) }
        : null,
      markers: finalStyle.markers,
      // Eco VERBATIM de lo compuesto: el carril lo asienta y así queda cruzable contra el copy juzgado.
      // 1.4.0 — `emphasis` viaja sólo si la petición lo trajo: sin él, el eco es el de 1.3.4.
      // 1.5.0 — si el límite de área retiró la bajada, el eco lo dice: lo compuesto ya no la lleva.
      text: { headline, subheadline: finalStyle.slots.subheadline ? subheadline : (style.slots.subheadline ? null : subheadline),
        ...(emphasisIn.length ? { emphasis: emphasisIn } : {}) },
      // F3 — la forma de 1.2.0 se mantiene; sólo se suma `meta`.
      meta: {
        carousel_applied: false, warnings,
        ...(areaFit.report ? { text_area: areaFit.report } : {}),
        // 1.6.0 — la detección de caras: qué vio, dónde quedó el texto y el consumo del modelo (el carril lo asienta).
        ...(faceMeta ? { faces: faceMeta } : {}),
        // 1.6.2 — qué contraste se midió debajo del texto y si la sombra se aplicó.
        ...(textEffectMeta ? { text_effect: textEffectMeta } : {}),
        // 1.6.3 — si el énfasis cambió de color para leerse, y por qué.
        ...(emphasisContrastMeta ? { emphasis_contrast: emphasisContrastMeta } : {}),
        ...(emphasisRoleIn ? { emphasis_role: { requested: emphasisRoleIn, applied: roleApplied.applied } } : {}),
        ...(ruleRoleIn ? { rule_role: { requested: ruleRoleIn, applied: ruleApplied.applied } } : {}),
        ...(identityRoleIn ? { identity_role: { requested: identityRoleIn, applied: identityApplied.applied } } : {}),
        // 1.12.0 — la fila pedida, el ancla que forzó y dónde quedó el texto (sólo si llegó `text_place`).
        ...(placeApplied.applied ? { text_place: { ...placeApplied.applied, anchor_used: finalStyle.layout.anchor } } : {}),
        // 1.13.0 — qué palabra sola se evitó y cuál bajó a acompañarla (sólo si hubo alguna).
        ...(orphan.report.length ? { orphan_lines: orphan.report } : {}),
        ...(shadowApplied ? { text_shadow: { requested: textShadowIn, spans_requested: shadowSpansIn, ...shadowApplied.applied } } : {}),
        ...(emphasisIn.length ? { emphasis: {
          requested: emphasisIn,
          highlighted: (hl?.parts ?? []).filter((p) => p.keyword).map((p) => p.text),
          styled: !!hl?.emphasis,
        } } : {}),
      },
      duration_ms: Date.now() - t0,
    });
  } catch (err) {
    const e = err as CompositorError;
    const label = e?.label ?? 'COMPOSITOR_FAILED';
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Compositor][BRIEF7] ${label}: ${msg}`);
    res.status(e?.status ?? 500).json({ error: msg, error_label: label, status: 'error' });
  }
}
