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

export function showInterstitialAd(): Promise<void> {
  return new Promise((resolve) => {
    if (adInFlight || !loadFullScreenAd.isSupported()) { resolve(); return; }
    adInFlight = true;
    const finish = () => { adInFlight = false; resolve(); };
    const cleanup = loadFullScreenAd({
      options: { adGroupId: AD_IDS.interstitial },
      onEvent: (event) => {
        if (event.type === 'loaded') {
          showFullScreenAd({
            options: { adGroupId: AD_IDS.interstitial },
            onEvent: (e) => { if (e.type === 'dismissed') finish(); },
            onError: () => finish(),
          });
        }
      },
      onError: () => finish(),
    });
    setTimeout(() => { cleanup(); finish(); }, 10000);
  });
}

export function isRewardedSupported(): boolean {
  return loadFullScreenAd.isSupported();
}

// 리워드 광고: 광고를 보여주되 끝나면(적립/닫힘 무관) resolve. best-effort.
export function showRewardedAd(): Promise<boolean> {
  return new Promise((resolve) => {
    if (adInFlight || !loadFullScreenAd.isSupported()) { resolve(false); return; }
    adInFlight = true;
    let settled = false;
    const timer: { id?: ReturnType<typeof setTimeout> } = {};
    const done = (c: () => void, result: boolean) => {
      if (settled) return;
      settled = true;
      adInFlight = false;
      clearTimeout(timer.id);
      c();
      resolve(result);
    };
    const cleanup = loadFullScreenAd({
      options: { adGroupId: AD_IDS.rewarded },
      onEvent: (event) => {
        if (event.type === 'loaded') {
          showFullScreenAd({
            options: { adGroupId: AD_IDS.rewarded },
            onEvent: (e) => {
              if (e.type === 'userEarnedReward') done(cleanup, true);
              else if (e.type === 'dismissed') done(cleanup, true);
            },
            onError: () => done(cleanup, false),
          });
        }
      },
      onError: () => done(cleanup, false),
    });
    timer.id = setTimeout(() => done(cleanup, false), 30000);
  });
}
