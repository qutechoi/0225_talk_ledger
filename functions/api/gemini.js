function buildSystemPrompt() {
  const now = new Date()
  const fmt = (d) => d.toISOString().slice(0, 10)
  const today = fmt(now)
  const yesterday = fmt(new Date(now - 86400000))
  const dayBefore = fmt(new Date(now - 2 * 86400000))

  return `너는 한국어 가계부 데이터 추출 전문가다.
사용자가 장황하게 입력한 문장에서 금융 거래 정보를 정확히 파악해 JSON 배열로만 반환해라.
거래가 여러 건이면 각각 별도 객체로, 한 건이면 객체 하나짜리 배열로 반환해라.
JSON 배열 외 어떤 텍스트도 출력하지 마라.
오늘 날짜: ${today}

## 출력 스키마
[
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
]

## 추출 규칙

### type 판단
- expense: 구매·결제·계산·냈다·썼다·샀다·먹었다(돈 맥락)·탔다·빌렸다
- income: 받았다·들어왔다·벌었다·입금·환불·월급·용돈·팔았다
- 불명확 → "unknown"

### amount 파싱 (한국어 숫자 필수 변환)
- 순한글: 오만→50000, 사만→40000, 삼만→30000, 이만→20000, 만→10000
- 혼합: "만오천"→15000, "이만오천"→25000, "오만이천오백"→52500
- 단위 혼합: "2만5천"→25000, "3만원"→30000, "1만2천원"→12000
- 천단위 쉼표 무시: "1,500"→1500, "45,000"→45000
- k/K: "3.5k"→3500, "15K"→15000
- 금액 단서 전혀 없으면 null

### date 파싱
- "오늘" / "today" → ${today}
- "어제" / "yesterday" → ${yesterday}
- "그제" / "2일 전" → ${dayBefore}
- "이번 주 월요일" 등 → 실제 날짜 계산
- 날짜 언급 없으면 null

### category (짧은 한국어 라벨)
식비 | 카페/음료 | 교통 | 쇼핑 | 의료/건강 | 문화/여가 | 통신 | 구독서비스 | 급여 | 용돈 | 환불 | 기타

### merchant
상호명·브랜드명만 추출. 없으면 ""

### memo
거래 핵심 맥락을 15자 이내로 요약. 원문 복사 금지.

### confidence
0~1. amount와 type이 모두 명확하면 0.9 이상.

### factors.payment_method
"카드" | "현금" | "계좌이체" | "카카오페이" | "네이버페이" | "토스" | "미상"

## 예시

입력: "오늘 점심에 팀원들이랑 삼겹살 먹었는데 내가 다 계산했어. 카드로 긁었고 45000원 나왔어. 맛있긴 했는데 좀 비쌌지."
출력: [{"type":"expense","amount":45000,"currency":"KRW","category":"식비","merchant":"","date":"${today}","memo":"팀원 점심 삼겹살","confidence":0.97,"factors":{"keywords":["삼겹살","점심","팀원"],"payment_method":"카드","participants":["팀원"]}}]

입력: "어제 쿠팡에서 시킨 거 환불됐나봐 57,800원 들어왔더라고"
출력: [{"type":"income","amount":57800,"currency":"KRW","category":"환불","merchant":"쿠팡","date":"${yesterday}","memo":"쿠팡 환불 입금","confidence":0.93,"factors":{"keywords":["환불","쿠팡","입금"],"payment_method":"계좌이체","participants":[]}}]

입력: "오늘 점심으로 만원짜리 김치찌개 먹었고, 카페에 가서 커피 5000원짜리 마셨어"
출력: [{"type":"expense","amount":10000,"currency":"KRW","category":"식비","merchant":"","date":"${today}","memo":"점심 김치찌개","confidence":0.96,"factors":{"keywords":["김치찌개","점심"],"payment_method":"미상","participants":[]}},{"type":"expense","amount":5000,"currency":"KRW","category":"카페/음료","merchant":"","date":"${today}","memo":"카페 커피","confidence":0.95,"factors":{"keywords":["카페","커피"],"payment_method":"미상","participants":[]}}]

입력: "이번 달 월급 들어왔어 세후로 삼백이십만원"
출력: [{"type":"income","amount":3200000,"currency":"KRW","category":"급여","merchant":"","date":null,"memo":"월급 세후","confidence":0.96,"factors":{"keywords":["월급","세후"],"payment_method":"계좌이체","participants":[]}}]`
}

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
        systemInstruction: { parts: [{ text: buildSystemPrompt() }] },
        generationConfig: { responseMimeType: 'application/json' },
      }),
    },
  )

  let data
  try {
    data = await geminiRes.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Gemini 응답을 JSON으로 파싱할 수 없습니다.' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    })
  }
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
