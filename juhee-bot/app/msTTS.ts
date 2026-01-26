/**
 * @fileoverview Microsoft Azure Cognitive Services TTS 연동
 * @description Azure Speech API를 사용한 텍스트 음성 변환
 * @author kevin1113dev
 */

import sdk from "microsoft-cognitiveservices-speech-sdk";
import { __dirname } from "./const.js";
import { PassThrough } from "stream";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  TextAnalyticsClient,
  AzureKeyCredential,
} from "@azure/ai-text-analytics";

import dotenv from "dotenv";
import { logger } from "./logger.js";

dotenv.config();

/** Azure Speech API 키 */
const SPEECH_KEY: string = process.env.SPEECH_KEY ?? "";

/** Azure Speech API 리전 */
const SPEECH_REGION: string = process.env.SPEECH_REGION ?? "";

/** 기본 TTS 음성 */
const DEFAULT_VOICE: string = "SeoHyeonNeural";

type TtsCacheStats = {
  hits: number;
  misses: number;
  inflightWaits: number;
  errors: number;
};

declare global {
  // eslint-disable-next-line no-var
  var __juheeTtsCacheStats: TtsCacheStats | undefined;
}

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
  // discord.js ShardingManager가 환경변수로 SHARD_ID를 주는 케이스가 많음
  const shardId = process.env.SHARD_ID;
  if (shardId && shardId.trim().length > 0) return shardId.trim();

  // 일부 환경에선 SHARDS="0,1" 같은 형태로 제공될 수 있음
  const shards = process.env.SHARDS;
  if (shards && shards.trim().length > 0) {
    const first = shards.split(",")[0]?.trim();
    if (first) return first;
  }

  return "single";
}

function getStatsFilePath(): string {
  if (process.env.TTS_STATS_FILE && process.env.TTS_STATS_FILE.trim().length) {
    return path.resolve(process.env.TTS_STATS_FILE);
  }
  const shardId = getShardIdForStats();
  return path.join(TTS_CACHE_DIR, `tts-stats-${shardId}.json`);
}

let statsLoaded = false;
function loadPersistedStatsOnce() {
  if (statsLoaded) return;
  statsLoaded = true;

  try {
    ensureCacheDir();
    if (!cacheDirReady) return;

    const statsPath = getStatsFilePath();
    if (!fs.existsSync(statsPath)) return;

    const raw = fs.readFileSync(statsPath, "utf8");
    const parsed = JSON.parse(raw);
    const stats = getTtsCacheStats();
    stats.hits = Number(parsed?.hits ?? stats.hits) || 0;
    stats.misses = Number(parsed?.misses ?? stats.misses) || 0;
    stats.inflightWaits = Number(parsed?.inflightWaits ?? stats.inflightWaits) || 0;
    stats.errors = Number(parsed?.errors ?? stats.errors) || 0;
  } catch (e) {
    logger.warn("⚠️ TTS 캐시 통계 로드 실패:", e);
  }
}

let flushTimer: NodeJS.Timeout | null = null;
let lastFlushAt = 0;

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
  // 너무 자주 쓰지 않도록 최소 간격 + 디바운스
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

/**
 * TTS 오디오 캐시 디렉토리
 *
 * @remarks
 * - 기본값은 프로젝트 실행 경로 기준 `.ttsCache`
 * - 환경변수 `TTS_CACHE_DIR`로 변경 가능
 */
const TTS_CACHE_DIR: string = process.env.TTS_CACHE_DIR
  ? path.resolve(process.env.TTS_CACHE_DIR)
  : path.join(process.cwd(), ".ttsCache");

/** 캐시 파일 최대 보관 기간 (일). 0 이하면 만료 체크 안 함 */
const TTS_CACHE_MAX_AGE_DAYS: number = (() => {
  const raw = process.env.TTS_CACHE_MAX_AGE_DAYS ?? "30";
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : 30;
})();

/** 동일 요청 동시 합성 중복 방지 */
const inFlightSynthesis: Map<string, Promise<Buffer>> = new Map();

let cacheDirReady = false;

