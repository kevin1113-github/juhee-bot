/**
 * @fileoverview Microsoft Azure Cognitive Services TTS 연동
 * @description Azure Speech API를 사용한 텍스트 음성 변환
 * @author kevin1113dev
 */

import sdk from "microsoft-cognitiveservices-speech-sdk";
import { __dirname } from "./const.js";
import { PassThrough } from "stream";
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
  
  try {
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

    // speechConfig.speechSynthesisOutputFormat = sdk.SpeechSynthesisOutputFormat.Riff48Khz16BitMonoPcm;
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

    // console.log(ssml);

    speechSynthesizer.speakSsmlAsync(
      ssml,
      (result) => {
        try {
          speechSynthesizer.close();

          if (result.errorDetails) {
            logger.error("❌ TTS 합성 오류:", result.errorDetails);
            
            // websocket 에러나 내부 서버 에러의 경우 재시도
            const errorMessage = result.errorDetails?.toString() || '';
            const isRetriableError = errorMessage.includes('websocket error') || 
                                    errorMessage.includes('Internal server error') ||
                                    errorMessage.includes('1011');
            
            if (isRetriableError && retryCount < MAX_RETRIES) {
              logger.debug(`⚠️ TTS 재시도 (${retryCount + 1}/${MAX_RETRIES})`);
              setTimeout(() => {
                msTTS(textData, callback, voiceName, speed, retryCount + 1);
              }, 1000 * (retryCount + 1)); // 1초, 2초 간격으로 재시도
            } else {
              // 재시도 불가능하거나 재시도 횟수 초과 시 콜백 호출
              logger.debug(`❌ TTS 재시도 한계 도달 (${retryCount}/${MAX_RETRIES})`);
              if (typeof callback === 'function') {
                try {
                  callback(null); // null을 전달하여 오디오가 없음을 알림
                } catch (callbackError) {
                  logger.error("❌ TTS 오류 콜백 실패:", callbackError);
                }
              }
            }
            return;
          }

          const { audioData } = result;
          if (!audioData) {
            logger.debug(`⚠️ TTS audioData 비어있음`);
            // 오디오 데이터가 없어도 콜백을 호출
            if (typeof callback === 'function') {
              try {
                callback(null);
              } catch (callbackError) {
                logger.error("❌ 빈 audioData 콜백 실패:", callbackError);
              }
            }
            return;
          }

          // convert arrayBuffer to stream
          const bufferStream = new PassThrough();
          bufferStream.end(Buffer.from(audioData));
          if (typeof callback === 'function') {
            try {
              callback(bufferStream);
            } catch (callbackError) {
              logger.error("❌ TTS 스트림 콜백 실패:", callbackError);
            }
          }
        } catch (callbackError) {
          logger.error("❌ TTS 콜백 처리 오류:", callbackError);
          // 콜백 에러가 발생해도 안전하게 처리
          try {
            if (typeof callback === 'function') {
              callback(null);
            }
          } catch (safeCallbackError) {
            logger.error("❌ 안전 콜백 처리 오류:", safeCallbackError);
          }
        }
      },
      (error) => {
        logger.error("❌ TTS 합성 실패:", error);
        speechSynthesizer.close();
        
        // websocket 에러나 내부 서버 에러의 경우 재시도
        const errorMessage = error?.toString() || '';
        const isRetriableError = errorMessage.includes('websocket error') || 
                                errorMessage.includes('Internal server error') ||
                                errorMessage.includes('1011');
        
        if (isRetriableError && retryCount < MAX_RETRIES) {
          logger.debug(`⚠️ TTS 재시도 (${retryCount + 1}/${MAX_RETRIES})`);
          setTimeout(() => {
            msTTS(textData, callback, voiceName, speed, retryCount + 1);
          }, 1000 * (retryCount + 1)); // 1초, 2초 간격으로 재시도
        } else {
          // 재시도 불가능하거나 재시도 횟수 초과 시 콜백 호출
          logger.debug(`❌ TTS 재시도 한계 도달 (${retryCount}/${MAX_RETRIES})`);
          if (typeof callback === 'function') {
            try {
              callback(null);
            } catch (callbackError) {
              logger.error("❌ 합성 실패 콜백 오류:", callbackError);
            }
          }
        }
      }
    );
  } catch (error) {
    logger.error("❌ TTS 초기화 실패:", error);
    
    // 재시도 로직
    if (retryCount < MAX_RETRIES) {
      logger.debug(`⚠️ TTS 재시도 (${retryCount + 1}/${MAX_RETRIES})`);
      setTimeout(() => {
        msTTS(textData, callback, voiceName, speed, retryCount + 1);
      }, 1000 * (retryCount + 1)); // 1초, 2초 간격으로 재시도
    } else {
      logger.debug(`❌ TTS 재시도 한계 도달 (${retryCount}/${MAX_RETRIES})`);
      if (typeof callback === 'function') {
        try {
          callback(null);
        } catch (callbackError) {
          logger.error("❌ 최종 실패 콜백 오류:", callbackError);
        }
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
