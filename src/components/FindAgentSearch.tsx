'use client'
import { useState, useMemo } from 'react'
import Autocomplete from '@mui/material/Autocomplete'
import TextField from '@mui/material/TextField'
import CircularProgress from '@mui/material/CircularProgress'
import type { AgentSearchResult } from '@/types'

type Props = {
  onSelectAgent: (agentId: string) => void
  // Top agents by revenue for the current period (e.g. data.AD.yearly) — shown on
  // focus/click before any typing. Once 2+ characters are typed, this is ignored in
  // favor of the full debounced search across all agents.
  defaultOptions?: AgentSearchResult[]
}

export default function FindAgentSearch({ onSelectAgent, defaultOptions = [] }: Props) {
  const [inputValue, setInputValue] = useState('')
  const [options, setOptions] = useState<AgentSearchResult[]>([])
  const [loading, setLoading] = useState(false)

  const debouncedFetch = useMemo(() => {
    let timer: ReturnType<typeof setTimeout>
    return (q: string) => {
      clearTimeout(timer)
      if (q.trim().length < 2) { setOptions([]); return }
      timer = setTimeout(() => {
        setLoading(true)
        fetch(`/api/agents/search?q=${encodeURIComponent(q)}`)
          .then((r) => r.json())
          .then((d: { results: AgentSearchResult[] }) => { setOptions(d.results ?? []); setLoading(false) })
          .catch(() => setLoading(false))
      }, 250)
    }
  }, [])

  const isSearching = inputValue.trim().length >= 2
  const displayOptions = isSearching ? options : defaultOptions

  return (
    <Autocomplete
      size="small"
      openOnFocus
      options={displayOptions}
      {...(!isSearching ? { groupBy: () => 'Top Trade Partners (this period)' } : {})}
      getOptionLabel={(o) => o.name}
      filterOptions={(x) => x}
      loading={loading}
      inputValue={inputValue}
      onInputChange={(_, v) => { setInputValue(v); debouncedFetch(v) }}
      onChange={(_, v) => { if (v) onSelectAgent(v.id) }}
      isOptionEqualToValue={(o, v) => o.id === v.id}
      noOptionsText={isSearching ? 'No agents found' : 'No data for this period'}
      sx={{ width: 220 }}
      renderInput={(params) => (
        <TextField
          {...params}
          placeholder="Find Agent"
          variant="outlined"
          sx={{
            '.MuiOutlinedInput-root': { fontSize: '0.6875rem', height: 30, py: '0 !important' },
            '.MuiOutlinedInput-notchedOutline': { borderColor: 'divider' },
          }}
          slotProps={{
            ...params.slotProps,
            input: {
              ...params.slotProps.input,
              endAdornment: (
                <>
                  {loading && <CircularProgress size={12} sx={{ color: 'primary.main' }} />}
                  {params.slotProps.input.endAdornment}
                </>
              ),
            },
          }}
        />
      )}
    />
  )
}
