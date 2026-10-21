// NI UNA FORMA VOSEANTE EN EL CÓDIGO, LA INTERFAZ NI LOS PROMPTS DE ESTE REPO.
//
// EL CASO. Sam, 2026-10-20: «abre el barrido de voseo de la UI y sobre todo de lo que llega al
// modelo». El barrido del ecosistema [medido 2026-10-20] encontró voseo en prompts que llegan a un
// modelo, en cadenas de interfaz y en comentarios. Lo que llega al modelo es lo más caro: un prompt
// que pide español neutro escrito con voseo empuja al modelo hacia el voseo.
//
// POR QUÉ UN TEST. Las barreras anteriores del ecosistema vigilaban con listas cerradas y con `\b`, y
// no avisaron: la lista no tenía las formas nuevas y `\b` no casa con una vocal acentuada final. Este
// recorre TODO el texto de las carpetas de código —también los comentarios, que la regla de idioma
// cubre— con el detector morfológico de `idioma_voseo.mjs`, así que un archivo nuevo queda vigilado
// sin que nadie se acuerde de añadirlo.
//
// FUERA DEL BARRIDO, a propósito:
//   · `tests/` y los fixtures — contienen formas voseantes como dato de prueba de otros detectores.
//   · `CLAUDE.md`, `README.md`, `docs/` — context files y registros, con bloques literales del
//     protocolo que citan el voseo como ejemplo. Se revisan a mano.
//   · las citas de `CITAS`, una por una y con su motivo (§2-BIS: la cita literal no está prohibida).
//     Si una cita deja de existir, el test falla: una excepción que ya no hace falta se retira.
//
// Ejecutar:  node tests/sin_voseo_test.mjs
// Sin dependencias.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { formasVoseantes } from "./idioma_voseo.mjs";

const RAIZ = fileURLToPath(new URL("..", import.meta.url));
const CARPETAS = ["api", "src", "config", "constants", "services", "utils"];
const MINIMO = 40;
const CITAS = [
  {
    archivo: "src/config/brands.ts",
    forma: "Vivos\u00e9",
    motivo: "nombre propio de un producto, tal como se escribe; no es una forma verbal",
  },
  {
    archivo: "config/personBlueprints.tsx",
    forma: "Vivos\u00e9",
    motivo: "el mismo nombre propio de producto",
  },
];
const EXTENSIONES = /\.(tsx?|jsx?|mjs|cjs|html|css|sql)$/;
const FUERA = /(^|\/)(node_modules|dist|build|\.next|tests?|__fixtures__|migrations)(\/|$)|\.test\.|\.fixtures\./;

function archivos(dir) {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    if (FUERA.test(relative(RAIZ, ruta))) return [];
    if (statSync(ruta).isDirectory()) return archivos(ruta);
    return EXTENSIONES.test(nombre) ? [ruta] : [];
  });
}

let fallos = 0;
function caso(nombre, fn) {
  try {
    fn();
    console.log(`  ok  ${nombre}`);
  } catch (e) {
    fallos++;
    console.error(`  MAL ${nombre}\n${e.message}`);
  }
}

console.log("sin_voseo — el texto del repo está en ES neutro internacional");

const todos = CARPETAS.flatMap((c) => archivos(join(RAIZ, c)));

caso(`el barrido encuentra los archivos (si da menos de ${MINIMO}, el test no vigila nada)`, () => {
  assert.ok(todos.length >= MINIMO, `sólo ${todos.length} archivos en ${CARPETAS.join(", ")}`);
});

const hallazgos = todos.flatMap((ruta) =>
  readFileSync(ruta, "utf8").split("\n").flatMap((linea, i) =>
    formasVoseantes(linea).map((forma) => ({ archivo: relative(RAIZ, ruta), linea: i + 1, forma })),
  ),
);
const esCita = (h) => CITAS.some((c) => c.archivo === h.archivo && c.forma === h.forma);

caso(`ni una forma voseante ni regional en ${CARPETAS.join(", ")}`, () => {
  const sueltos = hallazgos.filter((h) => !esCita(h)).map((h) => `${h.archivo}:${h.linea} «${h.forma}»`);
  assert.deepEqual(sueltos, []);
});

caso("cada cita declarada sigue existiendo", () => {
  const vencidas = CITAS.filter((c) => !hallazgos.some((h) => h.archivo === c.archivo && h.forma === c.forma));
  assert.deepEqual(vencidas.map((c) => `${c.archivo} «${c.forma}»`), []);
});

// Las formas se arman por partes para que este archivo no contenga ninguna entera.
const v = (raiz, fin) => raiz + fin;

caso("caza imperativo y presente voseantes, también con tilde final", () => {
  assert.equal(formasVoseantes(`${v("Revis", "á")} esto`).length, 1);
  assert.equal(formasVoseantes(`¿${v("Ten", "és")} un post?`).length, 1);
  assert.equal(formasVoseantes(`${v("eleg", "í")} una marca`).length, 1);
  assert.equal(formasVoseantes(v("v", "os")).length, 1);
  assert.equal(formasVoseantes(`${v("mir", "á")} la pieza`).length, 1);
});

caso("caza el imperativo con pronombre pegado, que no lleva tilde", () => {
  assert.equal(formasVoseantes(`${v("Aprob", "ala")} hoy`).length, 1);
  assert.equal(formasVoseantes(v("fij", "ate")).length, 1);
  assert.deepEqual(formasVoseantes("Apruébala hoy; fíjate en la escala y en el regalo."), []);
});

caso("caza el regionalismo con equivalente neutro", () => {
  assert.equal(formasVoseantes(`por ${v("ac", "á")}`).length, 1);
});

caso("no marca futuros, tuteo ni palabras comunes", () => {
  assert.deepEqual(formasVoseantes("Revisa esto; se aplicará después y estás a tiempo, más o menos."), []);
  assert.deepEqual(formasVoseantes("¿Qué marca? Aquí, allí o más allá; podrá y querrá."), []);
});

caso("una cadena con \\n escrito no pega la n a la palabra siguiente", () => {
  assert.deepEqual(formasVoseantes("línea uno\\naquí"), []);
});

if (fallos) {
  console.error(`\n${fallos} caso(s) en rojo`);
  process.exit(1);
}
console.log("\nsin_voseo: todo en verde");
