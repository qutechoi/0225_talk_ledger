import { useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import './App.css'

const STORAGE_KEY = 'talk-ledger-entries-v1'

const initialEntries = (() => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
})()

const systemPrompt = `너는 한국어 가계부 분류기다. 사용자의 자유문장 1개를 분석해서 반드시 JSON만 출력해라.
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

async function parseWithGemini(text) {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY
  if (!apiKey) {
    throw new Error('VITE_GEMINI_API_KEY가 필요합니다. .env에 설정해주세요.')
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: {
          responseMimeType: 'application/json',
        },
      }),
    },
  )

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Gemini API 오류: ${errText}`)
  }

  const data = await res.json()
  const modelText =
    data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '{}'

  return JSON.parse(modelText)
}

function App() {
  const [input, setInput] = useState('')
  const [entries, setEntries] = useState(initialEntries)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const totals = useMemo(() => {
    const income = entries
      .filter((e) => e.type === 'income' && typeof e.amount === 'number')
      .reduce((sum, e) => sum + e.amount, 0)
    const expense = entries
      .filter((e) => e.type === 'expense' && typeof e.amount === 'number')
      .reduce((sum, e) => sum + e.amount, 0)
    return { income, expense, balance: income - expense }
  }, [entries])

  const persist = (next) => {
    setEntries(next)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }

  const handleAnalyze = async () => {
    if (!input.trim()) return
    setLoading(true)
    setError('')

    try {
      const parsed = await parseWithGemini(input.trim())
      const record = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        originalText: input.trim(),
        ...parsed,
      }
      persist([record, ...entries])
      setInput('')
    } catch (e) {
      setError(e.message || '분석 중 오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }

  const handleDownloadExcel = () => {
    const rows = entries.map((e) => ({
      createdAt: e.createdAt,
      date: e.date,
      type: e.type,
      amount: e.amount,
      currency: e.currency,
      category: e.category,
      merchant: e.merchant,
      memo: e.memo,
      confidence: e.confidence,
      keywords: (e.factors?.keywords || []).join(', '),
      payment_method: e.factors?.payment_method || '',
      participants: (e.factors?.participants || []).join(', '),
      originalText: e.originalText,
    }))

    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Ledger')
    XLSX.writeFile(wb, `talk_ledger_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  return (
    <main className="container">
      <h1>말로 쓰는 가계부</h1>
      <p className="sub">문장으로 입력하면 Gemini가 수입/지출과 핵심 팩터를 JSON으로 추출해 저장해요.</p>

      <section className="card">
        <textarea
          rows={4}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="예) 점심으로 김치찌개 9,500원 카드 결제"
        />
        <div className="actions">
          <button onClick={handleAnalyze} disabled={loading}>
            {loading ? '분석 중...' : '입력 추가'}
          </button>
          <button className="secondary" onClick={handleDownloadExcel} disabled={entries.length === 0}>
            엑셀 다운로드
          </button>
        </div>
        {error && <p className="error">{error}</p>}
      </section>

      <section className="summary">
        <div>수입: ₩{totals.income.toLocaleString()}</div>
        <div>지출: ₩{totals.expense.toLocaleString()}</div>
        <div>잔액: ₩{totals.balance.toLocaleString()}</div>
      </section>

      <section>
        <h2>기록 ({entries.length})</h2>
        <ul className="list">
          {entries.map((e) => (
            <li key={e.id} className="entry">
              <div className="row">
                <strong>{e.type}</strong>
                <span>{e.amount ?? '-'} {e.currency || ''}</span>
              </div>
              <div className="meta">{e.category} · {e.merchant || '미상'} · 신뢰도 {e.confidence}</div>
              <pre>{JSON.stringify(e, null, 2)}</pre>
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}

export default App
