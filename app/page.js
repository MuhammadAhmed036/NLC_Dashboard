'use client';
import React, { useState, useEffect, useMemo } from 'react';
import {
  PieChart, Pie, Cell, Tooltip, BarChart, Bar, XAxis, YAxis,
  ResponsiveContainer, Legend, CartesianGrid
} from 'recharts';
import { Car, CheckCircle, Clock, AlertCircle, Activity, Database, Target, Users, Radio } from 'lucide-react';
import Image from 'next/image';

export default function Dashboard() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [detectedStatusKey, setDetectedStatusKey] = useState(null);

  // ---------- helpers ----------
  const normalize = (str) => (str ?? '').toString().trim().toLowerCase();
  const normalizeKey = (k) => normalize(k).replace(/[^a-z0-9]+/g, '');

  const STATUS_SYNONYMS = {
    cleared: ['cleared', 'clear', 'completed', 'done', 'resolved,', 'resolved', 'ok', 'approved', 'passed'],
    pending: ['pending', 'in progress', 'waiting', 'awaiting', 'review', 'queued', 'hold'],
    issue:   ['issue', 'problem', 'error', 'fault', 'alert', 'failed', 'reject', 'rejected'],
  };

  const matchesStatus = (val, target) => {
    const nv = normalize(val);
    if (!nv) return false;
    return STATUS_SYNONYMS[target].some((s) => nv.includes(s));
  };

  const guessStatusKey = (rows) => {
    if (!rows?.length) return null;
    const keys = Object.keys(rows[0] || {});
    if (!keys.length) return null;

    const preferred = keys.find(k => {
      const nk = normalizeKey(k);
      return nk.includes('vehiclesdi') || nk === 'vehiclesdi' || nk.includes('status');
    });

    const sample = rows.slice(0, Math.min(25, rows.length));
    const scores = keys.map((k) => {
      const score = sample.reduce((acc, r) => {
        const v = r[k];
        if (matchesStatus(v, 'cleared') || matchesStatus(v, 'pending') || matchesStatus(v, 'issue')) {
          return acc + 1;
        }
        return acc;
      }, 0);
      return { key: k, score };
    }).sort((a, b) => b.score - a.score);

    const best = scores[0];
    if (preferred) {
      const preferredScore = (scores.find(s => s.key === preferred) || {}).score || 0;
      if (preferredScore > 0) return preferred;
    }
    if (best && best.score > 0) return best.key;
    return keys.find(k => normalizeKey(k) === 'status') || null;
  };

  // Column finder for other widgets
  const findColumnKey = (rows, want) => {
    if (!rows?.length) return null;
    const keys = Object.keys(rows[0] || {});
    const normalizedMap = new Map(keys.map(k => [normalizeKey(k), k]));

    if (want === 'trackerinstalled') {
      if (normalizedMap.has('trackerinstalled')) return normalizedMap.get('trackerinstalled');
      const k1 = keys.find(k => {
        const nk = normalizeKey(k);
        return nk.includes('tracker') && nk.includes('installed');
      });
      if (k1) return k1;
    }

    if (want === 'presentabsent') {
      if (normalizedMap.has('presentabsent')) return normalizedMap.get('presentabsent');
      const k2 = keys.find(k => {
        const nk = normalizeKey(k);
        return nk.includes('present') || nk.includes('absent');
      });
      if (k2) return k2;
    }

    if (want === 'driverperformance') {
      if (normalizedMap.has('driversperformance')) return normalizedMap.get('driversperformance');
      if (normalizedMap.has('driverperformance'))  return normalizedMap.get('driverperformance');
      const k3 = keys.find(k => {
        const nk = normalizeKey(k);
        return nk.includes('performance');
      });
      if (k3) return k3;
    }

    // NEW: driver name column
    if (want === 'drivername') {
      if (normalizedMap.has('drivername')) return normalizedMap.get('drivername');
      if (normalizedMap.has('driversname')) return normalizedMap.get('driversname');
      const k4 = keys.find(k => {
        const nk = normalizeKey(k);
        return nk.includes('driver') && nk.includes('name');
      });
      if (k4) return k4;
    }

    return null;
  };

  // ---------- data load ----------
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/sheets');
        const json = await res.json();
        if (!res.ok) throw new Error(json?.message || 'Failed to load data');
        setData(json);
        setDetectedStatusKey(guessStatusKey(json));
      } catch (e) {
        setError(e.message || String(e));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // Subscribe to live updates via Server-Sent Events (Vercel-compatible)
  useEffect(() => {
    const es = new EventSource('/api/sheets/stream');
    let pollTimer = null;

    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg?.type === 'init' || msg?.type === 'update') {
          setData(msg.data || []);
          setDetectedStatusKey(guessStatusKey(msg.data || []));
          // If live updates arrive, consider data loaded
          setLoading(false);
          setError(null);
        }
      } catch (_) {
        // ignore malformed events
      }
    };

    es.onerror = () => {
      // Fallback polling if SSE connection fails
      if (!pollTimer) {
        pollTimer = setInterval(async () => {
          try {
            const res = await fetch('/api/sheets');
            const json = await res.json();
            if (Array.isArray(json)) {
              setData(json);
              setDetectedStatusKey(guessStatusKey(json));
              setLoading(false);
              setError(null);
            }
          } catch {}
        }, 10000);
      }
    };

    return () => {
      es.close();
      if (pollTimer) clearInterval(pollTimer);
    };
  }, []);

  // ---------- aggregates ----------
  const statusKey = detectedStatusKey || 'Status';

  const {
    cleared, pending, issue, total,
    trackerYes, trackerNo,
    presentCount, absentCount,
    perfExcellent, perfGood, perfSatisfactory
  } = useMemo(() => {
    let c = 0, p = 0, i = 0;
    let tYes = 0, tNo = 0;
    let pres = 0, abs = 0;
    let ex = 0, gd = 0, sat = 0;

    const trackerKey = findColumnKey(data, 'trackerinstalled');
    const paKey      = findColumnKey(data, 'presentabsent');
    const perfKey    = findColumnKey(data, 'driverperformance');
    const dnKey      = findColumnKey(data, 'drivername');

    for (const row of data) {
      // status
      const v = row?.[statusKey];
      if      (matchesStatus(v, 'cleared')) c++;
      else if (matchesStatus(v, 'pending')) p++;
      else if (matchesStatus(v, 'issue'))   i++;

      // tracker
      if (trackerKey) {
        const tv = normalize(row?.[trackerKey]);
        if (tv && !tv.includes('na')) {
          if (tv === 'yes' || tv.startsWith('y')) tYes++;
          else if (tv === 'no' || tv.startsWith('n')) tNo++;
        }
      }

      // gate attendance by driver name not NA
      let hasDriver = true;
      if (dnKey) {
        const dn = normalize(row?.[dnKey]);
        hasDriver = !!dn && dn !== 'na' && dn !== 'n/a';
      }

      // present/absent
      if (paKey && hasDriver) {
        const pv = normalize(row?.[paKey]);
        if (pv === 'p' || pv.includes('present') || pv === 'on' || pv === 'onduty') pres++;
        else if (pv === 'a' || pv.includes('absent') || pv.includes('off') || pv.includes('leave')) abs++;
      }

      // driver performance (Excellent/Good/Satisfactory; include common typos)
      if (perfKey) {
        const dv = normalize(row?.[perfKey]);
        if (!dv) continue;
        if (/(excellent|exelent|excelent|excellant)/.test(dv)) ex++;
        else if (/good/.test(dv)) gd++;
        else if (/(satisfactory|satisf|average|ok)/.test(dv)) sat++;
      }
    }

    return {
      cleared: c, pending: p, issue: i, total: data.length,
      trackerYes: tYes, trackerNo: tNo,
      presentCount: pres, absentCount: abs,
      perfExcellent: ex, perfGood: gd, perfSatisfactory: sat,
    };
  }, [data, statusKey]);

  const pct = (n, den = total) => (den > 0 ? ((n / den) * 100).toFixed(1) : '0.0');

  const statusData = [
    { name: 'Cleared', value: cleared, color: '#10b981' },
    { name: 'Pending', value: pending, color: '#f59e0b' },
    { name: 'Issue',   value: issue,   color: '#ef4444' },
  ];

  const trackerData = [
    { name: 'Installed',     value: trackerYes, color: '#22c55e' },
    { name: 'Not Installed', value: trackerNo,  color: '#64748b' },
  ];

  const attendanceData = [
    { name: 'Present', value: presentCount, color: '#3b82f6' },
    { name: 'Absent',  value: absentCount,  color: '#f97316' },
  ];

  const performanceData = [
    { name: 'Excellent',   value: perfExcellent,   color: '#a78bfa' }, // violet-400
    { name: 'Good',        value: perfGood,        color: '#60a5fa' }, // blue-400
    { name: 'Satisfactory',value: perfSatisfactory,color: '#34d399' }, // emerald-400
  ];

  // compute attendance total for metrics (exclude NA by gating counts above)
  const attendanceTotal = presentCount + absentCount;

  const PremiumMetric = ({ icon: Icon, title, value, percentage, gradient, accentColor }) => (
    <div className={`group relative overflow-hidden rounded-2xl ${gradient} p-5 shadow-2xl hover:shadow-3xl transition-all duration-500 border border-white/10 hover:border-white/20 hover:-translate-y-1`}>
      <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
      <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full blur-2xl -mr-16 -mt-16"></div>
      <div className="relative z-10">
        <div className="flex items-center justify-between mb-4">
          <div className={`${accentColor} bg-white/15 p-2.5 rounded-xl backdrop-blur-sm shadow-lg group-hover:scale-110 transition-transform duration-300`}>
            <Icon className="h-5 w-5" strokeWidth={2.5} />
          </div>
          <div className="flex flex-col items-end">
            <span className="text-white/90 text-2xl font-black tracking-tight">{percentage}%</span>
            <div className="h-1 w-12 bg-white/20 rounded-full mt-1 overflow-hidden">
              <div className="h-full bg-white/80 rounded-full transition-all duration-700" style={{ width: `${percentage}%` }}></div>
            </div>
          </div>
        </div>
        <p className="text-white text-3xl font-black mb-2 tracking-tight">{value}</p>
        <p className="text-white/70 text-xs font-semibold uppercase tracking-wider">{title}</p>
      </div>
    </div>
  );

  const StatusBadge = ({ val }) => {
    const v = val ?? '';
    const cls =
      matchesStatus(v, 'cleared') ? 'bg-emerald-500/25 text-emerald-200 border border-emerald-400/50' :
      matchesStatus(v, 'pending') ? 'bg-amber-500/25  text-amber-200  border border-amber-400/50'  :
      matchesStatus(v, 'issue')   ? 'bg-red-500/25    text-red-200    border border-red-400/50'    :
                                    'bg-slate-500/25  text-slate-200  border border-slate-400/50';
    return (
      <span className={`inline-flex items-center px-3 py-1 rounded-lg text-xs font-bold ${cls}`}>
        {String(v)}
      </span>
    );
  };

  const CustomTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      const item = payload[0];
      return (
        <div className="bg-slate-900/95 backdrop-blur-xl px-5 py-3 rounded-xl shadow-2xl border border-cyan-500/30">
          <p className="font-bold text-white text-sm">{item?.payload?.name}</p>
          <p className="text-cyan-300 text-xs mt-1 font-semibold">
            Count: <span className="font-black text-cyan-400">{item?.payload?.value}</span>
          </p>
        </div>
      );
    }
    return null;
  };

  const columns = Object.keys(data[0] || []);
  const isStatusishKey = (k) => {
    const nk = normalizeKey(k);
    return k === detectedStatusKey || nk.includes('status') || nk.includes('vehiclesdi');
  };

  // ---------- states ----------
  if (loading) {
    return (
      <div className="h-screen bg-gradient-to-br from-slate-950 via-indigo-950 to-purple-950 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-20 w-20 border-4 border-purple-400/20 border-t-cyan-400 mb-6 shadow-2xl"></div>
          <p className="text-white font-bold text-xl tracking-wide">Loading Dashboard...</p>
          <p className="text-slate-400 text-sm mt-2">Initializing vehicle data</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-screen bg-gradient-to-br from-slate-950 via-indigo-950 to-purple-950 flex items-center justify-center">
        <div className="bg-slate-900/95 backdrop-blur-2xl shadow-2xl border border-red-500/50 p-10 max-w-md rounded-3xl">
          <div className="flex items-center">
            <div className="bg-red-500/20 p-4 rounded-2xl mr-5 shadow-lg">
              <AlertCircle className="h-10 w-10 text-red-400" />
            </div>
            <div>
              <p className="font-black text-red-300 text-xl">Error Loading Data</p>
              <p className="text-red-400 text-sm mt-2">{error}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ---------- render ----------
  return (
    // allow vertical scrolling so the records section is fully visible on next scroll
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-indigo-950 to-purple-950 overflow-auto">
      <div className="min-h-full flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-r from-slate-900/80 via-slate-900/70 to-slate-900/80 backdrop-blur-2xl border-b border-white/10 shadow-2xl">
          <div className="px-8 py-4 flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="relative h-14 w-14 overflow-hidden rounded-2xl ring-2 ring-cyan-400/30 shadow-2xl shadow-cyan-500/20">
                <Image
                  src="/NLC-LOGO.png"
                  alt="NLC Logo"
                  fill
                  className="object-contain p-1"
                  priority
                />
              </div>
              <div>
                <h1 className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-300 via-blue-300 to-purple-300 tracking-tight">
                  NLC Vehicles Report
                </h1>
                <p className="text-slate-400 text-xs font-semibold mt-1 tracking-wide">Today Report</p>
              </div>
            </div>
            <div className="flex items-center space-x-3 bg-gradient-to-r from-emerald-500/20 to-teal-500/20 border border-emerald-400/30 px-5 py-2.5 rounded-xl backdrop-blur-sm shadow-lg">
              <div className="relative">
                <Activity className="h-5 w-5 text-emerald-300 animate-pulse" strokeWidth={2.5} />
                <span className="absolute -top-1 -right-1 h-2.5 w-2.5 bg-emerald-400 rounded-full animate-ping"></span>
              </div>
              <span className="text-emerald-200 font-black text-sm tracking-wide">LIVE</span>
            </div>
          </div>
        </div>

        {/* Dashboard widgets */}
        <div className="px-5 py-6">
          {/* Metrics Row */}
          <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
            {/* Total */}
            <div className="group relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-800 to-slate-950 p-5 shadow-2xl border border-white/10">
              <div className="relative z-10">
                <div className="flex items-center justify-between mb-4">
                  <div className="bg-cyan-500/20 p-2.5 rounded-xl backdrop-blur-sm shadow-lg">
                    <Car className="h-5 w-5 text-cyan-400" strokeWidth={2.5} />
                  </div>
                  <Target className="h-5 w-5 text-purple-400" />
                </div>
                <p className="text-white text-4xl font-black mb-2 tracking-tight">{total}</p>
                <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Total Vehicles</p>
              </div>
            </div>

            <PremiumMetric
              icon={CheckCircle}
              title="Cleared"
              value={cleared}
              percentage={pct(cleared)}
              gradient="bg-gradient-to-br from-emerald-600 via-emerald-700 to-teal-800"
              accentColor="text-emerald-300"
            />
            <PremiumMetric
              icon={Clock}
              title="Pending"
              value={pending}
              percentage={pct(pending)}
              gradient="bg-gradient-to-br from-amber-600 via-amber-700 to-orange-800"
              accentColor="text-amber-300"
            />
            <PremiumMetric
              icon={AlertCircle}
              title="Issues"
              value={issue}
              percentage={pct(issue)}
              gradient="bg-gradient-to-br from-red-600 via-red-700 to-pink-800"
              accentColor="text-red-300"
            />
            <PremiumMetric
              icon={Radio}
              title="Trackers"
              value={`${trackerYes}/${total}`}
              percentage={pct(trackerYes)}
              gradient="bg-gradient-to-br from-green-600 via-green-700 to-lime-800"
              accentColor="text-green-300"
            />
            <PremiumMetric
              icon={Users}
              title="Present"
              value={`${presentCount}/${attendanceTotal}`}
              percentage={pct(presentCount, attendanceTotal)}
              gradient="bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-800"
              accentColor="text-blue-300"
            />
          </div>

          {/* Charts Row */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4 mt-5">
            {/* Status */}
            <div className="md:col-span-3 bg-slate-900/60 backdrop-blur-2xl rounded-2xl p-5 shadow-2xl border border-white/10 flex flex-col">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-black text-white uppercase tracking-wider">Status</h3>
                <div className="h-2 w-2 bg-emerald-400 rounded-full animate-pulse"></div>
              </div>
              <div className="flex-1 flex items-center justify-center min-h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={statusData} dataKey="value" cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={4} label={({ percent }) => `${(percent * 100).toFixed(0)}%`}>
                      {statusData.map((e, i) => <Cell key={i} fill={e.color} />)}
                    </Pie>
                    <Tooltip content={<CustomTooltip />} />
                    <Legend verticalAlign="bottom" height={35} iconType="circle" wrapperStyle={{ fontSize: '11px', fontWeight: 700 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Trackers */}
            <div className="md:col-span-3 bg-slate-900/60 backdrop-blur-2xl rounded-2xl p-5 shadow-2xl border border-white/10 flex flex-col">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-black text-white uppercase tracking-wider">Trackers</h3>
                <div className="h-2 w-2 bg-green-400 rounded-full animate-pulse"></div>
              </div>
              <div className="flex-1 flex items-center justify-center min-h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={trackerData} dataKey="value" cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={4} label={({ percent }) => `${(percent * 100).toFixed(0)}%`}>
                      {trackerData.map((e, i) => <Cell key={i} fill={e.color} />)}
                    </Pie>
                    <Tooltip content={<CustomTooltip />} />
                    <Legend verticalAlign="bottom" height={35} iconType="circle" wrapperStyle={{ fontSize: '11px', fontWeight: 700 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Attendance */}
            <div className="md:col-span-3 bg-slate-900/60 backdrop-blur-2xl rounded-2xl p-5 shadow-2xl border border-white/10 flex flex-col">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-black text-white uppercase tracking-wider">Attendance</h3>
                <div className="h-2 w-2 bg-blue-400 rounded-full animate-pulse"></div>
              </div>
              <div className="flex-1 min-h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={attendanceData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                    <XAxis dataKey="name" stroke="#94a3b8" tick={{ fontSize: 11, fontWeight: 700 }} axisLine={{ stroke: '#475569' }} />
                    <YAxis stroke="#94a3b8" tick={{ fontSize: 11 }} axisLine={{ stroke: '#475569' }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="value" radius={[8, 8, 0, 0]}>
                      {attendanceData.map((e, i) => <Cell key={i} fill={e.color} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* NEW: Driver Performance */}
            <div className="md:col-span-3 bg-slate-900/60 backdrop-blur-2xl rounded-2xl p-5 shadow-2xl border border-white/10 flex flex-col">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-black text-white uppercase tracking-wider">Driver Performance</h3>
                <div className="h-2 w-2 bg-violet-400 rounded-full animate-pulse"></div>
              </div>
              <div className="flex-1 flex items-center justify-center min-h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={performanceData} dataKey="value" cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={4} label={({ percent }) => `${(percent * 100).toFixed(0)}%`}>
                      {performanceData.map((e, i) => <Cell key={i} fill={e.color} />)}
                    </Pie>
                    <Tooltip content={<CustomTooltip />} />
                    <Legend verticalAlign="bottom" height={35} iconType="circle" wrapperStyle={{ fontSize: '11px', fontWeight: 700 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>

        {/* ===== FULL-WIDTH RECORDS SECTION (shows on next scroll) ===== */}
        <section className="px-5 pb-8">
          <div className="bg-slate-900/70 backdrop-blur-2xl rounded-2xl shadow-2xl border border-white/10 overflow-hidden">
            <div className="px-6 py-5 border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <Database className="h-5 w-5 text-cyan-400" />
                <h2 className="text-base md:text-lg font-black text-white uppercase tracking-wider">Vehicle Records</h2>
              </div>
              <p className="text-xs md:text-sm text-slate-400">{data.length} entries</p>
            </div>

            {/* Tall scroll container so the table is fully visible and scrollable */}
            <div className="max-h-[70vh] overflow-auto">
              <table className="w-full">
                <thead className="sticky top-0 bg-slate-950/95 backdrop-blur-sm z-10">
                  <tr className="border-b border-slate-700">
                    {columns.map((key) => (
                      <th key={key} className="px-4 py-3 text-left text-xs font-black text-cyan-300 uppercase tracking-wider">
                        {key}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {data.map((row, i) => (
                    <tr key={i} className="hover:bg-slate-800/50 transition-colors duration-200">
                      {columns.map((key, j) => (
                        <td key={j} className="px-4 py-3 text-xs text-slate-300 whitespace-nowrap font-medium">
                          {isStatusishKey(key)
                            ? <StatusBadge val={row[key]} />
                            : String(row[key] ?? '')
                          }
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

      </div>
    </div>
  );
}
