// ARNÉS DEL HANDLER — ejecuta `api/execute.ts` TAL COMO SE DESPLIEGA, sin red y sin credenciales.
//
// Para qué existe (2026-10-03, motor de personas): el cambio a `personas[]` toca el handler, no sólo
// los bloques puros. La única forma de demostrar que con UNA persona «nada cambia» es comparar el
// cuerpo EXACTO que el handler manda a Vertex (prompt, imágenes y su orden) antes y después. Este
// arnés lo captura; `tests/personas_test.mjs` lo compara con el golden congelado sobre `main`.
//
// Lo único que sustituye: `google-auth-library` (un token falso) y `fetch` (respuestas de fixture).
// No reimplementa nada del handler.
//
// No es un test por sí mismo: lo importan los tests. El guion bajo del nombre lo dice.

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Carga el handler desde un texto fuente (por defecto, `api/execute.ts` del árbol de trabajo). */
export async function loadHandler(sourceText) {
  const src = sourceText ?? readFileSync(join(ROOT, 'api', 'execute.ts'), 'utf8');
  const stub =
    'class GoogleAuth { constructor(_o) {} async getClient() { return { getAccessToken: async () => ({ token: "t" }) }; } }';
  const patched = src.replace("import { GoogleAuth } from 'google-auth-library';", stub);
  if (patched === src) throw new Error('ARNÉS: no se encontró el import de google-auth-library');
  const dir = mkdtempSync(join(tmpdir(), 'handler-harness-'));
  const file = join(dir, 'execute_harness.mts');
  writeFileSync(file, patched, 'utf8');
  process.env.GOOGLE_SERVICE_ACCOUNT_KEY = '{}';
  process.env.GOOGLE_CLOUD_PROJECT = 'proyecto-prueba';
  process.env.GOOGLE_CLOUD_LOCATION = 'us-central1';
  process.env.SUPABASE_URL = 'https://db.example.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
  const mod = await import(pathToFileURL(file).href);
  return mod.default;
}

/**
 * Ejecuta una petición contra el handler con un `fetch` de fixture.
 * `db` mapea un prefijo de tabla de PostgREST a las filas que devuelve (por defecto, ninguna), o a una
 * función `(URLSearchParams) => filas` cuando la prueba necesita que los filtros cuenten.
 * Devuelve { status, json, vertexImage, vertexText }: los CUERPOS que se mandaron a Vertex.
 */
export async function run(handler, body, { db = {}, synth = 'SYNTHESIZED SCENE' } = {}) {
  const calls = { vertexImage: null, vertexText: null, fetched: [] };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    calls.fetched.push(u.startsWith('data:') ? u.slice(0, 40) : u);
    if (u.startsWith('https://db.example.invalid/rest/v1/')) {
      const [table, query = ''] = u.slice('https://db.example.invalid/rest/v1/'.length).split('?');
      // Una tabla puede ser una lista (se devuelve entera, sin mirar filtros: lo de siempre) o una
      // función que recibe los parámetros de la consulta y filtra como PostgREST (2026-10-03, filas
      // por canal: con una lista, la fila de marca y la de canal serían indistinguibles).
      const rows = typeof db[table] === 'function' ? db[table](new URLSearchParams(query)) : (db[table] ?? []);
      return new Response(JSON.stringify(rows), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (u.includes('aiplatform.googleapis.com') && u.includes('gemini-2.5-flash-image:generateContent')) {
      calls.vertexImage = JSON.parse(init.body);
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'AAAA' } }] } }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 1290 },
      }), { status: 200 });
    }
    if (u.includes('aiplatform.googleapis.com') && u.includes(':generateContent')) {
      calls.vertexText = JSON.parse(init.body);
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: synth }] } }],
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 },
      }), { status: 200 });
    }
    if (u.startsWith('data:')) return realFetch(u);
    if (/^https?:\/\//.test(u)) {
      return new Response(new TextEncoder().encode(`IMG:${u}`), { status: 200, headers: { 'content-type': 'image/png' } });
    }
    throw new Error(`ARNÉS: fetch inesperado a ${u}`);
  };
  let status = 0; let json = null;
  const res = {
    setHeader() {},
    status(s) { status = s; return this; },
    json(j) { json = j; return this; },
    end() { return this; },
  };
  try {
    await handler({ method: 'POST', body }, res);
  } finally {
    globalThis.fetch = realFetch;
  }
  return { status, json, vertexImage: calls.vertexImage, vertexText: calls.vertexText, fetched: calls.fetched };
}

/** Lo que el golden compara: el texto y las imágenes (en orden) que viajan a Vertex. */
export function vertexDigest(r) {
  const parts = r.vertexImage?.contents?.[0]?.parts ?? [];
  return {
    status: r.status,
    image_parts: parts.filter((p) => p.inlineData).map((p) => `${p.inlineData.mimeType}:${Buffer.from(p.inlineData.data, 'base64').toString('utf8').slice(0, 200)}`),
    image_text: parts.filter((p) => typeof p.text === 'string').map((p) => p.text),
    aspect: r.vertexImage?.generationConfig?.imageConfig?.aspectRatio ?? null,
    builder_user: r.vertexText?.contents?.[0]?.parts?.[0]?.text ?? null,
    response: r.json ? Object.fromEntries(Object.entries(r.json).filter(([k]) => k !== 'image_data_url')) : null,
  };
}
