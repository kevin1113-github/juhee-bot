import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";

import { loadTextToSpeech, loadVoiceStyle } from "./helper.js";
import { logger } from "./logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type TtsCacheStats = {
  hits: number;
  misses: number;
  inflightWaits: number;
  errors: number;
};

type SupertonicStyle = unknown;

type TextToSpeechEngine = {
  sampleRate: number;
  call: (
    text: string,
    lang: string,
    style: SupertonicStyle,
    totalStep: number,
    speed?: number
  ) => Promise<{ wav: ArrayLike<number>; duration: number[] }>;
};

type SynthesisResult = {
  sampleRate: number;
  pcmBuffer: Buffer;
};

declare global {
  // eslint-disable-next-line no-var
  var __juheeTtsCacheStats: TtsCacheStats | undefined;
}

const VOICES = {
  F1: "F1",
  F2: "F2",
  F3: "F3",
  F4: "F4",
  F5: "F5",
  M1: "M1",
  M2: "M2",
  M3: "M3",
  M4: "M4",
  M5: "M5",
} as const;

// const VOICE_ALIASES: Record<string, keyof typeof VOICES> = {
//   SunHiNeural: "F1",
//   SeoHyeonNeural: "F2",
//   SoonBokNeural: "F3",
//   JiMinNeural: "F4",
//   YuJinNeural: "F5",
//   InJoonNeural: "M1",
//   BongJinNeural: "M2",
//   GookMinNeural: "M3",
//   HyunsuMultilingualNeural: "M4",
// };

const DEFAULT_VOICE: keyof typeof VOICES = "M1";
const TOTAL_STEP = (() => {
  const raw = process.env.SUPERTONIC_TOTAL_STEP ?? "4";
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? Math.min(10, Math.max(3, parsed)) : 4;
})();
const MAX_RETRIES = 2;
const DISCORD_PCM_RATE = 48000;
const DISCORD_PCM_CHANNELS = 2;

const TTS_CACHE_DIR: string = process.env.TTS_CACHE_DIR
  ? path.resolve(process.env.TTS_CACHE_DIR)
  : path.join(process.cwd(), ".ttsCache");

const TTS_CACHE_MAX_AGE_DAYS: number = (() => {
  const raw = process.env.TTS_CACHE_MAX_AGE_DAYS ?? "30";
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : 30;
})();

/** TTS 캐시 폴더 총 용량 상한 (바이트). 초과 시 오래된 파일부터(LRU) 삭제. 기본 500MB, 0이면 무제한 */
const TTS_CACHE_MAX_BYTES: number = (() => {
  const raw = process.env.TTS_CACHE_MAX_MB ?? "500";
  const parsed = parseInt(raw, 10);
  const mb = Number.isFinite(parsed) && parsed >= 0 ? parsed : 500;
  return mb * 1024 * 1024;
})();

/** 캐시 정리 주기 (ms). 기본 1시간 */
const TTS_CACHE_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
let cacheCleanupRunning = false;

const inFlightSynthesis: Map<string, Promise<SynthesisResult>> = new Map();
const styleCache: Map<string, SupertonicStyle> = new Map();

let textToSpeechPromise: Promise<TextToSpeechEngine> | null = null;
let cacheDirReady = false;
let statsLoaded = false;
let flushTimer: NodeJS.Timeout | null = null;
let lastFlushAt = 0;

function getTtsCacheStats(): TtsCacheStats {
  if (!globalThis.__juheeTtsCacheStats) {
    globalThis.__juheeTtsCacheStats = {
      hits: 0,
      misses: 0,
      inflightWaits: 0,
      errors: 0,
    };
  }
  return globalThis.__juheeTtsCacheStats;
}

function getShardIdForStats(): string {
  const shardId = process.env.SHARD_ID;
  if (shardId && shardId.trim().length > 0) return shardId.trim();

  const shards = process.env.SHARDS;
  if (shards && shards.trim().length > 0) {
    const first = shards.split(",")[0]?.trim();
    if (first) return first;
  }

  return "single";
}

function getStatsFilePath(): string {
  if (process.env.TTS_STATS_FILE && process.env.TTS_STATS_FILE.trim().length > 0) {
    return path.resolve(process.env.TTS_STATS_FILE);
  }
  const shardId = getShardIdForStats();
  return path.join(TTS_CACHE_DIR, `tts-stats-${shardId}.json`);
}

