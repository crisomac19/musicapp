// Netlify Function: server-side proxy for sunoapi.org.
// The API key never reaches the browser — set SUNO_API_KEY in Netlify env vars.

const SUNO_BASE = "https://api.sunoapi.org/api/v1";
const MODELS = ["V6", "V6_WILD", "V6_MINI"];

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

async function suno(path, { method = "GET", body } = {}) {
  const key = process.env.SUNO_API_KEY;
  if (!key) {
    return { code: 500, msg: "Server is missing SUNO_API_KEY. Add it in Netlify environment variables." };
  }
  const res = await fetch(`${SUNO_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { code: res.status || 500, msg: text.slice(0, 300) || "Unexpected response from Suno API" };
  }
}

// Map a sunoapi.org envelope ({code,msg,data}) to an HTTP response.
function relay(result) {
  if (result && result.code === 200) return json(200, { ok: true, data: result.data });
  const code = Number(result?.code) || 500;
  const friendly = {
    400: "Invalid parameters.",
    401: "Unauthorized — check the SUNO_API_KEY.",
    405: "Rate limit exceeded. Try again shortly.",
    413: "Prompt or lyrics too long.",
    429: "Out of credits on the Suno API account.",
    430: "Too many requests. Please slow down and retry.",
    455: "Suno API is under maintenance. Try again later.",
  }[code];
  const status = code >= 400 && code < 600 ? code : 502;
  return json(status, { ok: false, code, error: result?.msg || friendly || "Request failed", hint: friendly });
}

const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = (v, min, max) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : undefined;
};

function buildGeneratePayload(input, callBackUrl) {
  const model = MODELS.includes(input.model) ? input.model : "V6";
  const customMode = Boolean(input.customMode);
  const instrumental = Boolean(input.instrumental);
  const payload = { customMode, instrumental, model, callBackUrl };

  if (!customMode) {
    const prompt = str(input.prompt, 3000);
    const style = str(input.style, 1000);
    if (!prompt && !style) throw new Error("Describe the song you want.");
    if (prompt) payload.prompt = prompt;
    if (style) payload.style = style;
    return payload;
  }

  const style = str(input.style, 1000);
  const lyrics = instrumental ? "" : str(input.lyrics, 5000);
  const negativeTags = str(input.negativeTags, 1000);
  if (!style && !lyrics && !negativeTags) throw new Error("Add a style or lyrics.");
  if (style) payload.style = style;
  if (lyrics) payload.lyrics = lyrics;
  if (negativeTags) payload.negativeTags = negativeTags;
  const title = str(input.title, 80);
  if (title) payload.title = title;
  if (!instrumental && (input.vocalGender === "m" || input.vocalGender === "f")) payload.vocalGender = input.vocalGender;

  const duration = num(input.duration, 10, 360);
  if (duration) payload.duration = Math.round(duration);
  const styleWeight = num(input.styleWeight, 0, 1);
  if (styleWeight !== undefined) payload.styleWeight = Math.round(styleWeight * 100) / 100;
  const weirdness = num(input.weirdnessConstraint, 0, 1);
  if (weirdness !== undefined) payload.weirdnessConstraint = Math.round(weirdness * 100) / 100;
  const variety = num(input.variety, 0, 4);
  if (variety !== undefined) payload.variety = Math.round(variety);
  return payload;
}

function checkPassword(req) {
  const required = process.env.APP_PASSWORD;
  if (!required) return true;
  return req.headers.get("x-app-password") === required;
}

function countryOf(req, context) {
  const fromCtx = context?.geo?.country?.code;
  if (fromCtx) return fromCtx;
  const raw = req.headers.get("x-nf-geo");
  if (raw) {
    try { return JSON.parse(Buffer.from(raw, "base64").toString("utf8"))?.country?.code || ""; } catch {}
  }
  return req.headers.get("x-country") || "";
}

export default async (req, context) => {
  const url = new URL(req.url);
  const route = url.pathname.replace(/^\/(\.netlify\/functions\/api|api)\/?/, "").replace(/\/$/, "");
  const callBackUrl = `${url.origin}/api/callback`;

  try {
    // Suno posts results here; we poll instead, so just acknowledge.
    if (route === "callback") return json(200, { status: "received" });

    if (route === "config" && req.method === "GET") {
      return json(200, { ok: true, data: { passwordRequired: Boolean(process.env.APP_PASSWORD), country: countryOf(req, context) } });
    }

    if (!checkPassword(req)) return json(401, { ok: false, error: "Wrong or missing app password.", needPassword: true });

    if (route === "credits" && req.method === "GET") {
      return relay(await suno("/generate/credit"));
    }

    if (route === "generate" && req.method === "POST") {
      let payload;
      try {
        payload = buildGeneratePayload(await req.json(), callBackUrl);
      } catch (e) {
        return json(400, { ok: false, error: e.message });
      }
      return relay(await suno("/generate", { method: "POST", body: payload }));
    }

    if (route === "status" && req.method === "GET") {
      const taskId = url.searchParams.get("taskId");
      if (!taskId) return json(400, { ok: false, error: "taskId is required" });
      return relay(await suno(`/generate/record-info?taskId=${encodeURIComponent(taskId)}`));
    }

    if (route === "lyrics" && req.method === "POST") {
      const { prompt } = await req.json();
      const p = str(prompt, 200);
      if (!p) return json(400, { ok: false, error: "Describe what the lyrics should be about." });
      return relay(await suno("/lyrics", { method: "POST", body: { prompt: p, callBackUrl } }));
    }

    if (route === "lyrics-status" && req.method === "GET") {
      const taskId = url.searchParams.get("taskId");
      if (!taskId) return json(400, { ok: false, error: "taskId is required" });
      return relay(await suno(`/lyrics/record-info?taskId=${encodeURIComponent(taskId)}`));
    }

    return json(404, { ok: false, error: `Unknown route: ${route || "/"}` });
  } catch (err) {
    console.error(err);
    return json(502, { ok: false, error: "Could not reach the Suno API. Please try again." });
  }
};

export const config = { path: "/api/*" };
