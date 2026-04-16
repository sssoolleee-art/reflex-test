import React, { useState, useRef, useEffect, useCallback } from 'react';
import { BannerAd, showInterstitialAd, showRewardedAd } from './utils/ads';

// ── Types ─────────────────────────────────────────────────────────────────────

type Screen = 'home' | 'play' | 'result' | 'history' | 'share';
type Phase   = 'idle' | 'waiting' | 'ready' | 'foul' | 'showed';
type ReflexGrade = 'flash' | 'pro' | 'fast' | 'normal' | 'slow' | 'sleepy';

interface SessionResult {
  results: number[];
  avgMs:   number;
  bestMs:  number;
  grade:   ReflexGrade;
  percentile: number;
}

interface DailyRecord {
  date:  string;
  avgMs: number;
  bestMs: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const FREE_SETS_PER_DAY = 2;

const GRADE: Record<ReflexGrade, { label: string; emoji: string; color: string }> = {
  flash:  { label: '번개 반사신경',   emoji: '⚡', color: '#E6B800' },
  pro:    { label: '프로 게이머급',   emoji: '🎮', color: '#FF6B6B' },
  fast:   { label: '빠른 편',        emoji: '🏃', color: '#00B8B9' },
  normal: { label: '평균',           emoji: '👤', color: '#95A5A6' },
  slow:   { label: '느긋한 편',      emoji: '🐢', color: '#3498DB' },
  sleepy: { label: '졸고 있었나요?', emoji: '😴', color: '#9B59B6' },
};

// ── Storage ───────────────────────────────────────────────────────────────────

const SK = {
  BEST_MS:    'reflex_best',
  DAILY:      'reflex_daily',
  STREAK:     'reflex_streak',
  TOTAL:      'reflex_total',
  TODAY_SETS: 'reflex_today_sets',
};

function lsGet<T>(key: string): T | null {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) as T : null; }
  catch { return null; }
}
function lsSet<T>(key: string, value: T) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

function todayStr() { return new Date().toISOString().slice(0, 10); }

function getTodaySetCount(): number {
  const saved = lsGet<{ date: string; count: number }>(SK.TODAY_SETS);
  return saved?.date === todayStr() ? saved.count : 0;
}
function incrementSetCount() {
  lsSet(SK.TODAY_SETS, { date: todayStr(), count: getTodaySetCount() + 1 });
}

function getBestMs(): number | null { return lsGet<number>(SK.BEST_MS); }

function getStreak(): number {
  const s = lsGet<{ lastDate: string; count: number }>(SK.STREAK);
  if (!s) return 0;
  const today = todayStr();
  const yest  = new Date(); yest.setDate(yest.getDate() - 1);
  const yestStr = yest.toISOString().slice(0, 10);
  if (s.lastDate === today || s.lastDate === yestStr) return s.count;
  return 0;
}

function getTotalAttempts(): number { return lsGet<number>(SK.TOTAL) ?? 0; }

function getDailyRecords(): DailyRecord[] {
  const all = lsGet<Record<string, DailyRecord>>(SK.DAILY) ?? {};
  return Object.values(all).sort((a, b) => a.date.localeCompare(b.date)).slice(-14);
}

function saveSession(session: SessionResult) {
  const today = todayStr();

  // 최고 기록
  const best = getBestMs();
  if (!best || session.bestMs < best) lsSet(SK.BEST_MS, session.bestMs);

  // 일별 기록
  const all = lsGet<Record<string, DailyRecord>>(SK.DAILY) ?? {};
  const ex  = all[today];
  all[today] = ex
    ? { date: today, avgMs: Math.round((ex.avgMs + session.avgMs) / 2), bestMs: Math.min(ex.bestMs, session.bestMs) }
    : { date: today, avgMs: session.avgMs, bestMs: session.bestMs };
  lsSet(SK.DAILY, all);

  // 스트릭
  const s = lsGet<{ lastDate: string; count: number }>(SK.STREAK);
  const yest = new Date(); yest.setDate(yest.getDate() - 1);
  const yestStr = yest.toISOString().slice(0, 10);
  if (!s || (s.lastDate !== today && s.lastDate !== yestStr)) {
    lsSet(SK.STREAK, { lastDate: today, count: 1 });
  } else if (s.lastDate === yestStr) {
    lsSet(SK.STREAK, { lastDate: today, count: s.count + 1 });
  } else {
    // 오늘 이미 기록 있음, lastDate만 갱신
    lsSet(SK.STREAK, { lastDate: today, count: s.count });
  }

  // 총 시도 횟수
  lsSet(SK.TOTAL, getTotalAttempts() + session.results.length);
}

