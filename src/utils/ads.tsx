import { useEffect, useRef } from 'react';
import { TossAds, loadFullScreenAd, showFullScreenAd, IAP } from '@apps-in-toss/web-framework';

export const AD_FREE_SKU = 'ait.0000028289.ae0bc7b3.fb7223875e.8212850872';
export const AD_FREE_KEY = 'reflex_ad_free';

export function isAdFree(): boolean {
  return localStorage.getItem(AD_FREE_KEY) === 'true';
}

export async function restoreAdFree(onUnlocked: () => void) {
  if (isAdFree()) { onUnlocked(); return; }
  try {
    const res = await IAP.getCompletedOrRefundedOrders();
    if (res?.orders.some(o => o.status === 'COMPLETED' && o.sku === AD_FREE_SKU)) {
      localStorage.setItem(AD_FREE_KEY, 'true');
      onUnlocked();
    }
  } catch {}
}

export function buyAdFree(onSuccess: () => void, onDone: () => void) {
  const cleanup = IAP.createOneTimePurchaseOrder({
    options: {
      sku: AD_FREE_SKU,
      processProductGrant: async () => {
        try { localStorage.setItem(AD_FREE_KEY, 'true'); onSuccess(); return true; }
        catch { return false; }
      },
    },
    onEvent: () => { cleanup(); onDone(); },
    onError: () => { cleanup(); onDone(); },
  });
}

const AD_IDS = {
  banner:       'ait.v2.live.c58a229bc85c4056',
  interstitial: 'ait.v2.live.49bafaf2815245b2',
  rewarded:     'ait.v2.live.a7c643811a3846fe',
};

// 앱 시작 시 한 번만 initialize → 배너가 이 Promise를 기다린 뒤 attach (초기화 없으면 배너 송출 실패)
let resolveInit!: () => void;
const adsReady = new Promise<void>((r) => { resolveInit = r; });

export function initAds() {
  if (!TossAds.initialize.isSupported()) { resolveInit(); return; }
  TossAds.initialize({ callbacks: { onInitialized: () => resolveInit() } });
  // 초기화 직후 전면·리워드를 미리 load → 노출 시점엔 즉시 표시
  adsReady.then(() => {
    if (isAdFree()) return;
    preloadAd(AD_IDS.interstitial);
    preloadAd(AD_IDS.rewarded);
  });
}

// 전면/리워드 풀스크린이 동시에 뜨지 않도록
let adInFlight = false;

export function BannerAd() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current || !TossAds.attachBanner.isSupported()) return;
    const el = ref.current;
    let result: { destroy: () => void } | null = null;
    let destroyed = false;
    adsReady.then(() => {
      if (destroyed || !el) return;
      result = TossAds.attachBanner(AD_IDS.banner, el);
    });
    return () => { destroyed = true; result?.destroy(); };
  }, []);
  return <div ref={ref} style={{ width: '100%', minHeight: 50 }} />;
}

// ── 전면·리워드 프리로드 (ox-quiz·오늘의운세·사주·랜덤뽑기와 동일 구조) ──
// 노출 시점에 load를 시작하면 로드 지연·실패가 그대로 노출 손실이 된다
// (기존 전면 load 타임아웃 10초 — 시청률 68~76% 나오는 날의 손실 원인.
//  전면 eCPM 38,741₩·리워드 49,404₩로 노출 1건 가치가 높아 손실이 큼).

interface AdSlot {
  status: 'idle' | 'loading' | 'ready';
  cleanup: (() => void) | null;
  waiters: (() => void)[];
}

const slots = new Map<string, AdSlot>();

function getSlot(adGroupId: string): AdSlot {
  let s = slots.get(adGroupId);
  if (!s) {
    s = { status: 'idle', cleanup: null, waiters: [] };
    slots.set(adGroupId, s);
  }
  return s;
}

function preloadAd(adGroupId: string) {
  if (!loadFullScreenAd.isSupported()) return;
  const slot = getSlot(adGroupId);
  if (slot.status !== 'idle') return;
  slot.status = 'loading';
  const notify = () => slot.waiters.splice(0).forEach((w) => w());
  const cleanup = loadFullScreenAd({
    options: { adGroupId },
    onEvent: (event) => {
      if (event.type === 'loaded') {
        slot.status = 'ready';
        slot.cleanup = cleanup;
        notify();
      }
    },
    onError: () => {
      cleanup();
      slot.status = 'idle';
      slot.cleanup = null;
      notify();
    },
  });
}

