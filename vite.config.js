import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [
      react(),
      {
        name: 'gemini-dev-proxy',
        configureServer(server) {
          server.middlewares.use('/api/gemini', async (req, res) => {
            if (req.method === 'OPTIONS') {
              res.writeHead(204, {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type',
              })
              res.end()
              return
            }

            if (req.method !== 'POST') {
              res.writeHead(405, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'Method Not Allowed' }))
              return
            }

            const apiKey = env.GEMINI_API_KEY
            if (!apiKey) {
              res.writeHead(500, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'GEMINI_API_KEY 환경변수가 설정되지 않았습니다. .env 파일을 확인해주세요.' }))
              return
            }

            let body = ''
            for await (const chunk of req) body += chunk
            let text
            try {
              text = JSON.parse(body).text
            } catch {
              res.writeHead(400, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: '요청 본문을 파싱할 수 없습니다.' }))
              return
            }

            const geminiRes = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  contents: [{ role: 'user', parts: [{ text }] }],
                  systemInstruction: {
                    parts: [
                      {
                        text: `너는 한국어 가계부 분류기다. 사용자의 자유문장 1개를 분석해서 반드시 JSON만 출력해라.
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
- category는 짧은 한국어 라벨`,
                      },
                    ],
                  },
                  generationConfig: { responseMimeType: 'application/json' },
                }),
              },
            )

            const data = await geminiRes.json()
            res.writeHead(geminiRes.status, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify(data))
          })
        },
      },
    ],
  }
})