function ensureCacheDir() {
  if (cacheDirReady) return;
  try {
    fs.mkdirSync(TTS_CACHE_DIR, { recursive: true });
    cacheDirReady = true;
  } catch (e) {
    logger.warn("⚠️ TTS 캐시 디렉토리 생성 실패:", e);
  }
}

function loadPersistedStatsOnce() {
  if (statsLoaded) return;
  statsLoaded = true;

  try {
    ensureCacheDir();
    if (!cacheDirReady) return;

    const statsPath = getStatsFilePath();
    if (!fs.existsSync(statsPath)) return;

    const raw = fs.readFileSync(statsPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<TtsCacheStats>;
    const stats = getTtsCacheStats();
    stats.hits = Number(parsed.hits ?? stats.hits) || 0;
    stats.misses = Number(parsed.misses ?? stats.misses) || 0;
    stats.inflightWaits = Number(parsed.inflightWaits ?? stats.inflightWaits) || 0;
    stats.errors = Number(parsed.errors ?? stats.errors) || 0;
  } catch (e) {
    logger.warn("⚠️ TTS 캐시 통계 로드 실패:", e);
  }
}

async function flushStatsToDisk() {
  try {
    ensureCacheDir();
    if (!cacheDirReady) return;

    const stats = getTtsCacheStats();
    const statsPath = getStatsFilePath();
    const payload = {
      hits: stats.hits,
      misses: stats.misses,
      inflightWaits: stats.inflightWaits,
      errors: stats.errors,
      updatedAt: new Date().toISOString(),
      pid: process.pid,
    };

    const tmpPath = `${statsPath}.tmp-${process.pid}-${Date.now()}`;
    await fs.promises.writeFile(tmpPath, JSON.stringify(payload));
    await fs.promises.rename(tmpPath, statsPath);
    lastFlushAt = Date.now();
  } catch (e) {
    logger.warn("⚠️ TTS 캐시 통계 저장 실패:", e);
  }
}

function scheduleStatsFlush() {
  const MIN_INTERVAL_MS = 5000;
  const DEBOUNCE_MS = 1000;
  const now = Date.now();
  const waitMs = Math.max(DEBOUNCE_MS, MIN_INTERVAL_MS - (now - lastFlushAt));

  if (flushTimer) return;
  flushTimer = setTimeout(async () => {
    flushTimer = null;
    await flushStatsToDisk();
  }, waitMs);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveAssetDir(subDir: string): string {
  // Prefer project-root assets path in production (.cache/app runtime).
  const cwdCandidate = path.resolve(process.cwd(), "assets", subDir);
  if (fs.existsSync(cwdCandidate)) {
    return cwdCandidate;
  }

  // Fallback for direct source execution from app/.
  const sourceCandidate = path.resolve(__dirname, "../assets", subDir);
  if (fs.existsSync(sourceCandidate)) {
    return sourceCandidate;
  }

  // Fallback for compiled execution from .cache/app/.
  return path.resolve(__dirname, "../../assets", subDir);
}

function quickLanguageDetect(text: string): string {
  const koreanRegex = /[ㄱ-ㅎㅏ-ㅣ가-힣]/;
  const japaneseRegex = /[\u3040-\u30ff\u31f0-\u31ff]/;
  const englishRegex = /^[a-zA-Z\s\d\.,!?"'():;\-]+$/;

  if (koreanRegex.test(text)) return "ko";
  if (japaneseRegex.test(text)) return "ja";
  if (englishRegex.test(text)) return "en";
  return "ko";
}

function normalizeVoiceName(voiceName?: string): keyof typeof VOICES {
  if (!voiceName) return DEFAULT_VOICE;

  if (voiceName in VOICES) {
    return voiceName as keyof typeof VOICES;
  }

  // const alias = VOICE_ALIASES[voiceName];
  // if (alias) return alias;

  logger.warn(
    `Invalid voice name "${voiceName}". Falling back to default voice "${DEFAULT_VOICE}".`
  );
  return DEFAULT_VOICE;
}

function normalizeSpeed(speed: number): number {
  // Supertonic README 권장 범위(0.9~1.5)에 맞춰 Azure식 speed 값을 안전하게 변환.
  const safe = Number.isFinite(speed) ? speed : 30;
  const clamped = Math.min(100, Math.max(0, safe));
  const mapped = 1.05 + (clamped - 30) * 0.005;
  return Math.min(1.5, Math.max(0.9, mapped));
}

function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

async function isCacheValid(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.promises.stat(filePath);
    if (TTS_CACHE_MAX_AGE_DAYS <= 0) return true;
    const maxAgeMs = TTS_CACHE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
    const ageMs = Date.now() - stat.mtimeMs;
    if (ageMs <= maxAgeMs) return true;
    await fs.promises.unlink(filePath).catch(() => undefined);
    return false;
  } catch {
    return false;
  }
}

function writeCacheEnvelope(sampleRate: number, pcmBuffer: Buffer): Buffer {
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32LE(sampleRate, 0);
  return Buffer.concat([header, pcmBuffer]);
}

function readCacheEnvelope(buffer: Buffer): SynthesisResult {
  if (buffer.length < 4) {
    throw new Error("Invalid PCM cache buffer");
  }
  const sampleRate = buffer.readUInt32LE(0);
  return {
    sampleRate,
    pcmBuffer: buffer.subarray(4),
  };
}

async function writeCacheAtomic(filePath: string, result: SynthesisResult) {
  try {
    ensureCacheDir();
    if (!cacheDirReady) return;
    if (fs.existsSync(filePath)) return;

    const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    const payload = writeCacheEnvelope(result.sampleRate, result.pcmBuffer);
    await fs.promises.writeFile(tmpPath, payload);
    await fs.promises.rename(tmpPath, filePath);
  } catch (e) {
    logger.warn("⚠️ TTS 캐시 저장 실패:", e);
  }
}

async function getTextToSpeechEngine(): Promise<TextToSpeechEngine> {
  if (!textToSpeechPromise) {
    const onnxDir = resolveAssetDir("onnx");
    textToSpeechPromise = loadTextToSpeech(onnxDir, false)
      .then((engine) => engine as TextToSpeechEngine)
      .catch((e) => {
        textToSpeechPromise = null;
        throw e;
      });
  }
  return textToSpeechPromise;
}

function getVoiceStyle(voice: keyof typeof VOICES): SupertonicStyle {
  const cached = styleCache.get(voice);
  if (cached) return cached;

  const voiceStylePath = path.join(resolveAssetDir("voice_styles"), `${voice}.json`);
  const style = loadVoiceStyle([voiceStylePath], true) as SupertonicStyle;
  styleCache.set(voice, style);
  return style;
}

function wavFloatToPcm16Buffer(wav: ArrayLike<number>): Buffer {
  const pcm = Buffer.allocUnsafe(wav.length * 2);
  for (let i = 0; i < wav.length; i++) {
    const sample = Math.max(-1, Math.min(1, wav[i] ?? 0));
    const intSample = sample < 0 ? Math.round(sample * 32768) : Math.round(sample * 32767);
    pcm.writeInt16LE(intSample, i * 2);
  }
  return pcm;
}

function resamplePcm16Mono(input: Buffer, fromRate: number, toRate: number): Buffer {
  if (fromRate === toRate) return input;
  if (input.length < 2) return input;

  const inputSamples = Math.floor(input.length / 2);
  const outputSamples = Math.max(1, Math.round((inputSamples * toRate) / fromRate));
  const output = Buffer.allocUnsafe(outputSamples * 2);

  for (let i = 0; i < outputSamples; i++) {
    const srcPos = (i * fromRate) / toRate;
    const leftIndex = Math.floor(srcPos);
    const rightIndex = Math.min(leftIndex + 1, inputSamples - 1);
    const t = srcPos - leftIndex;

    const left = input.readInt16LE(leftIndex * 2);
    const right = input.readInt16LE(rightIndex * 2);
    const interpolated = Math.round(left + (right - left) * t);

    output.writeInt16LE(interpolated, i * 2);
  }

  return output;
}

function monoToStereoPcm16(input: Buffer): Buffer {
  if (input.length < 2) return input;
  const samples = Math.floor(input.length / 2);
  const output = Buffer.allocUnsafe(samples * 4);

  for (let i = 0; i < samples; i++) {
    const sample = input.readInt16LE(i * 2);
    const outOffset = i * 4;
    output.writeInt16LE(sample, outOffset);
    output.writeInt16LE(sample, outOffset + 2);
  }

  return output;
}

function pcmToDiscordRawStream(pcmBuffer: Buffer, sampleRate: number): PassThrough {
  const safeSampleRate =
    Number.isFinite(sampleRate) && sampleRate > 0
      ? Math.floor(sampleRate)
      : DISCORD_PCM_RATE;
  const resampledMono = resamplePcm16Mono(pcmBuffer, safeSampleRate, DISCORD_PCM_RATE);
  const stereoPcm = monoToStereoPcm16(resampledMono);

  if (safeSampleRate !== DISCORD_PCM_RATE) {
    logger.debug(`🎚️ PCM 리샘플링: ${safeSampleRate}Hz -> ${DISCORD_PCM_RATE}Hz`);
  }

  const pcmStream = new PassThrough();
  pcmStream.end(stereoPcm);
  return pcmStream;
}

async function synthesizeWithRetry(
  textData: string,
  lang: string,
  voice: keyof typeof VOICES,
  speed: number,
  retryCount: number
): Promise<SynthesisResult> {
  const engine = await getTextToSpeechEngine();
  const style = getVoiceStyle(voice);
  const normalizedSpeed = normalizeSpeed(speed);

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const { wav } = await engine.call(textData, lang, style, TOTAL_STEP, normalizedSpeed);
      return {
        sampleRate: engine.sampleRate,
        pcmBuffer: wavFloatToPcm16Buffer(wav),
      };
    } catch (e) {
      const absoluteAttempt = retryCount + attempt + 1;
      if (attempt < MAX_RETRIES) {
        logger.warn(`⚠️ Supertonic TTS 재시도 (${absoluteAttempt}/${retryCount + MAX_RETRIES + 1})`);
        await delay(1000 * (attempt + 1));
        continue;
      }
      throw e;
    }
  }

  throw new Error("Unreachable");
}