// ready가 될 때까지 대기 (idle이면 그 자리에서 load 시작)
function waitForLoaded(adGroupId: string, timeoutMs: number): Promise<boolean> {
  const slot = getSlot(adGroupId);
  if (slot.status === 'ready') return Promise.resolve(true);
  preloadAd(adGroupId);
  if (slot.status !== 'loading') return Promise.resolve(false); // 미지원 등
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(slot.status === 'ready');
    };
    const timer = setTimeout(finish, timeoutMs);
    slot.waiters.push(finish);
  });
}

// 로드돼 있는 광고를 표시하고 닫힐 때까지 대기. 끝나면 다음 광고를 미리 load.
// 'shown' 정상 노출 / 'failed' 표시 자체가 실패(만료 등, 재시도 가능) /
// 'aborted' 광고가 뜬 뒤 이벤트 유실·중단(재시도하면 광고 2연속 — 금지)
function showLoaded(adGroupId: string): Promise<{ status: 'shown' | 'failed' | 'aborted'; earned: boolean }> {
  return new Promise((resolve) => {
    const slot = getSlot(adGroupId);
    const loadCleanup = slot.cleanup;
    slot.status = 'idle';
    slot.cleanup = null;
    let opened = false;
    let settled = false;
    const done = (status: 'shown' | 'failed' | 'aborted', earned = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(guard);
      loadCleanup?.();
      preloadAd(adGroupId);
      resolve({ status, earned });
    };
    showFullScreenAd({
      options: { adGroupId },
      onEvent: (e) => {
        opened = true; // 어떤 이벤트든 왔다면 광고는 표시된 것
        if (e.type === 'userEarnedReward') done('shown', true);
        else if (e.type === 'dismissed') done('shown', false);
      },
      onError: () => done(opened ? 'aborted' : 'failed'),
    });
    const guard = setTimeout(() => done('aborted'), 90_000); // 이벤트 유실 대비
  });
}

// 프리로드된 광고를 즉시 표시. 표시 실패(프리로드 광고 만료 등) 시에만 새로 load해 1회 재시도.
async function showFullScreen(adGroupId: string): Promise<{ shown: boolean; earned: boolean }> {
  if (!loadFullScreenAd.isSupported()) return { shown: false, earned: false };
  for (let attempt = 0; attempt < 2; attempt++) {
    const ready = await waitForLoaded(adGroupId, attempt === 0 ? 12_000 : 8_000);
    if (!ready) return { shown: false, earned: false };
    const result = await showLoaded(adGroupId);
    if (result.status === 'shown') return { shown: true, earned: result.earned };
    if (result.status === 'aborted') return { shown: false, earned: false };
  }
  return { shown: false, earned: false };
}

// 노출 정책: 전면광고를 반복하지 않음 — 세션당 최대 2회, 최소 3분 간격
let interstitialShownCount = 0;
let interstitialShownAt = 0;
function allowInterstitial(): boolean {
  const now = Date.now();
  if (interstitialShownCount >= 2 || now - interstitialShownAt < 180_000) return false;
  interstitialShownCount += 1;
  interstitialShownAt = now;
  return true;
}

export async function showInterstitialAd(): Promise<void> {
  if (!allowInterstitial()) return;
  if (adInFlight) return;
  adInFlight = true;
  try { await showFullScreen(AD_IDS.interstitial); }
  finally { adInFlight = false; }
}

export function isRewardedSupported(): boolean {
  return loadFullScreenAd.isSupported();
}

// 리워드 광고: 광고를 보여주되 끝나면(적립/닫힘 무관) resolve. best-effort. (기존 정책 유지)
export async function showRewardedAd(): Promise<boolean> {
  if (adInFlight) return false;
  adInFlight = true;
  try {
    const result = await showFullScreen(AD_IDS.rewarded);
    return result.shown; // dismissed도 true (best-effort)
  } finally { adInFlight = false; }
}