// ── Game Helpers ──────────────────────────────────────────────────────────────

function getGrade(avgMs: number): ReflexGrade {
  if (avgMs < 180) return 'flash';
  if (avgMs < 220) return 'pro';
  if (avgMs < 260) return 'fast';
  if (avgMs < 320) return 'normal';
  if (avgMs < 400) return 'slow';
  return 'sleepy';
}

function getPercentile(avgMs: number): number {
  const z   = (avgMs - 265) / 40;
  const cdf = 0.5 * (1 + Math.tanh(z * 0.7978));
  return Math.max(1, Math.min(99, Math.round(cdf * 100)));
}

// ── SVG Line Chart ────────────────────────────────────────────────────────────

function LineChart({ data }: { data: DailyRecord[] }) {
  const W = 320, H = 160;
  const pad = { top: 20, right: 20, bottom: 32, left: 48 };
  const cW = W - pad.left - pad.right;
  const cH = H - pad.top  - pad.bottom;

  if (data.length < 2) return (
    <div style={{ textAlign: 'center', color: '#aaa', fontSize: 14, padding: '20px 0' }}>
      기록이 쌓이면 추이를 볼 수 있어요
    </div>
  );

  const vals = data.map(d => d.avgMs);
  const minV = Math.min(...vals), maxV = Math.max(...vals);
  const range = maxV - minV || 50;

  // invert: low ms = top (낮을수록 좋음)
  const ptsInv = data.map((d, i) => ({
    x: pad.left + (i / (data.length - 1)) * cW,
    y: pad.top  + (1 - (d.avgMs - minV) / range) * cH,
  }));

  const pathD = ptsInv.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const bestIdx = vals.indexOf(Math.min(...vals));

  const yLabels = [maxV, Math.round((maxV + minV) / 2), minV];

  return (
    <svg width={W} height={H} style={{ overflow: 'visible', display: 'block', margin: '0 auto' }}>
      {yLabels.map((v, i) => {
        const y = pad.top + (i / 2) * cH;
        return (
          <g key={i}>
            <line x1={pad.left} y1={y} x2={W - pad.right} y2={y}
                  stroke="#D0F5F5" strokeDasharray="4" />
            <text x={pad.left - 6} y={y + 4} textAnchor="end"
                  fontSize={10} fill="#88CCCC">{v}ms</text>
          </g>
        );
      })}
      <path d={pathD} fill="none" stroke="#00D2D3" strokeWidth={2.5} strokeLinejoin="round" />
      {ptsInv.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={i === bestIdx ? 5.5 : 3}
                fill={i === bestIdx ? '#00D2D3' : '#fff'}
                stroke="#00D2D3" strokeWidth={2} />
      ))}
      <text x={pad.left} y={H - 4} fontSize={10} fill="#88CCCC">
        {data[0].date.slice(5)}
      </text>
      <text x={W - pad.right} y={H - 4} textAnchor="end" fontSize={10} fill="#88CCCC">
        {data[data.length - 1].date.slice(5)}
      </text>
    </svg>
  );
}

// ── Home Screen ───────────────────────────────────────────────────────────────

