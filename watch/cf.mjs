/*
 * Cloudflare API 的兩個用途：Browser Rendering（抓需要真瀏覽器的頁面）
 * 與 Workers AI（生態掃描的判讀）。
 *
 * 設計上的兩條紀律：
 *
 * ① **型號不寫死。** 供應商會下架型號，寫死的那天 CI 才會炸，而且是靜靜地
 *    炸在一個沒人每天看的排程裡。所以：環境變數優先，沒有就查當下的清單，
 *    並且**印出實際用了哪一個**——報告要能回答「這個判讀是誰做的」。
 *
 * ② **沒有金鑰時不要靜默跳過。** 少跑一項檢查而報告看起來一切正常，
 *    比檢查失敗更糟。呼叫端要把缺金鑰當成一種要回報的狀態。
 */

const API = 'https://api.cloudflare.com/client/v4';

export function cfCreds() {
  const accountId = process.env.CF_ACCOUNT_ID;
  const token = process.env.CF_API_TOKEN;
  return accountId && token ? { accountId, token } : null;
}

async function cfFetch(creds, path, init = {}) {
  const res = await fetch(`${API}/accounts/${creds.accountId}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${creds.token}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const raw = await res.text();
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    /* 非 JSON 回應通常是 Cloudflare 前端擋下來的錯誤頁。把前 200 字帶出去，
       否則只會看到「JSON 解析失敗」，查不出到底發生什麼事。 */
    throw new Error(`HTTP ${res.status}：回應不是 JSON — ${raw.slice(0, 200)}`);
  }
  if (!res.ok || body.success === false) {
    const errs = (body.errors ?? []).map((e) => `${e.code}: ${e.message}`).join('; ');
    throw new Error(`HTTP ${res.status}${errs ? ` — ${errs}` : ''}`);
  }
  return body.result;
}

/* ── Browser Rendering ────────────────────────────────────────────────
   有些站對一般程式化抓取直接回 400／403（Meta 的爬蟲文件就是），
   必須用真瀏覽器執行 JavaScript 之後才拿得到內容。 */
export async function browserContent(creds, url) {
  const result = await cfFetch(creds, '/browser-rendering/content', {
    method: 'POST',
    body: JSON.stringify({ url }),
  });
  /* 官方文件沒有明載 result 的型別。實際觀察是 HTML 字串，但不敢假設——
     若哪天改成物件，寧可在這裡講清楚拿到什麼，也不要往下傳一個 [object Object]
     讓比對默默全部落空。 */
  if (typeof result === 'string') return result;
  if (result && typeof result.html === 'string') return result.html;
  throw new Error(`未預期的回應型別：${JSON.stringify(result).slice(0, 200)}`);
}

/* ── Workers AI ───────────────────────────────────────────────────────
   偏好順序，不是硬編碼：清單裡有才用，都沒有就用當下第一個文字生成型號，
   並在報告裡標明「偏好清單都沒中」。CF_AI_MODEL 一律優先於這裡。 */
const PREFERRED = [/llama.*3\.3.*70b/i, /llama.*4/i, /llama.*3\.1.*70b/i, /qwen.*(72|32)b/i, /mistral.*large/i];

export async function pickModel(creds) {
  if (process.env.CF_AI_MODEL) {
    return { model: process.env.CF_AI_MODEL, how: '由 CF_AI_MODEL 指定' };
  }
  const models = await cfFetch(
    creds,
    '/ai/models/search?task=Text%20Generation&hide_experimental=true&per_page=100',
  );
  const names = (models ?? []).map((m) => m?.name).filter((n) => typeof n === 'string');
  if (!names.length) throw new Error('型號清單查詢成功但沒有可用的文字生成型號');

  for (const pat of PREFERRED) {
    const hit = names.find((n) => pat.test(n));
    if (hit) return { model: hit, how: `依偏好順序自動挑選（清單共 ${names.length} 個）` };
  }
  return { model: names[0], how: `偏好清單都沒中，改用清單第一個（共 ${names.length} 個）` };
}

export async function runModel(creds, model, messages, opts = {}) {
  const result = await cfFetch(creds, `/ai/run/${model}`, {
    method: 'POST',
    body: JSON.stringify({ messages, max_tokens: opts.maxTokens ?? 1500 }),
  });
  const text = result?.response;
  if (typeof text !== 'string') {
    throw new Error(`未預期的回應型別：${JSON.stringify(result).slice(0, 200)}`);
  }
  return text;
}