async function supertonicTTS(
  textData: string,
  callback: (stream: PassThrough | null) => void,
  voiceName: string = DEFAULT_VOICE,
  speed: number = 30,
  retryCount: number = 0
) {
  const stats = getTtsCacheStats();

  try {
    loadPersistedStatsOnce();
    ensureCacheDir();

    const normalizedVoice = normalizeVoiceName(voiceName);
    const detectedLanguage =
      voiceName === "HyunsuMultilingualNeural" ? "ko" : quickLanguageDetect(textData);

    const cacheKey = sha256Hex(
      JSON.stringify({
        v: 2,
        provider: "supertonic",
        lang: detectedLanguage,
        voice: normalizedVoice,
        speed,
        textData,
      })
    );
    const cacheFilePath = path.join(TTS_CACHE_DIR, `${cacheKey}.pcm`);

    if (cacheDirReady && (await isCacheValid(cacheFilePath))) {
      try {
        const payload = await fs.promises.readFile(cacheFilePath);
        const cached = readCacheEnvelope(payload);
        stats.hits += 1;
        scheduleStatsFlush();
        callback(pcmToDiscordRawStream(cached.pcmBuffer, cached.sampleRate));
        return;
      } catch (cacheReadError) {
        logger.warn("⚠️ TTS 캐시 읽기 실패, 재합성 진행:", cacheReadError);
      }
    }

    let synthesisPromise = inFlightSynthesis.get(cacheKey);
    if (!synthesisPromise) {
      stats.misses += 1;
      scheduleStatsFlush();

      synthesisPromise = (async () => {
        const result = await synthesizeWithRetry(
          textData,
          detectedLanguage,
          normalizedVoice,
          speed,
          retryCount
        );
        await writeCacheAtomic(cacheFilePath, result);
        return result;
      })();
      inFlightSynthesis.set(cacheKey, synthesisPromise);
    } else {
      stats.inflightWaits += 1;
      scheduleStatsFlush();
    }

    try {
      const result = await synthesisPromise;
      callback(pcmToDiscordRawStream(result.pcmBuffer, result.sampleRate));
    } catch (e) {
      stats.errors += 1;
      scheduleStatsFlush();
      throw e;
    } finally {
      if (inFlightSynthesis.get(cacheKey) === synthesisPromise) {
        inFlightSynthesis.delete(cacheKey);
      }
    }
  } catch (error) {
    logger.error("❌ Supertonic TTS 합성 실패:", error);
    stats.errors += 1;
    scheduleStatsFlush();

    try {
      callback(null);
    } catch (callbackError) {
      logger.error("❌ Supertonic TTS 실패 콜백 오류:", callbackError);
    }
  }
}

