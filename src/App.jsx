import { useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts'
import './App.css'

const STORAGE_KEY = 'talk-ledger-entries-v1'
const PIE_COLORS = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6']

const initialEntries = (() => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
})()

async function parseWithGemini(text) {
  const res = await fetch('/api/gemini', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(`Gemini API 오류: ${err.error || res.statusText}`)
  }

  const data = await res.json()
  const modelText = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '{}'
  return JSON.parse(modelText)
}

const toNumber = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

const monthKey = (entry) => {
  const basis = entry.date || entry.createdAt?.slice(0, 10)
  if (!basis) return 'unknown'
  return basis.slice(0, 7)
}

function App() {
  const [input, setInput] = useState('')
  const [entries, setEntries] = useState(initialEntries)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editDraft, setEditDraft] = useState(null)
  const [showExcelPreview, setShowExcelPreview] = useState(false)

  const persist = (next) => {
    setEntries(next)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }

  const totals = useMemo(() => {
    const income = entries
      .filter((e) => e.type === 'income' && typeof e.amount === 'number')
      .reduce((sum, e) => sum + e.amount, 0)
    const expense = entries
      .filter((e) => e.type === 'expense' && typeof e.amount === 'number')
      .reduce((sum, e) => sum + e.amount, 0)
    return { income, expense, balance: income - expense }
  }, [entries])

  const categoryBarData = useMemo(() => {
    const map = new Map()
    entries
      .filter((e) => e.type === 'expense' && typeof e.amount === 'number')
      .forEach((e) => {
        const key = e.category || '미분류'
        map.set(key, (map.get(key) || 0) + e.amount)
      })
    return [...map.entries()]
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 8)
  }, [entries])

  const inOutPieData = useMemo(
    () => [
      { name: '수입', value: totals.income },
      { name: '지출', value: totals.expense },
    ],
    [totals.income, totals.expense],
  )

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
    const wb = XLSX.utils.book_new()

    const allRows = entries.map((e) => ({
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

    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(allRows), 'All')

    const grouped = entries.reduce((acc, e) => {
      const key = monthKey(e)
      if (!acc[key]) acc[key] = []
      acc[key].push(e)
      return acc
    }, {})

    Object.entries(grouped).forEach(([month, list]) => {
      const rows = list.map((e) => ({
        date: e.date || e.createdAt?.slice(0, 10),
        type: e.type,
        amount: e.amount,
        category: e.category,
        merchant: e.merchant,
        memo: e.memo,
        originalText: e.originalText,
      }))
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), month.slice(0, 31))
    })

    XLSX.writeFile(wb, `talk_ledger_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  const startEdit = (entry) => {
    setEditingId(entry.id)
    setEditDraft({
      ...entry,
      amount: entry.amount ?? '',
      confidence: entry.confidence ?? '',
      keywords: (entry.factors?.keywords || []).join(', '),
      participants: (entry.factors?.participants || []).join(', '),
      payment_method: entry.factors?.payment_method || '',
    })
  }

  const saveEdit = () => {
    const next = entries.map((e) => {
      if (e.id !== editingId) return e
      return {
        ...e,
        type: editDraft.type,
        amount: toNumber(editDraft.amount),
        currency: editDraft.currency,
        category: editDraft.category,
        merchant: editDraft.merchant,
        date: editDraft.date || null,
        memo: editDraft.memo,
        confidence: toNumber(editDraft.confidence),
        factors: {
          keywords: editDraft.keywords
            .split(',')
            .map((k) => k.trim())
            .filter(Boolean),
          payment_method: editDraft.payment_method,
          participants: editDraft.participants
            .split(',')
            .map((p) => p.trim())
            .filter(Boolean),
        },
      }
    })

    persist(next)
    setEditingId(null)
    setEditDraft(null)
  }

  return (
    <main className="container">
      <h1>말로 쓰는 가계부</h1>
      <p className="sub">자연어 입력 → Gemini JSON 분석 → 누적 저장 → 엑셀 내보내기</p>

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
          <button className="secondary" onClick={() => setShowExcelPreview(true)} disabled={entries.length === 0}>
            엑셀 다운로드(월별 시트 포함)
          </button>
        </div>
        {error && <p className="error">{error}</p>}
      </section>

      <section className="summary">
        <div>수입: ₩{totals.income.toLocaleString()}</div>
        <div>지출: ₩{totals.expense.toLocaleString()}</div>
        <div>잔액: ₩{totals.balance.toLocaleString()}</div>
      </section>

      <section className="charts">
        <div className="chart-card">
          <h3>카테고리별 지출 (Top 8)</h3>
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={categoryBarData} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="category" />
                <YAxis />
                <Tooltip formatter={(value) => `₩${Number(value).toLocaleString()}`} />
                <Bar dataKey="amount" fill="#4f46e5" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="chart-card">
          <h3>수입/지출 비율</h3>
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie data={inOutPieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={95} label>
                  {inOutPieData.map((_, idx) => (
                    <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => `₩${Number(value).toLocaleString()}`} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      <section>
        <h2>기록 ({entries.length})</h2>
        <ul className="list">
          {entries.map((e) => (
            <li key={e.id} className="entry">
              <div className="row">
                <strong>{e.type}</strong>
                <span>
                  {e.amount ?? '-'} {e.currency || ''}
                </span>
              </div>
              <div className="meta">
                {e.category} · {e.merchant || '미상'} · 신뢰도 {e.confidence}
              </div>
              <div className="entry-actions">
                <button className="small" onClick={() => startEdit(e)}>
                  수동 수정
                </button>
              </div>
              <pre>{JSON.stringify(e, null, 2)}</pre>
            </li>
          ))}
        </ul>
      </section>

      {showExcelPreview && (
        <div className="modal-backdrop">
          <div className="modal preview">
            <h3>엑셀 미리보기 ({entries.length}건)</h3>
            <div className="preview-table-wrap">
              <table className="preview-table">
                <thead>
                  <tr>
                    <th>날짜</th>
                    <th>유형</th>
                    <th>금액</th>
                    <th>통화</th>
                    <th>카테고리</th>
                    <th>상점</th>
                    <th>결제수단</th>
                    <th>메모</th>
                    <th>신뢰도</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => {
                    const typeLabel = e.type === 'income' ? '수입' : e.type === 'expense' ? '지출' : '미분류'
                    const typeClass = e.type === 'income' ? 'income' : e.type === 'expense' ? 'expense' : 'unknown'
                    return (
                      <tr key={e.id}>
                        <td>{e.date || e.createdAt?.slice(0, 10) || '-'}</td>
                        <td><span className={`badge ${typeClass}`}>{typeLabel}</span></td>
                        <td>{e.amount != null ? e.amount.toLocaleString() : '-'}</td>
                        <td>{e.currency || '-'}</td>
                        <td>{e.category || '-'}</td>
                        <td>{e.merchant || '-'}</td>
                        <td>{e.factors?.payment_method || '-'}</td>
                        <td>{e.memo || '-'}</td>
                        <td>{e.confidence != null ? e.confidence : '-'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="actions">
              <button onClick={() => { handleDownloadExcel(); setShowExcelPreview(false) }}>다운로드</button>
              <button className="secondary" onClick={() => setShowExcelPreview(false)}>닫기</button>
            </div>
          </div>
        </div>
      )}

      {editingId && editDraft && (
        <div className="modal-backdrop">
          <div className="modal">
            <h3>기록 수정</h3>
            <div className="grid">
              <label>
                type
                <select value={editDraft.type || 'unknown'} onChange={(e) => setEditDraft({ ...editDraft, type: e.target.value })}>
                  <option value="income">income</option>
                  <option value="expense">expense</option>
                  <option value="unknown">unknown</option>
                </select>
              </label>
              <label>
                amount
                <input value={editDraft.amount} onChange={(e) => setEditDraft({ ...editDraft, amount: e.target.value })} />
              </label>
              <label>
                currency
                <input value={editDraft.currency || ''} onChange={(e) => setEditDraft({ ...editDraft, currency: e.target.value })} />
              </label>
              <label>
                date
                <input value={editDraft.date || ''} onChange={(e) => setEditDraft({ ...editDraft, date: e.target.value })} placeholder="YYYY-MM-DD" />
              </label>
              <label>
                category
                <input value={editDraft.category || ''} onChange={(e) => setEditDraft({ ...editDraft, category: e.target.value })} />
              </label>
              <label>
                merchant
                <input value={editDraft.merchant || ''} onChange={(e) => setEditDraft({ ...editDraft, merchant: e.target.value })} />
              </label>
              <label>
                confidence
                <input value={editDraft.confidence} onChange={(e) => setEditDraft({ ...editDraft, confidence: e.target.value })} />
              </label>
              <label>
                payment_method
                <input value={editDraft.payment_method} onChange={(e) => setEditDraft({ ...editDraft, payment_method: e.target.value })} />
              </label>
              <label>
                keywords (comma)
                <input value={editDraft.keywords} onChange={(e) => setEditDraft({ ...editDraft, keywords: e.target.value })} />
              </label>
              <label>
                participants (comma)
                <input value={editDraft.participants} onChange={(e) => setEditDraft({ ...editDraft, participants: e.target.value })} />
              </label>
              <label className="full">
                memo
                <textarea rows={3} value={editDraft.memo || ''} onChange={(e) => setEditDraft({ ...editDraft, memo: e.target.value })} />
              </label>
            </div>
            <div className="actions">
              <button onClick={saveEdit}>저장</button>
              <button className="secondary" onClick={() => { setEditingId(null); setEditDraft(null) }}>
                취소
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

export default App