function HomeScreen({ onStart }: { onStart: () => void }) {
  const bestMs     = getBestMs();
  const streak     = getStreak();
  const total      = getTotalAttempts();
  const setCount   = getTodaySetCount();
  const setsLeft   = Math.max(0, FREE_SETS_PER_DAY - setCount);

  return (
    <div style={s.page}>
      {/* 헤더 */}
      <div style={{ padding: '56px 24px 0' }}>
        <p style={{ fontSize: 13, fontWeight: 700, color: '#00B8B9', letterSpacing: 1 }}>REFLEX TEST</p>
        <h1 style={{ fontSize: 48, fontWeight: 900, color: '#111', letterSpacing: '-3px', lineHeight: 1, marginTop: 4 }}>
          ⚡ 반응속도<br />테스트
        </h1>
        <p style={{ fontSize: 15, color: '#666', marginTop: 10, letterSpacing: '-0.3px' }}>
          초록색으로 바뀌는 순간 터치!<br />
          2회 평균으로 등급이 결정돼요.
        </p>
      </div>

      {/* 스탯 카드 */}
      <div style={{ padding: '24px 24px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={s.statRow}>
          {bestMs
            ? <StatCard icon="🏆" label="최고 기록" value={`${bestMs}ms`} />
            : <StatCard icon="🏆" label="최고 기록" value="—" />
          }
          <StatCard icon="🔥" label="연속 도전" value={streak > 0 ? `${streak}일` : '—'} />
          <StatCard icon="📊" label="총 시도"   value={total > 0 ? `${total}회` : '—'} />
        </div>
        {setsLeft > 0
          ? <p style={{ fontSize: 13, color: '#00B8B9', fontWeight: 600, textAlign: 'center' }}>
              오늘 무료 도전 {setsLeft}회 남음
            </p>
          : <p style={{ fontSize: 13, color: '#FF6B6B', fontWeight: 600, textAlign: 'center' }}>
              오늘 무료 도전 소진 · 광고 시청 후 추가 가능
            </p>
        }
      </div>

      {/* 시작 버튼 */}
      <div style={{ padding: '20px 24px 0' }}>
        <button style={s.startBtn} onClick={onStart}>
          2회 도전 시작
        </button>
      </div>

      <div style={{ flex: 1 }} />
      <div style={{ padding: '0 0 16px' }}>
        <BannerAd />
      </div>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div style={{ flex: 1, background: '#fff', borderRadius: 16, padding: '14px 12px', textAlign: 'center' as const }}>
      <div style={{ fontSize: 22 }}>{icon}</div>
      <div style={{ fontSize: 11, color: '#aaa', fontWeight: 600, marginTop: 4 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 900, color: '#111', letterSpacing: '-1px', marginTop: 2 }}>{value}</div>
    </div>
  );
}

// ── Play Screen ───────────────────────────────────────────────────────────────

function PlayScreen({ onComplete }: { onComplete: (result: SessionResult) => void }) {
  const [phase,   setPhase]   = useState<Phase>('idle');
  const [attempt, setAttempt] = useState(0);   // 완료된 유효 시도 수 (0~5)
  const [results, setResults] = useState<number[]>([]);
  const [lastMs,  setLastMs]  = useState<number | null>(null);

  const timerRef     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startTimeRef = useRef<number>(0);
  const phaseRef     = useRef<Phase>('idle');   // 비동기 setTimeout 내에서 최신 phase 참조용
  phaseRef.current   = phase;

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  function beginAttempt() {
    setPhase('waiting');
    const delay = 1500 + Math.random() * 2500;
    timerRef.current = setTimeout(() => {
      startTimeRef.current = performance.now();
      setPhase('ready');
    }, delay);
  }

  const handleTap = useCallback(async () => {
    if (phase === 'idle') {
      beginAttempt();
      return;
    }
    if (phase === 'waiting') {
      clearTimeout(timerRef.current!);
      timerRef.current = null;
      setPhase('foul');
      setTimeout(() => setPhase('idle'), 1500);
      return;
    }
    if (phase === 'ready') {
      const ms = Math.round(performance.now() - startTimeRef.current);
      setLastMs(ms);
      const newResults = [...results, ms];
      const nextAttempt = attempt + 1;
      setResults(newResults);
      setAttempt(nextAttempt);
      setPhase('showed');

      if (nextAttempt >= 2) {
        const avgMs   = Math.round(newResults.reduce((a, b) => a + b, 0) / 2);
        const grade   = getGrade(avgMs);
        const percentile = getPercentile(avgMs);
        const bestMs  = Math.min(...newResults);
        const session: SessionResult = { results: newResults, avgMs, grade, percentile, bestMs };
        saveSession(session);
        await showInterstitialAd();
        onComplete(session);
      } else {
        setTimeout(() => setPhase('idle'), 1200);
      }
    }
    // foul/showed: 무시 (자동 전환 대기 중)
  }, [phase, results, attempt, onComplete]);

  const bgColor =
    phase === 'ready'   ? '#2ED573' :
    phase === 'foul'    ? '#FFA502' :
    phase === 'showed'  ? '#00D2D3' : '#FF4757';

  const progressLabel = phase === 'showed' ? `${attempt} / 2` : `${attempt + 1} / 2`;

  return (
    <div
      onClick={handleTap}
      style={{
        background: bgColor,
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        userSelect: 'none',
        transition: 'background 0.08s ease',
        color: '#fff',
        cursor: 'pointer',
      }}
    >
      <p style={{ position: 'absolute', top: 56, fontSize: 14, fontWeight: 700, opacity: 0.75 }}>
        {progressLabel}
      </p>

      {phase === 'idle' && (
        <div style={{ textAlign: 'center' as const }}>
          <p style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-1px' }}>화면을 터치!</p>
          <p style={{ fontSize: 15, opacity: 0.7, marginTop: 8 }}>초록으로 바뀌면 즉시 눌러요</p>
        </div>
      )}
      {phase === 'waiting' && (
        <div style={{ textAlign: 'center' as const }}>
          <p style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-1px' }}>기다리세요...</p>
          <p style={{ fontSize: 14, opacity: 0.6, marginTop: 8 }}>초록으로 바뀔 때 눌러요</p>
        </div>
      )}
      {phase === 'ready' && (
        <p style={{ fontSize: 72, fontWeight: 900, letterSpacing: '-4px', animation: 'pulse 0.3s ease' }}>
          터치!
        </p>
      )}
      {phase === 'foul' && (
        <div style={{ textAlign: 'center' as const }}>
          <p style={{ fontSize: 44, fontWeight: 900 }}>⚡</p>
          <p style={{ fontSize: 24, fontWeight: 800, marginTop: 8 }}>너무 빨라요!</p>
          <p style={{ fontSize: 14, opacity: 0.7, marginTop: 6 }}>초록으로 바뀐 후 눌러야 해요</p>
        </div>
      )}
      {phase === 'showed' && lastMs !== null && (
        <div style={{ textAlign: 'center' as const, animation: 'countUp 0.2s ease' }}>
          <p style={{ fontSize: 80, fontWeight: 900, letterSpacing: '-5px', lineHeight: 1 }}>
            {lastMs}<span style={{ fontSize: 36, letterSpacing: '-2px' }}>ms</span>
          </p>
          <p style={{ fontSize: 14, opacity: 0.75, marginTop: 8 }}>
            {attempt >= 2 ? '완료! 잠시만요...' : '다음 시도 준비 중'}
          </p>
        </div>
      )}
    </div>
  );
}

// ── Result Screen ─────────────────────────────────────────────────────────────

function ResultScreen({
  session,
  onPlayAgain,
  onShowHistory,
  onShare,
}: {
  session: SessionResult;
  onPlayAgain: () => void;
  onShowHistory: () => void;
  onShare: () => void;
}) {
  const [loading, setLoading] = useState<'history' | 'again' | null>(null);
  const [toast,   setToast]   = useState('');

  const g = GRADE[session.grade];

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 2500);
  }

  async function handlePlayAgain() {
    setLoading('again');
    const setCount = getTodaySetCount();
    if (setCount < FREE_SETS_PER_DAY) {
      incrementSetCount();
      await showInterstitialAd();
      onPlayAgain();
    } else {
      // 추가 세트: 리워드 광고
      const earned = await showRewardedAd();
      if (earned) {
        incrementSetCount();
        await showInterstitialAd();
        onPlayAgain();
      } else {
        showToast('광고를 끝까지 보면 1세트 더 할 수 있어요!');
      }
    }
    setLoading(null);
  }

  async function handleHistory() {
    setLoading('history');
    const earned = await showRewardedAd();
    if (earned) {
      onShowHistory();
    } else {
      showToast('광고를 끝까지 보면 기록을 확인할 수 있어요!');
    }
    setLoading(null);
  }

  return (
    <div style={s.page}>
      {toast && <div style={s.toast}>{toast}</div>}

      {/* 결과 카드 */}
      <div style={{ ...s.card, margin: '52px 16px 0', background: g.color }}>
        <p style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.65)', letterSpacing: 1 }}>
          나의 반응속도
        </p>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, marginTop: 6 }}>
          <p style={{ fontSize: 72, fontWeight: 900, color: '#fff', letterSpacing: '-5px', lineHeight: 1, animation: 'countUp 0.3s ease' }}>
            {session.avgMs}
          </p>
          <p style={{ fontSize: 24, fontWeight: 700, color: 'rgba(255,255,255,0.8)', marginBottom: 8, letterSpacing: '-1px' }}>
            ms
          </p>
        </div>
        <p style={{ fontSize: 26, fontWeight: 900, color: '#fff', letterSpacing: '-1px', marginTop: 4 }}>
          {g.emoji} {g.label}
        </p>
        <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.7)', marginTop: 4 }}>
          상위 {session.percentile}% · 최고 {session.bestMs}ms
        </p>
      </div>

      {/* 5회 결과 */}
      <div style={{ padding: '16px 16px 0' }}>
        <p style={{ fontSize: 12, fontWeight: 700, color: '#aaa', letterSpacing: 0.5, marginBottom: 8 }}>
          시도별 기록
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          {session.results.map((ms, i) => {
            const isBest = ms === session.bestMs;
            return (
              <div key={i} style={{
                flex: 1,
                background: isBest ? g.color : '#fff',
                borderRadius: 12,
                padding: '10px 4px',
                textAlign: 'center' as const,
              }}>
                <p style={{ fontSize: 10, color: isBest ? 'rgba(255,255,255,0.7)' : '#bbb', fontWeight: 600 }}>
                  {i + 1}회{isBest ? ' 🏆' : ''}
                </p>
                <p style={{ fontSize: 16, fontWeight: 900, color: isBest ? '#fff' : '#111', letterSpacing: '-0.5px', marginTop: 2 }}>
                  {ms}
                </p>
                <p style={{ fontSize: 10, color: isBest ? 'rgba(255,255,255,0.7)' : '#bbb' }}>ms</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* 반응속도 추이 (잠금) */}
      <div style={{ padding: '12px 16px 0' }}>
        <button
          style={{ ...s.lockedBtn, opacity: loading === 'history' ? 0.6 : 1 }}
          onClick={handleHistory}
          disabled={loading !== null}
        >
          <span style={{ fontSize: 16, marginRight: 6 }}>🔒</span>
          나의 반응속도 추이 보기
          <span style={{ fontSize: 12, color: '#aaa', marginLeft: 4 }}>(광고 시청)</span>
        </button>
      </div>

      {/* 액션 버튼 */}
      <div style={{ padding: '12px 16px 0', display: 'flex', gap: 8 }}>
        <button
          style={{ ...s.primaryBtn, background: g.color, flex: 2, opacity: loading === 'again' ? 0.7 : 1 }}
          onClick={handlePlayAgain}
          disabled={loading !== null}
        >
          {loading === 'again' ? '잠시만요...' : '한 세트 더!'}
        </button>
        <button style={{ ...s.ghostBtn, flex: 1 }} onClick={onShare}>
          공유
        </button>
      </div>

      <div style={{ flex: 1 }} />
      <div style={{ padding: '16px 0' }}>
        <BannerAd />
      </div>
    </div>
  );
}

// ── History Screen ────────────────────────────────────────────────────────────

function HistoryScreen({ onBack }: { onBack: () => void }) {
  const records = getDailyRecords();
  const allMs   = records.map(r => r.avgMs);
  const overallBest  = allMs.length ? Math.min(...allMs) : null;
  const latestAvg    = records.length ? records[records.length - 1].avgMs : null;
  const prevAvg      = records.length > 1 ? records[records.length - 2].avgMs : null;

  const improvement = latestAvg && prevAvg
    ? prevAvg - latestAvg   // 양수 = 빨라짐
    : null;

  return (
    <div style={s.page}>
      <div style={{ padding: '56px 24px 0' }}>
        <p style={{ fontSize: 13, fontWeight: 700, color: '#00B8B9', letterSpacing: 1 }}>HISTORY</p>
        <h2 style={{ fontSize: 32, fontWeight: 900, color: '#111', letterSpacing: '-2px', marginTop: 4 }}>
          반응속도 추이
        </h2>
        {improvement !== null && (
          <p style={{ fontSize: 14, color: improvement >= 0 ? '#2ED573' : '#FF6B6B', fontWeight: 600, marginTop: 6 }}>
            {improvement >= 0
              ? `어제보다 ${improvement}ms 빨라졌어요! 🎉`
              : `어제보다 ${Math.abs(improvement)}ms 느려졌어요`
            }
          </p>
        )}
      </div>

      <div style={{ padding: '24px 16px 0' }}>
        <div style={s.card}>
          <p style={{ fontSize: 12, fontWeight: 700, color: '#aaa', marginBottom: 12 }}>
            최근 {records.length}일 평균 기록
          </p>
          <LineChart data={records} />
        </div>
      </div>

      {overallBest && (
        <div style={{ padding: '16px 16px 0' }}>
          <div style={{ background: '#fff', borderRadius: 16, padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: '#555' }}>🏆 이 기간 최고 기록</span>
            <span style={{ fontSize: 22, fontWeight: 900, color: '#111', letterSpacing: '-1px' }}>{overallBest}ms</span>
          </div>
        </div>
      )}

      <div style={{ padding: '20px 16px 0' }}>
        <button style={{ ...s.primaryBtn, background: '#00D2D3' }} onClick={onBack}>
          결과로 돌아가기
        </button>
      </div>

      <div style={{ flex: 1 }} />
    </div>
  );
}

// ── Share Screen ──────────────────────────────────────────────────────────────

function ShareScreen({ session, onBack }: { session: SessionResult; onBack: () => void }) {
  const [showShareModal, setShowShareModal] = useState(false);
  const [copied, setCopied] = useState(false);
  const g = GRADE[session.grade];

  const shareText = `⚡ 반응속도 테스트 결과\n\n`
    + `평균: ${session.avgMs}ms\n`
    + `등급: ${g.emoji} ${g.label}\n`
    + `상위 ${session.percentile}%\n\n`
    + `너는 몇 ms야? 👇 토스에서 도전해봐!`;

  function handleCopy() {
    navigator.clipboard.writeText(shareText).then(() => {
      setCopied(true);
      setShowShareModal(false);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div style={s.page}>
      {copied && <div style={s.toast}>복사됐어요 📋</div>}

      {/* 공유 모달 */}
      {showShareModal && (
        <div
          style={{ position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end', zIndex: 100 }}
          onClick={() => setShowShareModal(false)}
        >
          <div
            style={{ background: '#fff', borderRadius: '20px 20px 0 0', padding: '32px 24px 48px', width: '100%' }}
            onClick={e => e.stopPropagation()}
          >
            <p style={{ fontSize: 18, fontWeight: 800, color: '#111', letterSpacing: '-0.5px', marginBottom: 20 }}>
              결과 공유하기
            </p>
            <div style={{ background: '#F5F5F5', borderRadius: 12, padding: '14px 16px', marginBottom: 20 }}>
              <p style={{ fontSize: 13, color: '#555', lineHeight: 1.6, whiteSpace: 'pre-line' as const }}>
                {shareText}
              </p>
            </div>
            <button style={{ ...s.primaryBtn, background: '#111' }} onClick={handleCopy}>
              텍스트 복사하기
            </button>
          </div>
        </div>
      )}

      <div style={{ padding: '56px 16px 0' }}>
        {/* 공유 카드 */}
        <div style={{
          background: g.color,
          borderRadius: 24,
          padding: '32px 24px',
          textAlign: 'center' as const,
          boxShadow: `0 8px 32px ${g.color}66`,
        }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.65)', letterSpacing: 1 }}>
            ⚡ REFLEX TEST
          </p>
          <p style={{ fontSize: 80, fontWeight: 900, color: '#fff', letterSpacing: '-6px', lineHeight: 1, marginTop: 16 }}>
            {session.avgMs}<span style={{ fontSize: 32, letterSpacing: '-2px' }}>ms</span>
          </p>
          <p style={{ fontSize: 28, fontWeight: 900, color: '#fff', letterSpacing: '-1px', marginTop: 8 }}>
            {g.emoji} {g.label}
          </p>
          <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.7)', marginTop: 6 }}>
            상위 {session.percentile}%
          </p>
          <p style={{ fontSize: 16, fontWeight: 700, color: 'rgba(255,255,255,0.85)', marginTop: 20 }}>
            "너는 몇 ms야?"
          </p>
        </div>
      </div>

      <div style={{ padding: '20px 16px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <button style={{ ...s.primaryBtn, background: '#111' }} onClick={() => setShowShareModal(true)}>
          공유하기
        </button>
        <button style={{ ...s.ghostBtn }} onClick={onBack}>
          돌아가기
        </button>
      </div>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────

export default function App() {
  const [screen,  setScreen]  = useState<Screen>('home');
  const [session, setSession] = useState<SessionResult | null>(null);

  async function handleStart() {
    const count = getTodaySetCount();
    if (count < FREE_SETS_PER_DAY) {
      incrementSetCount();
      setScreen('play');
    } else {
      const earned = await showRewardedAd();
      if (earned) {
        incrementSetCount();
        setScreen('play');
      }
    }
  }

  function handlePlayComplete(result: SessionResult) {
    setSession(result);
    setScreen('result');
  }

  return (
    <>
      {screen === 'home' && (
        <HomeScreen onStart={handleStart} />
      )}
      {screen === 'play' && (
        <PlayScreen onComplete={handlePlayComplete} />
      )}
      {screen === 'result' && session && (
        <ResultScreen
          session={session}
          onPlayAgain={() => setScreen('play')}
          onShowHistory={() => setScreen('history')}
          onShare={() => setScreen('share')}
        />
      )}
      {screen === 'history' && (
        <HistoryScreen onBack={() => setScreen('result')} />
      )}
      {screen === 'share' && session && (
        <ShareScreen session={session} onBack={() => setScreen('result')} />
      )}
    </>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#E8FFFE',
    display: 'flex',
    flexDirection: 'column',
  },
  card: {
    background: '#fff',
    borderRadius: 20,
    padding: '20px',
    boxShadow: '0 2px 16px rgba(0,0,0,0.06)',
  },
  statRow: {
    display: 'flex',
    gap: 10,
  },
  startBtn: {
    width: '100%',
    padding: '18px',
    fontSize: '18px',
    fontWeight: 900,
    color: '#fff',
    background: '#00D2D3',
    border: 'none',
    borderRadius: '18px',
    letterSpacing: '-0.5px',
    cursor: 'pointer',
    fontFamily: 'inherit',
    boxShadow: '0 4px 20px #00D2D366',
  },
  primaryBtn: {
    width: '100%',
    padding: '17px',
    fontSize: '17px',
    fontWeight: 800,
    color: '#fff',
    border: 'none',
    borderRadius: '16px',
    letterSpacing: '-0.5px',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  ghostBtn: {
    padding: '17px',
    fontSize: '15px',
    fontWeight: 600,
    color: '#888',
    background: '#F0F0F0',
    border: 'none',
    borderRadius: '16px',
    cursor: 'pointer',
    fontFamily: 'inherit',
    letterSpacing: '-0.3px',
  },
  lockedBtn: {
    width: '100%',
    padding: '16px',
    fontSize: '14px',
    fontWeight: 700,
    color: '#555',
    background: '#F5F5F5',
    border: '1.5px dashed #DDD',
    borderRadius: '16px',
    cursor: 'pointer',
    fontFamily: 'inherit',
    letterSpacing: '-0.3px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  toast: {
    position: 'fixed' as const,
    bottom: 32,
    left: '50%',
    transform: 'translateX(-50%)',
    background: '#191f28',
    color: '#fff',
    padding: '12px 20px',
    borderRadius: '99px',
    fontSize: '14px',
    fontWeight: 500,
    zIndex: 1000,
    whiteSpace: 'nowrap' as const,
  },
};