/**
 * TTS 캐시 폴더 정리
 *
 * @remarks
 * 1) mtime 기준 TTS_CACHE_MAX_AGE_DAYS 초과 파일 삭제 (접근 여부와 무관하게 스윕)
 * 2) 그래도 총 용량이 TTS_CACHE_MAX_BYTES를 초과하면 오래된 파일부터(LRU) 삭제
 *
 * `.pcm` 캐시 파일만 대상으로 하며 통계 파일(tts-stats-*.json)은 건드리지 않는다.
 */
async function cleanupCacheDir(): Promise<void> {
  if (cacheCleanupRunning) return;
  cacheCleanupRunning = true;
  try {
    ensureCacheDir();
    if (!cacheDirReady) return;

    let names: string[];
    try {
      names = await fs.promises.readdir(TTS_CACHE_DIR);
    } catch {
      return;
    }

    const pcmFiles = names.filter((n) => n.endsWith(".pcm"));
    if (pcmFiles.length === 0) return;

    const maxAgeMs =
      TTS_CACHE_MAX_AGE_DAYS > 0
        ? TTS_CACHE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000
        : 0;
    const now = Date.now();

    const entries: { path: string; size: number; mtimeMs: number }[] = [];
    let removedByAge = 0;

    for (const name of pcmFiles) {
      const filePath = path.join(TTS_CACHE_DIR, name);
      try {
        const stat = await fs.promises.stat(filePath);

        // 1) 나이 초과 파일 삭제
        if (maxAgeMs > 0 && now - stat.mtimeMs > maxAgeMs) {
          await fs.promises.unlink(filePath).catch(() => undefined);
          removedByAge++;
          continue;
        }

        entries.push({
          path: filePath,
          size: stat.size,
          mtimeMs: stat.mtimeMs,
        });
      } catch {
        // 개별 파일 처리 실패는 무시
      }
    }

    // 2) 총 용량 상한 초과 시 LRU(오래된 mtime부터) 삭제
    let removedBySize = 0;
    if (TTS_CACHE_MAX_BYTES > 0) {
      let totalBytes = entries.reduce((acc, e) => acc + e.size, 0);
      if (totalBytes > TTS_CACHE_MAX_BYTES) {
        entries.sort((a, b) => a.mtimeMs - b.mtimeMs); // 오래된 순
        for (const entry of entries) {
          if (totalBytes <= TTS_CACHE_MAX_BYTES) break;
          try {
            await fs.promises.unlink(entry.path);
            totalBytes -= entry.size;
            removedBySize++;
          } catch {
            // 무시
          }
        }
      }
    }

    if (removedByAge > 0 || removedBySize > 0) {
      logger.info(
        `🧹 TTS 캐시 정리: 만료 ${removedByAge}개, 용량초과 ${removedBySize}개 삭제`
      );
    }
  } catch (e) {
    logger.warn("⚠️ TTS 캐시 정리 실패:", e);
  } finally {
    cacheCleanupRunning = false;
  }
}

// 시작 시 1회 정리 후 주기적으로 반복 (타이머는 unref로 프로세스 종료를 막지 않음)
void cleanupCacheDir();
{
  const cacheCleanupTimer = setInterval(() => {
    void cleanupCacheDir();
  }, TTS_CACHE_CLEANUP_INTERVAL_MS);
  if (typeof cacheCleanupTimer.unref === "function") {
    cacheCleanupTimer.unref();
  }
}

// 시작 시점에 모델/기본 스타일을 미리 로드해 첫 요청 지연을 줄인다.
void getTextToSpeechEngine()
  .then(() => {
    try {
      getVoiceStyle(DEFAULT_VOICE);
      logger.info(`⚡ Supertonic 워밍업 완료 (totalStep=${TOTAL_STEP}, speedRange=0.9~1.5)`);
    } catch (e) {
      logger.warn("⚠️ Supertonic 스타일 워밍업 실패:", e);
    }
  })
  .catch((e) => {
    logger.warn("⚠️ Supertonic 엔진 워밍업 실패:", e);
  });

export default supertonicTTS;
