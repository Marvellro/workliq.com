'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

type WaitlistStatus = 'pending' | 'invited' | 'rejected'

interface WaitlistEntry {
  id: string
  name: string
  email: string
  role: string
  status: WaitlistStatus
  created_at: string
  invited_at: string | null
}

const STATUS_STYLES: Record<WaitlistStatus, string> = {
  pending:  'bg-amber-100 text-amber-800',
  invited:  'bg-emerald-100 text-emerald-800',
  rejected: 'bg-red-100 text-red-800',
}

function fmt(date: string | null) {
  if (!date) return '—'
  return new Date(date).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

export default function AdminWaitlistPage() {
  const [entries, setEntries]   = useState<WaitlistEntry[]>([])
  const [filter, setFilter]     = useState<WaitlistStatus | 'all'>('all')
  const [search, setSearch]     = useState('')
  const [loading, setLoading]   = useState(true)
  const [busy, setBusy]         = useState<string | null>(null)
  const [toast, setToast]       = useState<{ msg: string; ok: boolean } | null>(null)

  const fetchEntries = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('waitlist')
      .select('*')
      .order('created_at', { ascending: false })
    if (!error && data) setEntries(data as WaitlistEntry[])
    setLoading(false)
  }, [])

  useEffect(() => { fetchEntries() }, [fetchEntries])

  function showToast(msg: string, ok = true) {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3500)
  }

  async function inviteUser(entry: WaitlistEntry) {
    setBusy(entry.id)
    try {
      const res = await fetch('/api/admin/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: entry.email, name: entry.name }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      showToast(`Invite sent to ${entry.email}`)
      await fetchEntries()
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to send invite', false)
    } finally {
      setBusy(null)
    }
  }

  async function rejectUser(entry: WaitlistEntry) {
    if (!confirm(`Reject ${entry.name}?`)) return
    setBusy(entry.id)
    const { error } = await supabase
      .from('waitlist')
      .update({ status: 'rejected', rejected_at: new Date().toISOString() })
      .eq('id', entry.id)
    if (error) showToast(error.message, false)
    else { showToast(`${entry.name} rejected`); await fetchEntries() }
    setBusy(null)
  }

  async function removeUser(entry: WaitlistEntry) {
    if (!confirm(`Permanently delete ${entry.name}?`)) return
    setBusy(entry.id)
    const { error } = await supabase.from('waitlist').delete().eq('id', entry.id)
    if (error) showToast(error.message, false)
    else { showToast(`${entry.name} removed`); await fetchEntries() }
    setBusy(null)
  }

  function exportCSV() {
    const headers = ['Name', 'Email', 'Role', 'Status', 'Signed Up', 'Invited At']
    const rows = filtered.map(e => [
      e.name, e.email, e.role, e.status, fmt(e.created_at), fmt(e.invited_at),
    ])
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url
    a.download = `workliq-waitlist-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const filtered = entries.filter(e => {
    const matchStatus = filter === 'all' || e.status === filter
    const matchSearch = !search ||
      e.name.toLowerCase().includes(search.toLowerCase()) ||
      e.email.toLowerCase().includes(search.toLowerCase()) ||
      (e.role ?? '').toLowerCase().includes(search.toLowerCase())
    return matchStatus && matchSearch
  })

  const counts = {
    all:      entries.length,
    pending:  entries.filter(e => e.status === 'pending').length,
    invited:  entries.filter(e => e.status === 'invited').length,
    rejected: entries.filter(e => e.status === 'rejected').length,
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium
          ${toast.ok ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>
          {toast.msg}
        </div>
      )}
      <div className="max-w-6xl mx-auto px-4 py-10">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Waitlist</h1>
            <p className="text-sm text-gray-500 mt-1">
              {counts.pending} pending · {counts.invited} invited · {counts.rejected} rejected
            </p>
          </div>
          <button onClick={exportCSV}
            className="px-4 py-2 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50">
            ↓ Export CSV
          </button>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <div className="flex gap-1 bg-white border border-gray-200 rounded-lg p-1">
            {(['all', 'pending', 'invited', 'rejected'] as const).map(s => (
              <button key={s} onClick={() => setFilter(s)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium capitalize
                  ${filter === s ? 'bg-gray-900 text-white' : 'text-gray-600 hover:text-gray-900'}`}>
                {s} ({counts[s]})
              </button>
            ))}
          </div>
          <input type="text" placeholder="Search name, email or role…"
            value={search} onChange={e => setSearch(e.target.value)}
            className="flex-1 px-4 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-gray-900" />
        </div>

        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
          {loading ? (
            <div className="py-20 text-center text-gray-400 text-sm">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="py-20 text-center text-gray-400 text-sm">No entries found</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-5 py-3 font-medium text-gray-500">Name</th>
                  <th className="text-left px-5 py-3 font-medium text-gray-500">Email</th>
                  <th className="text-left px-5 py-3 font-medium text-gray-500">Role</th>
                  <th className="text-left px-5 py-3 font-medium text-gray-500">Status</th>
                  <th className="text-left px-5 py-3 font-medium text-gray-500">Signed Up</th>
                  <th className="text-right px-5 py-3 font-medium text-gray-500">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map(entry => (
                  <tr key={entry.id} className="hover:bg-gray-50">
                    <td className="px-5 py-3.5 font-medium text-gray-900">{entry.name}</td>
                    <td className="px-5 py-3.5 text-gray-600">{entry.email}</td>
                    <td className="px-5 py-3.5 text-gray-600">{entry.role || '—'}</td>
                    <td className="px-5 py-3.5">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize
                        ${STATUS_STYLES[entry.status] ?? 'bg-gray-100 text-gray-600'}`}>
                        {entry.status ?? 'pending'}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-gray-500">{fmt(entry.created_at)}</td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center justify-end gap-2">
                        {(entry.status === 'pending' || entry.status === 'invited') && (
                          <button disabled={busy === entry.id} onClick={() => inviteUser(entry)}
                            className="px-3 py-1.5 rounded-md bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 disabled:opacity-50">
                            {busy === entry.id ? 'Sending…' : entry.status === 'invited' ? 'Resend' : 'Invite'}
                          </button>
                        )}
                        {entry.status === 'pending' && (
                          <button disabled={busy === entry.id} onClick={() => rejectUser(entry)}
                            className="px-3 py-1.5 rounded-md border border-gray-200 text-gray-600 text-xs font-medium hover:bg-gray-50 disabled:opacity-50">
                            Reject
                          </button>
                        )}
                        <button disabled={busy === entry.id} onClick={() => removeUser(entry)}
                          className="px-3 py-1.5 rounded-md border border-red-100 text-red-500 text-xs font-medium hover:bg-red-50 disabled:opacity-50">
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