function ensureCacheDir() {
  if (cacheDirReady) return;
  try {
    fs.mkdirSync(TTS_CACHE_DIR, { recursive: true });
    cacheDirReady = true;
  } catch (e) {
    // 캐시 디렉토리 생성 실패 시에도 TTS는 계속 동작해야 함
    logger.warn("⚠️ TTS 캐시 디렉토리 생성 실패:", e);
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetriableErrorMessage(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("websocket error") ||
    m.includes("internal server error") ||
    m.includes("1011")
  );
}

function bufferToStream(buffer: Buffer): PassThrough {
  const stream = new PassThrough();
  stream.end(buffer);
  return stream;
}

function fileToStream(filePath: string): PassThrough {
  const stream = new PassThrough();
  const rs = fs.createReadStream(filePath);
  rs.on("error", (e) => stream.destroy(e));
  rs.pipe(stream);
  return stream;
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

async function writeCacheAtomic(filePath: string, data: Buffer) {
  try {
    ensureCacheDir();
    if (!cacheDirReady) return;
    // 이미 파일이 있으면 덮어쓰지 않음
    if (fs.existsSync(filePath)) return;

    const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    await fs.promises.writeFile(tmpPath, data);
    await fs.promises.rename(tmpPath, filePath);
  } catch (e) {
    logger.warn("⚠️ TTS 캐시 저장 실패:", e);
  }
}

async function synthesizeSsmlToBufferWithRetry(
  speechConfig: sdk.SpeechConfig,
  ssml: string,
  maxRetries: number
): Promise<Buffer> {
  let attempt = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const buffer = await new Promise<Buffer>((resolve, reject) => {
        const synthesizer = new sdk.SpeechSynthesizer(speechConfig);
        synthesizer.speakSsmlAsync(
          ssml,
          (result) => {
            try {
              synthesizer.close();
              if (result.errorDetails) {
                const errorMessage = result.errorDetails?.toString() || "";
                const error = new Error(errorMessage);
                (error as any).retriable = isRetriableErrorMessage(errorMessage);
                reject(error);
                return;
              }
              const audioData = result.audioData;
              if (!audioData) {
                reject(new Error("Empty audioData"));
                return;
              }
              resolve(Buffer.from(audioData));
            } catch (e) {
              try {
                synthesizer.close();
              } catch {
                // ignore
              }
              reject(e);
            }
          },
          (error) => {
            try {
              synthesizer.close();
            } catch {
              // ignore
            }
            const errorMessage = error?.toString() || "";
            const err = new Error(errorMessage);
            (err as any).retriable = isRetriableErrorMessage(errorMessage);
            reject(err);
          }
        );
      });

      return buffer;
    } catch (e: any) {
      const retriable = Boolean(e?.retriable);
      const message = e?.message?.toString?.() ?? String(e);

      if (retriable && attempt < maxRetries) {
        attempt += 1;
        logger.debug(`⚠️ TTS 재시도 (${attempt}/${maxRetries})`);
        await delay(1000 * attempt);
        continue;
      }

      logger.error("❌ TTS 합성 오류:", message);
      throw e;
    }
  }
}

/** Azure Language API 키 (언어 감지용, 현재 미사용) */
const LANGUAGE_KEY = process.env.LANGUAGE_KEY ?? "";

/** Azure Language API 엔드포인트 (현재 미사용) */
const LANGUAGE_ENDPOINT = process.env.LANGUAGE_ENDPOINT ?? "";

/** 언어 분석 클라이언트 (현재 미사용) */
const client = new TextAnalyticsClient(
  LANGUAGE_ENDPOINT,
  new AzureKeyCredential(LANGUAGE_KEY)
);

/**
 * Microsoft Azure TTS를 사용하여 텍스트를 음성으로 변환
 * 
 * @param textData - 변환할 텍스트
 * @param callback - 오디오 스트림을 받을 콜백 함수
 * @param voiceName - 사용할 음성 이름 (기본값: SeoHyeonNeural)
 * @param speed - 속도 조절 (0-100, 기본값: 30)
 * @param retryCount - 재시도 횟수 (내부 사용, 기본값: 0)
 * 
 * @remarks
 * - 언어 자동 감지 (한국어, 일본어, 영어)
 * - 오류 발생 시 최대 2번 재시도
 * - Ogg Opus 형식으로 출력
 * - 재시도 간격: 1초, 2초 (점진적 증가)
 */
