const SYSTEM_PROMPT = `너는 한국어 가계부 분류기다. 사용자의 자유문장 1개를 분석해서 반드시 JSON만 출력해라.
스키마:
{
  "type": "income" | "expense" | "unknown",
  "amount": number | null,
  "currency": "KRW" | "USD" | "UNKNOWN",
  "category": string,
  "merchant": string,
  "date": "YYYY-MM-DD" | null,
  "memo": string,
  "confidence": number,
  "factors": {
    "keywords": string[],
    "payment_method": string,
    "participants": string[]
  }
}
규칙:
- JSON 외 텍스트 금지
- 확실하지 않으면 unknown/null 사용
- confidence는 0~1
- category는 짧은 한국어 라벨`

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function onRequestPost(context) {
  const { request, env } = context

  const apiKey = env.GEMINI_API_KEY
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'GEMINI_API_KEY 환경변수가 설정되지 않았습니다.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    })
  }

  let text
  try {
    const body = await request.json()
    text = body.text
  } catch {
    return new Response(JSON.stringify({ error: '요청 본문을 파싱할 수 없습니다.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    })
  }

  if (!text) {
    return new Response(JSON.stringify({ error: 'text 필드가 필요합니다.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    })
  }

  const geminiRes = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text }] }],
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        generationConfig: { responseMimeType: 'application/json' },
      }),
    },
  )

  const data = await geminiRes.json()
  return new Response(JSON.stringify(data), {
    status: geminiRes.status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  })
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  })
}
