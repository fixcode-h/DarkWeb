// 把 release/ 里的扩展包上传到 Chrome 应用商店并提交审核（Chrome Web Store API v2）。
// 用法：node scripts/cws-publish.mjs [zip 路径]
//
// 环境变量：
//   CWS_PUBLISHER_ID   开发者后台 Account 页里的 Publisher ID
//   CWS_EXTENSION_ID   商店里这个扩展的 ID（32 位小写字母）
//   凭据二选一：
//   CWS_SERVICE_ACCOUNT_KEY                       服务账号的 JSON 密钥全文（推荐，不会过期）
//   CWS_CLIENT_ID / CWS_CLIENT_SECRET / CWS_REFRESH_TOKEN   OAuth 客户端 + refresh token
//   可选：
//   CWS_PUBLISH=false  只上传成草稿，不提交审核
//
// 没配置时直接跳过（退出码 0），这样没配密钥的仓库照常出包。
import { createSign } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = process.env;
const API = (env.CWS_API_BASE || 'https://chromewebstore.googleapis.com').replace(/\/$/, '');
const SCOPE = 'https://www.googleapis.com/auth/chromewebstore';

const publisherId = (env.CWS_PUBLISHER_ID || '').trim();
const extensionId = (env.CWS_EXTENSION_ID || '').trim();
const hasServiceAccount = !!(env.CWS_SERVICE_ACCOUNT_KEY || '').trim();
const hasOAuth = !!(env.CWS_CLIENT_ID && env.CWS_CLIENT_SECRET && env.CWS_REFRESH_TOKEN);

if (!publisherId || !extensionId || !(hasServiceAccount || hasOAuth)) {
  const missing = [
    !publisherId && 'CWS_PUBLISHER_ID',
    !extensionId && 'CWS_EXTENSION_ID',
    !(hasServiceAccount || hasOAuth) && 'CWS_SERVICE_ACCOUNT_KEY（或 CWS_CLIENT_ID / CWS_CLIENT_SECRET / CWS_REFRESH_TOKEN）',
  ].filter(Boolean);
  console.log(`::notice::未同步到 Chrome 应用商店：缺少 ${missing.join('、')}。配置方法见 docs/store/README.md`);
  process.exit(0);
}

function findZip() {
  const arg = process.argv[2];
  if (arg) return resolve(arg);
  const dir = join(root, 'release');
  const zips = readdirSync(dir).filter((f) => f.endsWith('.zip'));
  if (zips.length !== 1) throw new Error(`release/ 里应当只有一个 zip，实际有 ${zips.length} 个；请把路径作为参数传入`);
  return join(dir, zips[0]);
}

const b64url = (v) => Buffer.from(v).toString('base64url');

async function tokenRequest(url, params) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(`获取访问令牌失败（HTTP ${res.status}）：${data.error || ''} ${data.error_description || ''}`.trim());
  }
  return data.access_token;
}

async function accessToken() {
  if (hasServiceAccount) {
    let key;
    try {
      key = JSON.parse(env.CWS_SERVICE_ACCOUNT_KEY);
    } catch {
      throw new Error('CWS_SERVICE_ACCOUNT_KEY 不是合法的 JSON，请粘贴服务账号密钥文件的完整内容');
    }
    const tokenUri = env.CWS_TOKEN_URI || key.token_uri || 'https://oauth2.googleapis.com/token';
    const now = Math.floor(Date.now() / 1000);
    const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(
      JSON.stringify({ iss: key.client_email, scope: SCOPE, aud: tokenUri, iat: now, exp: now + 600 }),
    )}`;
    const signature = createSign('RSA-SHA256').update(unsigned).sign(key.private_key).toString('base64url');
    return tokenRequest(tokenUri, {
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${signature}`,
    });
  }
  return tokenRequest(env.CWS_TOKEN_URI || 'https://oauth2.googleapis.com/token', {
    grant_type: 'refresh_token',
    client_id: env.CWS_CLIENT_ID,
    client_secret: env.CWS_CLIENT_SECRET,
    refresh_token: env.CWS_REFRESH_TOKEN,
  });
}

const item = `publishers/${publisherId}/items/${extensionId}`;
let token = '';

async function call(method, path, body, contentType) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(contentType ? { 'content-type': contentType } : {}) },
    body,
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    /* 非 JSON 响应，下面按原文报错 */
  }
  if (!res.ok) {
    const err = new Error(`${method} ${path} 失败（HTTP ${res.status}）：${data.error?.message || text.slice(0, 500)}`);
    err.details = data.error?.details;
    throw err;
  }
  return data;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const zipPath = findZip();
  const zip = readFileSync(zipPath);
  token = await accessToken();

  // 上一个版本还在审核时不能直接传新包，先撤回它
  const status = await call('GET', `/v2/${item}:fetchStatus`);
  const pending = status.submittedItemRevisionStatus;
  if (pending?.state === 'PENDING_REVIEW') {
    const v = pending.distributionChannels?.[0]?.crxVersion || '?';
    console.log(`版本 ${v} 还在审核中，先撤回，用新包重新提交`);
    await call('POST', `/v2/${item}:cancelSubmission`);
  }

  console.log(`上传 ${zipPath}（${(zip.length / 1024).toFixed(0)} KB）`);
  const up = await call('POST', `/upload/v2/${item}:upload`, zip, 'application/zip');
  let state = up.uploadState || '';
  let version = up.crxVersion || '';
  for (let i = 0; /IN_PROGRESS/.test(state) && i < 30; i++) {
    await sleep(Number(env.CWS_POLL_MS || 5000));
    const s = await call('GET', `/v2/${item}:fetchStatus`);
    state = s.lastAsyncUploadState || state;
  }
  if (!/SUCCEEDED/.test(state)) throw new Error(`上传没有成功，状态：${state || '未知'}`);
  console.log(`上传成功${version ? `，商店识别到的版本号 ${version}` : ''}`);

  if (String(env.CWS_PUBLISH).toLowerCase() === 'false') {
    console.log('CWS_PUBLISH=false：只上传为草稿，没有提交审核');
    return;
  }

  const pub = await call('POST', `/v2/${item}:publish`, '{}', 'application/json');
  for (const w of pub.warningInfo?.warnings || []) console.log(`::warning::${w.reason}: ${w.description}`);
  console.log(`已提交，当前状态：${pub.state || '未知'}（PENDING_REVIEW 表示等待审核，通过后自动上架）`);
}

main().catch((e) => {
  console.error(`::error::同步到 Chrome 应用商店失败：${e.message}`);
  if (e.details) console.error(JSON.stringify(e.details, null, 2));
  process.exit(1);
});
