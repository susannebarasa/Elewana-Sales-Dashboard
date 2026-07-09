'use client'
import { useState, useRef, useEffect } from 'react'
import Box from '@mui/material/Box'
import Fab from '@mui/material/Fab'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import IconButton from '@mui/material/IconButton'
import InputBase from '@mui/material/InputBase'
import CircularProgress from '@mui/material/CircularProgress'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import CloseIcon from '@mui/icons-material/Close'
import SendIcon from '@mui/icons-material/Send'

const SAMPLE_QUESTIONS = [
  'What is the total revenue for this year?',
  'Which property has the highest occupancy?',
  'Show me revenue by booking channel',
  'What is our year-on-year growth?',
  'Which market segment books the most?',
  'What is the average daily rate across all properties?',
]

interface Message {
  role: 'user' | 'assistant'
  content: string
}

export default function AiQueryBox() {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const sendMessage = async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || loading) return
    setInput('')

    const userMsg: Message = { role: 'user', content: trimmed }
    setMessages((prev) => [...prev, userMsg])
    setLoading(true)

    try {
      const res = await fetch('/api/copilotkit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [...messages, userMsg] }),
      })
      if (!res.ok) throw new Error('Backend not connected yet')
      const data = await res.json()
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: data.reply ?? data.message ?? 'No response received.' },
      ])
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: 'AI backend not connected yet — this will work once deployed to Netlify.',
        },
      ])
    } finally {
      setLoading(false)
    }
  }

  return (
    <Box sx={{ position: 'fixed', bottom: 28, right: 28, zIndex: 1400 }}>

      {/* Panel */}
      {open && (
        <Paper
          elevation={0}
          sx={{
            position: 'absolute',
            bottom: 68,
            right: 0,
            width: 380,
            maxHeight: 530,
            display: 'flex',
            flexDirection: 'column',
            border: '0.5px solid #C9BEA9',
            borderRadius: 2,
            bgcolor: '#FAF6EC',
            boxShadow: '0 12px 40px rgba(31,26,20,0.14)',
            overflow: 'hidden',
          }}
        >
          {/* Header */}
          <Box
            sx={{
              px: 2,
              py: 1.5,
              borderBottom: '0.5px solid #C9BEA9',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              bgcolor: '#FAF6EC',
              flexShrink: 0,
            }}
          >
            <Box>
              <Typography
                sx={{
                  fontFamily: '"Cormorant Garamond", Georgia, serif',
                  fontSize: 19,
                  fontWeight: 500,
                  color: '#1F1A14',
                  lineHeight: 1,
                }}
              >
                Ask Elewana AI
              </Typography>
              <Typography
                sx={{
                  fontSize: 9.5,
                  color: '#6B5F50',
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  mt: 0.4,
                }}
              >
                Query your data in plain English
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              {messages.length > 0 && (
                <IconButton
                  size="small"
                  onClick={() => setMessages([])}
                  sx={{ color: '#A0917E', fontSize: 10, '&:hover': { color: '#6B5F50' } }}
                  title="Clear chat"
                >
                  <Typography sx={{ fontSize: 9, letterSpacing: '0.06em' }}>CLEAR</Typography>
                </IconButton>
              )}
              <IconButton
                size="small"
                onClick={() => setOpen(false)}
                sx={{ color: '#6B5F50', '&:hover': { color: '#1F1A14' } }}
              >
                <CloseIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Box>
          </Box>

          {/* Body */}
          <Box sx={{ flex: 1, overflowY: 'auto', p: 2, minHeight: 0 }}>
            {messages.length === 0 ? (
              <>
                <Typography
                  sx={{
                    fontSize: 9.5,
                    fontWeight: 600,
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    color: '#6B5F50',
                    mb: 1.5,
                  }}
                >
                  Suggested questions
                </Typography>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                  {SAMPLE_QUESTIONS.map((q) => (
                    <Box
                      key={q}
                      onClick={() => sendMessage(q)}
                      sx={{
                        p: '9px 12px',
                        border: '0.5px solid #C9BEA9',
                        borderRadius: 1.5,
                        cursor: 'pointer',
                        fontSize: 12,
                        color: '#3A3026',
                        bgcolor: '#F5F0E8',
                        transition: 'all 0.12s',
                        '&:hover': {
                          borderColor: '#B7632A',
                          bgcolor: '#FAEEDA',
                          color: '#854F0B',
                        },
                      }}
                    >
                      {q}
                    </Box>
                  ))}
                </Box>
              </>
            ) : (
              <>
                {messages.map((m, i) => (
                  <Box
                    key={i}
                    sx={{
                      mb: 1.5,
                      display: 'flex',
                      justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start',
                    }}
                  >
                    <Box
                      sx={{
                        maxWidth: '85%',
                        px: 1.5,
                        py: 1,
                        borderRadius: 1.5,
                        fontSize: 12.5,
                        lineHeight: 1.6,
                        whiteSpace: 'pre-wrap',
                        ...(m.role === 'user'
                          ? {
                              bgcolor: '#B7632A',
                              color: '#fff',
                              borderBottomRightRadius: 4,
                            }
                          : {
                              bgcolor: '#F5F0E8',
                              color: '#1F1A14',
                              border: '0.5px solid #C9BEA9',
                              borderBottomLeftRadius: 4,
                            }),
                      }}
                    >
                      {m.content}
                    </Box>
                  </Box>
                ))}
                {loading && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                    <CircularProgress size={11} sx={{ color: '#B7632A' }} />
                    <Typography sx={{ fontSize: 11, color: '#6B5F50' }}>Thinking…</Typography>
                  </Box>
                )}
                <div ref={messagesEndRef} />
              </>
            )}
          </Box>

          {/* Input */}
          <Box
            sx={{
              px: 1.5,
              py: 1.25,
              borderTop: '0.5px solid #C9BEA9',
              display: 'flex',
              alignItems: 'flex-end',
              gap: 1,
              bgcolor: '#FAF6EC',
              flexShrink: 0,
            }}
          >
            <InputBase
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  sendMessage(input)
                }
              }}
              placeholder="Ask about your data…"
              fullWidth
              multiline
              maxRows={3}
              sx={{
                fontSize: 12.5,
                color: '#1F1A14',
                px: 1.25,
                py: 0.75,
                border: '0.5px solid #C9BEA9',
                borderRadius: 1,
                bgcolor: '#F5F0E8',
                lineHeight: 1.5,
                '& .MuiInputBase-input': { fontSize: 12.5 },
                '& .MuiInputBase-input::placeholder': {
                  color: '#A0917E',
                  opacity: 1,
                },
              }}
            />
            <IconButton
              size="small"
              onClick={() => sendMessage(input)}
              disabled={!input.trim() || loading}
              sx={{
                bgcolor: '#B7632A',
                color: '#fff',
                width: 34,
                height: 34,
                flexShrink: 0,
                mb: 0.25,
                '&:hover': { bgcolor: '#854F0B' },
                '&.Mui-disabled': { bgcolor: '#C9BEA9', color: '#fff' },
              }}
            >
              <SendIcon sx={{ fontSize: 15 }} />
            </IconButton>
          </Box>
        </Paper>
      )}

      {/* Floating button */}
      <Fab
        onClick={() => setOpen((o) => !o)}
        size="medium"
        sx={{
          bgcolor: open ? '#854F0B' : '#B7632A',
          color: '#fff',
          width: 52,
          height: 52,
          boxShadow: '0 4px 18px rgba(183,99,42,0.45)',
          transition: 'background-color 0.15s',
          '&:hover': { bgcolor: '#854F0B' },
        }}
      >
        <AutoAwesomeIcon sx={{ fontSize: 22 }} />
      </Fab>
    </Box>
  )
}