async function msTTS(
  textData: string,
  callback: Function,
  voiceName: string = DEFAULT_VOICE,
  speed: number = 30,
  retryCount: number = 0
) {
  const MAX_RETRIES = 2;
  const stats = getTtsCacheStats();
  
  try {
    loadPersistedStatsOnce();

    if (!SPEECH_KEY || !SPEECH_REGION) {
      logger.error("Speech API credentials not configured");
      if (typeof callback === 'function') {
        try {
          callback(null);
        } catch (callbackError) {
          logger.error("Error calling callback for missing credentials:", callbackError);
        }
      }
      return;
    }

    ensureCacheDir();

    const speechConfig = sdk.SpeechConfig.fromSubscription(
      SPEECH_KEY,
      SPEECH_REGION
    );

    let language: string;
    let voice: string;
    // const detectedLanguage = await recognizeLanguage(textData);
    const detectedLanguage = (voiceName == 'HyunsuMultilingualNeural') ? 'ko' : quickLanguageDetect(textData);

    switch (detectedLanguage) {
      case "ko":
        language = "ko-KR";
        voice = language + "-" + (voiceName ?? DEFAULT_VOICE);
        break;
      case "ja":
        language = "ja-JP";
        voice = language + "-AoiNeural";
        break;
      case "en":
        language = "en-US";
        voice = language + "-AnaNeural";
        break;
      default:
        language = "ko-KR";
        voice = language + "-" + (voiceName ?? DEFAULT_VOICE);
        break;
    }

    speechConfig.speechSynthesisOutputFormat =
      sdk.SpeechSynthesisOutputFormat.Ogg24Khz16BitMonoOpus;
    speechConfig.speechSynthesisLanguage = language;
    speechConfig.speechSynthesisVoiceName = voice;

    const speechSynthesizer = new sdk.SpeechSynthesizer(speechConfig);
    const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${language}">
    <voice name="${voice}">
      <prosody rate="+${speed ?? 30}%">${textData}</prosody>
    </voice>
  </speak>`;
    const cacheKey = sha256Hex(
      JSON.stringify({
        v: 1,
        format: "Ogg24Khz16BitMonoOpus",
        language,
        voice,
        speed,
        textData
      })
    );
    const cacheFilePath = path.join(TTS_CACHE_DIR, `${cacheKey}.ogg`);

    // 캐시 히트
    if (cacheDirReady && (await isCacheValid(cacheFilePath))) {
      logger.debug(`💾 TTS 캐시 히트: ${cacheKey}`);
      stats.hits += 1;
      scheduleStatsFlush();
      if (typeof callback === "function") {
        try {
          callback(fileToStream(cacheFilePath));
        } catch (callbackError) {
          logger.error("❌ TTS 캐시 스트림 콜백 실패:", callbackError);
        }
      }
      return;
    }

    // 동일 키 동시 요청은 한 번만 합성
    let synthesisPromise = inFlightSynthesis.get(cacheKey);
    if (!synthesisPromise) {
      stats.misses += 1;
      scheduleStatsFlush();
      synthesisPromise = (async () => {
        const buffer = await synthesizeSsmlToBufferWithRetry(
          speechConfig,
          ssml,
          MAX_RETRIES
        );
        await writeCacheAtomic(cacheFilePath, buffer);
        return buffer;
      })();
      inFlightSynthesis.set(cacheKey, synthesisPromise);
    } else {
      stats.inflightWaits += 1;
      scheduleStatsFlush();
    }

    try {
      const buffer = await synthesisPromise;
      if (typeof callback === "function") {
        try {
          callback(bufferToStream(buffer));
        } catch (callbackError) {
          logger.error("❌ TTS 스트림 콜백 실패:", callbackError);
        }
      }
    } catch (e) {
      stats.errors += 1;
      scheduleStatsFlush();
      throw e;
    } finally {
      // 완료/실패 상관없이 in-flight 제거
      if (inFlightSynthesis.get(cacheKey) === synthesisPromise) {
        inFlightSynthesis.delete(cacheKey);
      }
    }

    return;
  } catch (error) {
    logger.error("❌ TTS 초기화 실패:", error);
    stats.errors += 1;
    scheduleStatsFlush();

    // 합성 재시도는 synthesizeSsmlToBufferWithRetry에서 처리.
    if (typeof callback === "function") {
      try {
        callback(null);
      } catch (callbackError) {
        logger.error("❌ 최종 실패 콜백 오류:", callbackError);
      }
    }
  }
}

/**
 * Azure Language API를 사용한 언어 인식 함수 (현재 비활성화)
 * API 호출 비용 절감을 위해 로컬 언어 감지 사용
 */
// async function recognizeLanguage(text: string): Promise<string> {
//   try {
//     if (recognizeOption && LANGUAGE_KEY && LANGUAGE_ENDPOINT) {
//       const result: DetectLanguageResult = (await client.detectLanguage([text]))[0];
//       if (!result.error) {
//         logger.debug(`🌍 Detected language: ${result.primaryLanguage.iso6391Name}`);
//         return result.primaryLanguage.iso6391Name;
//       } else {
//         logger.warn("Language detection failed, defaulting to Korean:", result.error);
//         return 'ko';
//       }
//     } else {
//       return 'ko';
//     }
//   } catch (error) {
//     logger.error("Error in language recognition:", error);
//     return 'ko';
//   }
// }

/**
 * 빠른 로컬 언어 감지
 * API 호출 없이 정규식으로 언어 판별
 * 
 * @param text - 감지할 텍스트
 * @returns 언어 코드 ('ko', 'ja', 'en')
 * 
 * @remarks
 * - 한글 문자 포함 시: 'ko'
 * - 일본어 문자 포함 시: 'ja'
 * - 영어 문자만 포함 시: 'en'
 * - 그 외: 'ko' (기본값)
 */
function quickLanguageDetect(text: string): string {
  const koreanRegex = /[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/;
  const japaneseRegex = /[ひらがなカタカナ]/;
  const englishRegex = /^[a-zA-Z\s\d\.,!?]+$/;

  if (koreanRegex.test(text)) return "ko";
  if (japaneseRegex.test(text)) return "ja";
  if (englishRegex.test(text)) return "en";
  return "ko"; // 기본값
}

export default msTTS;
