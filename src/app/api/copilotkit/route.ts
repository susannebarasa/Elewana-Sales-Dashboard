export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { query } from '@/lib/db'

const SCHEMA = `
You are a BI assistant for Elewana Collection, a luxury safari and lodge company.
The MySQL database has these tables:

reservations(
  reservation_number VARCHAR,   -- unique booking ID
  status VARCHAR,               -- '20' = Provisional, '30' = Confirmed, '90' = Cancelled
  total_amount DOUBLE,          -- reservation total revenue
  date_created DATE,            -- booking creation date
  rate_type VARCHAR,            -- booking channel / rate type
  agent_id VARCHAR,             -- travel agent ID
  consultant VARCHAR            -- internal sales consultant name
)

itineraries(
  itinerary_id VARCHAR,
  reservation_number VARCHAR,   -- FK to reservations
  property VARCHAR,             -- property code (FK to properties.property_id)
  date_in DATE,                 -- check-in date
  date_out DATE,                -- check-out date
  total_gross_amount DOUBLE     -- itinerary-level revenue
)

agents(
  agent_id VARCHAR,
  agent_name VARCHAR
)

properties(
  property_id VARCHAR,
  name VARCHAR
)

Rules:
- Status '30' = Confirmed, '20' = Provisional, '90' = Cancelled
- For reservation-level revenue use reservations.total_amount (avoid itinerary joins to prevent inflation)
- For property-level revenue use itineraries.total_gross_amount
- Use MySQL syntax: YEAR(), MONTH(), CURDATE(), DATE_ADD(), DATEDIFF()
- Current year is ${new Date().getFullYear()}
- Keep queries simple and return at most 20 rows
`

export async function POST(req: NextRequest) {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  try {
    const { messages } = await req.json() as {
      messages: { role: string; content: string }[]
    }

    const lastMessage = messages[messages.length - 1]
    if (!lastMessage || lastMessage.role !== 'user') {
      return NextResponse.json({ reply: 'No question received.' })
    }

    const question = lastMessage.content

    // Step 1: Claude generates SQL
    const sqlResponse = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: `${SCHEMA}

Generate a single MySQL query to answer the user's question.
Return ONLY the SQL query — no explanation, no markdown, no backticks.`,
      messages: [{ role: 'user', content: question }],
    })

    const sql = (sqlResponse.content[0] as { text: string }).text.trim()

    // Step 2: Run against MySQL
    let queryResult: string
    try {
      const rows = await query(sql)
      queryResult = JSON.stringify(rows, null, 2)
    } catch (dbErr) {
      queryResult = `Query error: ${String(dbErr)}`
    }

    // Step 3: Claude formats plain English answer
    const answerResponse = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: `You are a helpful BI assistant for Elewana Collection.
Given a question and database results, write a clear concise answer in 1-3 sentences.
Use numbers and percentages where relevant. Be direct and informative.`,
      messages: [
        {
          role: 'user',
          content: `Question: ${question}\n\nSQL: ${sql}\n\nResults: ${queryResult}`,
        },
      ],
    })

    const reply = (answerResponse.content[0] as { text: string }).text.trim()
    return NextResponse.json({ reply })

  } catch (err) {
    console.error('[copilotkit route]', err)
    return NextResponse.json(
      { reply: 'Something went wrong. Please try again.' },
      { status: 500 }
    )
  }
}
