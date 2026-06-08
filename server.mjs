import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const PORT = Number(process.env.PORT || 4173);
const MODEL = process.env.OPENAI_MODEL || "gpt-5.2";
const ROOT = new URL(".", import.meta.url).pathname;
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    topics: {
      type: "array",
      items: { type: "string" },
    },
    vocabulary: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          term: { type: "string" },
          meaningZh: { type: "string" },
          example: { type: "string" },
          topic: { type: "string" },
        },
        required: ["term", "meaningZh", "example", "topic"],
      },
    },
    sentences: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          spanish: { type: "string" },
          chinese: { type: "string" },
          topic: { type: "string" },
        },
        required: ["spanish", "chinese", "topic"],
      },
    },
    grammar: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          explanation: { type: "string" },
          topic: { type: "string" },
        },
        required: ["title", "explanation", "topic"],
      },
    },
  },
  required: ["topics", "vocabulary", "sentences", "grammar"],
};

const systemPrompt = `你是一位西班牙語老師。

以下是 OCR 後的課堂內容，
裡面可能有：
- OCR 錯字
- 重複內容
- 缺少標點
- 中西文混雜

請你：
1. 修正 OCR 錯誤
2. 去除重複
3. 按主題分類
4. 整理成：
   - 單字
   - 句子
   - 文法
5. 保留西文原句
6. 加上自然中文翻譯
7. 適合 A1-A2 學習者

回傳規則：
- 只回傳符合 JSON schema 的資料。
- 單字請保留原形或課堂出現形式，中文翻譯要自然。
- 句子請保留修正後的西文原句，並提供繁體中文翻譯。
- 文法解釋要短、清楚，適合 A1-A2 學習者複習。
- 不要限制單字或句子的數量；請依 OCR 內容完整整理所有對 A1-A2 複習有用的單字、片語、句子與文法。
- 如果 OCR 內容很多，請去重後保留完整重點，不要為了湊固定數量而刪掉有用內容。`;

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 200_000) {
        reject(new Error("文字太長，請分批整理。"));
        request.destroy();
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

async function organizeWithOpenAI(ocrText) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("缺少 OPENAI_API_KEY。請先設定環境變數再啟動服務。");
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `請整理以下 OCR 文字：\n\n${ocrText}` },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "spanish_weekly_notes",
          strict: true,
          schema,
        },
      },
    }),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error?.message || "OpenAI API request failed.");
  }

  const outputText = extractResponseText(payload);
  if (!outputText) {
    throw new Error("OpenAI API did not return organized JSON text.");
  }

  return JSON.parse(outputText);
}

function extractResponseText(payload) {
  if (typeof payload.output_text === "string") {
    return payload.output_text;
  }

  return payload.output
    ?.flatMap((item) => item.content || [])
    ?.map((content) => content.text || "")
    ?.join("")
    ?.trim();
}

function getAllowedAiEmails() {
  return (process.env.ALLOWED_AI_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

function getBearerToken(request) {
  const header = request.headers.authorization || "";
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return "";
  }
  return token;
}

async function requireAuthenticatedUser(request) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error("缺少 Supabase 環境變數，請設定 SUPABASE_URL 與 SUPABASE_ANON_KEY。");
  }

  const token = getBearerToken(request);
  if (!token) {
    const error = new Error("請先登入後再使用 AI 整理。");
    error.statusCode = 401;
    throw error;
  }

  const authResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
    },
  });

  const user = await authResponse.json();
  if (!authResponse.ok || !user?.id) {
    const error = new Error("登入狀態已失效，請重新登入。");
    error.statusCode = 401;
    throw error;
  }

  const allowedEmails = getAllowedAiEmails();
  if (allowedEmails.length > 0 && !allowedEmails.includes((user.email || "").toLowerCase())) {
    const error = new Error("這個帳號沒有 AI 整理權限。");
    error.statusCode = 403;
    throw error;
  }

  return user;
}

async function handleApi(request, response) {
  try {
    await requireAuthenticatedUser(request);

    const body = await readBody(request);
    const { ocrText } = JSON.parse(body || "{}");
    if (!ocrText || typeof ocrText !== "string") {
      throw new Error("請提供 OCR 文字。");
    }

    const notes = await organizeWithOpenAI(ocrText);
    sendJson(response, 200, normalizeForClient(notes));
  } catch (error) {
    sendJson(response, error.statusCode || 400, { error: error.message });
  }
}

function normalizeForClient(notes) {
  return {
    topic: notes.topic || (Array.isArray(notes.topics) ? notes.topics.join("、") : ""),
    topics: notes.topics || (notes.topic ? [notes.topic] : []),
    vocab: (notes.vocab || notes.vocabulary || []).map((item) => ({
      word: item.word || item.term || "",
      translation: item.translation || item.trans || item.meaningZh || item.meaning || "",
      topic: item.topic || "",
      example: item.example || "",
    })),
    vocabulary: notes.vocabulary || [],
    sentences: notes.sentences || [],
    grammar: notes.grammar || [],
  };
}

async function handleStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = normalize(join(ROOT, pathname));

  if (!filePath.startsWith(normalize(ROOT))) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const file = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": mimeTypes[extname(filePath)] || "application/octet-stream",
    });
    response.end(file);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function sendClientConfig(response) {
  response.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" });
  response.end(`window.APP_CONFIG = ${JSON.stringify({
    supabaseUrl: SUPABASE_URL || "",
    supabaseAnonKey: SUPABASE_ANON_KEY || "",
  })};`);
}

const server = createServer((request, response) => {
  if (request.method === "POST" && request.url === "/api/organize") {
    handleApi(request, response);
    return;
  }
  if (request.method === "GET" && request.url === "/api/config.js") {
    sendClientConfig(response);
    return;
  }
  if (request.method === "GET" || request.method === "HEAD") {
    handleStatic(request, response);
    return;
  }
  response.writeHead(405);
  response.end("Method not allowed");
});

server.listen(PORT, () => {
  console.log(`Spanish notes app running at http://localhost:${PORT}`);
});
