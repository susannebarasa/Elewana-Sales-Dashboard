'use client'
import { useRef, useState } from 'react'
import Autocomplete, { createFilterOptions } from '@mui/material/Autocomplete'
import TextField from '@mui/material/TextField'
import type { AgentYearly } from '@/types'

// Sales Executive Summary's own Find Agent — deliberately NOT the shared FindAgentSearch
// component (Topbar/DailyView/PipelineView etc. use that one, with a "type 2+ characters before
// searching the full list" behavior that's appropriate for a lightweight suggestion box). This
// page already has the full real agent list in memory (data.AD.yearly, server-filtered by the
// current property/segment), so the dropdown shows ALL of them on focus — matching the Claude
// Design mockup's own agent search (AG_POOL, full list on focus, narrowed by typing) — with no
// extra network round-trip needed.
const filterAgents = createFilterOptions<AgentYearly>({
  stringify: (option) => `${option.nm} ${option.country ?? ''}`,
})

type Props = {
  agents: AgentYearly[]
  onSelectAgent: (agentId: string) => void
}

export default function SesAgentSearch({ agents, onSelectAgent }: Props) {
  const [inputValue, setInputValue] = useState('')
  // Dropdown-overlap fix (2026-07-16) — the popup was staying open (and painting over the Agent
  // Panel drawer that opens on selection) because nothing explicitly closed it or moved focus
  // away. `open` is now controlled directly, and the input is blurred on selection, so the popper
  // reliably unmounts before the drawer opens rather than lingering on top of it.
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <Autocomplete
      size="small"
      open={open}
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
      options={agents}
      filterOptions={filterAgents}
      getOptionLabel={(o) => o.nm}
      inputValue={inputValue}
      onInputChange={(_, v) => setInputValue(v)}
      onChange={(_, v) => {
        setOpen(false)
        inputRef.current?.blur()
        if (v) onSelectAgent(v.id)
      }}
      isOptionEqualToValue={(o, v) => o.id === v.id}
      noOptionsText="No agents match"
      sx={{ width: 240 }}
      slotProps={{
        listbox: {
          sx: {
            fontSize: '0.6875rem', maxHeight: 320,
            '& .MuiAutocomplete-option': { fontSize: '0.6875rem', minHeight: 'auto', py: 0.5 },
          },
        },
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          inputRef={inputRef}
          placeholder="Find Agent"
          variant="outlined"
          sx={{
            '.MuiOutlinedInput-root': { fontSize: '0.75rem', height: 30, py: '0 !important', bgcolor: '#F3EFE6' },
            '.MuiOutlinedInput-notchedOutline': { borderColor: '#C9BEA9' },
          }}
        />
      )}
    />
  )
}
