import { useState, useRef, useEffect } from 'react'

// Cloudflare Worker URL in production; localhost proxy for local dev
const AI_ENDPOINT = (import.meta.env.VITE_AI_ENDPOINT || 'http://localhost:8765') + '/ask'

const SUGGESTIONS = [
  'What is the overall activation rate?',
  'Which batch performed best?',
  'How are follow-up emails performing?',
  'What do survey responses tell us?',
  'How many customers are still pending?',
  'Summarize the campaign health',
]

const ACCENT = '#8b5cf6'
const ACCENT_DIM = 'rgba(139,92,246,0.12)'
const ACCENT_BORDER = 'rgba(139,92,246,0.28)'

function Message({ role, content }) {
  const isUser = role === 'user'
  return (
    <div style={{
      display: 'flex',
      justifyContent: isUser ? 'flex-end' : 'flex-start',
      marginBottom: 14,
    }}>
      {!isUser && (
        <div style={{
          width: 28, height: 28, borderRadius: '50%',
          background: ACCENT_DIM,
          border: `1px solid ${ACCENT_BORDER}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14, flexShrink: 0, marginRight: 10, marginTop: 2,
        }}>
          ✦
        </div>
      )}
      <div style={{
        maxWidth: '78%',
        background: isUser
          ? 'rgba(0,212,255,0.08)'
          : 'rgba(255,255,255,0.04)',
        border: isUser
          ? '1px solid rgba(0,212,255,0.2)'
          : `1px solid ${ACCENT_BORDER}`,
        borderRadius: isUser ? '12px 12px 2px 12px' : '2px 12px 12px 12px',
        padding: '10px 14px',
        fontSize: 13.5,
        color: '#dde4f0',
        lineHeight: 1.65,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}>
        {content}
      </div>
    </div>
  )
}

function TypingDots() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
      <div style={{
        width: 28, height: 28, borderRadius: '50%',
        background: ACCENT_DIM,
        border: `1px solid ${ACCENT_BORDER}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 14, flexShrink: 0,
      }}>
        ✦
      </div>
      <div style={{
        display: 'flex', gap: 5, alignItems: 'center',
        background: 'rgba(255,255,255,0.04)',
        border: `1px solid ${ACCENT_BORDER}`,
        borderRadius: '2px 12px 12px 12px',
        padding: '12px 16px',
      }}>
        {[0, 1, 2].map(i => (
          <div key={i} style={{
            width: 6, height: 6, borderRadius: '50%',
            background: ACCENT,
            animation: `aiDot 1.2s ease-in-out ${i * 0.2}s infinite`,
          }} />
        ))}
      </div>
    </div>
  )
}

export default function AskAI({ rawData, sidebar = false }) {
  const [messages, setMessages]   = useState([])
  const [input, setInput]         = useState('')
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState(null)
  const [serverAvail, setServerAvail] = useState(true)
  const bottomRef = useRef(null)
  const inputRef  = useRef(null)

  // Scroll to bottom whenever messages update
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  const send = async (text) => {
    const q = (text || input).trim()
    if (!q || loading) return

    setInput('')
    setError(null)
    const nextMessages = [...messages, { role: 'user', content: q }]
    setMessages(nextMessages)
    setLoading(true)

    try {
      const res = await fetch(AI_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: nextMessages, data: rawData ?? {} }),
      })

      const json = await res.json()
      if (!res.ok) {
        setError(json.error || `Server error ${res.status}`)
        setMessages(m => m.slice(0, -1)) // remove the user message on hard error
      } else {
        setMessages(m => [...m, { role: 'assistant', content: json.reply }])
        setServerAvail(true)
      }
    } catch {
      setServerAvail(false)
      setError('Cannot reach local server. Make sure refresh_server.py is running.')
      setMessages(m => m.slice(0, -1))
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  const isEmpty = messages.length === 0

  return (
    <>
      {/* Keyframe for typing dots — injected once */}
      <style>{`
        @keyframes aiDot {
          0%, 80%, 100% { opacity: 0.25; transform: scale(0.8); }
          40%            { opacity: 1;    transform: scale(1);   }
        }
      `}</style>

      <div style={{
        display: 'flex',
        flexDirection: 'column',
        flex: sidebar ? 1 : 'none',
        minHeight: sidebar ? 0 : (isEmpty ? 'auto' : 360),
        overflow: sidebar ? 'hidden' : 'visible',
      }}>
        {/* Empty state / suggestions */}
        {isEmpty && (
          <div style={{ marginBottom: sidebar ? 12 : 20 }}>
            <div style={{
              fontSize: sidebar ? 12 : 13, color: '#8892a4',
              marginBottom: sidebar ? 10 : 14, lineHeight: 1.6,
            }}>
              Ask anything about your campaign — activation rates, batch performance,
              email engagement, survey insights, and more.
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {SUGGESTIONS.map(s => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  disabled={loading}
                  style={{
                    background: ACCENT_DIM,
                    border: `1px solid ${ACCENT_BORDER}`,
                    borderRadius: 20,
                    padding: '5px 13px',
                    fontSize: 12,
                    color: '#c4b5fd',
                    cursor: 'pointer',
                    fontFamily: 'Inter, sans-serif',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = 'rgba(139,92,246,0.22)'
                    e.currentTarget.style.borderColor = 'rgba(139,92,246,0.5)'
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = ACCENT_DIM
                    e.currentTarget.style.borderColor = ACCENT_BORDER
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Chat history */}
        {messages.length > 0 && (
          <div style={{
            flex: 1,
            overflowY: 'auto',
            maxHeight: sidebar ? 'none' : 400,
            minHeight: sidebar ? 0 : 'auto',
            padding: '4px 2px 4px 0',
            marginBottom: 14,
            scrollbarWidth: 'thin',
          }}>
            {messages.map((m, i) => (
              <Message key={i} role={m.role} content={m.content} />
            ))}
            {loading && <TypingDots />}
            <div ref={bottomRef} />
          </div>
        )}

        {/* Error notice */}
        {error && (
          <div style={{
            background: 'rgba(255,71,87,0.08)',
            border: '1px solid rgba(255,71,87,0.25)',
            borderRadius: 8,
            padding: '8px 14px',
            fontSize: 12,
            color: '#ff8a95',
            marginBottom: 12,
          }}>
            {error}
            {!serverAvail && (
              <span style={{ marginLeft: 6, color: '#4a5568' }}>
                — start it with: <code style={{ color: '#ff8a95' }}>python refresh_server.py</code>
              </span>
            )}
          </div>
        )}

        {/* Input bar */}
        <div style={{
          display: 'flex',
          gap: 10,
          alignItems: 'flex-end',
        }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Ask anything about the campaign… (Enter to send, Shift+Enter for new line)"
            disabled={loading}
            rows={1}
            style={{
              flex: 1,
              background: 'rgba(255,255,255,0.04)',
              border: `1px solid ${input ? 'rgba(139,92,246,0.45)' : 'rgba(255,255,255,0.1)'}`,
              borderRadius: 10,
              padding: '11px 14px',
              fontSize: 13.5,
              color: '#f0f4ff',
              fontFamily: 'Inter, system-ui, sans-serif',
              resize: 'none',
              outline: 'none',
              lineHeight: 1.5,
              transition: 'border-color 0.15s',
              minHeight: 44,
              maxHeight: 120,
              overflow: 'auto',
            }}
            onInput={e => {
              // Auto-grow
              e.target.style.height = 'auto'
              e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'
            }}
            onFocus={e => { e.target.style.borderColor = 'rgba(139,92,246,0.6)' }}
            onBlur={e => { e.target.style.borderColor = input ? 'rgba(139,92,246,0.45)' : 'rgba(255,255,255,0.1)' }}
          />
          <button
            onClick={() => send()}
            disabled={!input.trim() || loading}
            style={{
              height: 44,
              minWidth: 44,
              background: (!input.trim() || loading) ? 'rgba(139,92,246,0.12)' : ACCENT,
              border: `1px solid ${(!input.trim() || loading) ? ACCENT_BORDER : ACCENT}`,
              borderRadius: 10,
              color: (!input.trim() || loading) ? '#6d5aac' : '#fff',
              fontSize: 18,
              cursor: (!input.trim() || loading) ? 'default' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
              transition: 'all 0.15s',
              boxShadow: (!input.trim() || loading) ? 'none' : '0 0 14px rgba(139,92,246,0.5)',
            }}
          >
            {loading ? '…' : '↑'}
          </button>
        </div>

        {/* Clear history link */}
        {messages.length > 0 && !loading && (
          <div style={{ marginTop: 8, textAlign: 'right' }}>
            <button
              onClick={() => { setMessages([]); setError(null) }}
              style={{
                background: 'none', border: 'none',
                color: '#4a5568', fontSize: 11, cursor: 'pointer',
                fontFamily: 'Inter, sans-serif',
              }}
            >
              Clear conversation
            </button>
          </div>
        )}
      </div>
    </>
  )
}
